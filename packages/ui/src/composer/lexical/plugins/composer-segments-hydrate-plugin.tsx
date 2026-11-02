import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useLayoutEffect, type RefObject } from "react";
import type { LexicalEditor } from "lexical";

import { caretAtEnd } from "../../composer-segment-model.js";
import { normalizeCaretForComposer } from "../../composer-caret-normalize.js";
import { richSegmentsToEditorState } from "../bridge/index.js";
import { segmentCaretToLexicalSelection } from "../caret.js";
import type { RichSegment } from "../../composer-segment-model.js";

type ComposerSegmentsHydratePluginProps = {
  editorRef: RefObject<LexicalEditor | null>;
  segmentsRef: RefObject<RichSegment[]>;
  skipEditorSyncRef: RefObject<boolean>;
  mountHydratedRef: RefObject<boolean>;
};

/** One-shot mount hydrate: push current segment state into Lexical. */
export function ComposerSegmentsHydratePlugin({
  editorRef,
  segmentsRef,
  skipEditorSyncRef,
  mountHydratedRef,
}: ComposerSegmentsHydratePluginProps) {
  const [editor] = useLexicalComposerContext();

  useLayoutEffect(() => {
    editorRef.current = editor;
    return () => {
      editorRef.current = null;
    };
  }, [editor, editorRef]);

  useLayoutEffect(() => {
    if (mountHydratedRef.current) {
      return;
    }
    mountHydratedRef.current = true;
    const segments = segmentsRef.current;
    skipEditorSyncRef.current = true;
    richSegmentsToEditorState(segments, editor);
    segmentCaretToLexicalSelection(
      editor,
      segments,
      normalizeCaretForComposer(segments, caretAtEnd(segments)),
    );
    skipEditorSyncRef.current = false;
  }, [editor, editorRef, mountHydratedRef, segmentsRef, skipEditorSyncRef]);

  return null;
}
