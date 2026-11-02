import { createElement, type ReactElement } from "react";
import {
  $applyNodeReplacement,
  DecoratorNode,
  type DOMExportOutput,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from "lexical";

import { SpiritChipDecorator } from "../../chips/spirit-chip-decorator.js";
import { spiritChipPlainText, type SpiritChipPayload } from "../spirit-chip-payload.js";

export type SerializedSpiritChipNode = Spread<
  {
    payload: SpiritChipPayload;
  },
  SerializedLexicalNode
>;

export class SpiritChipNode extends DecoratorNode<ReactElement> {
  __payload: SpiritChipPayload;

  static getType(): string {
    return "spirit-chip";
  }

  static clone(node: SpiritChipNode): SpiritChipNode {
    return new SpiritChipNode(node.__payload, node.__key);
  }

  constructor(payload: SpiritChipPayload, key?: NodeKey) {
    super(key);
    this.__payload = payload;
  }

  static importJSON(serialized: SerializedSpiritChipNode): SpiritChipNode {
    return $createSpiritChipNode(serialized.payload);
  }

  exportJSON(): SerializedSpiritChipNode {
    return {
      ...super.exportJSON(),
      type: "spirit-chip",
      version: 1,
      payload: this.__payload,
    };
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const span = document.createElement("span");
    span.setAttribute("data-spirit-chip", "true");
    span.setAttribute("contenteditable", "false");
    return span;
  }

  updateDOM(): false {
    return false;
  }

  isInline(): boolean {
    return true;
  }

  isKeyboardSelectable(): boolean {
    return true;
  }

  // The base class returns slot text by default (a chip has no slots, i.e. ""), so copy/select-all would lose the chip; emit canonical text instead
  getTextContent(): string {
    return spiritChipPlainText(this.__payload);
  }

  // The base exportDOM reuses createDOM (an empty span), so text/html would lose the chip too; emit a semantic span carrying the canonical text
  exportDOM(): DOMExportOutput {
    const span = document.createElement("span");
    span.setAttribute("data-spirit-chip", "true");
    span.setAttribute("data-chip-kind", this.__payload.kind);
    span.textContent = spiritChipPlainText(this.__payload);
    return { element: span };
  }

  decorate(): ReactElement {
    return createElement(SpiritChipDecorator, { payload: this.__payload });
  }

  getPayload(): SpiritChipPayload {
    return this.__payload;
  }

  setPayload(payload: SpiritChipPayload): void {
    const writable = this.getWritable();
    writable.__payload = payload;
  }
}

export function $createSpiritChipNode(payload: SpiritChipPayload): SpiritChipNode {
  return $applyNodeReplacement(new SpiritChipNode(payload));
}

export function $isSpiritChipNode(node: LexicalNode | null | undefined): node is SpiritChipNode {
  return node instanceof SpiritChipNode;
}
