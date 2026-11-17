import assert from "node:assert/strict";
import { test } from "vitest";
import { parseExtensionComposerAttachment } from "../../src/lib/extension-composer-attachment.ts";
const diff = {
  kind: "prDiff",
  prUrl: "https://example.test/project/pull/1",
  filename: "src/page.ts",
  lineStart: 1,
  lineEnd: 2,
  diffText: "+added",
  status: "open",
};
test("the host creates attachment identity and binds the originating tab", () => {
  const parsed = parseExtensionComposerAttachment(
    { ...diff, id: "forged", sourceTabId: "other-tab" },
    "owned-tab",
  );
  assert.equal(parsed.kind, "prDiff");
  assert.equal(parsed.attachment.sourceTabId, "owned-tab");
  assert.notEqual(parsed.attachment.id, "forged");
  assert.equal(parsed.attachment.diffText, "+added");
});
test("attachment validation rejects malformed ranges, unsafe links and unknown types", () => {
  for (const input of [
    null,
    [],
    { ...diff, kind: "send" },
    { ...diff, lineStart: -1 },
    { ...diff, lineEnd: 0 },
    { ...diff, lineEnd: Infinity },
    { ...diff, prUrl: "javascript:alert(1)" },
    { ...diff, status: "unknown" },
    { ...diff, diffText: "" },
  ])
    assert.throws(() => parseExtensionComposerAttachment(input, "tab"));
});
test("the same boundary supports non-PR snippets without filesystem access", () => {
  const file = parseExtensionComposerAttachment(
    {
      kind: "fileSnippet",
      filePath: "src/page.ts",
      lineStart: 0,
      lineEnd: 0,
      selectedText: "selected",
    },
    "tab",
  );
  const terminal = parseExtensionComposerAttachment(
    {
      kind: "terminalSnippet",
      terminalName: "Build",
      lineStart: 1,
      lineEnd: 3,
      selectedText: "output",
    },
    "tab",
  );
  assert.equal(file.kind, "fileSnippet");
  assert.equal(terminal.kind, "terminalSnippet");
});
