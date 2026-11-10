import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const stylesCss = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../src/styles.css"),
  "utf8",
);

const nativeBlock = stylesCss.match(/^html\s*\{([\s\S]*?)\}/m)?.[1];
const allowBlock = stylesCss.match(/^html\s+:is\(([\s\S]*?)\)\s*\{([\s\S]*?)\}/m);

test("workbench chrome defaults to user-select: none on every host", () => {
  assert.ok(nativeBlock, "expected the shared html rule");
  assert.match(nativeBlock, /user-select:\s*none/);
});

test("content canvases restore user-select: text on every host", () => {
  assert.ok(allowBlock, "expected the shared html :is(...) allowlist");
  const [selectors, declarations] = allowBlock.slice(1);
  assert.match(declarations, /user-select:\s*text/);
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
