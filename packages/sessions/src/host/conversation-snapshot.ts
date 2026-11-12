import type { ConversationMessageSnapshot, PendingAssistantAux } from "../types.js";
import { buildVisibleMessageSnapshots } from "./message-snapshots.js";
import {
  hasActiveSubagentToolInMessages,
  isStandaloneSubagentStatusAux,
  messageOrderDebugLevel,
  parsePendingSubagentStatusText,
  rewindStandalonePendingAuxInsertIndexForThinking,
  shouldReanchorPersistedStandaloneSubagentStatusOnBeginAssistantResponse,
  summarizeMessagesTailForOrderDebug,
  truncateOneLineForDebug,
} from "./message-ordering.js";
import type { StoredDesktopRewindMetadata } from "./rewind.js";

export interface BuildConversationMessagesInput {
  messages: ConversationMessageSnapshot[];
  livePendingAux?: PendingAssistantAux;
  rewind: StoredDesktopRewindMetadata;
}

export interface SyncStandalonePendingAuxInput {
  livePendingAux?: PendingAssistantAux;
  pendingAssistantMessageId?: number;
  lastSettledAssistantMessageId?: number;
}

interface StandalonePendingAuxSnapshot {
  message: ConversationMessageSnapshot;
  insertAt: number;
  source: "live" | "persisted";
  anchorMessageId?: number;
  anchorResolvedIndex?: number;
}

export class DesktopConversationSnapshotView {
  private persistedStandalonePendingAux: PendingAssistantAux | undefined;
  private persistedStandalonePendingAuxAnchorMessageId: number | undefined;
  private standalonePendingAuxMessageId: number | undefined;
  private lastStandalonePendingAuxSnapshotLogSignature: string | undefined;

  constructor(private readonly allocateMessageId: () => number) {}

  buildMessagesWithPendingAssistant(
    input: BuildConversationMessagesInput,
  ): ConversationMessageSnapshot[] {
    const snapshots = buildVisibleMessageSnapshots({
      messages: input.messages,
      livePendingAux: input.livePendingAux,
      rewind: input.rewind,
    });

    // Subagent runtime status is shown on the subagent tool card only — never splice a
    // standalone assistant row (wrong insertAt can place it above the user message).
    this.lastStandalonePendingAuxSnapshotLogSignature = undefined;
    return snapshots;
  }

  syncStandalonePendingAux(input: SyncStandalonePendingAuxInput): void {
    const livePendingAux = input.livePendingAux;
    if (livePendingAux && isStandaloneSubagentStatusAux(livePendingAux)) {
      this.persistedStandalonePendingAux = {
        kind: livePendingAux.kind,
        statusText: livePendingAux.statusText,
        ...(livePendingAux.detailText ? { detailText: livePendingAux.detailText } : {}),
      };
      if (this.standalonePendingAuxMessageId === undefined) {
        this.standalonePendingAuxMessageId = this.allocateMessageId();
      }
      const anchorMessageId =
        input.pendingAssistantMessageId ?? input.lastSettledAssistantMessageId;
      if (anchorMessageId !== undefined) {
        this.persistedStandalonePendingAuxAnchorMessageId = anchorMessageId;
      }
      return;
    }

    if (
      !isStandaloneSubagentStatusAux(this.persistedStandalonePendingAux) ||
      (livePendingAux !== undefined && !isStandaloneSubagentStatusAux(livePendingAux))
    ) {
      this.clearStandalonePendingAuxState();
    }
  }

  shouldReanchorPersistedStandaloneSubagentStatusOnBeginAssistantResponse(
    previousMessage: ConversationMessageSnapshot | undefined,
  ): boolean {
    return shouldReanchorPersistedStandaloneSubagentStatusOnBeginAssistantResponse(
      previousMessage,
      this.persistedStandalonePendingAux,
    );
  }

  reanchorPersistedStandalonePendingAux(anchorMessageId: number): void {
    this.persistedStandalonePendingAuxAnchorMessageId = anchorMessageId;
  }

  clearStandalonePendingAuxState(): void {
    this.persistedStandalonePendingAux = undefined;
    this.persistedStandalonePendingAuxAnchorMessageId = undefined;
    this.standalonePendingAuxMessageId = undefined;
    this.lastStandalonePendingAuxSnapshotLogSignature = undefined;
  }

  private standalonePendingAuxSnapshot(
    livePendingAux: PendingAssistantAux | undefined,
    snapshots: ConversationMessageSnapshot[],
  ): StandalonePendingAuxSnapshot | undefined {
    const liveStandalonePendingAux =
      livePendingAux && isStandaloneSubagentStatusAux(livePendingAux) ? livePendingAux : undefined;
    const liveStatusText = liveStandalonePendingAux
      ? parsePendingSubagentStatusText(liveStandalonePendingAux.statusText)
      : undefined;
    if (liveStatusText) {
      if (hasActiveSubagentToolInMessages(snapshots)) {
        return undefined;
      }
      return {
        source: "live",
        insertAt: this.subagentStatusInsertIndex(snapshots),
        message: this.standalonePendingAuxMessage(liveStatusText),
      };
    }

    const persistedStandalonePendingAux =
      this.persistedStandalonePendingAux &&
      isStandaloneSubagentStatusAux(this.persistedStandalonePendingAux)
        ? this.persistedStandalonePendingAux
        : undefined;
    const persistedStatusText = persistedStandalonePendingAux
      ? parsePendingSubagentStatusText(persistedStandalonePendingAux.statusText)
      : undefined;
    if (!persistedStatusText) {
      return undefined;
    }

    const anchorMessageId = this.persistedStandalonePendingAuxAnchorMessageId;
    let anchorResolvedIndex: number | undefined;
    let insertAt: number | undefined;
    if (anchorMessageId !== undefined) {
      const anchoredIndex = snapshots.findIndex((message) => message.id === anchorMessageId);
      if (anchoredIndex >= 0) {
        anchorResolvedIndex = anchoredIndex;
        insertAt = rewindStandalonePendingAuxInsertIndexForThinking(snapshots, anchoredIndex);
      }
    }

    if (insertAt === undefined) {
      insertAt = this.subagentStatusInsertIndex(snapshots);
    }

    if (hasActiveSubagentToolInMessages(snapshots)) {
      return undefined;
    }

    return {
      source: "persisted",
      anchorMessageId,
      anchorResolvedIndex,
      insertAt,
      message: this.standalonePendingAuxMessage(persistedStatusText),
    };
  }

  private subagentStatusInsertIndex(snapshots: ConversationMessageSnapshot[]): number {
    for (let index = snapshots.length - 1; index >= 0; index -= 1) {
      const message = snapshots[index];
      if (message?.role === "assistant" && message.tool?.toolName === "subagent") {
        return index + 1;
      }
    }
    return snapshots.length;
  }

  private standalonePendingAuxMessage(statusText: string): ConversationMessageSnapshot {
    if (this.standalonePendingAuxMessageId === undefined) {
      this.standalonePendingAuxMessageId = this.allocateMessageId();
    }

    return {
      id: this.standalonePendingAuxMessageId,
      role: "assistant",
      content: statusText,
      pending: false,
    };
  }

  private logSnapshotStandalonePendingAux(
    standalonePendingAux: StandalonePendingAuxSnapshot,
    snapshots: ConversationMessageSnapshot[],
  ): void {
    if (messageOrderDebugLevel() !== "verbose") {
      return;
    }

    const status = truncateOneLineForDebug(standalonePendingAux.message.content, 48);
    const tail = summarizeMessagesTailForOrderDebug(snapshots, 6);
    const signature = [
      standalonePendingAux.source,
      standalonePendingAux.message.id,
      standalonePendingAux.insertAt,
      standalonePendingAux.anchorMessageId ?? "∅",
      standalonePendingAux.anchorResolvedIndex ?? "∅",
      standalonePendingAux.message.content,
      tail,
    ].join("|");
    if (signature === this.lastStandalonePendingAuxSnapshotLogSignature) {
      return;
    }
    this.lastStandalonePendingAuxSnapshotLogSignature = signature;
    console.warn(
      `[desktop-host][snapshot] standalone-subagent-status source=${standalonePendingAux.source} msg=${standalonePendingAux.message.id} insert=${standalonePendingAux.insertAt} anchorMsg=${standalonePendingAux.anchorMessageId ?? "∅"} anchorIdx=${standalonePendingAux.anchorResolvedIndex ?? "∅"} status≈${status}${standalonePendingAux.message.content.length > 48 ? "…" : ""} tail=${tail}`,
    );
  }
}
