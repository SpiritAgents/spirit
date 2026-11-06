import type { BridgeRuntimeSnapshot } from "@spiritagent/agent-core/host-bridge";

import type { ServerRuntimeResult } from "./runtime-factory.js";
import type { RuntimeSubagentSessionSummary } from "@spiritagent/agent-core";

function nativeSubagentSessions(
  runtimeResult: ServerRuntimeResult,
): RuntimeSubagentSessionSummary[] {
  return runtimeResult.runtime.backgroundTaskRecords().flatMap((task) => {
    if (task.kind !== "subagent" || !task.sessionId) return [];
    const status =
      task.status === "starting"
        ? "bootstrapping"
        : task.status === "blocked"
          ? "blocked"
          : task.status === "completed"
            ? "completed"
            : task.status === "failed" || task.status === "stopped" || task.status === "interrupted"
              ? "failed"
              : "running";
    return [
      {
        sessionId: task.sessionId,
        parentToolCallId: task.toolCallId,
        title: task.input.trim().slice(0, 72) || "SubAgent",
        status,
        startedAtUnixMs: task.startedAtUnixMs,
        updatedAtUnixMs: task.updatedAtUnixMs,
        ...(task.endedAtUnixMs ? { completedAtUnixMs: task.endedAtUnixMs } : {}),
        ...(task.finalOutputPreview ? { finalOutput: task.finalOutputPreview } : {}),
        ...(task.error ? { error: task.error } : {}),
        ...(task.worktreePath ? { worktreePath: task.worktreePath } : {}),
        ...(task.worktreeBranch ? { worktreeBranch: task.worktreeBranch } : {}),
      },
    ];
  });
}

/**
 * Projects a session runtime into the bridge-compatible snapshot shape.
 * Same fields as the legacy host bridge's `buildSnapshot` — clients written
 * against the sidecar protocol read this unchanged.
 */
export function buildServerSnapshot(runtimeResult: ServerRuntimeResult): BridgeRuntimeSnapshot {
  const target = runtimeResult.runtime;
  const pendingUserTurn = target.pendingUserTurn();
  const pendingAuxState = target.pendingAuxState();
  const currentPendingApproval = target.currentPendingApproval();
  const currentPendingQuestions = target.currentPendingQuestions();
  const backgroundToolStatus = target.backgroundToolStatus();
  const childSessions = [...target.childSessions()];
  const knownChildIds = new Set(childSessions.map((child) => child.sessionId));
  childSessions.push(
    ...nativeSubagentSessions(runtimeResult).filter((child) => !knownChildIds.has(child.sessionId)),
  );

  return {
    ...(pendingUserTurn !== undefined ? { pendingUserTurn } : {}),
    pendingImagePaths: [...target.pendingImagePaths()],
    pendingMcpResources: target.pendingMcpResources().map((resource) => ({
      server: resource.server,
      displayName: resource.displayName,
      uri: resource.uri,
      ...(resource.mimeType !== undefined ? { mimeType: resource.mimeType } : {}),
      readAtUnixMs: resource.readAtUnixMs,
      content: resource.content,
    })),
    ...(pendingAuxState !== undefined ? { pendingAuxState } : {}),
    hasPendingApproval: target.hasPendingApproval(),
    hasPendingManualApproval: target.hasPendingManualApproval(),
    hasPendingQuestions: target.hasPendingQuestions(),
    ...(currentPendingApproval !== undefined ? { currentPendingApproval } : {}),
    childSessions,
    ...(currentPendingQuestions !== undefined ? { currentPendingQuestions } : {}),
    isBusy: target.isBusy(),
    loopEnabled: target.loopEnabled(),
    approvalLevel: runtimeResult.approvalLevelSnapshot(),
    ...(backgroundToolStatus !== undefined ? { backgroundToolStatus } : {}),
    backgroundTasks: target.backgroundTaskRecords(),
    backgroundTaskNotifications: target.backgroundTaskNotifications(),
  };
}
