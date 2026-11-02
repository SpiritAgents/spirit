import { createHeadlessEditor } from "@lexical/headless";
import type { LexicalEditor } from "lexical";

import {
  segmentsEqual,
  segmentsToMessageText,
  type RichSegment,
} from "../../composer-segment-model.js";
import { COMPOSER_LEXICAL_NODES } from "../composer-lexical-config.js";
import { editorStateToRichSegments } from "./editor-to-rich-segments.js";
import { richSegmentsToEditorState } from "./rich-segments-to-editor.js";

export { editorStateToRichSegments } from "./editor-to-rich-segments.js";
export { richSegmentsToEditorState } from "./rich-segments-to-editor.js";

export function createComposerLexicalEditor(): LexicalEditor {
  return createHeadlessEditor({
    namespace: "spirit-composer",
    nodes: [...COMPOSER_LEXICAL_NODES],
    onError(error: Error) {
      throw error;
    },
  });
}

export function richSegmentsRoundTrip(segments: readonly RichSegment[]): RichSegment[] {
  const editor = createComposerLexicalEditor();
  richSegmentsToEditorState(segments, editor);
  return editorStateToRichSegments(editor);
}

export function assertRichSegmentsRoundTrip(segments: readonly RichSegment[]): boolean {
  const roundTripped = richSegmentsRoundTrip(segments);
  return segmentsEqual([...segments], roundTripped);
}

export function assertMessageTextInvariant(segments: readonly RichSegment[]): boolean {
  const before = segmentsToMessageText([...segments]);
  const roundTripped = richSegmentsRoundTrip(segments);
  const after = segmentsToMessageText(roundTripped);
  return before === after;
}
