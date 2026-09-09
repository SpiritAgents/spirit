import { randomUUID } from "node:crypto";
import { createServer, type Server as HttpServer } from "node:http";
import type { Socket } from "node:net";

import {
  configureLlmClientVersion,
  configureLlmHttpVersion,
  normalizeLlmHttpVersion,
} from "@spiritagent/agent-core";

import { loadOrCreateToken, readCurrentToken, tokenEquals } from "./auth-token.js";
import {
  registerInstance,
  unregisterInstance,
  type ServerInstanceRecord,
} from "./instance-registry.js";
import {
  JSON_RPC_INTERNAL_ERROR,
  JSON_RPC_INVALID_REQUEST,
  JSON_RPC_METHOD_NOT_FOUND,
  JSON_RPC_PARSE_ERROR,
  PROTOCOL_VERSION,
  RUNTIME_EVENT,
  SERVER_CONNECTED,
  SERVER_HEALTH,
  SERVER_INITIALIZE,
  SESSION_ABORT,
  SESSION_ABORT_SHELL,
  SESSION_ACTIVATE_SKILL,
  SESSION_ADD_PENDING_IMAGE,
  SESSION_APPLY_MCP_PROMPT,
  SESSION_ATTACH,
  SESSION_ATTACH_MCP_RESOURCE,
  SESSION_CLEAR_PENDING_IMAGES,
  SESSION_CLEAR_PENDING_MCP_RESOURCES,
  SESSION_CLOSE,
  SESSION_COMPACT_HISTORY,
  SESSION_CONTINUE_COMPLETION,
  SESSION_CONTINUE_MANUAL_APPROVAL,
  SESSION_CREATE,
  SESSION_DETACH,
  SESSION_DESKTOP_TIMELINE_UPDATED,
  SESSION_EXPORT_ARCHIVE,
  SESSION_EXPORT_STATE,
  SESSION_GET_DESKTOP_TIMELINE,
  SESSION_LIST,
  SESSION_MIGRATE_CONVERSATION_KEY,
  SESSION_MCP,
  SESSION_POLL,
  SESSION_PUSH_DESKTOP_TIMELINE,
  SESSION_RENAME,
  SESSION_REPLY_PENDING_APPROVAL,
  SESSION_REPLY_PENDING_QUESTIONS,
  SESSION_RESOLVE_EXTENSION_UI,
  SESSION_REPLY_TRUST,
  SESSION_RESET,
  SESSION_REPLACE_CONFIG,
  SESSION_REPLACE_FROM_ARCHIVE,
  SESSION_RUN_SESSION_START,
  SESSION_RUN_SESSION_END,
  SESSION_RELOAD_METADATA,
  SESSION_SET_APPROVAL_LEVEL,
  SESSION_SET_ATTRIBUTION,
  SESSION_SET_TODO_SESSION_KEY,
  SESSION_SET_LOOP_ENABLED,
  SESSION_SET_MODE,
  SESSION_SNAPSHOT,
  SESSION_START_MANUAL_TOOL_COMMAND,
  SESSION_SUBAGENT_ARCHIVE,
  SESSION_SUBAGENT_AUX,
  SESSION_SUBAGENT_EVENTS,
  SESSION_SUBMIT_USER_TURN,
  SESSION_TAKE_MANUAL_RESULT,
  SESSION_TURN_FINISHED,
  SESSION_USER_TURN_SUBMITTED,
  SESSION_FILE_CHANGED,
  SESSION_TITLE_UPDATED,
  SESSION_EXTENSION_UI_REQUESTED,
  SERVER_SET_LLM_CLIENT_VERSION,
  SERVER_SET_LLM_HTTP_VERSION,
  WORKSPACE_TRUST_REQUESTED,
  errorResponse,
  isJsonRpcRequest,
  notification,
  successResponse,
  type ClientKind,
  type ServerHealthResult,
  type ServerInitializeResult,
} from "./protocol/index.js";
import { SessionManager } from "./session-manager.js";
import { HostService, HOST_METHODS } from "./host-service.js";
import {
  normalizeHostToolDescriptionHints,
  normalizeHostUiPromptSection,
} from "./host-ui-prompt.js";

const SESSION_METHODS = new Set([
  SESSION_CREATE,
  SESSION_ATTACH,
  SESSION_DETACH,
  SESSION_LIST,
  SESSION_MIGRATE_CONVERSATION_KEY,
  SESSION_CLOSE,
  SESSION_SUBMIT_USER_TURN,
  SESSION_ABORT,
  SESSION_ABORT_SHELL,
  SESSION_SET_APPROVAL_LEVEL,
  SESSION_SET_MODE,
  SESSION_SET_LOOP_ENABLED,
  SESSION_RESET,
  SESSION_RENAME,
  SESSION_CONTINUE_COMPLETION,
  SESSION_COMPACT_HISTORY,
  SESSION_POLL,
  SESSION_REPLY_PENDING_APPROVAL,
  SESSION_REPLY_PENDING_QUESTIONS,
  SESSION_RESOLVE_EXTENSION_UI,
  SESSION_REPLY_TRUST,
  SESSION_REPLACE_FROM_ARCHIVE,
  SESSION_EXPORT_ARCHIVE,
  SESSION_EXPORT_STATE,
  SESSION_PUSH_DESKTOP_TIMELINE,
  SESSION_GET_DESKTOP_TIMELINE,
  SESSION_ACTIVATE_SKILL,
  SESSION_ADD_PENDING_IMAGE,
  SESSION_CLEAR_PENDING_IMAGES,
  SESSION_ATTACH_MCP_RESOURCE,
  SESSION_CLEAR_PENDING_MCP_RESOURCES,
  SESSION_APPLY_MCP_PROMPT,
  SESSION_MCP,
  SESSION_START_MANUAL_TOOL_COMMAND,
  SESSION_CONTINUE_MANUAL_APPROVAL,
  SESSION_TAKE_MANUAL_RESULT,
  SESSION_SUBAGENT_ARCHIVE,
  SESSION_SUBAGENT_AUX,
  SESSION_REPLACE_CONFIG,
  SESSION_RELOAD_METADATA,
  SESSION_RUN_SESSION_START,
  SESSION_RUN_SESSION_END,
  SESSION_SET_ATTRIBUTION,
  SESSION_SET_TODO_SESSION_KEY,
]);

const SERVER_METHODS = new Set([SERVER_SET_LLM_HTTP_VERSION, SERVER_SET_LLM_CLIENT_VERSION]);
import {
  acceptUpgrade,
  isWebSocketUpgrade,
  rejectUpgrade,
  type WebSocketConnection,
} from "./ws/websocket-server.js";

/** After the last client disconnects, wait this long before exiting (multi-host handoff). */
export const DEFAULT_IDLE_EXIT_GRACE_MS = 2_500;

function safeStderrLog(message: string): void {
  try {
    console.error(message);
  } catch {
    // Parent host may die first and break the forwarded stderr pipe (EPIPE).
  }
}

export interface DaemonOptions {
  /** Bind hostname; defaults to loopback. Pass 0.0.0.0 only for explicit remote access. */
  host?: string;
  /** 0 lets the OS pick a free port (default). */
  port?: number;
  dataDir: string;
  version: string;
  log?: (message: string) => void;
  /**
   * Idle-exit grace after the last client disconnects.
   * - number: wait that many ms then close (default {@link DEFAULT_IDLE_EXIT_GRACE_MS})
   * - null: never auto-exit (tests / keep-alive)
   * Startup with zero clients never schedules idle-exit; only a drop from N≥1 → 0 does.
   */
  idleExitGraceMs?: number | null;
  /** Called after an idle-exit `close()` finishes (e.g. `process.exit(0)` in the serve entry). */
  onIdleExit?: () => void;
}

export interface RunningDaemon {
  readonly instanceId: string;
  readonly host: string;
  readonly port: number;
  readonly pid: number;
  readonly startedAt: string;
  readonly url: string;
  close(): Promise<void>;
}

interface ClientState {
  clientKind?: ClientKind;
  clientId?: string;
  workspaceRoot?: string;
  attachedSessionIds?: Set<string>;
}

function extractPresentedToken(headerValue: string | undefined, url: string | undefined): string {
  if (typeof headerValue === "string") {
    const match = /^Bearer\s+(.+)$/i.exec(headerValue.trim());
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  if (url) {
    try {
      const parsed = new URL(url, "http://localhost");
      return parsed.searchParams.get("token")?.trim() ?? "";
    } catch {
      return "";
    }
  }
  return "";
}

export async function startDaemon(options: DaemonOptions): Promise<RunningDaemon> {
  const host = options.host?.trim() || "127.0.0.1";
  const requestedPort = options.port ?? 0;
  const dataDir = options.dataDir;
  const version = options.version;
  const log = options.log ?? safeStderrLog;
  const idleExitGraceMs =
    options.idleExitGraceMs === undefined ? DEFAULT_IDLE_EXIT_GRACE_MS : options.idleExitGraceMs;

  // Ensure the home-level token exists before the first handshake arrives.
  await loadOrCreateToken(dataDir);

  const instanceId = randomUUID();
  const startedAt = new Date().toISOString();
  const connections = new Set<WebSocketConnection>();
  const clientStates = new Map<WebSocketConnection, ClientState>();
  let closed = false;
  let idleExitTimer: ReturnType<typeof setTimeout> | undefined;
  let closeDaemon: () => Promise<void> = async () => {};

  const cancelIdleExit = (): void => {
    if (idleExitTimer === undefined) {
      return;
    }
    clearTimeout(idleExitTimer);
    idleExitTimer = undefined;
  };

  const scheduleIdleExit = (): void => {
    if (idleExitGraceMs === null || closed) {
      return;
    }
    cancelIdleExit();
    const graceMs = Math.max(0, idleExitGraceMs);
    idleExitTimer = setTimeout(() => {
      idleExitTimer = undefined;
      if (closed || connections.size > 0) {
        return;
      }
      log(`[spirit-server] no clients remaining after ${graceMs}ms; shutting down`);
      void closeDaemon().then(() => {
        options.onIdleExit?.();
      });
    }, graceMs);
    idleExitTimer.unref?.();
  };

  const onClientGone = (conn: WebSocketConnection): void => {
    if (closed) {
      return;
    }
    const state = clientStates.get(conn);
    const attached = state?.attachedSessionIds;
    if (attached && attached.size > 0) {
      for (const sessionId of attached) {
        void sessionManager.detachSession(resolveClientId(state), sessionId);
      }
      attached.clear();
    }
    clientStates.delete(conn);
    log(`[spirit-server] client disconnected (${connections.size} remaining)`);
    if (connections.size > 0) {
      return;
    }
    // Nobody left to answer: release parked approvals / questions / trust.
    sessionManager.handleNoClientsRemaining();
    scheduleIdleExit();
  };

  const resolveClientId = (state: ClientState | undefined): string => {
    if (state?.clientId?.trim()) {
      return state.clientId.trim();
    }
    const generated = `client_${randomUUID().replaceAll("-", "")}`;
    if (state) {
      state.clientId = generated;
    }
    return generated;
  };

  const trackAttachment = (conn: WebSocketConnection, sessionId: string): void => {
    let state = clientStates.get(conn);
    if (!state) {
      state = {};
      clientStates.set(conn, state);
    }
    if (!state.attachedSessionIds) {
      state.attachedSessionIds = new Set();
    }
    state.attachedSessionIds.add(sessionId);
  };

  const untrackAttachment = (conn: WebSocketConnection, sessionId: string): void => {
    clientStates.get(conn)?.attachedSessionIds?.delete(sessionId);
  };

  const requireAttachedToSession = (
    clientState: ClientState | undefined,
    sessionId: string,
  ): void => {
    if (!clientState?.attachedSessionIds?.has(sessionId)) {
      throw new Error("client is not attached to session");
    }
  };

  const broadcast = (method: string, params: unknown): void => {
    const frame = JSON.stringify(notification(method, params));
    for (const conn of connections) {
      conn.send(frame);
    }
  };

  const sessionManager = new SessionManager(dataDir, {
    broadcastRuntimeEvent: (sessionId, event) => {
      broadcast(RUNTIME_EVENT, { sessionId, event });
    },
    broadcastSubagentEvents: (sessionId, drains) => {
      broadcast(SESSION_SUBAGENT_EVENTS, { sessionId, drains });
    },
    broadcastUserTurnSubmitted: (sessionId, turn) => {
      broadcast(SESSION_USER_TURN_SUBMITTED, {
        sessionId,
        text: turn.text,
        ...(turn.clientTurnId ? { clientTurnId: turn.clientTurnId } : {}),
        ...(turn.explicitWorkspaceFiles.length > 0
          ? { explicitWorkspaceFiles: turn.explicitWorkspaceFiles }
          : {}),
      });
    },
    broadcastTurnFinished: (sessionId, stopReason, result) => {
      broadcast(SESSION_TURN_FINISHED, {
        sessionId,
        stopReason,
        ...(result ? { result } : {}),
      });
    },
    broadcastSnapshot: (sessionId, snapshot) => {
      broadcast(SESSION_SNAPSHOT, { sessionId, snapshot });
    },
    broadcastTrustRequest: (sessionId, requestId, request) => {
      broadcast(WORKSPACE_TRUST_REQUESTED, { sessionId, requestId, request });
    },
    broadcastExtensionUiRequested: (sessionId, request) => {
      broadcast(SESSION_EXTENSION_UI_REQUESTED, { sessionId, ...request });
    },
    broadcastFileChange: (sessionId, change) => {
      broadcast(SESSION_FILE_CHANGED, { sessionId, change });
    },
    broadcastDesktopTimelineUpdated: (sessionId, revision) => {
      broadcast(SESSION_DESKTOP_TIMELINE_UPDATED, { sessionId, revision });
    },
    broadcastTitleUpdated: (sessionId, title) => {
      broadcast(SESSION_TITLE_UPDATED, { sessionId, title });
    },
    log,
  });

  const hostService = new HostService(dataDir, sessionManager);

  /** Params readers with strict-but-minimal validation at the RPC boundary. */
  const readSessionId = (params: Record<string, unknown>): string => {
    const sessionId = params["sessionId"];
    if (typeof sessionId !== "string" || !sessionId.trim()) {
      throw new Error("missing sessionId");
    }
    return sessionId;
  };

  /** Session RPC surface; `conn` provides the client kind from initialize. */
  const handleSessionRpc = async (
    conn: WebSocketConnection,
    method: string,
    rawParams: unknown,
  ): Promise<unknown> => {
    const params = (rawParams ?? {}) as Record<string, unknown>;
    const clientState = clientStates.get(conn);
    const clientId = resolveClientId(clientState);
    switch (method) {
      case SESSION_CREATE: {
        const workspaceRoot =
          typeof params["workspaceRoot"] === "string" && params["workspaceRoot"].trim()
            ? params["workspaceRoot"]
            : undefined;
        if (!workspaceRoot) {
          throw new Error("missing workspaceRoot");
        }
        const approvalLevel = params["approvalLevel"];
        const todoSessionKey = params["todoSessionKey"];
        const modelRef = params["modelRef"];
        const agentMode = params["agentMode"];
        const conversationKey = params["conversationKey"];
        const sessionKind = params["sessionKind"];
        const dreamScopeRaw = params["dreamScope"];
        const dreamSourceSessionRaw = params["dreamSourceSession"];
        const hostUiPromptSection = normalizeHostUiPromptSection(params["hostUiPromptSection"]);
        const hostToolDescriptionHints = normalizeHostToolDescriptionHints(
          params["hostToolDescriptionHints"],
        );
        const basicInfoHostRaw = params["basicInfoHost"];
        let basicInfoHost: { kind: "Desktop" | "CLI" | "Web"; url?: string } | undefined;
        if (basicInfoHostRaw && typeof basicInfoHostRaw === "object") {
          const raw = basicInfoHostRaw as Record<string, unknown>;
          const kind = raw["kind"];
          if (kind === "Desktop" || kind === "CLI" || kind === "Web") {
            basicInfoHost = { kind };
            if (typeof raw["url"] === "string" && raw["url"].trim()) {
              basicInfoHost.url = raw["url"].trim();
            }
          }
        }
        const dreamScope =
          dreamScopeRaw &&
          typeof dreamScopeRaw === "object" &&
          typeof (dreamScopeRaw as Record<string, unknown>)["workspaceRoot"] === "string" &&
          typeof (dreamScopeRaw as Record<string, unknown>)["gitBranch"] === "string"
            ? {
                workspaceRoot: String(
                  (dreamScopeRaw as Record<string, unknown>)["workspaceRoot"],
                ).trim(),
                gitBranch: String((dreamScopeRaw as Record<string, unknown>)["gitBranch"]).trim(),
              }
            : undefined;
        let dreamSourceSession:
          | { path: string; displayName?: string; savedAtUnixMs?: number }
          | undefined;
        if (
          dreamSourceSessionRaw &&
          typeof dreamSourceSessionRaw === "object" &&
          typeof (dreamSourceSessionRaw as Record<string, unknown>)["path"] === "string"
        ) {
          const raw = dreamSourceSessionRaw as Record<string, unknown>;
          dreamSourceSession = {
            path: String(raw["path"]).trim(),
          };
          if (typeof raw["displayName"] === "string" && raw["displayName"].trim()) {
            dreamSourceSession.displayName = raw["displayName"].trim();
          }
          if (typeof raw["savedAtUnixMs"] === "number") {
            dreamSourceSession.savedAtUnixMs = raw["savedAtUnixMs"];
          }
        }
        const info = await sessionManager.createSession({
          workspaceRoot,
          hostKind: clientState?.clientKind ?? "cli",
          ...(typeof conversationKey === "string" && conversationKey.trim()
            ? { conversationKey: conversationKey.trim() }
            : {}),
          ...(approvalLevel === "auto-approval" ||
          approvalLevel === "bypass-approval" ||
          approvalLevel === "default"
            ? { approvalLevel }
            : {}),
          ...(typeof todoSessionKey === "string" && todoSessionKey.trim()
            ? { todoSessionKey: todoSessionKey.trim() }
            : {}),
          ...(modelRef &&
          typeof modelRef === "object" &&
          typeof (modelRef as Record<string, unknown>)["groupId"] === "string" &&
          typeof (modelRef as Record<string, unknown>)["name"] === "string"
            ? { modelRef: modelRef as never }
            : {}),
          ...(agentMode === "plan" || agentMode === "ask" || agentMode === "debug"
            ? { agentMode }
            : {}),
          ...(sessionKind === "dream-collector" ? { sessionKind: "dream-collector" as const } : {}),
          ...(dreamScope ? { dreamScope } : {}),
          ...(dreamSourceSession ? { dreamSourceSession } : {}),
          ...(hostUiPromptSection ? { hostUiPromptSection } : {}),
          ...(hostToolDescriptionHints ? { hostToolDescriptionHints } : {}),
          ...(basicInfoHost ? { basicInfoHost } : {}),
        });
        return info;
      }
      case SESSION_ATTACH: {
        const sessionId =
          typeof params["sessionId"] === "string" ? params["sessionId"].trim() : undefined;
        const conversationKey =
          typeof params["conversationKey"] === "string"
            ? params["conversationKey"].trim()
            : undefined;
        const result = sessionManager.attachSession(clientId, {
          ...(sessionId ? { sessionId } : {}),
          ...(conversationKey ? { conversationKey } : {}),
        });
        trackAttachment(conn, result.session.sessionId);
        return result;
      }
      case SESSION_DETACH:
      case SESSION_CLOSE: {
        const sessionId = readSessionId(params);
        const result = await sessionManager.detachSession(clientId, sessionId);
        untrackAttachment(conn, sessionId);
        return method === SESSION_DETACH ? result : { ok: true, ...result };
      }
      case SESSION_LIST:
        return { sessions: sessionManager.listSessions() };
      case SESSION_MIGRATE_CONVERSATION_KEY: {
        const conversationKey = params["conversationKey"];
        if (typeof conversationKey !== "string" || !conversationKey.trim()) {
          throw new Error("missing conversationKey");
        }
        await sessionManager.migrateConversationKey(readSessionId(params), conversationKey.trim());
        return { ok: true };
      }
      case SESSION_SUBMIT_USER_TURN: {
        const text = params["text"];
        if (typeof text !== "string") {
          throw new Error("missing text");
        }
        const outcome = await sessionManager.submitUserTurn(readSessionId(params), {
          text,
          ...(typeof params["clientTurnId"] === "string" && params["clientTurnId"].trim()
            ? { clientTurnId: params["clientTurnId"].trim() }
            : {}),
          ...(Array.isArray(params["explicitImages"])
            ? {
                explicitImages: params["explicitImages"].filter(
                  (v): v is string => typeof v === "string",
                ),
              }
            : {}),
          ...(Array.isArray(params["explicitWorkspaceFiles"])
            ? { explicitWorkspaceFiles: params["explicitWorkspaceFiles"] as never }
            : {}),
          ...(Array.isArray(params["activeSkills"])
            ? { activeSkills: params["activeSkills"] as never }
            : {}),
        });
        return outcome;
      }
      case SESSION_ABORT:
        sessionManager.abort(readSessionId(params));
        return { ok: true };
      case SESSION_ABORT_SHELL:
        return {
          aborted: sessionManager.abortShell(
            readSessionId(params),
            String(params["toolCallId"] ?? ""),
          ),
        };
      case SESSION_SET_APPROVAL_LEVEL: {
        const level = params["approvalLevel"];
        if (level !== "default" && level !== "auto-approval" && level !== "bypass-approval") {
          throw new Error("invalid approvalLevel");
        }
        await sessionManager.setApprovalLevel(readSessionId(params), level);
        return { ok: true };
      }
      case SESSION_REPLY_PENDING_APPROVAL: {
        const sessionId = readSessionId(params);
        requireAttachedToSession(clientState, sessionId);
        await sessionManager.replyPendingApproval(sessionId, params["decision"] as never);
        return { ok: true };
      }
      case SESSION_REPLY_PENDING_QUESTIONS: {
        const sessionId = readSessionId(params);
        requireAttachedToSession(clientState, sessionId);
        await sessionManager.replyPendingQuestions(sessionId, params["result"] as never);
        return { ok: true };
      }
      case SESSION_RESOLVE_EXTENSION_UI: {
        const sessionId = readSessionId(params);
        requireAttachedToSession(clientState, sessionId);
        const requestId = params["requestId"];
        if (typeof requestId !== "string" || !requestId) {
          throw new Error("missing requestId");
        }
        sessionManager.resolveExtensionUi(sessionId, requestId, params["result"]);
        return { ok: true };
      }
      case SESSION_SET_MODE: {
        const mode = params["mode"];
        if (mode !== "agent" && mode !== "plan" && mode !== "ask" && mode !== "debug") {
          throw new Error("invalid mode");
        }
        await sessionManager.setAgentMode(readSessionId(params), mode);
        return { ok: true };
      }
      case SESSION_SET_LOOP_ENABLED:
        sessionManager.setLoopEnabled(readSessionId(params), params["enabled"] === true);
        return { ok: true };
      case SESSION_RESET:
        sessionManager.reset(readSessionId(params));
        return { ok: true };
      case SESSION_RENAME: {
        const title = params["title"];
        if (typeof title !== "string") {
          throw new Error("missing title");
        }
        sessionManager.rename(readSessionId(params), title);
        return { ok: true };
      }
      case SESSION_CONTINUE_COMPLETION:
        await sessionManager.continueAssistantCompletion(readSessionId(params));
        return { accepted: true };
      case SESSION_COMPACT_HISTORY:
        await sessionManager.compactHistory(readSessionId(params));
        return { accepted: true };
      case SESSION_POLL:
        return { snapshot: sessionManager.snapshot(readSessionId(params)) };
      case SESSION_REPLY_TRUST: {
        const requestId = params["requestId"];
        const decision = params["decision"];
        if (typeof requestId !== "string" || !requestId) {
          throw new Error("missing requestId");
        }
        if (decision !== "allowOnce" && decision !== "deny" && decision !== "alwaysTrust") {
          throw new Error("invalid decision");
        }
        const sessionId = sessionManager.pendingTrustSessionId(requestId);
        if (!sessionId) {
          throw new Error("unknown trust requestId");
        }
        requireAttachedToSession(clientState, sessionId);
        sessionManager.replyWorkspaceCapabilityTrust(requestId, decision);
        return { ok: true };
      }
      case SESSION_REPLACE_FROM_ARCHIVE:
        sessionManager.replaceFromArchive(readSessionId(params), params["archive"]);
        return { ok: true };
      case SESSION_EXPORT_ARCHIVE:
        return sessionManager.exportArchive(
          readSessionId(params),
          params["messages"],
          params["assistantAux"],
        );
      case SESSION_PUSH_DESKTOP_TIMELINE:
        return sessionManager.pushDesktopTimeline(readSessionId(params), params["timeline"]);
      case SESSION_GET_DESKTOP_TIMELINE:
        return sessionManager.getDesktopTimeline(readSessionId(params));
      case SESSION_EXPORT_STATE:
        return sessionManager.exportState(readSessionId(params));
      case SESSION_ACTIVATE_SKILL:
        sessionManager.activateSkill(readSessionId(params), params["skill"] as never);
        return { ok: true };
      case SESSION_ADD_PENDING_IMAGE:
        sessionManager.addPendingImage(readSessionId(params), String(params["path"] ?? ""));
        return { ok: true };
      case SESSION_CLEAR_PENDING_IMAGES:
        return { cleared: sessionManager.clearPendingImages(readSessionId(params)) };
      case SESSION_ATTACH_MCP_RESOURCE:
        return {
          label: await sessionManager.attachMcpResource(
            readSessionId(params),
            String(params["server"] ?? ""),
            String(params["uri"] ?? ""),
          ),
        };
      case SESSION_CLEAR_PENDING_MCP_RESOURCES:
        return { cleared: sessionManager.clearPendingMcpResources(readSessionId(params)) };
      case SESSION_APPLY_MCP_PROMPT:
        return {
          notice: await sessionManager.applyMcpPrompt(
            readSessionId(params),
            String(params["server"] ?? ""),
            String(params["prompt"] ?? ""),
            typeof params["argsJson"] === "string" ? params["argsJson"] : undefined,
            typeof params["userMessage"] === "string" ? params["userMessage"] : undefined,
          ),
        };
      case SESSION_MCP:
        return sessionManager.mcpCall(
          readSessionId(params),
          String(params["action"] ?? ""),
          (params["params"] ?? {}) as Record<string, unknown>,
        );
      case SESSION_START_MANUAL_TOOL_COMMAND:
        return sessionManager.startManualToolCommand(
          readSessionId(params),
          String(params["message"] ?? ""),
        );
      case SESSION_CONTINUE_MANUAL_APPROVAL:
        return sessionManager.continuePendingManualToolApproval(
          readSessionId(params),
          params["decision"],
        );
      case SESSION_TAKE_MANUAL_RESULT:
        return sessionManager.takeCompletedManualToolCommandResult(readSessionId(params));
      case SESSION_SUBAGENT_ARCHIVE:
        return sessionManager.subagentSessionArchive(
          readSessionId(params),
          String(params["subagentSessionId"] ?? ""),
        );
      case SESSION_SUBAGENT_AUX:
        return sessionManager.subagentPendingAuxState(
          readSessionId(params),
          String(params["subagentSessionId"] ?? ""),
        );
      case SESSION_REPLACE_CONFIG: {
        const modelRef = params["modelRef"];
        await sessionManager.replaceConfig(
          readSessionId(params),
          modelRef &&
            typeof modelRef === "object" &&
            typeof (modelRef as Record<string, unknown>)["groupId"] === "string" &&
            typeof (modelRef as Record<string, unknown>)["name"] === "string"
            ? (modelRef as { groupId: string; name: string })
            : undefined,
        );
        return { ok: true };
      }
      case SESSION_RELOAD_METADATA: {
        const mode = params["mode"];
        await sessionManager.reloadHostMetadata(
          readSessionId(params),
          mode === "plan" || mode === "ask" || mode === "debug" ? mode : "agent",
        );
        return { ok: true };
      }
      case SESSION_RUN_SESSION_START: {
        const source = params["source"];
        if (source !== "startup" && source !== "resume" && source !== "open") {
          throw new Error("invalid source");
        }
        await sessionManager.runSessionStart(readSessionId(params), source);
        return { ok: true };
      }
      case SESSION_RUN_SESSION_END: {
        const reason = params["reason"];
        if (reason !== "abort" && reason !== "close" && reason !== "switch") {
          throw new Error("invalid reason");
        }
        await sessionManager.runSessionEnd(readSessionId(params), reason);
        return { ok: true };
      }
      case SESSION_SET_ATTRIBUTION:
        sessionManager.setAttribution(
          readSessionId(params),
          (params["attribution"] ?? {}) as never,
        );
        return { ok: true };
      case SESSION_SET_TODO_SESSION_KEY: {
        const sessionKey = params["sessionKey"];
        if (typeof sessionKey !== "string" || !sessionKey.trim()) {
          throw new Error("missing sessionKey");
        }
        sessionManager.setTodoSessionKey(readSessionId(params), sessionKey.trim());
        return { ok: true };
      }
      default:
        throw new Error(`unknown session method: ${method}`);
    }
  };

  const handleRpc = async (conn: WebSocketConnection, raw: string | Buffer): Promise<void> => {
    if (typeof raw !== "string") {
      conn.send(
        JSON.stringify(
          errorResponse(null, JSON_RPC_INVALID_REQUEST, "binary frames are not JSON-RPC"),
        ),
      );
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      conn.send(JSON.stringify(errorResponse(null, JSON_RPC_PARSE_ERROR, "parse error")));
      return;
    }
    if (!isJsonRpcRequest(parsed)) {
      conn.send(JSON.stringify(errorResponse(null, JSON_RPC_INVALID_REQUEST, "invalid request")));
      return;
    }
    try {
      switch (parsed.method) {
        case SERVER_HEALTH: {
          const result: ServerHealthResult = {
            ok: true,
            instanceId,
            pid: process.pid,
            version,
            startedAt,
            uptimeMs: Math.round(process.uptime() * 1000),
            connections: connections.size,
          };
          conn.send(JSON.stringify(successResponse(parsed.id, result)));
          return;
        }
        case SERVER_INITIALIZE: {
          const params = (parsed.params ?? {}) as Record<string, unknown>;
          const state: ClientState = {};
          if (
            params["clientKind"] === "cli" ||
            params["clientKind"] === "desktop" ||
            params["clientKind"] === "web"
          ) {
            state.clientKind = params["clientKind"];
          }
          if (typeof params["clientId"] === "string") {
            state.clientId = params["clientId"];
          }
          if (typeof params["workspaceRoot"] === "string") {
            state.workspaceRoot = params["workspaceRoot"];
          }
          clientStates.set(conn, state);
          const result: ServerInitializeResult = {
            protocolVersion: PROTOCOL_VERSION,
            instanceId,
            version,
            startedAt,
            dataDir,
          };
          conn.send(JSON.stringify(successResponse(parsed.id, result)));
          return;
        }
        default:
          if (SERVER_METHODS.has(parsed.method)) {
            if (parsed.method === SERVER_SET_LLM_HTTP_VERSION) {
              const params = (parsed.params ?? {}) as Record<string, unknown>;
              configureLlmHttpVersion(normalizeLlmHttpVersion(params["llmHttpVersion"]));
            } else if (parsed.method === SERVER_SET_LLM_CLIENT_VERSION) {
              const params = (parsed.params ?? {}) as Record<string, unknown>;
              if (typeof params["clientVersion"] === "string") {
                configureLlmClientVersion(params["clientVersion"]);
              }
            }
            conn.send(JSON.stringify(successResponse(parsed.id, null)));
            return;
          }
          if (SESSION_METHODS.has(parsed.method)) {
            const result = await handleSessionRpc(conn, parsed.method, parsed.params);
            conn.send(JSON.stringify(successResponse(parsed.id, result ?? null)));
            return;
          }
          if (HOST_METHODS.has(parsed.method)) {
            const result = await hostService.handle(parsed.method, parsed.params);
            conn.send(JSON.stringify(successResponse(parsed.id, result ?? null)));
            return;
          }
          conn.send(
            JSON.stringify(
              errorResponse(
                parsed.id,
                JSON_RPC_METHOD_NOT_FOUND,
                `unknown method: ${parsed.method}`,
              ),
            ),
          );
      }
    } catch (err) {
      conn.send(
        JSON.stringify(
          errorResponse(
            parsed.id,
            JSON_RPC_INTERNAL_ERROR,
            err instanceof Error ? err.message : String(err),
          ),
        ),
      );
    }
  };

  const httpServer: HttpServer = createServer((req, res) => {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  httpServer.on("upgrade", (req, rawSocket, head) => {
    void head;
    // WS upgrades always ride on a net.Socket (or TLSSocket); @types/node
    // widens the event signature to Duplex.
    const socket = rawSocket as Socket;
    if (!isWebSocketUpgrade(req)) {
      rejectUpgrade(socket, 400, "Bad Request");
      return;
    }
    void (async () => {
      const expected = await readCurrentToken(dataDir);
      const presented = extractPresentedToken(req.headers["authorization"], req.url);
      if (!expected || !tokenEquals(presented, expected)) {
        rejectUpgrade(socket, 401, "Unauthorized");
        return;
      }
      const conn = acceptUpgrade(req, socket);
      if (!conn) {
        return;
      }
      cancelIdleExit();
      connections.add(conn);
      conn.send(
        JSON.stringify(
          notification(SERVER_CONNECTED, {
            protocolVersion: PROTOCOL_VERSION,
            instanceId,
            version,
          }),
        ),
      );
      conn.on("message", (data: string | Buffer) => {
        void handleRpc(conn, data);
      });
      conn.on("close", () => {
        connections.delete(conn);
        onClientGone(conn);
      });
      conn.on("error", () => {
        connections.delete(conn);
        onClientGone(conn);
      });
    })();
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(requestedPort, host, () => resolve());
  });

  const address = httpServer.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("failed to resolve listening address");
  }
  const port = address.port;

  const record: ServerInstanceRecord = {
    instanceId,
    pid: process.pid,
    host,
    port,
    startedAt,
    version,
  };
  await registerInstance(dataDir, record);

  closeDaemon = async (): Promise<void> => {
    if (closed) {
      return;
    }
    closed = true;
    cancelIdleExit();
    await sessionManager.shutdown();
    for (const conn of connections) {
      conn.close(1001, "server shutting down");
    }
    connections.clear();
    clientStates.clear();
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
      httpServer.closeAllConnections();
    });
    await unregisterInstance(dataDir, instanceId);
  };

  log(
    `[spirit-server] listening on ws://${host}:${port} (instance ${instanceId}, pid ${process.pid})`,
  );

  return {
    instanceId,
    host,
    port,
    pid: process.pid,
    startedAt,
    url: `ws://${host}:${port}`,
    close: () => closeDaemon(),
  };
}
