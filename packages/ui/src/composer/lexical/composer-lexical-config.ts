import { LineBreakNode, ParagraphNode, TextNode, type Klass, type LexicalNode } from "lexical";

import { SpiritChipNode } from "./nodes/spirit-chip-node.js";
import { SpiritParagraphNode } from "./nodes/spirit-paragraph-node.js";

export const COMPOSER_LEXICAL_NODES: ReadonlyArray<Klass<LexicalNode>> = [
  SpiritChipNode,
  SpiritParagraphNode,
  ParagraphNode,
  TextNode,
  LineBreakNode,
];
