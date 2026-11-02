import type { DesktopAgentMode } from "./agent-mode.js";
import type { RichSegment } from "./composer-segment-model.js";
import {
  emptySegments,
  hasInlineAttachmentChipSegments,
  hasSkillSegment,
  isComposerPlainEmpty,
  mergeAdjacentTextSegments,
  segmentsToPlainText,
} from "./composer-segment-model.js";
import { hasLoopSegment, insertLoopSegment } from "./composer-loop-segments.js";
import {
  currentAgentModeSegment,
  hasAgentModeSegment,
  insertAgentModeSegment,
  isAgentModeChipKind,
  removeAgentModeSegment,
  type AgentModeChipKind,
} from "./composer-agent-mode-segments.js";

export type AgentModeChipPolicy = {
  hostMode: DesktopAgentMode;
  dismissed: boolean;
};

export function shouldPinAgentModeChip(policy: AgentModeChipPolicy): boolean {
  return isAgentModeChipKind(policy.hostMode) && !policy.dismissed;
}

/** Sole entry for adding/removing Plan/Ask chips in segment state. */
export function applyAgentModeChipPolicy(
  segs: RichSegment[],
  policy: AgentModeChipPolicy,
): RichSegment[] {
  if (!shouldPinAgentModeChip(policy)) {
    return removeAgentModeSegment(segs);
  }
  const mode = policy.hostMode as AgentModeChipKind;
  if (hasAgentModeSegment(segs) && segs.some((s) => s.kind === mode)) {
    return mergeAdjacentTextSegments(segs);
  }
  return insertAgentModeSegment(segs, mode).segments;
}

export function composerShowsPlaceholder(
  segs: RichSegment[],
  opts: { composing: boolean; attachmentCount: number },
): boolean {
  if (opts.composing || opts.attachmentCount > 0) {
    return false;
  }
  if (
    hasLoopSegment(segs) ||
    hasAgentModeSegment(segs) ||
    hasSkillSegment(segs) ||
    hasInlineAttachmentChipSegments(segs)
  ) {
    return false;
  }
  return segmentsToPlainText(segs) === "";
}

/** The lone spacer trailing a chip right after insertion; typing any whitespace or non-space character counts as having started editing. */
function isAgentModeChipPlaceholderBaselinePlain(plain: string): boolean {
  return plain === "" || plain === " ";
}

export function composerShowsAgentModeChipPlaceholder(
  segs: RichSegment[],
  opts: { composing: boolean; attachmentCount: number },
): boolean {
  if (opts.composing || opts.attachmentCount > 0) {
    return false;
  }
  if (!currentAgentModeSegment(segs)) {
    return false;
  }
  const plain = segmentsToPlainText(segs);
  if (!isAgentModeChipPlaceholderBaselinePlain(plain)) {
    return false;
  }
  return isComposerPlainEmpty(plain);
}

export function buildSegmentsAfterSend(agentMode: DesktopAgentMode): RichSegment[] {
  return applyAgentModeChipPolicy(emptySegments(), {
    hostMode: agentMode,
    dismissed: false,
  });
}

export function buildPostSendComposerSegments(
  agentMode: DesktopAgentMode,
  loopEnabled: boolean,
): RichSegment[] {
  let next = buildSegmentsAfterSend(agentMode);
  if (loopEnabled) {
    next = insertLoopSegment(next).segments;
  }
  return next;
}
