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

const { createComposerLexicalEditor, richSegmentsToEditorState } =
  await import("@spiritagent/ui/composer");
const { caretAtEnd, caretToPlainTextOffset, insertSegmentAtCaret, segmentsToPlainText } =
  await import("@spiritagent/ui/composer");
const {
  lexicalSelectionToPlainTextOffset,
  lexicalSelectionToSegmentCaret,
  segmentCaretToLexicalSelection,
} = await import("@spiritagent/ui/composer");

const multilineSegments = [
  {
    kind: "text",
    value:
      "First line of the verse\nSecond line of the verse\nThird line of the verse\nHere I want to quote a sentence, caret goes right here:",
  },
];

test("lexical caret roundtrips multiline plain-text offset", () => {
  const editor = createComposerLexicalEditor();
  richSegmentsToEditorState(multilineSegments, editor);
  const endCaret = caretAtEnd(multilineSegments);
  segmentCaretToLexicalSelection(editor, multilineSegments, endCaret);

  const plainOffset = lexicalSelectionToPlainTextOffset(editor);
  const caret = lexicalSelectionToSegmentCaret(editor, multilineSegments);
  assert.equal(plainOffset, segmentsToPlainText(multilineSegments).length);
  assert.equal(caretToPlainTextOffset(multilineSegments, caret), plainOffset);
});

test("zero-width chip caret disambiguates trailing text from preceding text end", () => {
  const segments = [
    { kind: "text", value: "hello" },
    { kind: "skill", alias: "review-diff" },
    { kind: "text", value: " world" },
  ];
  const editor = createComposerLexicalEditor();
  richSegmentsToEditorState(segments, editor);

  segmentCaretToLexicalSelection(editor, segments, { segmentIndex: 0, offset: 5 });
  assert.deepEqual(lexicalSelectionToSegmentCaret(editor, segments), {
    segmentIndex: 0,
    offset: 5,
  });

  segmentCaretToLexicalSelection(editor, segments, { segmentIndex: 2, offset: 0 });
  assert.deepEqual(lexicalSelectionToSegmentCaret(editor, segments), {
    segmentIndex: 2,
    offset: 0,
  });
});

test("segment caret on chip segment maps to adjacent text without Lexical throw", () => {
  const segments = [
    { kind: "text", value: "hello " },
    { kind: "skill", alias: "/review-diff" },
    { kind: "text", value: " world" },
  ];
  const editor = createComposerLexicalEditor();
  richSegmentsToEditorState(segments, editor);
  assert.doesNotThrow(() => {
    segmentCaretToLexicalSelection(editor, segments, { segmentIndex: 1, offset: 0 });
  });
  const caret = lexicalSelectionToSegmentCaret(editor, segments);
  assert.equal(caret?.segmentIndex, 2);
  assert.equal(caret?.offset, 1);
});

test("element-type anchor on empty line maps to the empty line, not the end", async () => {
  // Caret on an empty line has no text node, so Lexical reports an element-type anchor on
  // the paragraph with anchorOffset = child index (paste-at-end regression).
  const segments = [{ kind: "text", value: "```测试\n\n```" }];
  const editor = createComposerLexicalEditor();
  richSegmentsToEditorState(segments, editor);

  const { $createRangeSelection, $getRoot, $setSelection } = await import("lexical");
  editor.update(
    () => {
      const paragraph = $getRoot().getFirstChild();
      // children: [text("```测试"), br, br, text("```")]; caret before the second br.
      const selection = $createRangeSelection();
      selection.anchor.set(paragraph.getKey(), 2, "element");
      selection.focus.set(paragraph.getKey(), 2, "element");
      $setSelection(selection);
    },
    { discrete: true },
  );

  const caret = lexicalSelectionToSegmentCaret(editor, segments);
  assert.deepEqual(caret, { segmentIndex: 0, offset: 6 });

  const { segments: next, caret: nextCaret } = insertSegmentAtCaret(segments, caret, {
    kind: "text",
    value: "粘贴",
  });
  assert.equal(segmentsToPlainText(next), "```测试\n粘贴\n```");
  assert.deepEqual(nextCaret, { segmentIndex: 0, offset: 8 });
});

test("insertSegmentAtCaret uses segment-model caret after multiline end selection", () => {
  const editor = createComposerLexicalEditor();
  richSegmentsToEditorState(multilineSegments, editor);
  segmentCaretToLexicalSelection(editor, multilineSegments, caretAtEnd(multilineSegments));

  const caret = lexicalSelectionToSegmentCaret(editor, multilineSegments);
  assert.ok(caret);
  const { segments } = insertSegmentAtCaret(multilineSegments, caret, {
    kind: "fileSnippet",
    attachment: {
      id: "snip-1",
      filePath: "README.md",
      lineStart: 1,
      lineEnd: 1,
      selectedText: "quote",
    },
  });
  const chipIndex = segments.findIndex((segment) => segment.kind === "fileSnippet");
  assert.ok(chipIndex >= 0);
  const textBeforeChip = segmentsToPlainText(segments.slice(0, chipIndex));
  assert.ok(textBeforeChip.endsWith("caret goes right here:"));
  assert.equal(textBeforeChip.includes("Second line of the verse\n[file:"), false);
});
