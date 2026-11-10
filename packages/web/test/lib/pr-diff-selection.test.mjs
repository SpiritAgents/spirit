import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { test } from "vitest";
import { fileURLToPath } from "node:url";

const require = createRequire(fileURLToPath(import.meta.url));
const { JSDOM } = require("../../../../node_modules/jsdom");

const { resolveDiffSelectionLineRange } = await import("../../src/lib/pr-diff-selection.ts");

function buildUnifiedDiffDom(lineNumbers) {
  const dom = new JSDOM(`<!doctype html><body><div id="root"></div></body>`);
  const { document } = dom.window;
  const root = document.getElementById("root");
  const diffRoot = document.createElement("div");
  diffRoot.className = "tool-call-diff unified-diff-root";
  root.appendChild(diffRoot);

  for (const lineNumber of lineNumbers) {
    const row = document.createElement("div");
    row.className = "unified-diff-line unified-diff-line-normal";
    const gutter = document.createElement("span");
    gutter.className = "unified-diff-gutter";
    gutter.textContent = String(lineNumber);
    const code = document.createElement("code");
    code.className = "unified-diff-code";
    code.textContent = `line ${lineNumber}`;
    row.append(gutter, code);
    diffRoot.appendChild(row);
  }

  return { dom, diffRoot, document };
}

test("resolveDiffSelectionLineRange reads unified-diff gutter line numbers", () => {
  const { dom, diffRoot, document } = buildUnifiedDiffDom([10, 11, 12]);
  const code = diffRoot.querySelector(".unified-diff-code");
  assert.ok(code);

  const range = document.createRange();
  range.setStart(code.firstChild, 0);
  range.setEnd(code.firstChild, 4);

  const selection = dom.window.getSelection();
  assert.ok(selection);
  selection.removeAllRanges();
  selection.addRange(range);

  assert.deepEqual(resolveDiffSelectionLineRange(diffRoot, selection), {
    lineStart: 10,
    lineEnd: 10,
  });
});

test("resolveDiffSelectionLineRange spans multiple unified-diff rows", () => {
  const { dom, diffRoot, document } = buildUnifiedDiffDom([10, 11, 12]);
  const firstCode = diffRoot.querySelector(".unified-diff-line .unified-diff-code");
  const lastRow = diffRoot.querySelectorAll(".unified-diff-line")[2];
  const lastCode = lastRow?.querySelector(".unified-diff-code");
  assert.ok(firstCode && lastCode);

  const range = document.createRange();
  range.setStart(firstCode.firstChild, 0);
  range.setEnd(lastCode.firstChild, 4);

  const selection = dom.window.getSelection();
  assert.ok(selection);
  selection.removeAllRanges();
  selection.addRange(range);

  assert.deepEqual(resolveDiffSelectionLineRange(diffRoot, selection), {
    lineStart: 10,
    lineEnd: 12,
  });
});
