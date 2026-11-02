export {
  caretAtEnd,
  emptySegments,
  hasInlineAttachmentChipSegments,
  hasSkillSegment,
  insertSegmentAtCaret,
  isComposerPlainEmpty,
  mergeAdjacentTextSegments,
  normalizeComposerPlain,
  segmentsEqual,
  segmentsToAttachments,
  segmentsToMessageText,
  segmentsToPlainText,
  syncSegmentsFromExternalValue,
  type RichSegment,
  type SegmentCaret,
} from "./composer-segment-model.js";

export {
  ensureLoopChipTypingTail,
  ensureLoopPinned,
  hasLoopSegment,
  insertLoopSegment,
  isCaretAtLoopRemovalPoint,
  normalizeCaretForPinnedLoopChip,
  removeLoopSegment,
} from "./composer-loop-segments.js";

export {
  isCaretAtInlineChipRemovalPoint,
  normalizeCaretForInlineAttachmentChips,
  removeInlineChipAtRemovalPoint,
} from "./composer-inline-chip-caret.js";

export { normalizeCaretForComposer } from "./composer-caret-normalize.js";

export {
  isCaretOnStructuralChipLeadingSpacer,
  isStructuralChipInsertedSpacerOnly,
  structuralChipKindBeforeCaret,
  trimStructuralChipLeadingSpacerAtCaret,
} from "./composer-structural-chip-caret.js";

export {
  caretAfterAgentModeChip,
  currentAgentModeSegment,
  ensureAgentModePinned,
  hasAgentModeSegment,
  insertAgentModeSegment,
  isAgentModeChipKind,
  isCaretAtAgentModeRemovalPoint,
  normalizeCaretForPinnedAgentModeChip,
  removeAgentModeSegment,
} from "./composer-agent-mode-segments.js";
