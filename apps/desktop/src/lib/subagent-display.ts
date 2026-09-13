import type { ConversationMessageSnapshot, PendingAssistantAux } from "../types.js";

/** Parent wrap-up after subagent — normal assistant body, not runtime status.
 * The CJK patterns intentionally match model-generated Chinese wrap-up text; models may
 * still answer in Chinese, so this detector stays CJK-aware by design. */
function isParentSubagentCompletionSurfaceText(text: string): boolean {
  return /子智能体已完成|输出如下/u.test(text);
}

/** Host-drawn spinner frame prefix on live pending aux status lines. */
const SUBAGENT_SPINNER_PREFIX = /^[|/\\-]\s+/;

/** Progress tail after `title:` on the subagent status line (streaming English fragments included). */
const SUBAGENT_STATUS_TAIL_PREFIX = /^(The|Sub|Sp|Thinking|Compressing|Running|Awaiting)\b/u;

/** Colon is part of an emoticon (e.g. `:)`), not a `label: status` separator. */
function isEmoticonColon(text: string, colonIdx: number): boolean {
  const next = text[colonIdx + 1];
  return next !== undefined && /[)D(P/\\\]oO0-3]/.test(next);
}

function lastStatusColonIndex(text: string): number {
  let colonIdx = Math.max(text.lastIndexOf(":"), text.lastIndexOf("："));
  while (colonIdx > 0 && isEmoticonColon(text, colonIdx)) {
    const prevAscii = text.lastIndexOf(":", colonIdx - 1);
    const prevFull = text.lastIndexOf("：", colonIdx - 1);
    const prev = Math.max(prevAscii, prevFull);
    if (prev <= 0) {
      return -1;
    }
    colonIdx = prev;
  }
  return colonIdx;
}

export function stripSubagentSpinnerPrefix(text: string): string {
  return text.trim().replace(SUBAGENT_SPINNER_PREFIX, "").trim();
}

/** Runtime `pendingAuxState()` for main-thread thinking/compressing (not subagent status lines). */
export function isLivePendingReasoningAux(pendingAux: PendingAssistantAux | undefined): boolean {
  return Boolean(
    pendingAux &&
    (pendingAux.kind === "thinking" || pendingAux.kind === "compressing") &&
    !parsePendingSubagentStatusText(pendingAux.statusText),
  );
}

/** Runtime `pendingAuxState().statusText` while no `detailText` yet (e.g. `| Thinking…`). */
export function isGenericPendingThinkingStatusText(text: string | undefined): boolean {
  const normalized = text?.trim();
  if (!normalized) {
    return false;
  }
  const withoutSpinner = stripSubagentSpinnerPrefix(normalized);
  return withoutSpinner === "Thinking…";
}

/** Placeholder compaction aux before summary text arrives (e.g. `| Compressing…`). */
export function isGenericPendingCompactionStatusText(text: string | undefined): boolean {
  const normalized = text?.trim();
  if (!normalized) {
    return false;
  }
  const withoutSpinner = stripSubagentSpinnerPrefix(normalized);
  return withoutSpinner === "Compressing…";
}

function isSubagentRuntimeStatusTail(after: string): boolean {
  const tail = after.trim();
  if (!tail) {
    return false;
  }
  if (SUBAGENT_STATUS_TAIL_PREFIX.test(tail)) {
    return true;
  }
  if (/^The user wants\b/u.test(tail)) {
    return true;
  }
  if (/^Running\s*$/u.test(tail)) {
    return true;
  }
  if (tail.startsWith("Awaiting")) {
    return true;
  }
  if (/^Done\s*$/u.test(tail)) {
    return true;
  }
  return false;
}

/**
 * Runtime status like `task: Running` or `task: The user wants…` — not child final output
 * or parent post-tool summary (Markdown), and not normal assistant prose that happens to
 * contain a colon.
 */
export function isSubagentStatusSurfaceText(text: string | undefined): boolean {
  const normalized = text?.trim();
  if (!normalized) {
    return false;
  }
  if (isParentSubagentCompletionSurfaceText(normalized)) {
    return false;
  }
  if (/\*\*[\s\S]+\*\*/u.test(normalized) || /^#{1,6}\s/m.test(normalized)) {
    return false;
  }
  // Assistant replies are often multi-line; subagent status is always a single line.
  if (/[\r\n]/.test(normalized)) {
    return false;
  }

  const withoutSpinner = stripSubagentSpinnerPrefix(normalized);

  if (withoutSpinner === "Thinking…" || withoutSpinner === "Compressing…") {
    return true;
  }
  if (/:\s*Running\s*$/u.test(withoutSpinner)) {
    return true;
  }
  if (/:\s*Awaiting/u.test(withoutSpinner)) {
    return true;
  }

  const colonIdx = lastStatusColonIndex(withoutSpinner);
  if (colonIdx <= 0) {
    return false;
  }

  const before = withoutSpinner.slice(0, colonIdx).trim();
  const after = withoutSpinner.slice(colonIdx + 1).trim();
  if (!after || before.length < 4 || after.startsWith("```")) {
    return false;
  }

  if (isParentSubagentCompletionSurfaceText(before)) {
    return false;
  }

  // Runtime truncates progress to ~120 chars; real answers are longer.
  if (withoutSpinner.length > 220) {
    return false;
  }

  // Prose after a colon (lists, sentences) is not subagent progress.
  if (/[。！？；*•]/.test(after) || /^\s*[-*]\s/m.test(after)) {
    return false;
  }

  if (!isSubagentRuntimeStatusTail(after)) {
    return false;
  }

  if (after.length > 200) {
    return false;
  }

  return true;
}

export function hasSubagentToolInCurrentTurn(
  messages: ReadonlyArray<ConversationMessageSnapshot>,
): boolean {
  let lastUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      lastUserIndex = index;
      break;
    }
  }
  for (let index = lastUserIndex + 1; index < messages.length; index += 1) {
    const message = messages[index];
    if (message?.role === "assistant" && message.tool?.toolName === "subagent") {
      return true;
    }
  }
  return false;
}

export function hasActiveSubagentToolInMessages(
  messages: ReadonlyArray<ConversationMessageSnapshot>,
): boolean {
  return messages.some(
    (message) =>
      message.role === "assistant" &&
      message.tool?.toolName === "subagent" &&
      (message.tool.phase === "preview" || message.tool.phase === "running"),
  );
}

/** While a subagent is still executing or awaiting approval in the current turn, the main timeline must not show child-session tool cards. */
export function hasInFlightSubagentDelegationInMessages(
  messages: ReadonlyArray<ConversationMessageSnapshot>,
): boolean {
  return messages.some(
    (message) =>
      message.role === "assistant" &&
      message.tool?.toolName === "subagent" &&
      (message.tool.phase === "preview" ||
        message.tool.phase === "running" ||
        message.tool.phase === "pending-approval"),
  );
}

export function isSubagentStatusSurfaceMessage(
  message: ConversationMessageSnapshot | undefined,
): boolean {
  return Boolean(
    message?.role === "assistant" && !message.tool && isSubagentStatusSurfaceText(message.content),
  );
}

/** Parsed subagent runtime status from `pendingAuxState().statusText` (spinner stripped). */
export function parsePendingSubagentStatusText(text: string | undefined): string | undefined {
  if (!text) {
    return undefined;
  }

  const status = stripSubagentSpinnerPrefix(text);
  if (!status || status === "Thinking…" || status === "Compressing…") {
    return undefined;
  }

  if (!isSubagentStatusSurfaceText(status)) {
    return undefined;
  }

  return status;
}
