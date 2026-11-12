import assert from "node:assert/strict";
import { test } from "vitest";

import { parseMarkdownIntoBlocks } from "streamdown";

import { parseStreamBlocksIncrementally } from "../../src/components/agent-markdown-message.tsx";

/** Feed chunks in streaming append order; assert incremental results match a full parse */
function assertIncrementalMatchesFull(chunks) {
  let cache = null;
  let content = "";
  for (const chunk of chunks) {
    content += chunk;
    cache = parseStreamBlocksIncrementally(cache, content);
    assert.equal(cache.content, content);
    assert.deepEqual(cache.blocks, parseMarkdownIntoBlocks(content));
  }
  return cache;
}

test("incremental parse matches full parse across paragraph appends", () => {
  assertIncrementalMatchesFull([
    "Hello ",
    "world.",
    "\n\nSecond paragraph",
    " continues here.",
    "\n\nThird.",
  ]);
});

test("incremental parse matches full parse across fenced code blocks", () => {
  assertIncrementalMatchesFull([
    "Intro text.\n\n",
    "```ts\nconst a",
    " = 1;\n",
    "```\n\nAfter the fence.",
  ]);
});

test("incremental parse matches full parse across lists and headings", () => {
  assertIncrementalMatchesFull([
    "# Title\n\n",
    "- one\n",
    "- two\n",
    "\nTail paragraph",
    "\n\n## Sub\n\nMore text.",
  ]);
});

test("incremental parse matches full parse with block math ($$)", () => {
  assertIncrementalMatchesFull(["Before.\n\n$$\nx", " + y\n$$", "\n\nAfter math."]);
});

test("footnote syntax falls back to full parse (single block)", () => {
  const cache = assertIncrementalMatchesFull([
    "Alpha.\n\nBeta.",
    "\n\nSee note[^1].\n\n[^1]: the note",
  ]);
  // streamdown returns a single block for documents containing footnotes
  assert.equal(cache.blocks.length, 1);
});

test("identical content reuses the cache object", () => {
  const first = parseStreamBlocksIncrementally(null, "A.\n\nB.");
  const second = parseStreamBlocksIncrementally(first, "A.\n\nB.");
  assert.equal(second, first);
});

test("non-append rewrites fall back to full parse", () => {
  const first = parseStreamBlocksIncrementally(null, "A.\n\nB.\n\nC.");
  const rewritten = parseStreamBlocksIncrementally(first, "Z.");
  assert.deepEqual(rewritten.blocks, parseMarkdownIntoBlocks("Z."));
});
