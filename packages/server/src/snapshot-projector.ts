import type { BridgeRuntimeSnapshot } from "@spiritagent/agent-core/host-bridge";

import type { ServerRuntimeResult } from "./runtime-factory.js";

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
    childSessions: [...target.childSessions()],
    ...(currentPendingQuestions !== undefined ? { currentPendingQuestions } : {}),
    isBusy: target.isBusy(),
    loopEnabled: target.loopEnabled(),
    approvalLevel: runtimeResult.approvalLevelSnapshot(),
    ...(backgroundToolStatus !== undefined ? { backgroundToolStatus } : {}),
    backgroundTasks: target.backgroundTaskRecords(),
    backgroundTaskNotifications: target.backgroundTaskNotifications(),
  };
}
