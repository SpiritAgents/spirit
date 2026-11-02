import { ParagraphNode } from "lexical";

/**
 * Composer uses a single inline paragraph; subclass exists for future pin-order transforms.
 */
export class SpiritParagraphNode extends ParagraphNode {
  static getType(): string {
    return "spirit-paragraph";
  }

  static clone(node: SpiritParagraphNode): SpiritParagraphNode {
    return new SpiritParagraphNode(node.__key);
  }
}

export function $createSpiritParagraphNode(): SpiritParagraphNode {
  return new SpiritParagraphNode();
}

export function $isSpiritParagraphNode(node: unknown): node is SpiritParagraphNode {
  return node instanceof SpiritParagraphNode;
}
