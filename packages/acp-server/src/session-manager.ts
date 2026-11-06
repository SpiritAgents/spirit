import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  buildParentSubagentToolResultText,
  createToolExecutionTextOutput,
  isBackgroundTaskTerminal,
  type JsonValue,
  type RuntimeEvent,
  type AgentMode,
  type LlmActiveSkill,
  type RuntimePendingApproval,
  type RuntimePendingQuestions,
} from "@spiritagent/agent-core";
import {
  createBackgroundTaskOwner,
  acquireRuntimeSessionLease,
  deleteTranscriptSessionDir,
  FileBackgroundTaskStore,
  isBackgroundTaskOwnerAlive,
  readSessionStorageKey,
  resolveSubagentTranscriptFilePath,
  type BackgroundTaskOwner,
} from "@spiritagent/host-internal";
import type { AcpServerConfig, AcpSessionState } from "./types.js";
import { AVAILABLE_MODES, normalizeModeId } from "./types.js";
import { createAcpRuntime, type AcpRuntimeResult } from "./runtime-factory.js";

type StopReason = "end_turn" | "refusal" | "cancelled";
type EventSink = (sessionId: string, event: RuntimeEvent<JsonValue>) => void;
interface SessionSummary {
  sessionId: string;
  sessionKind?: "default" | "dream-collector" | "subagent";
  subagentOrigin?: import("@spiritagent/agent-core").SubagentSessionOrigin;
  currentMode: AgentMode;
  modes: typeof AVAILABLE_MODES;
  enabledSkillCatalog: AcpSessionState["enabledSkillCatalog"];
}
interface LiveSession extends AcpSessionState {
  result: AcpRuntimeResult;
  agentWriter?: { ownerSessionId: string; toolCallId: string };
  operations: Promise<void>;
  pump: NodeJS.Timeout;
  polling: boolean;
  closing: boolean;
  turnActive: boolean;
  generation: number;
  waiter?: { resolve(value: StopReason): void; reject(error: unknown): void } | undefined;
  onEvent: EventSink;
  reportedApproval?: RuntimePendingApproval<JsonValue> | undefined;
  reportedQuestions?: RuntimePendingQuestions<JsonValue> | undefined;
  lastTurnResult?: { assistantText?: string; error?: string };
}

interface CreateAcpSessionOptions {
  sessionId?: string;
  sessionKind?: "default" | "dream-collector" | "subagent";
  subagentOrigin?: import("@spiritagent/agent-core").SubagentSessionOrigin;
}

/** Owns ACP session lifetimes independently of individual prompt requests. */
export class SessionManager {
  private readonly sessions = new Map<string, LiveSession>();
  private readonly openings = new Map<
    string,
    { workspaceRoot: string; promise: Promise<SessionSummary> }
  >();
  private owner: Promise<BackgroundTaskOwner> | undefined;
  private shuttingDown = false;

  constructor(private readonly globalConfig: AcpServerConfig) {}

  async createSession(
    workspaceRoot: string,
    onEvent: EventSink,
    initialMode: AgentMode = "agent",
    options: CreateAcpSessionOptions = {},
  ) {
    return this.openSession(
      options.sessionId?.trim() || `sess_${randomUUID().replaceAll("-", "")}`,
      workspaceRoot,
      onEvent,
      initialMode,
      false,
      options,
    );
  }

  async loadSession(
    sessionId: string,
    workspaceRoot: string,
    onEvent: EventSink,
  ): Promise<SessionSummary> {
    if (!/^sess_[0-9a-f]{32}$/.test(sessionId)) throw new Error("Invalid ACP session ID.");
    const live = this.sessions.get(sessionId);
    if (live) {
      if (path.resolve(live.workspaceRoot) !== path.resolve(workspaceRoot))
        throw new Error("Session workspace mismatch.");
      return this.summary(live);
    }
    return this.openSession(sessionId, workspaceRoot, onEvent, "agent", true);
  }

  private async openSession(
    sessionId: string,
    workspaceRoot: string,
    onEvent: EventSink,
    mode: AgentMode,
    requireExisting: boolean,
    options: CreateAcpSessionOptions = {},
  ): Promise<SessionSummary> {
    if (this.shuttingDown) throw new Error("ACP host is shutting down.");
    const opening = this.openings.get(sessionId);
    if (opening) {
      if (path.resolve(opening.workspaceRoot) !== path.resolve(workspaceRoot))
        throw new Error("Session workspace mismatch.");
      return opening.promise;
    }
    const promise = this.initializeSession(
      sessionId,
      workspaceRoot,
      onEvent,
      mode,
      requireExisting,
      options,
    ).finally(() => this.openings.delete(sessionId));
    this.openings.set(sessionId, { workspaceRoot, promise });
    return promise;
  }

  private async initializeSession(
    sessionId: string,
    workspaceRoot: string,
    onEvent: EventSink,
    mode: AgentMode,
    requireExisting: boolean,
    options: CreateAcpSessionOptions = {},
  ): Promise<SessionSummary> {
    const result = await createAcpRuntime(
      { ...this.globalConfig, workspaceRoot },
      (event) => {
        if (event.kind !== "approval-requested" && event.kind !== "questions-requested")
          onEvent(sessionId, event);
      },
      mode,
      sessionId,
      {
        taskOwner: await (this.owner ??= createBackgroundTaskOwner(
          this.globalConfig.spiritDataDir,
        )),
        requireExisting,
        subagentSessionDelegate: {
          execute: (request: import("@spiritagent/agent-core").SubagentSessionExecutionRequest) =>
            this.delegateSubagentTurn(sessionId, request),
        },
        ...(options.sessionKind ? { sessionKind: options.sessionKind } : {}),
        ...(options.subagentOrigin ? { subagentOrigin: options.subagentOrigin } : {}),
      },
    );
    const session: LiveSession = {
      sessionId,
      runtime: result.runtime,
      toolExecutor: result.toolExecutor,
      result,
      workspaceRoot,
      ...(result.sessionKind ? { sessionKind: result.sessionKind } : {}),
      ...(result.subagentOrigin ? { subagentOrigin: result.subagentOrigin } : {}),
      currentMode: result.agentModeSnapshot(),
      pendingPrompt: null,
      activeSkills: result.activeSkills,
      enabledSkillCatalog: result.enabledSkillCatalog,
      setAgentMode: result.setAgentMode,
      operations: Promise.resolve(),
      pump: setInterval(() => this.tick(session), 25),
      polling: false,
      closing: false,
      turnActive: false,
      generation: 0,
      onEvent,
    };
    session.pump.unref();
    this.sessions.set(sessionId, session);
    return this.summary(session);
  }

  private summary(session: LiveSession) {
    return {
      sessionId: session.sessionId,
      ...(session.sessionKind ? { sessionKind: session.sessionKind } : {}),
      ...(session.subagentOrigin ? { subagentOrigin: session.subagentOrigin } : {}),
      modes: AVAILABLE_MODES,
      currentMode: session.currentMode,
      enabledSkillCatalog: session.enabledSkillCatalog,
    };
  }

  getSession(sessionId: string): AcpSessionState | undefined {
    return this.sessions.get(sessionId);
  }

  requireSession(sessionId: string): AcpSessionState {
    const session = this.sessions.get(sessionId);
    if (!session || session.closing) throw new Error(`Session ${sessionId} not found`);
    return session;
  }

  async withSession<T>(
    sessionId: string,
    action: (session: AcpSessionState) => Promise<T>,
  ): Promise<T> {
    const session = this.sessions.get(sessionId);
    if (!session || session.closing) throw new Error(`Session ${sessionId} not found`);
    return this.serialize(session, () => action(session));
  }

  private serialize<T>(
    session: LiveSession,
    action: () => Promise<T>,
    allowClosing = false,
  ): Promise<T> {
    const guarded = async () => {
      if (session.closing && !allowClosing) throw new Error("Session is closing.");
      return action();
    };
    const operation = session.operations.then(guarded, guarded);
    session.operations = operation.then(
      () => {},
      () => {},
    );
    return operation;
  }

  async runPrompt(
    sessionId: string,
    text: string,
    images: string[],
    skills: LlmActiveSkill[],
  ): Promise<StopReason> {
    const session = this.sessions.get(sessionId);
    if (!session || session.closing) throw new Error(`Session ${sessionId} not found`);
    const agentWriter = session.agentWriter;
    this.cancel(sessionId);
    if (agentWriter) {
      session.agentWriter = agentWriter;
    }
    const generation = session.generation;
    delete session.lastTurnResult;
    session.pendingPrompt = new AbortController();
    const completed = new Promise<StopReason>((resolve, reject) => {
      session.waiter = { resolve, reject };
    });
    try {
      await this.serialize(session, async () => {
        if (generation !== session.generation) return;
        session.turnActive = true;
        await session.runtime.startUserTurnStreaming(text, images, [], skills);
      });
    } catch (error) {
      if (generation === session.generation) {
        session.waiter?.reject(error);
        session.waiter = undefined;
        session.turnActive = false;
      }
    }
    return completed;
  }

  cancel(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.generation += 1;
    delete session.agentWriter;
    session.pendingPrompt?.abort();
    session.pendingPrompt = null;
    session.runtime.abort();
    session.turnActive = false;
    session.waiter?.resolve("cancelled");
    session.waiter = undefined;
  }

  private tick(session: LiveSession): void {
    if (session.closing) return;
    // Input delivery must remain live even when poll awaits an early tool decision.
    // The runtime selects one pending child, so concurrent children cannot cross-apply replies.
    const approval = session.runtime.currentPendingApproval();
    if (approval && approval.request !== session.reportedApproval?.request)
      session.onEvent(session.sessionId, { kind: "approval-requested", approval });
    session.reportedApproval = approval;
    const questions = session.runtime.currentPendingQuestions();
    if (questions && questions.request !== session.reportedQuestions?.request)
      session.onEvent(session.sessionId, { kind: "questions-requested", questions });
    session.reportedQuestions = questions;
    if (session.polling) return;
    session.polling = true;
    const generation = session.generation;
    void this.serialize(
      session,
      async () => {
        if (session.closing) return;
        await session.runtime.poll({ allowBackgroundWakeup: false });
        if (generation !== session.generation) return;
        session.runtime.handleStreamStallTimeout();
        const result = session.runtime.takeCompletedTurnResult();
        if (result?.kind === "completed" || result?.kind === "failed") {
          await session.result.persist();
          if (generation !== session.generation) return;
          delete session.agentWriter;
          session.lastTurnResult =
            result.kind === "completed"
              ? { assistantText: result.assistantText }
              : { error: result.error };
          session.turnActive = false;
          session.pendingPrompt = null;
          session.waiter?.resolve(result.kind === "completed" ? "end_turn" : "refusal");
          session.waiter = undefined;
        }
        if (
          !session.turnActive &&
          !session.waiter &&
          session.runtime.hasPendingBackgroundTaskNotifications()
        ) {
          session.turnActive = await session.runtime.resumeBackgroundTaskNotifications();
        }
        session.runtime.drainEvents();
        session.runtime.drainActiveChildSessionEvents();
      },
      true,
    )
      .catch((error: unknown) => {
        if (generation === session.generation) {
          session.waiter?.reject(error);
          session.waiter = undefined;
          session.turnActive = false;
          session.runtime.abort();
        }
        session.onEvent(session.sessionId, {
          kind: "background-task-error",
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        session.polling = false;
      });
  }

  async delegateSubagentTurn(
    parentSessionId: string,
    request: import("@spiritagent/agent-core").SubagentSessionExecutionRequest,
  ): Promise<import("@spiritagent/agent-core").SessionTaskResult> {
    const parent = this.sessions.get(parentSessionId);
    if (!parent || parent.closing) throw new Error(`Session ${parentSessionId} not found`);
    if (!request.sessionId && parent.sessionKind === "subagent") {
      throw new Error("Nested subagents are not supported.");
    }
    const target = request.sessionId
      ? await this.loadSession(request.sessionId, parent.workspaceRoot, parent.onEvent)
      : await this.createSession(parent.workspaceRoot, parent.onEvent, parent.currentMode, {
          sessionKind: "subagent",
          subagentOrigin: {
            parentSessionId,
            parentToolCallId: request.parentToolCallId,
          },
        });
    const session = this.sessions.get(target.sessionId);
    if (!session || session.closing) throw new Error(`Session ${target.sessionId} not found`);
    if (session.runtime.hasPendingApproval() || session.runtime.hasPendingQuestions()) {
      throw new Error("Answer the target session's pending approval or questionnaire first.");
    }
    if (session.agentWriter) {
      throw new Error("The target session is already being prompted by another agent.");
    }
    session.agentWriter = {
      ownerSessionId: parentSessionId,
      toolCallId: request.parentToolCallId,
    };
    if (session.turnActive || session.waiter) {
      this.cancel(target.sessionId);
      await session.operations;
      session.agentWriter = {
        ownerSessionId: parentSessionId,
        toolCallId: request.parentToolCallId,
      };
    }
    const cancel = () => this.cancel(target.sessionId);
    request.context.signal.addEventListener("abort", cancel, { once: true });
    try {
      const stopReason = await this.runPrompt(target.sessionId, request.prompt, [], []);
      const result = session.lastTurnResult;
      const failed = stopReason !== "end_turn";
      const text = result?.assistantText ?? result?.error ?? "The turn was cancelled.";
      const transcript = resolveSubagentTranscriptFilePath(
        this.globalConfig.spiritDataDir,
        target.sessionId,
        target.sessionId,
      );
      await request.context.update({
        sessionId: target.sessionId,
        sessionTranscript: transcript,
        finalOutputPreview: text.slice(0, 16_384),
      });
      await request.context.writeOutput(`\n\nFinal response:\n${text}\n`);
      return {
        output: createToolExecutionTextOutput(
          buildParentSubagentToolResultText(text, failed, target.sessionId, transcript),
        ),
        failed,
      };
    } finally {
      request.context.signal.removeEventListener("abort", cancel);
      delete session.agentWriter;
    }
  }

  async setSessionMode(sessionId: string, modeId: string): Promise<AgentMode> {
    return this.withSession(sessionId, async (session) => {
      const mode = normalizeModeId(modeId);
      await session.setAgentMode(mode);
      session.currentMode = mode;
      return mode;
    });
  }

  async closeSession(sessionId: string): Promise<void> {
    await this.openings.get(sessionId)?.promise;
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.closing = true;
    clearInterval(session.pump);
    this.cancel(sessionId);
    await this.serialize(session, () => session.result.dispose(), true);
    this.sessions.delete(sessionId);
  }

  async deleteSession(sessionId: string): Promise<void> {
    if (!/^sess_[0-9a-f]{32}$/.test(sessionId)) throw new Error("Invalid ACP session ID.");
    await this.closeSession(sessionId);
    const sessionKey = readSessionStorageKey(this.globalConfig.spiritDataDir, sessionId);
    if (sessionKey) {
      const owner = await (this.owner ??= createBackgroundTaskOwner(
        this.globalConfig.spiritDataDir,
      ));
      const lease = await acquireRuntimeSessionLease(
        this.globalConfig.spiritDataDir,
        sessionKey,
        owner.owner,
      );
      try {
        const store = new FileBackgroundTaskStore({
          spiritDataDir: this.globalConfig.spiritDataDir,
          sessionKey,
          owner: owner.owner,
        });
        await store.recoverInterrupted((identity) =>
          isBackgroundTaskOwnerAlive(this.globalConfig.spiritDataDir, identity),
        );
        if ((await store.list()).some((task) => !isBackgroundTaskTerminal(task.status)))
          throw new Error(
            "This session has active tasks in another runtime. Close it in that host before deleting it.",
          );
        await deleteTranscriptSessionDir(this.globalConfig.spiritDataDir, sessionId);
      } finally {
        await lease.release();
      }
      return;
    }
    await deleteTranscriptSessionDir(this.globalConfig.spiritDataDir, sessionId);
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    const openings = await Promise.allSettled(
      [...this.openings.values()].map((opening) => opening.promise),
    );
    const sessions = await Promise.allSettled(
      [...this.sessions.keys()].map((id) => this.closeSession(id)),
    );
    const owner = await Promise.allSettled(
      this.owner ? [this.owner.then((value) => value.close())] : [],
    );
    this.owner = undefined;
    const errors = [...openings, ...sessions, ...owner].flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (errors.length) throw new AggregateError(errors, "ACP shutdown failed.");
  }
}
