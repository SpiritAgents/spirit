import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useLayoutEffect, type RefObject } from "react";
import type { LexicalEditor } from "lexical";

import { caretAtEnd } from "../../composer-segment-model.js";
import { normalizeCaretForComposer } from "../../composer-caret-normalize.js";
import { COMPOSER_HOST_SYNC_TAGS } from "../host-sync.js";
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
    // Defer out of the layout-effect window: with chip decorators present, the mount push makes
    // @lexical/react flushSync synchronously, which React dev-mode flags when it happens inside
    // a layout effect. The microtask still lands before first paint, so nothing flashes.
    queueMicrotask(() => {
      const segments = segmentsRef.current;
      skipEditorSyncRef.current = true;
      richSegmentsToEditorState(segments, editor, { tag: COMPOSER_HOST_SYNC_TAGS });
      segmentCaretToLexicalSelection(
        editor,
        segments,
        normalizeCaretForComposer(segments, caretAtEnd(segments)),
        { tag: COMPOSER_HOST_SYNC_TAGS },
      );
      skipEditorSyncRef.current = false;
    });
  }, [editor, editorRef, mountHydratedRef, segmentsRef, skipEditorSyncRef]);

  return null;
}
