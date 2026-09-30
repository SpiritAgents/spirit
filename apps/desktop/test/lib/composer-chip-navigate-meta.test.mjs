import assert from "node:assert/strict";
import { test } from "vitest";

import {
  alignChipNavigateMetaToParts,
  applyChipNavigateMeta,
  extractChipNavigateMeta,
  parseChipNavigateMeta,
  remapChipNavigateMetaQuoteSessionPath,
} from "../../src/lib/composer-chip-navigate-meta.ts";
import {
  messageContentToRichSegments,
  parseMessageContentParts,
  segmentsToMessageText,
} from "../../src/lib/composer-segment-model.ts";

const fileSnippet = {
  id: "file-1",
  filePath: "src/a.ts",
  lineStart: 2,
  lineEnd: 4,
  selectedText: "const a = 1;",
  sourceTabId: "tab-files-1",
};

const quote = {
  id: "quote-1",
  selectedText: "hello",
  sessionPath: "/tmp/chats/chat-1.json",
  messageId: 7,
  origin: "side-chat",
};

test("extractChipNavigateMeta follows document order of navigable chips", () => {
  const meta = extractChipNavigateMeta([
    { kind: "text", value: "see " },
    { kind: "workspaceFile", path: "src/a.ts", sourceTabId: "tab-a" },
    { kind: "plan" },
    { kind: "skill", alias: "/foo" },
    { kind: "fileSnippet", attachment: fileSnippet },
    { kind: "messageQuote", attachment: quote },
  ]);
  assert.deepEqual(meta, [
    { kind: "workspaceFile", sourceTabId: "tab-a" },
    { kind: "skill" },
    { kind: "fileSnippet", sourceTabId: "tab-files-1" },
    {
      kind: "messageQuote",
      quoteSessionPath: "/tmp/chats/chat-1.json",
      quoteMessageId: 7,
      quoteOrigin: "side-chat",
    },
  ]);
});

test("segmentsToMessageText strips host-only navigate fields from wire", () => {
  const wire = segmentsToMessageText([
    { kind: "text", value: "see " },
    { kind: "workspaceFile", path: "src/a.ts", sourceTabId: "tab-a" },
    { kind: "fileSnippet", attachment: fileSnippet },
    { kind: "messageQuote", attachment: quote },
  ]);
  assert.equal(wire.includes("tab-a"), false);
  assert.equal(wire.includes("tab-files-1"), false);
  assert.equal(wire.includes("chat-1.json"), false);
  assert.equal(wire.includes("side-chat"), false);
});

test("wire round-trip aligns meta by document order including duplicate kinds", () => {
  const segments = [
    { kind: "text", value: "a " },
    { kind: "workspaceFile", path: "one.ts", sourceTabId: "tab-1" },
    { kind: "text", value: " b " },
    { kind: "workspaceFile", path: "two.ts", sourceTabId: "tab-2" },
    { kind: "skill", alias: "/demo" },
  ];
  const meta = extractChipNavigateMeta(segments);
  const wire = segmentsToMessageText(segments);
  const parts = parseMessageContentParts(wire);
  const aligned = alignChipNavigateMetaToParts(parts, meta);
  assert.deepEqual(aligned, meta);
  const restored = applyChipNavigateMeta(messageContentToRichSegments(wire, "m"), aligned);
  const restoredMeta = extractChipNavigateMeta(restored);
  assert.deepEqual(restoredMeta, meta);
});

test("length or kind mismatch discards the entire meta array", () => {
  const parts = parseMessageContentParts(
    segmentsToMessageText([{ kind: "workspaceFile", path: "one.ts" }]),
  );
  assert.equal(
    alignChipNavigateMetaToParts(parts, [
      { kind: "workspaceFile", sourceTabId: "a" },
      { kind: "skill" },
    ]),
    undefined,
  );
  assert.equal(alignChipNavigateMetaToParts(parts, [{ kind: "skill" }]), undefined);
});

test("applyChipNavigateMeta is a no-op when kinds do not align", () => {
  const segments = [{ kind: "workspaceFile", path: "one.ts" }];
  const next = applyChipNavigateMeta(segments, [{ kind: "skill" }]);
  assert.equal(next, segments);
  assert.equal(next[0]?.kind === "workspaceFile" && next[0].sourceTabId, undefined);
});

test("parseChipNavigateMeta rejects unknown kinds", () => {
  assert.equal(parseChipNavigateMeta([{ kind: "loop" }]), undefined);
  assert.deepEqual(parseChipNavigateMeta([{ kind: "workspaceFile", sourceTabId: " tab " }]), [
    { kind: "workspaceFile", sourceTabId: "tab" },
  ]);
});

test("workspaceFile isPlan rides the meta round-trip and stays out of the wire", () => {
  const segments = [
    { kind: "text", value: "see " },
    { kind: "workspaceFile", path: "plans/test.md", isPlan: true },
    { kind: "workspaceFile", path: "src/a.ts" },
  ];
  const meta = extractChipNavigateMeta(segments);
  assert.deepEqual(meta, [{ kind: "workspaceFile", isPlan: true }, { kind: "workspaceFile" }]);

  const wire = segmentsToMessageText(segments);
  assert.equal(wire.includes("isPlan"), false);
  // The plan chip's wire block is identical to a plain file reference block.
  assert.equal(wire.includes("```file:plans/test.md\n\n```"), true);

  const restored = applyChipNavigateMeta(messageContentToRichSegments(wire, "m"), meta);
  const planSegment = restored.find(
    (segment) => segment.kind === "workspaceFile" && segment.path === "plans/test.md",
  );
  assert.equal(planSegment?.kind === "workspaceFile" && planSegment.isPlan, true);
  const fileSegment = restored.find(
    (segment) => segment.kind === "workspaceFile" && segment.path === "src/a.ts",
  );
  assert.equal(fileSegment?.kind === "workspaceFile" && "isPlan" in fileSegment, false);
  assert.deepEqual(extractChipNavigateMeta(restored), meta);
});

test("parseChipNavigateMeta keeps isPlan only as true on workspaceFile entries", () => {
  assert.deepEqual(parseChipNavigateMeta([{ kind: "workspaceFile", isPlan: true }]), [
    { kind: "workspaceFile", isPlan: true },
  ]);
  assert.deepEqual(parseChipNavigateMeta([{ kind: "skill", isPlan: true }]), [{ kind: "skill" }]);
  assert.deepEqual(parseChipNavigateMeta([{ kind: "workspaceFile", isPlan: "yes" }]), [
    { kind: "workspaceFile" },
  ]);
});

test("remapChipNavigateMetaQuoteSessionPath rewrites matching quote paths only", () => {
  const meta = [
    { kind: "workspaceFile", sourceTabId: "tab-1" },
    {
      kind: "messageQuote",
      quoteSessionPath: "/tmp/chats/old.json",
      quoteMessageId: 7,
      quoteOrigin: "session",
    },
    {
      kind: "messageQuote",
      quoteSessionPath: "/tmp/chats/other.json",
      quoteMessageId: 8,
      quoteOrigin: "side-chat",
    },
  ];
  const remapped = remapChipNavigateMetaQuoteSessionPath(
    meta,
    "/tmp/chats/old.json",
    "/tmp/chats/new.json",
  );
  assert.deepEqual(remapped, [
    { kind: "workspaceFile", sourceTabId: "tab-1" },
    {
      kind: "messageQuote",
      quoteSessionPath: "/tmp/chats/new.json",
      quoteMessageId: 7,
      quoteOrigin: "session",
    },
    {
      kind: "messageQuote",
      quoteSessionPath: "/tmp/chats/other.json",
      quoteMessageId: 8,
      quoteOrigin: "side-chat",
    },
  ]);
});
