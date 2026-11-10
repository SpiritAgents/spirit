import type {
  ConversationMessagesDelta,
  ConversationSnapshot,
  DesktopConversationDelta,
  DesktopSnapshot,
  PaneSessionSlice,
} from "../types.js";

/**
 * Structural equality for plain JSON-shaped snapshot data. A missing key and an explicit
 * `undefined` value are treated as equal (matches how snapshots are built with conditional
 * spreads). References are compared first, so cached subtrees compare in O(1).
 */
export function deepEqualPlain(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }
  const aIsArray = Array.isArray(a);
  if (aIsArray !== Array.isArray(b)) {
    return false;
  }
  if (aIsArray && Array.isArray(b)) {
    if (a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; i += 1) {
      if (!deepEqualPlain(a[i], b[i])) {
        return false;
      }
    }
    return true;
  }
  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(aObj), ...Object.keys(bObj)]);
  for (const key of keys) {
    const av = aObj[key];
    const bv = bObj[key];
    if (av === undefined && bv === undefined) {
      continue;
    }
    if (!deepEqualPlain(av, bv)) {
      return false;
    }
  }
  return true;
}

/** Tail-replacement diff between two conversation snapshots (always delta-able). */
function diffConversationMessages(
  prev: ConversationSnapshot,
  next: ConversationSnapshot,
): ConversationMessagesDelta {
  const prevMessages = prev.messages;
  const nextMessages = next.messages;
  const shared = Math.min(prevMessages.length, nextMessages.length);
  let fromIndex = 0;
  while (fromIndex < shared && deepEqualPlain(prevMessages[fromIndex], nextMessages[fromIndex])) {
    fromIndex += 1;
  }
  const { messages: _messages, revision: _revision, ...conversationHead } = next;
  return {
    baseRevision: prev.revision,
    revision: next.revision,
    conversationHead,
    fromIndex,
    tailMessages: nextMessages.slice(fromIndex),
    totalCount: nextMessages.length,
  };
}

/**
 * Diffs the paneSessions map. Returns "full" when a full push is required (pane opened/closed
 * or a pane's non-conversation fields changed), otherwise the per-pane conversation deltas.
 */
function diffPaneSessions(
  prev: Record<string, PaneSessionSlice> | undefined,
  next: Record<string, PaneSessionSlice> | undefined,
): "full" | Record<string, ConversationMessagesDelta> | undefined {
  if (prev === next) {
    return undefined;
  }
  if (!prev || !next) {
    return "full";
  }
  const prevPaths = Object.keys(prev);
  const nextPaths = Object.keys(next);
  if (
    prevPaths.length !== nextPaths.length ||
    prevPaths.some((path) => !(path in next)) ||
    nextPaths.some((path) => !(path in prev))
  ) {
    return "full";
  }
  let paneDeltas: Record<string, ConversationMessagesDelta> | undefined;
  for (const path of nextPaths) {
    const prevSlice = prev[path]!;
    const nextSlice = next[path]!;
    if (prevSlice === nextSlice) {
      continue;
    }
    const { conversation: prevConversation, ...prevRest } = prevSlice;
    const { conversation: nextConversation, ...nextRest } = nextSlice;
    if (!deepEqualPlain(prevRest, nextRest)) {
      return "full";
    }
    if (!deepEqualPlain(prevConversation, nextConversation)) {
      paneDeltas ??= {};
      paneDeltas[path] = diffConversationMessages(prevConversation, nextConversation);
    }
  }
  return paneDeltas;
}

/**
 * Computes an incremental update from prev to next, or undefined when a full snapshot must be
 * sent instead (session switch, pane set change, or any top-level change outside conversations
 * — all rare during streaming). Conversation heads always ride along wholesale, so
 * conversation-level changes (pendingAuxState, contextUsage, todos, ...) never force a full push.
 */
export function diffLiveSnapshots(
  prev: DesktopSnapshot,
  next: DesktopSnapshot,
): DesktopConversationDelta | undefined {
  if (prev.composerSessionKey !== next.composerSessionKey) {
    return undefined;
  }
  let paneDeltas: Record<string, ConversationMessagesDelta> | undefined;
  const prevRecord = prev as unknown as Record<string, unknown>;
  const nextRecord = next as unknown as Record<string, unknown>;
  const keys = new Set([...Object.keys(prevRecord), ...Object.keys(nextRecord)]);
  for (const key of keys) {
    if (key === "conversation") {
      continue;
    }
    const av = prevRecord[key];
    const bv = nextRecord[key];
    if (av === bv || (av === undefined && bv === undefined)) {
      continue;
    }
    if (key === "paneSessions") {
      const result = diffPaneSessions(
        av as Record<string, PaneSessionSlice> | undefined,
        bv as Record<string, PaneSessionSlice> | undefined,
      );
      if (result === "full") {
        return undefined;
      }
      if (result) {
        paneDeltas = result;
      }
      continue;
    }
    if (!deepEqualPlain(av, bv)) {
      return undefined;
    }
  }
  const foreground = diffConversationMessages(prev.conversation, next.conversation);
  return {
    kind: "conversation-delta",
    composerSessionKey: next.composerSessionKey,
    ...foreground,
    ...(paneDeltas ? { paneDeltas } : {}),
  };
}

/** Applies a tail-replacement delta to one conversation; undefined when inapplicable. */
function applyMessagesDelta(
  current: ConversationSnapshot,
  delta: ConversationMessagesDelta,
): ConversationSnapshot | undefined {
  if (current.revision !== delta.baseRevision) {
    return undefined;
  }
  if (delta.fromIndex > current.messages.length) {
    return undefined;
  }
  const messages = current.messages.slice(0, delta.fromIndex);
  messages.push(...delta.tailMessages);
  if (messages.length !== delta.totalCount) {
    return undefined;
  }
  return {
    ...delta.conversationHead,
    revision: delta.revision,
    messages,
  };
}

/**
 * Applies a delta to the receiver's current snapshot, preserving the identity of unchanged
 * prefix messages so memoized rows do not re-render. Returns undefined when the delta cannot
 * be applied (stale base revision, session mismatch, inconsistent shape); the caller must then
 * resync with a full snapshot.
 */
export function applyConversationDelta(
  current: DesktopSnapshot | undefined,
  delta: DesktopConversationDelta,
): DesktopSnapshot | undefined {
  if (!current) {
    return undefined;
  }
  if (current.composerSessionKey !== delta.composerSessionKey) {
    return undefined;
  }
  const conversation = applyMessagesDelta(current.conversation, delta);
  if (!conversation) {
    return undefined;
  }
  let paneSessions = current.paneSessions;
  if (delta.paneDeltas) {
    if (!paneSessions) {
      return undefined;
    }
    const nextPanes: Record<string, PaneSessionSlice> = { ...paneSessions };
    for (const [path, paneDelta] of Object.entries(delta.paneDeltas)) {
      const slice = paneSessions[path];
      if (!slice) {
        return undefined;
      }
      const paneConversation = applyMessagesDelta(slice.conversation, paneDelta);
      if (!paneConversation) {
        return undefined;
      }
      nextPanes[path] = { ...slice, conversation: paneConversation };
    }
    paneSessions = nextPanes;
  }
  return {
    ...current,
    composerSessionKey: delta.composerSessionKey,
    conversation,
    ...(paneSessions ? { paneSessions } : {}),
  };
}
