import { appendQueuedUserTurnSnapshots } from "./message-queue.js";
import { isSessionBundleBusy } from "./direct-media-turn.js";
import type { DesktopConversationSnapshotView } from "./conversation-snapshot.js";
import type { SessionBundle } from "./session-bundle.js";

import type {
  ActiveSessionSnapshot,
  ConversationSnapshot,
  DesktopGitSnapshot,
  DesktopWorkspaceBinding,
  ModelRef,
  PaneSessionSlice,
  PendingAssistantAux,
} from "../types.js";
import { mapPendingAuxState, mapPendingToolApproval } from "./snapshot-mappers.js";
import { mapPendingQuestions } from "./service-utils.js";
import type { DesktopToolRequest } from "./contracts.js";

export function buildPaneSessionSlice(input: {
  bundle: SessionBundle;
  composerSessionKey: string;
  conversationSnapshotView?: DesktopConversationSnapshotView;
  livePendingAux?: PendingAssistantAux;
  isForegroundActive: boolean;
  pendingApproval?: {
    toolName: string;
    request: DesktopToolRequest;
    prompt: import("@spiritagent/agent-core").ToolApprovalPrompt;
    rememberTarget?: import("@spiritagent/agent-core").PermissionMemoryTarget;
    subagentSessionId?: string;
    autoReviewBlockReason?: string;
  };
  pendingQuestions?: import("@spiritagent/agent-core").RuntimePendingQuestions<DesktopToolRequest>;
  pendingImagePaths?: string[];
  pendingMcpResources?: import("../types.js").PendingMcpResource[];
  pendingUserTurn?: string;
  paneWorkspace?: {
    workspaceRoot: string;
    workspaceBinding: DesktopWorkspaceBinding;
    git: DesktopGitSnapshot;
  };
  paneModel?: {
    activeModel: ModelRef;
  };
}): PaneSessionSlice {
  const { bundle } = input;
  const rawConversationMessages = input.conversationSnapshotView
    ? input.conversationSnapshotView.buildMessagesWithPendingAssistant({
        messages: bundle.messageTimeline.toMessages(),
        livePendingAux: input.livePendingAux,
        rewind: bundle.rewind,
      })
    : bundle.messageTimeline.toMessages();

  const conversationMessages = appendQueuedUserTurnSnapshots(
    rawConversationMessages,
    bundle.queuedUserTurns,
  );

  const conversation: ConversationSnapshot = {
    revision: bundle.conversationRevision,
    messages: conversationMessages,
    loopEnabled: bundle.loopEnabled,
    approvalLevel: bundle.approvalLevel,
    ...(input.pendingUserTurn ? { pendingUserTurn: input.pendingUserTurn } : {}),
    pendingImagePaths: [...(input.pendingImagePaths ?? [])],
    pendingMcpResources: [...(input.pendingMcpResources ?? [])],
    ...(input.livePendingAux ? { pendingAuxState: mapPendingAuxState(input.livePendingAux)! } : {}),
    ...(input.pendingApproval
      ? {
          pendingToolApproval: mapPendingToolApproval({
            toolName: input.pendingApproval.toolName,
            request: input.pendingApproval.request,
            prompt: input.pendingApproval.prompt,
            ...(input.pendingApproval.rememberTarget
              ? { rememberTarget: input.pendingApproval.rememberTarget }
              : {}),
            ...(input.pendingApproval.subagentSessionId
              ? { subagentSessionId: input.pendingApproval.subagentSessionId }
              : {}),
            ...(input.pendingApproval.autoReviewBlockReason
              ? { autoReviewBlockReason: input.pendingApproval.autoReviewBlockReason }
              : {}),
          }),
        }
      : {}),
    ...(input.pendingQuestions
      ? { pendingQuestions: mapPendingQuestions(input.pendingQuestions) }
      : {}),
    isBusy: isSessionBundleBusy(bundle),
    ...(bundle.rewindWarnings.length > 0
      ? { rewindWarnings: bundle.rewindWarnings.map((warning) => ({ ...warning })) }
      : {}),
    ...(bundle.cachedTodoSnapshot ? { todos: bundle.cachedTodoSnapshot } : {}),
    ...(bundle.contextUsage ? { contextUsage: { ...bundle.contextUsage } } : {}),
  };

  return {
    conversation,
    ...(bundle.activeSession ? { activeSession: { ...bundle.activeSession } } : {}),
    composerSessionKey: input.composerSessionKey,
    isForegroundActive: input.isForegroundActive,
    ...(input.paneWorkspace && !input.isForegroundActive
      ? {
          workspaceRoot: input.paneWorkspace.workspaceRoot,
          workspaceBinding: input.paneWorkspace.workspaceBinding,
          git: input.paneWorkspace.git,
        }
      : {}),
    ...(input.paneModel && !input.isForegroundActive
      ? { activeModel: input.paneModel.activeModel }
      : {}),
  };
}

export function resolvePaneActiveSession(
  slice: PaneSessionSlice,
): ActiveSessionSnapshot | undefined {
  return slice.activeSession;
}
