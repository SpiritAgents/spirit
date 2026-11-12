import type { DesktopSnapshot } from "@/types";

/** Short-lived RPC busy flags that must not hide the turn abort control. */
export function busyActionBlocksConversationAbort(busyAction: string): boolean {
  return busyAction !== "" && busyAction !== "approve";
}

export function resolvePaneCanInterrupt(snapshot: DesktopSnapshot | null | undefined): boolean {
  return Boolean(
    snapshot?.runtimeReady &&
    snapshot.conversation.isBusy &&
    !snapshot.conversation.pendingToolApproval &&
    !snapshot.conversation.pendingQuestions,
  );
}

export function resolvePaneCanSend(snapshot: DesktopSnapshot | null | undefined): boolean {
  return Boolean(
    snapshot?.runtimeReady &&
    snapshot.config.activeApiKeyConfigured &&
    !snapshot.conversation.isBusy &&
    !snapshot.conversation.pendingToolApproval &&
    !snapshot.conversation.pendingQuestions,
  );
}

export function resolvePaneComposerBusy(
  snapshot: DesktopSnapshot | null | undefined,
  paneSendBusy: boolean,
): boolean {
  return paneSendBusy || snapshot?.conversation.isBusy === true;
}
