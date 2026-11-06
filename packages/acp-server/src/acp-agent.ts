import type * as acp from "@agentclientprotocol/sdk";
import { product } from "@spiritagent/product";
import type * as schema from "@agentclientprotocol/sdk";
import { RequestError } from "@agentclientprotocol/sdk";
import type { JsonValue, LlmActiveSkill, RuntimeEvent } from "@spiritagent/agent-core";
import { llmMessageTextContent } from "@spiritagent/agent-core";
import type { AuthState } from "./auth/auth-state.js";
import { buildAuthMethods } from "./auth/build-auth-methods.js";
import { TERMINAL_AUTH_METHOD_ID } from "./auth/constants.js";
import { canCreateSession } from "./auth/session-auth.js";
import { hasResolvableCredentials } from "@spiritagent/host-internal";
import {
  mapRuntimeEventToUpdate,
  createEventMapperState,
  type EventMapperState,
} from "./event-mapper.js";
import { handleApprovalRequest, handleQuestionsRequest } from "./permission-bridge.js";
import {
  buildAvailableCommands,
  parseSlashCommand,
  buildActiveSkillPayload,
  upsertActiveSkill,
} from "./skill-bridge.js";
import { extractPromptImages } from "./prompt-images.js";
import { SessionManager } from "./session-manager.js";
import { mapSessionSetupError } from "./transport/map-setup-error.js";
import { AVAILABLE_MODES } from "./types.js";
import type { AcpServerConfig } from "./types.js";

/**
 * Spirit implementation of the ACP Agent interface.
 *
 * Bridges ACP JSON-RPC messages to AgentRuntime calls.
 */
export class SpiritAcpAgent implements acp.Agent {
  private readonly connection: acp.AgentSideConnection;
  private readonly config: AcpServerConfig;
  private readonly sessionManager: SessionManager;
  private readonly authState: AuthState;
  /** Per-session event mapper state for tracking streaming deltas */
  private readonly mapperStates = new Map<string, EventMapperState>();
  /** Per-session prompt generation counter to prevent stale turn results */
  private readonly promptGenerations = new Map<string, number>();
  private readonly loadingSessions = new Set<string>();

  constructor(connection: acp.AgentSideConnection, config: AcpServerConfig, authState: AuthState) {
    this.connection = connection;
    this.config = config;
    this.authState = authState;
    this.sessionManager = new SessionManager(config);
  }

  async initialize(_params: schema.InitializeRequest): Promise<schema.InitializeResponse> {
    const authMethods = buildAuthMethods();

    return {
      protocolVersion: 1, // PROTOCOL_VERSION
      agentCapabilities: {
        loadSession: true,
        auth: {
          logout: {},
        },
        promptCapabilities: {
          image: true,
        },
        sessionCapabilities: {
          close: {},
          delete: {},
        },
      },
      agentInfo: {
        name: "spirit",
        title: product.name,
        version: "1.0.0-alpha.0",
      },
      authMethods,
    };
  }

  async newSession(params: schema.NewSessionRequest): Promise<schema.NewSessionResponse> {
    if (!canCreateSession(this.config, this.authState)) {
      throw RequestError.authRequired(
        undefined,
        "Authentication required before creating a session",
      );
    }

    const workspaceRoot = params.cwd;

    let result;
    try {
      result = await this.sessionManager.createSession(workspaceRoot, (sessionId, event) =>
        this.handleRuntimeEvent(sessionId, event),
      );
    } catch (err) {
      throw mapSessionSetupError(err);
    }

    // Create fresh mapper state for this session
    this.mapperStates.set(result.sessionId, createEventMapperState());

    // Advertise available slash commands from skill catalog.
    // IMPORTANT: Defer to after the session/new response is sent.
    // If we await or even fire-and-forget the notification here, the SDK's
    // internal message queue may send it before the session/new response,
    // causing Zed to discard it (session ID not yet known to the client).
    const commands = buildAvailableCommands(result.enabledSkillCatalog);
    if (commands.length > 0) {
      const sessionId = result.sessionId;
      setTimeout(() => {
        this.connection
          .sessionUpdate({
            sessionId,
            update: {
              sessionUpdate: "available_commands_update",
              availableCommands: commands,
            },
          } as unknown as schema.SessionNotification)
          .catch((err) => {
            console.error("Failed to send available commands:", err);
          });
      }, 0);
    }

    return {
      sessionId: result.sessionId,
      modes: {
        currentModeId: "agent",
        availableModes: AVAILABLE_MODES.map((m) => ({
          id: m.id,
          name: m.name,
          description: m.description,
        })),
      },
    };
  }

  async authenticate(
    params: schema.AuthenticateRequest,
  ): Promise<schema.AuthenticateResponse | void> {
    if (params.methodId !== TERMINAL_AUTH_METHOD_ID) {
      throw RequestError.invalidParams(
        { methodId: params.methodId, expected: TERMINAL_AUTH_METHOD_ID },
        `Unsupported authentication method: ${params.methodId}`,
      );
    }

    if (!hasResolvableCredentials(this.config.spiritDataDir)) {
      throw RequestError.authRequired(
        { reason: "missing_credentials" },
        "Provider credentials are not configured. Run setup in the terminal first.",
      );
    }
    this.authState.markAuthenticated();
    return {};
  }

  async loadSession(params: schema.LoadSessionRequest): Promise<schema.LoadSessionResponse> {
    if (!canCreateSession(this.config, this.authState)) throw RequestError.authRequired();
    this.loadingSessions.add(params.sessionId);
    try {
      const result = await this.sessionManager.loadSession(
        params.sessionId,
        params.cwd,
        (sessionId, event) => this.handleRuntimeEvent(sessionId, event),
      );
      return await this.sessionManager.withSession(params.sessionId, async (session) => {
        const mapper = createEventMapperState();
        this.mapperStates.set(params.sessionId, mapper);
        const notifications = session.runtime.backgroundTaskNotifications();
        const noticeContents = new Set(notifications.map((notice) => notice.content));
        const taskCalls = new Map(
          session.runtime.backgroundTaskRecords().map((task) => [task.toolCallId, task]),
        );
        for (const message of session.runtime.history()) {
          const text = llmMessageTextContent(message.content);
          if (noticeContents.has(text)) continue;
          if ((message.role === "user" || message.role === "assistant") && text) {
            await this.connection.sessionUpdate({
              sessionId: params.sessionId,
              update: {
                sessionUpdate:
                  message.role === "user" ? "user_message_chunk" : "agent_message_chunk",
                content: { type: "text", text },
              },
            });
          }
          for (const call of message.toolCalls ?? []) {
            const update = mapRuntimeEventToUpdate(
              {
                kind: "streaming-tool-preview",
                toolCallId: call.id,
                toolName: call.name,
                argumentsJson: call.argumentsJson,
              },
              params.sessionId,
              mapper,
            );
            if (update) await this.connection.sessionUpdate(update);
          }
          if (message.role === "tool" && message.toolCallId) {
            const task = taskCalls.get(message.toolCallId);
            const failed =
              task &&
              !task.background &&
              ["failed", "stopped", "interrupted"].includes(task.status);
            await this.connection.sessionUpdate({
              sessionId: params.sessionId,
              update: {
                sessionUpdate: "tool_call_update",
                toolCallId: message.toolCallId,
                status: failed ? "failed" : "completed",
                content: [{ type: "content", content: { type: "text", text } }],
              },
            });
          }
        }
        for (const notice of notifications) {
          const update = mapRuntimeEventToUpdate(
            { kind: "background-task-notification", ...notice },
            params.sessionId,
            mapper,
          );
          if (update) await this.connection.sessionUpdate(update);
        }
        return {
          modes: { currentModeId: result.currentMode, availableModes: [...AVAILABLE_MODES] },
        };
      });
    } catch (error) {
      throw mapSessionSetupError(error);
    } finally {
      this.loadingSessions.delete(params.sessionId);
    }
  }

  async unstable_logout(_params: schema.LogoutRequest): Promise<schema.LogoutResponse | void> {
    this.authState.logout();
    return {};
  }

  async setSessionMode(
    params: schema.SetSessionModeRequest,
  ): Promise<schema.SetSessionModeResponse | void> {
    const mode = await this.sessionManager.setSessionMode(params.sessionId, params.modeId);

    // Notify client of mode change
    await this.connection.sessionUpdate({
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "current_mode_update",
        currentModeId: mode,
      },
    } as unknown as schema.SessionNotification);

    return {};
  }

  async prompt(params: schema.PromptRequest): Promise<schema.PromptResponse> {
    const session = this.sessionManager.requireSession(params.sessionId);

    this.sessionManager.cancel(params.sessionId);

    // Increment generation so stale prompt completions are discarded
    const generation = (this.promptGenerations.get(params.sessionId) ?? 0) + 1;
    this.promptGenerations.set(params.sessionId, generation);

    // Extract text from prompt content blocks
    let userInput = extractPromptText(params.prompt);

    // Detect slash command and activate skill if matched
    const parsed = parseSlashCommand(userInput);
    let activeSkillsForTurn: LlmActiveSkill[] = [];
    if (parsed) {
      const entry = session.enabledSkillCatalog.find((s) => s.name === parsed.skillName);
      if (entry) {
        try {
          const payload = await buildActiveSkillPayload(entry);
          upsertActiveSkill(session.activeSkills, payload);
          activeSkillsForTurn = [payload];
          userInput =
            parsed.remainingText ||
            `Please follow the activated skill "${parsed.skillName}" to handle the current task.`;
        } catch (err) {
          console.error(`Failed to activate skill "${parsed.skillName}":`, err);
        }
      }
    }

    // Reset thinking delta tracker for the new prompt turn
    const mapper = this.mapperStates.get(params.sessionId) ?? createEventMapperState();
    mapper.sentThinkingLength = 0;
    this.mapperStates.set(params.sessionId, mapper);

    try {
      // Extract images from content blocks
      const { paths: explicitImages, cleanup: cleanupImages } = await extractPromptImages(
        params.prompt,
      );

      try {
        if (this.promptGenerations.get(params.sessionId) !== generation) {
          return { stopReason: "cancelled" };
        }
        const stopReason = await this.sessionManager.runPrompt(
          params.sessionId,
          userInput,
          explicitImages,
          activeSkillsForTurn,
        );

        // Check if a newer prompt has superseded this one
        if (this.promptGenerations.get(params.sessionId) !== generation) {
          return { stopReason: "cancelled" };
        }

        return { stopReason };
      } finally {
        // Clean up temp files after the entire turn completes (LLM may still
        // read image files during processing between start and completion)
        await cleanupImages();
      }
    } catch (err) {
      // Stale generation — a newer prompt took over, treat as cancelled
      if (this.promptGenerations.get(params.sessionId) !== generation) {
        return { stopReason: "cancelled" };
      }

      const aborted = session.pendingPrompt?.signal.aborted ?? false;
      session.pendingPrompt = null;

      if (aborted) {
        return { stopReason: "cancelled" };
      }

      // Re-throw unexpected errors
      throw err;
    }
  }

  async cancel(params: schema.CancelNotification): Promise<void> {
    this.promptGenerations.set(
      params.sessionId,
      (this.promptGenerations.get(params.sessionId) ?? 0) + 1,
    );
    this.sessionManager.cancel(params.sessionId);
  }

  async closeSession(
    params: schema.CloseSessionRequest,
  ): Promise<schema.CloseSessionResponse | void> {
    await this.sessionManager.closeSession(params.sessionId);
    this.mapperStates.delete(params.sessionId);
    this.promptGenerations.delete(params.sessionId);
    return {};
  }

  async deleteSession(params: schema.DeleteSessionRequest): Promise<schema.DeleteSessionResponse> {
    try {
      await this.sessionManager.deleteSession(params.sessionId);
    } catch (error) {
      throw mapSessionSetupError(error);
    }
    this.mapperStates.delete(params.sessionId);
    this.promptGenerations.delete(params.sessionId);
    return {};
  }

  async shutdown(): Promise<void> {
    await this.sessionManager.shutdown();
    this.mapperStates.clear();
    this.promptGenerations.clear();
  }

  /**
   * Handles runtime events by forwarding them to the ACP client.
   * For approval-requested events, triggers the permission bridge.
   */
  private handleRuntimeEvent(sessionId: string, event: RuntimeEvent<JsonValue>): void {
    if (event.kind === "background-task-notification" && this.loadingSessions.has(sessionId))
      return;
    // Handle approval requests asynchronously
    if (event.kind === "approval-requested") {
      const targetSessionId =
        event.approval.subagentSessionId ??
        this.sessionManager.delegatedInputSessionId(
          sessionId,
          "approval",
          event.approval.requestId,
        ) ??
        sessionId;
      const session = this.sessionManager.getSession(targetSessionId);
      if (session) {
        void handleApprovalRequest(this.connection, sessionId, event.approval)
          .then(async (decision) => {
            const pending = session.runtime.currentPendingApproval(event.approval.requestId);
            if (
              pending?.request !== event.approval.request ||
              pending?.toolCallId !== event.approval.toolCallId ||
              (pending?.subagentSessionId !== undefined &&
                pending.subagentSessionId !== event.approval.subagentSessionId)
            )
              return;
            // Early-stream execution can await this decision inside the session pump.
            await session.runtime.continuePendingApproval(decision, event.approval.requestId);
          })
          .catch((error: unknown) =>
            console.error("Failed to apply ACP permission response:", error),
          );
      }
      return;
    }

    // Handle questions-requested by degrading to a permission prompt
    if (event.kind === "questions-requested") {
      const targetSessionId =
        this.sessionManager.delegatedInputSessionId(
          sessionId,
          "questions",
          event.questions.requestId,
        ) ?? sessionId;
      const session = this.sessionManager.getSession(targetSessionId);
      if (session) {
        const description = event.questions.questions.title ?? event.questions.toolName;
        void handleQuestionsRequest(this.connection, sessionId, { prompt: description })
          .then(async (allowed) => {
            const pending = session.runtime.currentPendingQuestions(event.questions.requestId);
            if (
              pending?.request !== event.questions.request ||
              pending?.toolCallId !== event.questions.toolCallId
            )
              return;
            await session.runtime.continuePendingQuestions(
              allowed ? { status: "answered", answers: [] } : { status: "skipped" },
              event.questions.requestId,
            );
          })
          .catch((error: unknown) =>
            console.error("Failed to apply ACP questionnaire response:", error),
          );
      }
      return;
    }

    // Forward other events to ACP client
    if (event.kind === "background-task-error") console.error("[acp-server]", event.error);
    let mapperState = this.mapperStates.get(sessionId);
    if (!mapperState) {
      mapperState = createEventMapperState();
      this.mapperStates.set(sessionId, mapperState);
    }
    const update = mapRuntimeEventToUpdate(event, sessionId, mapperState);
    if (update) {
      this.connection.sessionUpdate(update).catch((err) => {
        console.error("Failed to send session update:", err);
      });
    }
  }
}

/**
 * Extracts text content from ACP prompt content blocks.
 */
function extractPromptText(prompt: schema.ContentBlock[]): string {
  const parts: string[] = [];

  for (const block of prompt) {
    if (block.type === "text") {
      parts.push(block.text);
    } else if (block.type === "resource" && "text" in block.resource) {
      const resource = block.resource as { uri?: string; text?: string };
      parts.push(`[File: ${resource.uri ?? "unknown"}]\n${resource.text ?? ""}`);
    } else if (block.type === "resource_link") {
      const link = block as { uri?: string; name?: string };
      parts.push(`[Link: ${link.name ?? link.uri ?? "unknown"}]`);
    }
  }

  return parts.join("\n\n");
}
