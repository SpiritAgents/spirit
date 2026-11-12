import assert from "node:assert/strict";
import { test } from "vitest";
import { parseHTML } from "linkedom";

const { window } = parseHTML("<!doctype html><html><body></body></html>");
globalThis.Node = window.Node;
globalThis.HTMLElement = window.HTMLElement;
globalThis.document = window.document;
if (typeof window.getSelection === "function") {
  globalThis.getSelection = window.getSelection.bind(window);
}
if (typeof globalThis.MutationObserver === "undefined") {
  globalThis.MutationObserver = class MutationObserver {
    observe() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  };
}

const { $getRoot } = await import("lexical");
const { createComposerLexicalEditor, richSegmentsToEditorState } =
  await import("@spiritagent/ui/composer");
const { $isSpiritChipNode } = await import("@spiritagent/ui/composer");

const mixedSegments = [
  { kind: "text", value: "look at " },
  { kind: "workspaceFile", path: "src/index.ts" },
  { kind: "text", value: " and " },
  { kind: "skill", alias: "/review-diff" },
  { kind: "text", value: " please" },
];

function chipNodesInEditor(editor) {
  return editor.getEditorState().read(() =>
    $getRoot()
      .getFirstChild()
      .getChildren()
      .filter((node) => $isSpiritChipNode(node)),
  );
}

test("SpiritChipNode.getTextContent returns canonical chip text", () => {
  const editor = createComposerLexicalEditor();
  richSegmentsToEditorState(mixedSegments, editor);

  const chips = chipNodesInEditor(editor);
  assert.equal(chips.length, 2);
  assert.equal(chips[0].getTextContent(), "@src/index.ts");
  assert.equal(chips[1].getTextContent(), "/review-diff");
});

function selectAllTextContent(editor) {
  let text = null;
  editor.update(() => {
    const paragraph = $getRoot().getFirstChild();
    text = paragraph.select(0, paragraph.getChildrenSize()).getTextContent();
  });
  return text;
}

test("select-all text content keeps chips instead of dropping them", () => {
  const editor = createComposerLexicalEditor();
  richSegmentsToEditorState(mixedSegments, editor);

  assert.equal(selectAllTextContent(editor), "look at @src/index.ts and /review-diff please");
});

test("select-all text content keeps line breaks alongside chips", () => {
  const editor = createComposerLexicalEditor();
  richSegmentsToEditorState(
    [
      { kind: "text", value: "first\nsecond " },
      { kind: "workspaceFile", path: "lib/a.ts" },
    ],
    editor,
  );

  assert.equal(selectAllTextContent(editor), "first\nsecond @lib/a.ts");
});

test("SpiritChipNode.exportDOM emits a labeled span with canonical text", () => {
  const editor = createComposerLexicalEditor();
  richSegmentsToEditorState(mixedSegments, editor);

  const [chip] = chipNodesInEditor(editor);
  const { element } = editor.getEditorState().read(() => chip.exportDOM(editor));
  assert.ok(element);
  assert.equal(element.tagName, "SPAN");
  assert.equal(element.getAttribute("data-spirit-chip"), "true");
  assert.equal(element.getAttribute("data-chip-kind"), "workspaceFile");
  assert.equal(element.textContent, "@src/index.ts");
});

test("chip payload survives exportJSON/importJSON round-trip", () => {
  const source = createComposerLexicalEditor();
  richSegmentsToEditorState(mixedSegments, source);

  const serialized = source
    .getEditorState()
    .read(() => chipNodesInEditor(source).map((chip) => chip.exportJSON()));

  const target = createComposerLexicalEditor();
  const state = target.parseEditorState({
    root: {
      children: [
        {
          children: serialized,
          direction: null,
          format: "",
          indent: 0,
          type: "paragraph",
          version: 1,
        },
      ],
      direction: null,
      format: "",
      indent: 0,
      type: "root",
      version: 1,
    },
  });
  target.setEditorState(state);

  const chips = chipNodesInEditor(target);
  assert.equal(chips.length, 2);
  assert.deepEqual(chips[0].getPayload(), { kind: "workspaceFile", path: "src/index.ts" });
  assert.deepEqual(chips[1].getPayload(), { kind: "skill", alias: "/review-diff" });
});
