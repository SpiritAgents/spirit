import assert from "node:assert/strict";
import { test } from "vitest";

const { spiritChipPlainText } = await import("@spiritagent/ui/composer");

test("workspaceFile chip plain text is the @path token", () => {
  assert.equal(
    spiritChipPlainText({ kind: "workspaceFile", path: "src/index.ts" }),
    "@src/index.ts",
  );
});

test("workspaceFile chip plain text normalizes backslashes", () => {
  assert.equal(
    spiritChipPlainText({ kind: "workspaceFile", path: "src\\lib\\foo.ts" }),
    "@src/lib/foo.ts",
  );
});

test("skill chip plain text keeps the slash alias", () => {
  assert.equal(spiritChipPlainText({ kind: "skill", alias: "/review-diff" }), "/review-diff");
});

test("element chip plain text is the angle-bracket tag label", () => {
  assert.equal(
    spiritChipPlainText({
      kind: "element",
      attachment: {
        id: "el-1",
        tagName: "img",
        outerHtml: '<img src="x">',
        screenshotDataUrl: "",
        pageUrl: "https://example.com",
      },
    }),
    "<img>",
  );
});

test("prDiff chip plain text is the file-and-lines label", () => {
  assert.equal(
    spiritChipPlainText({
      kind: "prDiff",
      attachment: {
        id: "pr-1",
        prUrl: "https://example.com/pr/1",
        filename: "src/foo.ts",
        lineStart: 9,
        lineEnd: 12,
        diffText: "diff",
        status: "open",
      },
    }),
    "foo.ts L9-12",
  );
});

test("gitCommit chip plain text is the subject label", () => {
  assert.equal(
    spiritChipPlainText({
      kind: "gitCommit",
      attachment: {
        id: "gc-1",
        oid: "abc123",
        subject: "fix: example",
        author: "dev",
        authoredAt: "2026-01-01T00:00:00Z",
        fullMessage: "fix: example\n\nbody",
      },
    }),
    "fix: example",
  );
});

test("terminalSnippet chip plain text is the terminal-and-lines label", () => {
  assert.equal(
    spiritChipPlainText({
      kind: "terminalSnippet",
      attachment: {
        id: "term-1",
        terminalName: "Terminal",
        lineStart: 10,
        lineEnd: 12,
        selectedText: "error output",
      },
    }),
    "Terminal L10-12",
  );
});

test("fileSnippet chip plain text is the file-and-lines label", () => {
  assert.equal(
    spiritChipPlainText({
      kind: "fileSnippet",
      attachment: {
        id: "file-1",
        filePath: "apps/desktop/src/App.tsx",
        lineStart: 10,
        lineEnd: 12,
        selectedText: "const App = () => null;",
      },
    }),
    "App.tsx L10-12",
  );
});

test("structural chips fall back to default English labels on the clipboard", () => {
  assert.equal(spiritChipPlainText({ kind: "loop" }), "Loop");
  assert.equal(spiritChipPlainText({ kind: "plan" }), "Plan");
  assert.equal(spiritChipPlainText({ kind: "ask" }), "Ask");
  assert.equal(spiritChipPlainText({ kind: "debug" }), "Debug");
});
