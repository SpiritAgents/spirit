import { randomUUID } from "node:crypto";
import path from "node:path";

import {
  buildAutomationTriggerMessage,
  createHostAutomationStore,
  defaultAutomationRunTriggerContext,
  readGitWorkspaceSnapshot,
  type AutomationRunTriggerContext,
  type HostAutomationDefinition,
  type HostAutomationRun,
} from "@spiritagent/host-internal";
import {
  AutomationConversationProjection,
  runAutomationStreamingTurn,
} from "./automation-conversation-projection.js";

import {
  createAutomationRuntime,
  disposeAutomationRuntime,
  type AutomationRuntimeHandle,
} from "./automation-runtime.js";
import { createDesktopRewindMetadata } from "./rewind.js";
import { buildStoredDesktopSession } from "./sessions.js";
import { modelExistsInProvider, modelRefKey } from "@spiritagent/host-internal";
import {
  chatsDirPath,
  resolveApiKeyForConfigModel,
  saveStoredSession,
  spiritDataDir,
  type DesktopConfigFile,
} from "./storage.js";
import type { DesktopHostRuntime } from "./runtime.js";

export const AUTOMATION_SESSION_FILE_PREFIX = "chat-automation-";
export const AUTOMATION_RUN_MAX_GUARD_ROUNDS = 200;

export interface RunDesktopAutomationOnceInput {
  definition: HostAutomationDefinition;
  config: DesktopConfigFile;
  triggerContext?: AutomationRunTriggerContext;
}

export interface RunDesktopAutomationOnceDeps {
  onRunUpdated?(automationId: string): void;
  notifySessionListUpdated?(): void;
  syncSessionFromDisk?(sessionPath: string): void | Promise<void>;
}

export async function runDesktopAutomationOnce(
  input: RunDesktopAutomationOnceInput,
  deps: RunDesktopAutomationOnceDeps,
): Promise<HostAutomationRun | undefined> {
  const store = createHostAutomationStore(spiritDataDir());
  const activeRun = await store.getActiveRun(input.definition.id);
  if (activeRun) {
    return undefined;
  }

  const runId = randomUUID();
  const startedAtUnixMs = Date.now();
  const sessionPath = path.join(
    chatsDirPath(),
    `${AUTOMATION_SESSION_FILE_PREFIX}${input.definition.id.slice(0, 8)}-${startedAtUnixMs}.json`,
  );

  let run = await store.addRun(input.definition.id, {
    id: runId,
    automationId: input.definition.id,
    sessionPath,
    status: "running",
    startedAtUnixMs,
  });
  deps.onRunUpdated?.(input.definition.id);

  let runtimeHandle: AutomationRuntimeHandle | undefined;
  let projection: AutomationConversationProjection | undefined;
  let gitBranch: string | undefined;

  try {
    const modelRef = input.definition.modelRef;
    if (!modelExistsInProvider(input.config.providers, modelRef.providerId, modelRef.name)) {
      throw new Error(`Model not found: ${modelRefKey(modelRef)}`);
    }
    const apiKey = await resolveApiKeyForConfigModel(input.config, modelRef);
    if (!apiKey) {
      throw new Error(`Missing API key for model: ${modelRefKey(modelRef)}`);
    }

    const gitSnapshot = await readGitWorkspaceSnapshot(input.definition.workspaceRoot);
    gitBranch = gitSnapshot.branch;
    const sessionDisplayName = `${input.definition.title} · ${formatRunTimestamp(startedAtUnixMs)}`;
    const runtimeInput: Parameters<typeof createAutomationRuntime>[0] = {
      definition: input.definition,
      config: input.config,
      sessionPath,
    };

    runtimeHandle = await createAutomationRuntime(runtimeInput);
    const runtime = runtimeHandle.runtime;
    const triggerContext =
      input.triggerContext ?? defaultAutomationRunTriggerContext(input.definition);
    const llmUserMessage = buildAutomationTriggerMessage({
      overview: input.definition.overview,
      trigger: input.definition.trigger,
      context: triggerContext,
    });

    projection = AutomationConversationProjection.create();
    projection.bindRuntime(runtime);
    projection.beginUserTurn(input.definition.overview);

    await persistAutomationSession(deps, {
      sessionPath,
      definition: input.definition,
      runId,
      runtime,
      projection,
      workspaceRoot: input.definition.workspaceRoot,
      gitBranch,
      sessionDisplayName,
      approvalLevel: input.definition.approvalLevel,
    });
    deps.notifySessionListUpdated?.();

    let result = await runAutomationStreamingTurn(runtime, projection, async () => {
      await runtime.startUserTurnStreaming(llmUserMessage);
    });

    for (let guard = 0; guard < AUTOMATION_RUN_MAX_GUARD_ROUNDS; guard += 1) {
      if (runtimeHandle.consumeTrustBlocked()) {
        run = await store.updateRun(input.definition.id, runId, { status: "blocked" });
        await persistAutomationSession(deps, {
          sessionPath,
          definition: input.definition,
          runId,
          runtime,
          projection,
          workspaceRoot: input.definition.workspaceRoot,
          gitBranch,
          sessionDisplayName,
          approvalLevel: input.definition.approvalLevel,
        });
        deps.onRunUpdated?.(input.definition.id);
        deps.notifySessionListUpdated?.();
        return run;
      }
      if (result.kind === "requires-approval") {
        if (input.definition.approvalLevel === "bypass-approval") {
          result = await runAutomationStreamingTurn(runtime, projection, async () => {
            await runtime.continuePendingApproval({ kind: "allow" });
          });
          continue;
        }
        run = await store.updateRun(input.definition.id, runId, { status: "blocked" });
        await persistAutomationSession(deps, {
          sessionPath,
          definition: input.definition,
          runId,
          runtime,
          projection,
          workspaceRoot: input.definition.workspaceRoot,
          gitBranch,
          sessionDisplayName,
          approvalLevel: input.definition.approvalLevel,
        });
        deps.onRunUpdated?.(input.definition.id);
        deps.notifySessionListUpdated?.();
        return run;
      }
      if (result.kind === "requires-questions") {
        if (input.definition.approvalLevel === "bypass-approval") {
          result = await runAutomationStreamingTurn(runtime, projection, async () => {
            await runtime.continuePendingQuestions({ status: "skipped" });
          });
          continue;
        }
        run = await store.updateRun(input.definition.id, runId, { status: "blocked" });
        await persistAutomationSession(deps, {
          sessionPath,
          definition: input.definition,
          runId,
          runtime,
          projection,
          workspaceRoot: input.definition.workspaceRoot,
          gitBranch,
          sessionDisplayName,
          approvalLevel: input.definition.approvalLevel,
        });
        deps.onRunUpdated?.(input.definition.id);
        deps.notifySessionListUpdated?.();
        return run;
      }
      if (result.kind === "failed") {
        throw new Error(result.error);
      }
      break;
    }

    if (result.kind !== "completed") {
      throw new Error(`Automation run did not complete: ${result.kind}`);
    }

    await persistAutomationSession(deps, {
      sessionPath,
      definition: input.definition,
      runId,
      runtime,
      projection,
      workspaceRoot: input.definition.workspaceRoot,
      gitBranch,
      sessionDisplayName,
      approvalLevel: input.definition.approvalLevel,
    });

    run = await store.updateRun(input.definition.id, runId, {
      status: "completed",
      completedAtUnixMs: Date.now(),
    });
    deps.onRunUpdated?.(input.definition.id);
    deps.notifySessionListUpdated?.();
    return run;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (runtimeHandle && projection) {
      try {
        await persistAutomationSession(deps, {
          sessionPath,
          definition: input.definition,
          runId,
          runtime: runtimeHandle.runtime,
          projection,
          workspaceRoot: input.definition.workspaceRoot,
          gitBranch,
          sessionDisplayName: `${input.definition.title} · ${formatRunTimestamp(startedAtUnixMs)}`,
          approvalLevel: input.definition.approvalLevel,
        });
      } catch {
        // Best-effort partial persist for failed runs.
      }
    }
    run = await store.updateRun(input.definition.id, runId, {
      status: "failed",
      completedAtUnixMs: Date.now(),
      error: message,
    });
    deps.onRunUpdated?.(input.definition.id);
    deps.notifySessionListUpdated?.();
    return run;
  } finally {
    if (runtimeHandle) {
      await disposeAutomationRuntime(runtimeHandle);
    }
  }
}

async function notifyAutomationSessionPersisted(
  deps: RunDesktopAutomationOnceDeps,
  sessionPath: string,
): Promise<void> {
  if (!deps.syncSessionFromDisk) {
    return;
  }
  await deps.syncSessionFromDisk(sessionPath);
}

async function persistAutomationSession(
  deps: RunDesktopAutomationOnceDeps,
  input: {
    sessionPath: string;
    definition: HostAutomationDefinition;
    runId: string;
    runtime: DesktopHostRuntime;
    projection: AutomationConversationProjection;
    workspaceRoot: string;
    gitBranch?: string;
    sessionDisplayName: string;
    approvalLevel: HostAutomationDefinition["approvalLevel"];
  },
): Promise<void> {
  const archivePayload = input.projection.buildArchivePayload();
  const archive = input.runtime.toArchive(archivePayload.messages, archivePayload.assistantAux);
  const timelineSnapshot = input.projection.timelineSnapshot();

  await saveStoredSession(
    input.sessionPath,
    buildStoredDesktopSession({
      llmHistory: archive.llmHistory,
      subagentSessions: archive.subagentSessions,
      savedAtUnixMs: Date.now(),
      sessionDisplayName: input.sessionDisplayName,
      sessionTitleSource: "seed",
      workspaceRoot: input.workspaceRoot,
      ...(input.gitBranch ? { gitBranch: input.gitBranch } : {}),
      desktopMessageTimeline: timelineSnapshot,
      rewind: createDesktopRewindMetadata(),
      loopEnabled: archive.loopEnabled === true,
      approvalLevel: input.approvalLevel,
      automationId: input.definition.id,
      automationRunId: input.runId,
    }),
  );
  await notifyAutomationSessionPersisted(deps, input.sessionPath);
}

function formatRunTimestamp(unixMs: number): string {
  const date = new Date(unixMs);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
