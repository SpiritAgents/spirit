import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const stylesCss = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../src/styles.css"),
  "utf8",
);
const nativeCss = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../../ui/src/native-interactions.css"),
  "utf8",
);

const nativeBlock = nativeCss.match(/^html\s*\{([\s\S]*?)\}/m)?.[1];
const allowBlocks = [
  ...`${nativeCss}\n${stylesCss}`.matchAll(/^html\s+:is\(([\s\S]*?)\)\s*\{([\s\S]*?)\}/gm),
];

test("workbench chrome defaults to user-select: none on every host", () => {
  assert.ok(nativeBlock, "expected the shared html rule");
  assert.match(stylesCss, /@import "@spiritagent\/ui\/native-interactions\.css"/);
  assert.match(nativeBlock, /user-select:\s*none/);
});

test("content canvases restore user-select: text on every host", () => {
  const textBlocks = allowBlocks.filter((block) => /user-select:\s*text/.test(block[2]));
  assert.ok(textBlocks.length > 0, "expected explicit selectable content rules");
  const selectors = textBlocks.map((block) => block[1]).join("\n");
  for (const required of [
    "input",
    "textarea",
    '[contenteditable="true"]',
    '[data-spirit-selectable="text"]',
    '[data-spirit-surface="message-bubble"]',
    "[data-spirit-markdown-root]",
    ".monaco-editor",
    ".workspace-terminal-xterm",
    ".unified-diff-code",
  ]) {
    assert.match(selectors, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(
    selectors,
    /\[data-spirit-surface="composer-surface"\]/,
    "composer-surface chrome must inherit user-select: none; input is contenteditable",
  );
});
