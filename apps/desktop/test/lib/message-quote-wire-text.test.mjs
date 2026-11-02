import assert from "node:assert/strict";
import { test } from "vitest";

import {
  messageContentToRichSegments,
  parseMessageContentParts,
  segmentsToMessageText,
} from "@spiritagent/ui/composer";
import { messageQuoteContextText, scanMessageQuoteWireBlocks } from "@spiritagent/ui/composer";

test("messageQuoteContextText serializes quote info line and selected text", () => {
  const wire = messageQuoteContextText({ selectedText: "hello\nworld" });

  assert.match(wire, /```quote\n/);
  assert.match(wire, /hello\nworld/);
  assert.match(wire, /\n```$/);
});

test("segmentsToMessageText and parseMessageContentParts round-trip message quote chips", () => {
  const attachment = {
    id: "quote-1",
    selectedText: "line one\nline two",
  };
  const message = segmentsToMessageText([{ kind: "messageQuote", attachment }]);
  const parts = parseMessageContentParts(message);
  assert.equal(parts.length, 1);
  assert.equal(parts[0]?.kind, "messageQuote");
  if (parts[0]?.kind !== "messageQuote") {
    return;
  }
  assert.equal(parts[0].selectedText, "line one\nline two");

  const segments = messageContentToRichSegments(message, "rewind");
  assert.equal(segments.length, 1);
  assert.equal(segments[0]?.kind, "messageQuote");
});

test("scanMessageQuoteWireBlocks parses body containing standalone fence lines", () => {
  const body = ["before", "```", "after"].join("\n");
  const wire = messageQuoteContextText({ selectedText: body });
  const blocks = scanMessageQuoteWireBlocks(wire);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]?.selectedText, body);
});

test("scanMessageQuoteWireBlocks ignores empty body and non-quote info lines", () => {
  assert.equal(scanMessageQuoteWireBlocks("```quote\n\n```").length, 0);
  assert.equal(scanMessageQuoteWireBlocks("```quote:session\nbody\n```").length, 0);
  assert.equal(scanMessageQuoteWireBlocks("```file:src/a.ts:1-2\nbody\n```").length, 0);
});
