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

const {
  assertMessageTextInvariant,
  assertRichSegmentsRoundTrip,
  createComposerLexicalEditor,
  editorStateToRichSegments,
  richSegmentsRoundTrip,
  richSegmentsToEditorState,
} = await import("@spiritagent/ui/composer");
const { emptySegments, segmentsEqual, segmentsToMessageText } =
  await import("@spiritagent/ui/composer");

const sampleElement = {
  id: "el-1",
  tagName: "img",
  outerHtml: '<img src="x">',
  screenshotDataUrl: "",
  pageUrl: "https://example.com",
};

const samplePrDiff = {
  id: "pr-1",
  prUrl: "https://github.com/o/r/pull/1",
  filename: "src/foo.ts",
  lineStart: 9,
  lineEnd: 9,
  diffText: "diff",
  status: "open",
};

const sampleGitCommit = {
  id: "gc-1",
  oid: "abc123",
  subject: "fix: example",
  author: "dev",
  authoredAt: "2026-01-01T00:00:00Z",
  fullMessage: "fix: example\n\nbody",
};

const sampleTerminal = {
  id: "term-1",
  terminalName: "Terminal",
  lineStart: 10,
  lineEnd: 12,
  selectedText: "error output",
};

const sampleFileSnippet = {
  id: "file-1",
  filePath: "apps/desktop/src/App.tsx",
  lineStart: 10,
  lineEnd: 12,
  selectedText: "const App = () => null;",
};

const fixtureCases = [
  { name: "empty", segments: emptySegments() },
  { name: "plain text", segments: [{ kind: "text", value: "hello world" }] },
  { name: "multiline text", segments: [{ kind: "text", value: "a\nbc\nd\nef\ng" }] },
  {
    name: "element chip",
    segments: [
      { kind: "text", value: "before " },
      { kind: "element", attachment: sampleElement },
      { kind: "text", value: " after" },
    ],
  },
  {
    name: "prDiff chip",
    segments: [
      { kind: "prDiff", attachment: samplePrDiff },
      { kind: "text", value: " " },
    ],
  },
  {
    name: "gitCommit chip",
    segments: [
      { kind: "gitCommit", attachment: sampleGitCommit },
      { kind: "text", value: " " },
    ],
  },
  {
    name: "terminalSnippet chip",
    segments: [
      { kind: "terminalSnippet", attachment: sampleTerminal },
      { kind: "text", value: " " },
    ],
  },
  {
    name: "fileSnippet chip",
    segments: [
      { kind: "fileSnippet", attachment: sampleFileSnippet },
      { kind: "text", value: " " },
    ],
  },
  {
    name: "workspaceFile chip",
    segments: [
      { kind: "workspaceFile", path: "src/index.ts" },
      { kind: "text", value: " " },
    ],
  },
  {
    name: "skill chip",
    segments: [
      { kind: "skill", alias: "/git-commit" },
      { kind: "text", value: " " },
    ],
  },
  {
    name: "structural chips",
    segments: [{ kind: "loop" }, { kind: "plan" }, { kind: "text", value: " " }],
  },
  {
    name: "ask and debug chips",
    segments: [{ kind: "ask" }, { kind: "debug" }, { kind: "text", value: "draft" }],
  },
];

for (const fixture of fixtureCases) {
  test(`richSegments round-trip: ${fixture.name}`, () => {
    assert.ok(assertRichSegmentsRoundTrip(fixture.segments));
    const roundTripped = richSegmentsRoundTrip(fixture.segments);
    assert.ok(segmentsEqual(fixture.segments, roundTripped));
  });

  test(`segmentsToMessageText invariant: ${fixture.name}`, () => {
    assert.ok(assertMessageTextInvariant(fixture.segments));
    const before = segmentsToMessageText(fixture.segments);
    const after = segmentsToMessageText(richSegmentsRoundTrip(fixture.segments));
    assert.equal(before, after);
  });
}

test("richSegmentsToEditorState hydrates editor readable by editorStateToRichSegments", () => {
  const editor = createComposerLexicalEditor();
  const segments = [
    { kind: "plan" },
    { kind: "text", value: "typed" },
    { kind: "workspaceFile", path: "lib/foo.ts" },
  ];
  richSegmentsToEditorState(segments, editor);
  const read = editorStateToRichSegments(editor);
  assert.ok(segmentsEqual(segments, read));
});
