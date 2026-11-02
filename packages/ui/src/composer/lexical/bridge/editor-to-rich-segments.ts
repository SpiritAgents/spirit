import {
  $getRoot,
  $isLineBreakNode,
  $isParagraphNode,
  $isTextNode,
  type ElementNode,
  type LexicalEditor,
} from "lexical";

import {
  emptySegments,
  mergeAdjacentTextSegments,
  type RichSegment,
} from "../../composer-segment-model.js";
import { $isSpiritChipNode } from "../nodes/spirit-chip-node.js";
import { $isSpiritParagraphNode } from "../nodes/spirit-paragraph-node.js";

function paragraphChildrenToSegments(paragraph: ElementNode): RichSegment[] {
  const out: RichSegment[] = [];

  for (const child of paragraph.getChildren()) {
    if ($isTextNode(child)) {
      const value = child.getTextContent();
      const prev = out[out.length - 1];
      if (prev?.kind === "text") {
        prev.value += value;
      } else {
        out.push({ kind: "text", value });
      }
      continue;
    }

    if ($isLineBreakNode(child)) {
      const prev = out[out.length - 1];
      if (prev?.kind === "text") {
        prev.value += "\n";
      } else {
        out.push({ kind: "text", value: "\n" });
      }
      continue;
    }

    if ($isSpiritChipNode(child)) {
      out.push(child.getPayload());
    }
  }

  if (out.length === 0) {
    return emptySegments();
  }

  return mergeAdjacentTextSegments(out);
}

/** Read RichSegment[] from the current Lexical editor state. */
export function editorStateToRichSegments(editor: LexicalEditor): RichSegment[] {
  let segments = emptySegments();

  editor.getEditorState().read(() => {
    const root = $getRoot();
    const firstChild = root.getFirstChild();

    if (!$isSpiritParagraphNode(firstChild) && !$isParagraphNode(firstChild)) {
      segments = emptySegments();
      return;
    }

    segments = paragraphChildrenToSegments(firstChild);
  });

  return segments;
}
