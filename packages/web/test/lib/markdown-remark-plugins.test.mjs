import assert from "node:assert/strict";
import { test } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { visit } from "unist-util-visit";

import {
  createSpiritRemarkPluginsForStreamdown,
  spiritRemarkPluginsForStreamdown,
} from "../../src/lib/markdown-remark-plugins.ts";

function countHardBreaks(markdown, remarkPlugins) {
  let processor = unified().use(remarkParse);
  for (const plugin of remarkPlugins) {
    if (Array.isArray(plugin)) {
      processor = processor.use(plugin[0], plugin[1]);
      continue;
    }
    processor = processor.use(plugin);
  }
  const tree = processor.runSync(processor.parse(markdown));
  let breaks = 0;
  visit(tree, "break", () => {
    breaks += 1;
  });
  return breaks;
}

test("spirit streamdown remark plugins turn single newline inside paragraph into hard break", () => {
  const markdown = "Topic\nWorking on it";
  const withSpiritPlugins = countHardBreaks(markdown, spiritRemarkPluginsForStreamdown);
  const gfmOnly = countHardBreaks(markdown, [remarkGfm]);

  assert.equal(withSpiritPlugins, 1);
  assert.equal(gfmOnly, 0);
});

test("spirit streamdown remark plugins preserve two-line plain text breaks", () => {
  const markdown = "First line text\nSecond line text";
  const breaks = countHardBreaks(markdown, spiritRemarkPluginsForStreamdown);
  assert.equal(breaks, 1);
});

test("spirit streamdown remark plugins skip hard breaks when singleLineBreaks is false", () => {
  const markdown = "Topic\nWorking on it";
  const withoutBreaks = countHardBreaks(
    markdown,
    createSpiritRemarkPluginsForStreamdown({ singleLineBreaks: false }),
  );

  assert.equal(withoutBreaks, 0);
});
