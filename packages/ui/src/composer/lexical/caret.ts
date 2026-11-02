import {
  $createRangeSelection,
  $getRoot,
  $getSelection,
  $isLineBreakNode,
  $isParagraphNode,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  type ElementNode,
  type LexicalEditor,
  type LexicalNode,
  type RangeSelection,
} from "lexical";

import type { SpiritChipPayload } from "./spirit-chip-payload.js";
import { normalizeCaretForComposer } from "../composer-caret-normalize.js";
import {
  caretAtEnd,
  caretToPlainTextOffset,
  mergeAdjacentTextSegments,
  plainTextOffsetToCaret,
  workspaceFilePlainToken,
  type RichSegment,
  type SegmentCaret,
} from "../composer-segment-model.js";
import { $isSpiritChipNode } from "./nodes/spirit-chip-node.js";
import { $isSpiritParagraphNode } from "./nodes/spirit-paragraph-node.js";

function getComposerParagraph(): ElementNode | null {
  const firstChild = $getRoot().getFirstChild();
  if (!$isSpiritParagraphNode(firstChild) && !$isParagraphNode(firstChild)) {
    return null;
  }
  return firstChild;
}

function chipPlainTextLength(payload: SpiritChipPayload): number {
  if (payload.kind === "workspaceFile") {
    return workspaceFilePlainToken(payload.path).length;
  }
  return 0;
}

type LexicalTarget = { nodeKey: string; offset: number };

/** Mirror `appendTextValueToParagraph` in rich-segments-to-editor.ts — keep Lexical walk in sync. */
function skipTextSegmentNodes(value: string, children: LexicalNode[], start: number): number {
  if (value.length === 0) {
    return $isTextNode(children[start]) ? start + 1 : -1;
  }
  const lines = value.split("\n");
  let index = start;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]!;
    if (line.length > 0) {
      if (!$isTextNode(children[index])) {
        return -1;
      }
      index += 1;
    }
    if (lineIndex < lines.length - 1) {
      if (!$isLineBreakNode(children[index])) {
        return -1;
      }
      index += 1;
    }
  }
  return index;
}

function skipSegmentNodes(segment: RichSegment, children: LexicalNode[], start: number): number {
  if (segment.kind === "text") {
    return skipTextSegmentNodes(segment.value, children, start);
  }
  return $isSpiritChipNode(children[start]) ? start + 1 : -1;
}

function textSegmentOffsetToLexical(
  value: string,
  children: LexicalNode[],
  startChild: number,
  offset: number,
): LexicalTarget | null {
  if (value.length === 0) {
    const node = children[startChild];
    return $isTextNode(node) ? { nodeKey: node.getKey(), offset: 0 } : null;
  }

  const lines = value.split("\n");
  let plain = 0;
  let childIndex = startChild;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]!;
    if (line.length > 0) {
      const node = children[childIndex];
      if (!$isTextNode(node)) {
        return null;
      }
      if (offset <= plain + line.length) {
        return { nodeKey: node.getKey(), offset: offset - plain };
      }
      plain += line.length;
      childIndex += 1;
    }
    if (lineIndex < lines.length - 1) {
      if (offset <= plain) {
        const prev = children[childIndex - 1];
        if ($isTextNode(prev)) {
          return { nodeKey: prev.getKey(), offset: prev.getTextContentSize() };
        }
        return null;
      }
      if (offset === plain + 1) {
        const next = children[childIndex + 1];
        if ($isTextNode(next)) {
          return { nodeKey: next.getKey(), offset: 0 };
        }
        return null;
      }
      if (!$isLineBreakNode(children[childIndex])) {
        return null;
      }
      plain += 1;
      childIndex += 1;
    }
  }

  for (let index = childIndex - 1; index >= startChild; index -= 1) {
    const node = children[index];
    if ($isTextNode(node)) {
      return { nodeKey: node.getKey(), offset: node.getTextContentSize() };
    }
  }
  return null;
}

/** SpiritChipNode cannot be a RangeSelection anchor (both text and element anchors throw), so a chip-segment caret maps to the adjacent text. */
function caretAdjacentToChip(segs: RichSegment[], chipIndex: number): SegmentCaret {
  const merged = mergeAdjacentTextSegments(segs);
  const textAfter = merged.findIndex((s, i) => i > chipIndex && s.kind === "text");
  if (textAfter >= 0) {
    const textSeg = merged[textAfter];
    const offset = textSeg?.kind === "text" && textSeg.value.startsWith(" ") ? 1 : 0;
    return { segmentIndex: textAfter, offset };
  }
  for (let i = chipIndex - 1; i >= 0; i -= 1) {
    const seg = merged[i];
    if (seg?.kind === "text") {
      return { segmentIndex: i, offset: seg.value.length };
    }
  }
  return { segmentIndex: Math.min(chipIndex + 1, merged.length), offset: 0 };
}

function resolveSegmentCaretForLexical(segs: RichSegment[], caret: SegmentCaret): SegmentCaret {
  const merged = mergeAdjacentTextSegments(segs);
  const normalized = normalizeCaretForComposer(merged, caret);
  const at = merged[normalized.segmentIndex];
  if (at && at.kind !== "text") {
    return caretAdjacentToChip(merged, normalized.segmentIndex);
  }
  return normalized;
}

function segmentCaretToLexicalTarget(
  paragraph: ElementNode,
  segments: RichSegment[],
  caret: SegmentCaret,
): LexicalTarget | null {
  const merged = mergeAdjacentTextSegments(segments);
  const segmentIndex = Math.min(Math.max(caret.segmentIndex, 0), merged.length);
  const caretOffset = Math.max(0, caret.offset);
  const children = paragraph.getChildren();
  let childIndex = 0;

  for (let index = 0; index < segmentIndex; index += 1) {
    childIndex = skipSegmentNodes(merged[index]!, children, childIndex);
    if (childIndex < 0) {
      return null;
    }
  }

  const segment = merged[segmentIndex];
  if (!segment) {
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const node = children[index];
      if ($isTextNode(node)) {
        return { nodeKey: node.getKey(), offset: node.getTextContentSize() };
      }
    }
    return null;
  }

  if (segment.kind === "text") {
    return textSegmentOffsetToLexical(segment.value, children, childIndex, caretOffset);
  }

  return segmentCaretToLexicalTarget(paragraph, merged, caretAdjacentToChip(merged, segmentIndex));
}

function locateAnchorInTextSegment(
  value: string,
  children: LexicalNode[],
  startChild: number,
  anchorNode: LexicalNode,
  anchorOffset: number,
  segmentIndex: number,
): SegmentCaret | null {
  const anchorKey = anchorNode.getKey();
  if (value.length === 0) {
    const node = children[startChild];
    if ($isTextNode(node) && (node.getKey() === anchorKey || node.isParentOf(anchorNode))) {
      return { segmentIndex, offset: anchorOffset };
    }
    return null;
  }

  const lines = value.split("\n");
  let childIndex = startChild;
  let plain = 0;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]!;
    if (line.length > 0) {
      const node = children[childIndex];
      if ($isTextNode(node) && (node.getKey() === anchorKey || node.isParentOf(anchorNode))) {
        return { segmentIndex, offset: plain + anchorOffset };
      }
      plain += line.length;
      childIndex += 1;
    }
    if (lineIndex < lines.length - 1) {
      const breakNode = children[childIndex];
      if ($isLineBreakNode(breakNode) && breakNode.getKey() === anchorKey) {
        return { segmentIndex, offset: plain };
      }
      plain += 1;
      childIndex += 1;
    }
  }
  return null;
}

function lexicalAnchorToSegmentCaret(
  paragraph: ElementNode,
  segments: RichSegment[],
  anchorNode: LexicalNode,
  anchorOffset: number,
): SegmentCaret | null {
  const merged = mergeAdjacentTextSegments(segments);
  const children = paragraph.getChildren();

  // Element-type anchor: the caret sits on an empty line, which has no text node to anchor
  // to, so Lexical anchors on the paragraph itself and anchorOffset is the child index
  // before which the caret sits. Convert it to a plain-text offset by summing the
  // preceding children (same accounting as lexicalSelectionToPlainTextOffset).
  if (anchorNode === paragraph) {
    let plain = 0;
    const stop = Math.min(Math.max(anchorOffset, 0), children.length);
    for (let index = 0; index < stop; index += 1) {
      const child = children[index]!;
      if ($isTextNode(child)) {
        plain += child.getTextContentSize();
        continue;
      }
      if ($isLineBreakNode(child)) {
        plain += 1;
        continue;
      }
      if ($isSpiritChipNode(child)) {
        plain += chipPlainTextLength(child.getPayload());
      }
    }
    return plainTextOffsetToCaret(merged, plain);
  }

  const anchorKey = anchorNode.getKey();
  let childIndex = 0;

  for (let segmentIndex = 0; segmentIndex < merged.length; segmentIndex += 1) {
    const segment = merged[segmentIndex]!;
    if (segment.kind === "text") {
      const caret = locateAnchorInTextSegment(
        segment.value,
        children,
        childIndex,
        anchorNode,
        anchorOffset,
        segmentIndex,
      );
      if (caret) {
        return caret;
      }
      childIndex = skipTextSegmentNodes(segment.value, children, childIndex);
      if (childIndex < 0) {
        return null;
      }
      continue;
    }

    const chip = children[childIndex];
    if ($isSpiritChipNode(chip) && chip.getKey() === anchorKey) {
      return caretAdjacentToChip(merged, segmentIndex);
    }
    childIndex = skipSegmentNodes(segment, children, childIndex);
    if (childIndex < 0) {
      return null;
    }
  }

  return caretAtEnd(merged);
}

function setCollapsedLexicalSelection(target: LexicalTarget): void {
  const selection: RangeSelection = $createRangeSelection();
  selection.anchor.set(target.nodeKey, target.offset, "text");
  selection.focus.set(target.nodeKey, target.offset, "text");
  $setSelection(selection);
}

/** Map Lexical caret to UTF-16 plain-text offset (matches segment model / composerText). */
export function lexicalSelectionToPlainTextOffset(editor: LexicalEditor): number | null {
  let result: number | null = null;
  editor.getEditorState().read(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
      return;
    }
    const paragraph = getComposerParagraph();
    if (!paragraph) {
      return;
    }

    const anchorNode = selection.anchor.getNode();
    const anchorKey = anchorNode.getKey();
    let offset = 0;

    for (const child of paragraph.getChildren()) {
      if ($isTextNode(child)) {
        if (child.getKey() === anchorKey || child.isParentOf(anchorNode)) {
          result = offset + selection.anchor.offset;
          return;
        }
        offset += child.getTextContentSize();
        continue;
      }
      if ($isLineBreakNode(child)) {
        offset += 1;
        continue;
      }
      if ($isSpiritChipNode(child)) {
        if (child.getKey() === anchorKey) {
          result = offset;
          return;
        }
        offset += chipPlainTextLength(child.getPayload());
      }
    }
  });
  return result;
}

export function lexicalSelectionToSegmentCaret(
  editor: LexicalEditor,
  segments: RichSegment[],
): SegmentCaret | null {
  let result: SegmentCaret | null = null;
  editor.getEditorState().read(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
      return;
    }
    const paragraph = getComposerParagraph();
    if (!paragraph) {
      return;
    }
    const anchorNode = selection.anchor.getNode();
    result = lexicalAnchorToSegmentCaret(paragraph, segments, anchorNode, selection.anchor.offset);
  });
  return result;
}

export function segmentCaretToLexicalSelection(
  editor: LexicalEditor,
  segments: RichSegment[],
  caret: SegmentCaret,
  options?: { tag?: string },
): void {
  const resolvedCaret = resolveSegmentCaretForLexical(segments, caret);
  editor.update(
    () => {
      const paragraph = getComposerParagraph();
      if (!paragraph) {
        return;
      }
      const target = segmentCaretToLexicalTarget(paragraph, segments, resolvedCaret);
      if (!target) {
        return;
      }
      setCollapsedLexicalSelection(target);
    },
    { discrete: true, ...(options?.tag ? { tag: options.tag } : {}) },
  );
}

export function focusComposerAtEnd(editor: LexicalEditor, segments: RichSegment[]): void {
  segmentCaretToLexicalSelection(editor, segments, caretAtEnd(segments));
  editor.focus();
}

// Re-export for tests that assert plain-offset roundtrips on unambiguous caret positions.
export { caretToPlainTextOffset, plainTextOffsetToCaret };
