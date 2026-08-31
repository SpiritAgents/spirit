import assert from "node:assert/strict";
import { test } from "vitest";

import { markdownToPlainText } from "../../src/lib/markdown-plain-text.ts";

test("heading followed by paragraph text joins with a single space", () => {
  assert.equal(markdownToPlainText("## 你好\n你好"), "你好 你好");
});

test("trailing blank lines after a heading produce no extra text", () => {
  assert.equal(markdownToPlainText("## 你好\n\n"), "你好");
});

test("emphasis, inline code, and links keep only their text", () => {
  assert.equal(
    markdownToPlainText("**加粗** 与 `代码`，见 [文档](https://example.com)。"),
    "加粗 与 代码，见 文档。",
  );
});

test("list items and soft line breaks collapse to spaces", () => {
  assert.equal(markdownToPlainText("- 甲\n- 乙\n\n第一行\n第二行"), "甲 乙 第一行 第二行");
});

test("code block content is kept without fences", () => {
  assert.equal(markdownToPlainText("```sh\npnpm install\n```"), "pnpm install");
});

test("raw html tags are dropped but their text content is kept", () => {
  assert.equal(markdownToPlainText("前文 <b>粗</b> 后文"), "前文 粗 后文");
});

test("empty and whitespace-only input reads as empty", () => {
  assert.equal(markdownToPlainText(""), "");
  assert.equal(markdownToPlainText("  \n\n"), "");
});
