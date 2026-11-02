import { useEffect, type ClipboardEvent } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { PASTE_COMMAND, COMMAND_PRIORITY_HIGH } from "lexical";

import { lexicalSelectionToSegmentCaret } from "../caret.js";
import {
  caretAtEnd,
  insertSegmentAtCaret,
  type RichSegment,
} from "../../composer-segment-model.js";
import type { ComposerSegmentsCommitFn } from "./composer-commands-plugin.js";

const LEXICAL_JSON_MIME = "application/x-lexical-editor";

type ComposerClipboardPluginProps = {
  segmentsRef: React.MutableRefObject<RichSegment[]>;
  commitSegments: ComposerSegmentsCommitFn;
  onPaste?: (e: ClipboardEvent<HTMLDivElement>) => void;
};

/**
 * Copy is not intercepted: left to the Lexical default pipeline (text/plain uses the
 * canonical text from SpiritChipNode.getTextContent, text/html uses exportDOM, and an
 * application/x-lexical-editor JSON is attached).
 * Paste is only passed through to RichTextPlugin when it carries Lexical JSON, which natively
 * restores chip nodes (payload fully preserved); everything else is inserted as plain text via
 * the segment model.
 */
export function ComposerClipboardPlugin({
  segmentsRef,
  commitSegments,
  onPaste,
}: ComposerClipboardPluginProps) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    // RichTextPlugin also registers at EDITOR priority and earlier; returning true at the same priority short-circuits it, so the host's image-paste onPaste would never run
    return editor.registerCommand(
      PASTE_COMMAND,
      (event) => {
        if (!(event instanceof ClipboardEvent)) {
          return false;
        }
        const clipboardEvent = event;
        if (onPaste) {
          onPaste(clipboardEvent as unknown as ClipboardEvent<HTMLDivElement>);
        }
        if (clipboardEvent.defaultPrevented) {
          return true;
        }

        if (clipboardEvent.clipboardData?.getData(LEXICAL_JSON_MIME)) {
          return false;
        }

        const plain = clipboardEvent.clipboardData?.getData("text/plain");
        if (!plain) {
          return false;
        }
        clipboardEvent.preventDefault();
        const caret =
          lexicalSelectionToSegmentCaret(editor, segmentsRef.current) ??
          caretAtEnd(segmentsRef.current);
        const { segments: next, caret: nextCaret } = insertSegmentAtCaret(
          segmentsRef.current,
          caret,
          { kind: "text", value: plain },
        );
        commitSegments(next, nextCaret);
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [commitSegments, editor, onPaste, segmentsRef]);

  return null;
}
