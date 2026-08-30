import assert from "node:assert/strict";
import { test } from "vitest";
import { harden } from "rehype-harden";

import {
  isMarkdownLocalPathUrl,
  prefixBareRelativeMarkdownUrl,
} from "../../src/lib/markdown-local-url.ts";
import {
  preserveLocalMarkdownUrlsBeforeHarden,
  restoreLocalMarkdownUrlsAfterHarden,
} from "../../src/lib/markdown-harden-local-urls.ts";

test("isMarkdownLocalPathUrl accepts bare relatives and filesystem paths", () => {
  assert.equal(isMarkdownLocalPathUrl("docs/README_zh-CN.md"), true);
  assert.equal(isMarkdownLocalPathUrl("packages/agent-core"), true);
  assert.equal(isMarkdownLocalPathUrl("../packages/agent-core"), true);
  assert.equal(isMarkdownLocalPathUrl("./foo.md"), true);
  assert.equal(isMarkdownLocalPathUrl("/Users/demo/a.md"), true);
  assert.equal(isMarkdownLocalPathUrl("#desktop"), false);
  assert.equal(isMarkdownLocalPathUrl("https://example.com/a.md"), false);
  assert.equal(isMarkdownLocalPathUrl("javascript:alert(1)"), false);
});

test("prefixBareRelativeMarkdownUrl only prefixes paths harden cannot parse", () => {
  assert.equal(prefixBareRelativeMarkdownUrl("docs/README.md"), "./docs/README.md");
  assert.equal(prefixBareRelativeMarkdownUrl("./docs/README.md"), "./docs/README.md");
  assert.equal(prefixBareRelativeMarkdownUrl("../packages/agent-core"), "../packages/agent-core");
  assert.equal(prefixBareRelativeMarkdownUrl("/docs/README.md"), "/docs/README.md");
});

function runHardenWithLocalUrlPreserve(tree) {
  preserveLocalMarkdownUrlsBeforeHarden()(tree);
  harden({
    allowedImagePrefixes: ["*"],
    allowedLinkPrefixes: ["*"],
    allowedProtocols: ["*"],
    allowDataImages: true,
  })(tree);
  restoreLocalMarkdownUrlsAfterHarden()(tree);
  return tree;
}

test("harden preserve keeps bare relative href instead of [blocked]", () => {
  const tree = {
    type: "root",
    children: [
      {
        type: "element",
        tagName: "a",
        properties: { href: "docs/README_zh-CN.md" },
        children: [{ type: "text", value: "简体中文" }],
      },
    ],
  };

  runHardenWithLocalUrlPreserve(tree);
  const link = tree.children[0];
  assert.equal(link.tagName, "a");
  assert.equal(link.properties.href, "docs/README_zh-CN.md");
});

test("harden preserve keeps ../ and packages/agent-core hrefs", () => {
  const tree = {
    type: "root",
    children: [
      {
        type: "element",
        tagName: "p",
        properties: {},
        children: [
          {
            type: "element",
            tagName: "a",
            properties: { href: "packages/agent-core" },
            children: [{ type: "text", value: "packages/agent-core" }],
          },
          {
            type: "element",
            tagName: "a",
            properties: { href: "../packages/agent-core" },
            children: [{ type: "text", value: "core" }],
          },
        ],
      },
    ],
  };

  runHardenWithLocalUrlPreserve(tree);
  const [bare, parent] = tree.children[0].children;
  assert.equal(bare.properties.href, "packages/agent-core");
  assert.equal(parent.properties.href, "../packages/agent-core");
});

test("harden preserve keeps relative image src", () => {
  const tree = {
    type: "root",
    children: [
      {
        type: "element",
        tagName: "img",
        properties: { src: "docs/desktop.png", alt: "Spirit Desktop" },
        children: [],
      },
    ],
  };

  runHardenWithLocalUrlPreserve(tree);
  const img = tree.children[0];
  assert.equal(img.tagName, "img");
  assert.equal(img.properties.src, "docs/desktop.png");
});

test("harden still blocks javascript hrefs", () => {
  const tree = {
    type: "root",
    children: [
      {
        type: "element",
        tagName: "a",
        properties: { href: "javascript:alert(1)" },
        children: [{ type: "text", value: "x" }],
      },
    ],
  };

  runHardenWithLocalUrlPreserve(tree);
  const node = tree.children[0];
  assert.equal(node.tagName, "span");
  const last = node.children[node.children.length - 1];
  assert.equal(last.type, "text");
  assert.match(last.value, /blocked/i);
});
