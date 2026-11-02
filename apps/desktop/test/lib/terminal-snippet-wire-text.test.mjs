import assert from "node:assert/strict";
import { test } from "vitest";

import {
  messageContentToRichSegments,
  parseMessageContentParts,
  segmentsToMessageText,
} from "@spiritagent/ui/composer";
import {
  parseTerminalSnippetLinePart,
  scanTerminalSnippetWireBlocks,
  terminalSnippetContextText,
} from "@spiritagent/ui/composer";

test("terminalSnippetContextText serializes terminal name, line range, and selected text", () => {
  const wire = terminalSnippetContextText({
    terminalName: "Terminal",
    lineStart: 10,
    lineEnd: 15,
    selectedText: "error: build failed\nexit code 1",
  });

  assert.match(wire, /```terminal:Terminal:10-15\n/);
  assert.match(wire, /error: build failed/);
  assert.match(wire, /\n```$/);
});

test("parseTerminalSnippetLinePart parses line range suffix", () => {
  const parsed = parseTerminalSnippetLinePart("L3-7");
  assert.deepEqual(parsed, {
    lineStart: 3,
    lineEnd: 7,
  });
});

test("wire round-trips terminal names containing parentheses", () => {
  const attachment = {
    id: "term-paren",
    terminalName: "bash (main)",
    lineStart: 5,
    lineEnd: 8,
    selectedText: "output line",
  };
  const message = segmentsToMessageText([{ kind: "terminalSnippet", attachment }]);
  const parts = parseMessageContentParts(message);
  assert.equal(parts.length, 1);
  assert.equal(parts[0]?.kind, "terminalSnippet");
  if (parts[0]?.kind !== "terminalSnippet") {
    return;
  }
  assert.equal(parts[0].terminalName, "bash (main)");
  assert.equal(parts[0].lineStart, 5);
  assert.equal(parts[0].lineEnd, 8);
});

test("wire round-trips terminal names containing tab characters", () => {
  const attachment = {
    id: "term-tab",
    terminalName: "shell\t1",
    lineStart: 2,
    lineEnd: 4,
    selectedText: "tab name line",
  };
  const message = segmentsToMessageText([{ kind: "terminalSnippet", attachment }]);
  const parts = parseMessageContentParts(message);
  assert.equal(parts.length, 1);
  assert.equal(parts[0]?.kind, "terminalSnippet");
  if (parts[0]?.kind !== "terminalSnippet") {
    return;
  }
  assert.equal(parts[0].terminalName, "shell\t1");
  assert.equal(parts[0].lineStart, 2);
  assert.equal(parts[0].lineEnd, 4);
});

test("segmentsToMessageText and parseMessageContentParts round-trip terminal chips", () => {
  const attachment = {
    id: "term-1",
    terminalName: "Terminal",
    lineStart: 42,
    lineEnd: 44,
    selectedText: "line one\nline two",
  };
  const message = segmentsToMessageText([{ kind: "terminalSnippet", attachment }]);
  const parts = parseMessageContentParts(message);
  assert.equal(parts.length, 1);
  assert.equal(parts[0]?.kind, "terminalSnippet");
  if (parts[0]?.kind !== "terminalSnippet") {
    return;
  }
  assert.equal(parts[0].terminalName, "Terminal");
  assert.equal(parts[0].lineStart, 42);
  assert.equal(parts[0].lineEnd, 44);
  assert.equal(parts[0].selectedText, "line one\nline two");

  const segments = messageContentToRichSegments(message, "rewind");
  assert.equal(segments.length, 1);
  assert.equal(segments[0]?.kind, "terminalSnippet");
});

test("scanTerminalSnippetWireBlocks parses body containing standalone fence lines", () => {
  const body = ["before", "```", "after"].join("\n");
  const wire = terminalSnippetContextText({
    terminalName: "Terminal 2",
    lineStart: 1,
    lineEnd: 3,
    selectedText: body,
  });
  const blocks = scanTerminalSnippetWireBlocks(wire);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]?.selectedText, body);
});
