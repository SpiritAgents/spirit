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
  createSubagentWorkspaceBootstrap,
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
  workLocation: import("@spiritagent/host-internal/work-location").WorkLocationKind;
  worktreePath?: string;
  worktreeBranch?: string;
  currentMode: AgentMode;
  modes: typeof AVAILABLE_MODES;
  enabledSkillCatalog: AcpSessionState["enabledSkillCatalog"];
}
interface LiveSession extends AcpSessionState {
  result: AcpRuntimeResult;
  agentWriter?: {
    ownerSessionId: string;
    toolCallId: string;
    context: import("@spiritagent/agent-core").SubagentSessionExecutionRequest["context"];
    onEvent: EventSink;
    blocked: boolean;
  };
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
    adoptStoredWorkspace = false,
  ): Promise<SessionSummary> {
    if (!/^sess_[0-9a-f]{32}$/.test(sessionId)) throw new Error("Invalid ACP session ID.");
    const live = this.sessions.get(sessionId);
    if (live) {
      if (adoptStoredWorkspace) return this.summary(live);
      if (path.resolve(live.workspaceRoot) !== path.resolve(workspaceRoot))
        throw new Error("Session workspace mismatch.");
      return this.summary(live);
    }
    return this.openSession(
      sessionId,
      workspaceRoot,
      onEvent,
      "agent",
      true,
      {},
      adoptStoredWorkspace,
    );
  }

  private async openSession(
    sessionId: string,
    workspaceRoot: string,
    onEvent: EventSink,
    mode: AgentMode,
    requireExisting: boolean,
    options: CreateAcpSessionOptions = {},
    adoptStoredWorkspace = false,
  ): Promise<SessionSummary> {
    if (this.shuttingDown) throw new Error("ACP host is shutting down.");
    const opening = this.openings.get(sessionId);
    if (opening) {
      if (adoptStoredWorkspace) return opening.promise;
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
      adoptStoredWorkspace,
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
    adoptStoredWorkspace = false,
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
        adoptStoredWorkspace,
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
      workspaceRoot: result.workspaceRoot,
      workLocation: result.workLocation,
      ...(result.worktreePath ? { worktreePath: result.worktreePath } : {}),
      ...(result.worktreeBranch ? { worktreeBranch: result.worktreeBranch } : {}),
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
      workLocation: session.workLocation,
      ...(session.worktreePath ? { worktreePath: session.worktreePath } : {}),
      ...(session.worktreeBranch ? { worktreeBranch: session.worktreeBranch } : {}),
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
    beforeStart?: () => Promise<void>,
  ): Promise<StopReason> {
    const session = this.sessions.get(sessionId);
    if (!session || session.closing) throw new Error(`Session ${sessionId} not found`);
    this.cancel(sessionId, { preserveAgentWriter: true });
    const generation = session.generation;
    delete session.lastTurnResult;
    session.pendingPrompt = new AbortController();
    const completed = new Promise<StopReason>((resolve, reject) => {
      session.waiter = { resolve, reject };
    });
    try {
      await this.serialize(session, async () => {
        await beforeStart?.();
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

  cancel(sessionId: string, options: { preserveAgentWriter?: boolean } = {}): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.generation += 1;
    if (!options.preserveAgentWriter) delete session.agentWriter;
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
    const writer = session.agentWriter;
    if (approval && approval.request !== session.reportedApproval?.request) {
      const eventApproval = writer
        ? {
            ...approval,
            subagentSessionId: session.sessionId,
            subagentTitle: "SubAgent",
          }
        : approval;
      (writer?.onEvent ?? session.onEvent)(writer?.ownerSessionId ?? session.sessionId, {
        kind: "approval-requested",
        approval: eventApproval,
      });
    }
    session.reportedApproval = approval;
    const questions = session.runtime.currentPendingQuestions();
    if (questions && questions.request !== session.reportedQuestions?.request) {
      (writer?.onEvent ?? session.onEvent)(writer?.ownerSessionId ?? session.sessionId, {
        kind: "questions-requested",
        questions,
      });
    }
    session.reportedQuestions = questions;
    const blocked = Boolean(approval || questions);
    if (writer && writer.blocked !== blocked) {
      writer.blocked = blocked;
      void writer.context.update({}, blocked ? "blocked" : "running").catch((error: unknown) => {
        session.onEvent(session.sessionId, {
          kind: "background-task-error",
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
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
      ? await this.loadSession(request.sessionId, parent.workspaceRoot, parent.onEvent, true)
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
    const writer: NonNullable<LiveSession["agentWriter"]> = {
      ownerSessionId: parentSessionId,
      toolCallId: request.parentToolCallId,
      context: request.context,
      onEvent: parent.onEvent,
      blocked: false,
    };
    session.agentWriter = writer;
    const cancel = () => this.cancel(target.sessionId, { preserveAgentWriter: true });
    request.context.signal.addEventListener("abort", cancel, { once: true });
    try {
      if (session.turnActive || session.waiter) {
        this.cancel(target.sessionId, { preserveAgentWriter: true });
        await session.operations;
      }
      const transcript = resolveSubagentTranscriptFilePath(
        this.globalConfig.spiritDataDir,
        target.sessionId,
        target.sessionId,
      );
      const stopReason = await this.runPrompt(
        target.sessionId,
        request.prompt,
        [],
        [],
        async () => {
          if (request.worktree) {
            await this.setSessionWorktree(target.sessionId);
          }
          await request.context.update({
            sessionId: target.sessionId,
            sessionTranscript: transcript,
            ...(session.worktreePath ? { worktreePath: session.worktreePath } : {}),
            ...(session.worktreeBranch ? { worktreeBranch: session.worktreeBranch } : {}),
          });
        },
      );
      const result = session.lastTurnResult;
      const failed = stopReason !== "end_turn";
      const text = result?.assistantText ?? result?.error ?? "The turn was cancelled.";
      await request.context.update({
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
      if (session.agentWriter === writer) delete session.agentWriter;
    }
  }

  delegatedInputSessionId(
    parentSessionId: string,
    kind: "approval" | "questions",
    requestId?: string,
  ): string | undefined {
    for (const session of this.sessions.values()) {
      if (session.agentWriter?.ownerSessionId !== parentSessionId) continue;
      const pending =
        kind === "approval"
          ? session.runtime.currentPendingApproval(requestId)
          : session.runtime.currentPendingQuestions(requestId);
      if (pending) return session.sessionId;
    }
    return undefined;
  }

  async setSessionWorktree(sessionId: string): Promise<AcpSessionState> {
    const session = this.sessions.get(sessionId);
    if (!session || session.closing) throw new Error(`Session ${sessionId} not found`);
    if (session.workLocation === "worktree" && session.worktreePath) {
      return session;
    }
    if (session.runtime.isBusy() || session.turnActive) {
      throw new Error("The target session is busy; wait for the current turn to finish.");
    }
    const bootstrap = createSubagentWorkspaceBootstrap({
      parentWorkspaceRoot: session.workspaceRoot,
      buildScopedRuntime: async () => ({ toolExecutor: session.toolExecutor }),
    });
    const boot = await bootstrap({
      subagentSessionId: sessionId,
      task: "Continue session",
      worktree: true,
      parentWorkspaceRoot: session.workspaceRoot,
    });
    if ("error" in boot) throw new Error(boot.error);
    if (!boot.worktreePath || !boot.branchName) {
      await boot.rollback?.();
      throw new Error("The subagent worktree identity is incomplete.");
    }
    const previousRoot = session.workspaceRoot;
    let switched = false;
    try {
      const fresh = await session.result.reconfigure({ workspaceRoot: boot.workspaceRoot });
      switched = true;
      session.result = fresh;
      session.toolExecutor = fresh.toolExecutor;
      session.activeSkills = fresh.activeSkills;
      session.enabledSkillCatalog = fresh.enabledSkillCatalog;
      session.setAgentMode = fresh.setAgentMode;
      session.workspaceRoot = boot.workspaceRoot;
      session.workLocation = "worktree";
      session.worktreePath = boot.worktreePath;
      session.worktreeBranch = boot.branchName;
      fresh.workLocation = "worktree";
      fresh.worktreePath = boot.worktreePath;
      fresh.worktreeBranch = boot.branchName;
      await fresh.persist();
      boot.markStarted?.();
    } catch (error) {
      const cleanup: Promise<unknown>[] = [Promise.resolve(boot.rollback?.())];
      if (switched) {
        cleanup.push(
          session.result.reconfigure({ workspaceRoot: previousRoot }).then((restored) => {
            session.result = restored;
            session.toolExecutor = restored.toolExecutor;
            session.activeSkills = restored.activeSkills;
            session.enabledSkillCatalog = restored.enabledSkillCatalog;
            session.setAgentMode = restored.setAgentMode;
            session.workspaceRoot = previousRoot;
            session.workLocation = "local";
            delete session.worktreePath;
            delete session.worktreeBranch;
          }),
        );
      }
      const results = await Promise.allSettled(cleanup);
      const failures = results.flatMap((entry) =>
        entry.status === "rejected" ? [entry.reason] : [],
      );
      if (failures.length) throw new AggregateError([error, ...failures]);
      throw error;
    }
    return session;
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
