import type { RichSegment, SegmentCaret } from "./composer-segment-model.js";
import { emptySegments, mergeAdjacentTextSegments } from "./composer-segment-model.js";

function isStructuralChipKind(
  kind: RichSegment["kind"] | undefined,
): kind is "loop" | "plan" | "ask" | "debug" {
  return kind === "loop" || kind === "plan" || kind === "ask" || kind === "debug";
}

/** Caret on the chip-inserted leading spacer (offset 1); Backspace trims it before chip removal. */
export function isCaretOnStructuralChipLeadingSpacer(
  segs: RichSegment[],
  caret: SegmentCaret,
): boolean {
  const merged = mergeAdjacentTextSegments(segs);
  const at = merged[caret.segmentIndex];
  if (at?.kind !== "text" || caret.offset !== 1 || !at.value.startsWith(" ")) {
    return false;
  }
  return isStructuralChipKind(merged[caret.segmentIndex - 1]?.kind);
}

/** Tail is only the chip-inserted lone spacer (default end-of-input position). */
export function isStructuralChipInsertedSpacerOnly(
  segs: RichSegment[],
  caret: SegmentCaret,
): boolean {
  if (!isCaretOnStructuralChipLeadingSpacer(segs, caret)) {
    return false;
  }
  const merged = mergeAdjacentTextSegments(segs);
  const at = merged[caret.segmentIndex];
  return at?.kind === "text" && at.value === " ";
}

export function structuralChipKindBeforeCaret(
  segs: RichSegment[],
  caret: SegmentCaret,
): "loop" | "plan" | "ask" | "debug" | null {
  const merged = mergeAdjacentTextSegments(segs);
  const prev = merged[caret.segmentIndex - 1];
  return isStructuralChipKind(prev?.kind) ? prev.kind : null;
}

export function trimStructuralChipLeadingSpacerAtCaret(
  segs: RichSegment[],
  caret: SegmentCaret,
): { segments: RichSegment[]; caret: SegmentCaret } | null {
  if (!isCaretOnStructuralChipLeadingSpacer(segs, caret)) {
    return null;
  }
  const merged = mergeAdjacentTextSegments(segs);
  const idx = caret.segmentIndex;
  const at = merged[idx];
  if (at?.kind !== "text") {
    return null;
  }
  const rest = at.value.slice(1);
  const next = mergeAdjacentTextSegments([
    ...merged.slice(0, idx),
    { kind: "text" as const, value: rest },
    ...merged.slice(idx + 1),
  ]);
  return {
    segments: next.length > 0 ? next : emptySegments(),
    caret: { segmentIndex: idx, offset: 0 },
  };
}
