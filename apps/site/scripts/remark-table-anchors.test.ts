import assert from "node:assert/strict";
import test from "node:test";
import { register } from "fumadocs-mdx/node";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { remarkTableAnchors } from "../src/lib/remark-table-anchors";

register();

type Transformer = ReturnType<typeof remarkTableAnchors>;
type Root = Parameters<Transformer>[0];
type Table = Extract<Root["children"][number], { type: "table" }>;

function table(labels: string[]): Table {
  return {
    type: "table",
    children: ["Item", ...labels].map((label) => ({
      type: "tableRow",
      children: [
        {
          type: "tableCell",
          children: label ? [{ type: "text", value: label }] : [],
        },
      ],
    })),
  };
}

function transform(children: Root["children"]) {
  const tree: Root = { type: "root", children };
  const file = { data: {} } as Parameters<Transformer>[1];
  remarkTableAnchors()(tree, file);
  return { tree, file };
}

test("table rows use heading slugs without anchoring the header", () => {
  const tools = table(["web_search", "Read File", "工具"]);
  transform([tools]);

  assert.equal(tools.children[0].data?.hProperties?.id, undefined);
  assert.deepEqual(
    tools.children.slice(1).map((row) => row.data?.hProperties?.id),
    ["web_search", "read-file", "工具"],
  );
});

test("headings and tables share duplicate numbering", () => {
  const firstHeading: Root["children"][number] = {
    type: "heading",
    depth: 2,
    children: [{ type: "text", value: "Item" }],
  };
  const firstTable = table(["Item", "Item"]);
  const secondTable = table(["Item"]);
  transform([firstHeading, firstTable, secondTable]);

  assert.equal(firstHeading.data?.hProperties?.id, "item");
  assert.equal(firstTable.children[1].data?.hProperties?.id, "item-1");
  assert.equal(firstTable.children[2].data?.hProperties?.id, "item-2");
  assert.equal(secondTable.children[1].data?.hProperties?.id, "item-3");
});

test("tables cannot change existing heading anchors", () => {
  const tools = table(["Item"]);
  const heading: Root["children"][number] = {
    type: "heading",
    depth: 2,
    children: [{ type: "text", value: "Item" }],
  };
  transform([tools, heading]);

  assert.equal(heading.data?.hProperties?.id, "item");
  assert.equal(tools.children[1].data?.hProperties?.id, "item-1");
});

test("explicit row IDs use heading syntax and remove the marker", () => {
  const tools = table(["联网搜索 [#web-search]"]);
  const { file } = transform([tools]);

  assert.equal(tools.children[1].data?.hProperties?.id, "web-search");
  assert.deepEqual(tools.children[1].children[0].children, [
    { type: "text", value: "联网搜索" },
  ]);
  assert.equal(file.data.toc, undefined);
});

test("formatted first cells and nested tables generate anchors", () => {
  const tools = table(["placeholder"]);
  tools.children[1].children[0].children = [
    { type: "strong", children: [{ type: "text", value: "Read " }] },
    { type: "inlineCode", value: "file" },
  ];
  transform([{ type: "blockquote", children: [tools] }]);

  assert.equal(tools.children[1].data?.hProperties?.id, "read-file");
});

test("empty first cells are not anchor targets", () => {
  const tools = table(["", "Item"]);
  transform([tools]);

  assert.equal(tools.children[1].data?.hProperties?.id, undefined);
  assert.equal(tools.children[2].data?.hProperties?.id, "item");
});

test("the global MDX configuration compiles tool rows in every locale", async () => {
  for (const locale of ["de", "en-US", "es", "fr", "ja", "ko", "pt-BR", "ru", "zh-CN", "zh-TW"]) {
    const compiled = await import(
      new URL(`../.generated/product/docs/${locale}/agent/tools.mdx`, import.meta.url).href
    );
    const markup = renderToStaticMarkup(createElement(compiled.default));

    assert.match(markup, /<tr id="web_search">/);
    assert.doesNotMatch(markup, /id="web-search"/);
    assert.equal([...markup.matchAll(/<tr id="/g)].length, 22);
    assert.deepEqual(compiled.toc, []);
  }
});