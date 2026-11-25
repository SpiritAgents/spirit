import assert from "node:assert/strict";
import { test } from "vitest";
import remarkParse from "remark-parse";
import { unified } from "unified";

import { createSpiritRemarkPluginsForStreamdown } from "@/lib/markdown-remark-plugins";

function parse(input) {
  const processor = unified()
    .use(remarkParse)
    .use(createSpiritRemarkPluginsForStreamdown({ singleLineBreaks: false }));
  return processor.runSync(processor.parse(input));
}

function inlineNodes(input) {
  return parse(input).children[0].children.map((node) => ({
    type: node.type,
    ...(node.type === "link" ? { url: node.url, label: node.children[0].value } : {}),
    ...(node.type === "text" ? { value: node.value } : {}),
  }));
}

const delimiters = [
  ..."，。；：、・！？…“”‘’＂＇",
  ..."（）【】《》〈〉「」『』〔〕〖〗〘〙〚〛［］｛｝",
];

test("CJK punctuation terminates bare URLs without consuming following prose", () => {
  for (const delimiter of delimiters) {
    assert.deepEqual(inlineNodes(`见 https://spirit.dev${delimiter}继续`), [
      { type: "text", value: "见 " },
      { type: "link", url: "https://spirit.dev", label: "https://spirit.dev" },
      { type: "text", value: `${delimiter}继续` },
    ]);
  }
});

test("URLs separated by CJK punctuation are linked independently", () => {
  assert.deepEqual(inlineNodes("见 https://spirit.dev、https://example.com/docs。后续"), [
    { type: "text", value: "见 " },
    { type: "link", url: "https://spirit.dev", label: "https://spirit.dev" },
    { type: "text", value: "、" },
    {
      type: "link",
      url: "https://example.com/docs",
      label: "https://example.com/docs",
    },
    { type: "text", value: "。后续" },
  ]);

  assert.deepEqual(inlineNodes("www.spirit.dev，www.example.com。"), [
    { type: "link", url: "http://www.spirit.dev", label: "www.spirit.dev" },
    { type: "text", value: "，" },
    { type: "link", url: "http://www.example.com", label: "www.example.com" },
    { type: "text", value: "。" },
  ]);
});

test("ASCII punctuation and URL query behavior remain unchanged", () => {
  assert.deepEqual(inlineNodes("See https://spirit.dev, next"), [
    { type: "text", value: "See " },
    { type: "link", url: "https://spirit.dev", label: "https://spirit.dev" },
    { type: "text", value: ", next" },
  ]);
  assert.deepEqual(inlineNodes("https://spirit.dev/search?q=a,b&page=1#result"), [
    {
      type: "link",
      url: "https://spirit.dev/search?q=a,b&page=1#result",
      label: "https://spirit.dev/search?q=a,b&page=1#result",
    },
  ]);
});

test("explicit Markdown links and angle autolinks are not rewritten", () => {
  for (const input of ["[label](https://spirit.dev，)", "<https://spirit.dev，>"]) {
    const link = parse(input).children[0].children[0];
    assert.equal(link.type, "link");
    assert.equal(link.url, "https://spirit.dev，");
  }
});
