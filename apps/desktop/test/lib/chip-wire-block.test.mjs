import assert from "node:assert/strict";
import { test } from "vitest";

import {
  chooseEscalatedFence,
  formatChipWireBlock,
  formatLineRange,
  parseLineRangeSuffix,
  scanChipWireBlocks,
  splitInfoPayloadAndLineRange,
} from "@spiritagent/ui/composer";

test("formatChipWireBlock serializes info line and body", () => {
  const wire = formatChipWireBlock("file:README.md:12-15", "hello world");
  assert.equal(wire, "```file:README.md:12-15\nhello world\n```");
});

test("formatChipWireBlock allows empty body for reference-only chips", () => {
  const wire = formatChipWireBlock("file:README.md");
  assert.equal(wire, "```file:README.md\n\n```");
});

test("formatChipWireBlock escalates fence depth for nested fence lines", () => {
  const body = ["before", "```", "after"].join("\n");
  const wire = formatChipWireBlock("file:src/a.ts:1-3", body);
  assert.match(wire, /^````file:src\/a\.ts:1-3\n/);
  assert.match(wire, /\n````$/);
});

test("chooseEscalatedFence escalates when body contains fence lines", () => {
  const body = ["before", "```", "after"].join("\n");
  const fence = chooseEscalatedFence(body);
  assert.equal(fence.open, "````\n");
  assert.equal(fence.close, "\n````");
});

test("scanChipWireBlocks parses reference-only block", () => {
  const wire = formatChipWireBlock("skill:/git-commit");
  const blocks = scanChipWireBlocks(wire);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]?.infoLine, "skill:/git-commit");
  assert.equal(blocks[0]?.body, "");
});

test("scanChipWireBlocks parses body with nested fence lines", () => {
  const body = ["before", "```", "after"].join("\n");
  const wire = formatChipWireBlock("file:src/a.ts:1-3", body);
  const blocks = scanChipWireBlocks(wire);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]?.body, body);
});

test("formatLineRange omits unknown lines and collapses single line", () => {
  assert.equal(formatLineRange(0, 0), "");
  assert.equal(formatLineRange(42, 42), ":42");
  assert.equal(formatLineRange(12, 15), ":12-15");
});

test("parseLineRangeSuffix parses range suffixes", () => {
  assert.deepEqual(parseLineRangeSuffix(":42"), { lineStart: 42, lineEnd: 42 });
  assert.deepEqual(parseLineRangeSuffix(":12-15"), { lineStart: 12, lineEnd: 15 });
  assert.deepEqual(parseLineRangeSuffix(""), { lineStart: 0, lineEnd: 0 });
});

test("splitInfoPayloadAndLineRange parses from the right", () => {
  assert.deepEqual(splitInfoPayloadAndLineRange("apps/foo.ts"), {
    payload: "apps/foo.ts",
    lineStart: 0,
    lineEnd: 0,
  });
  assert.deepEqual(splitInfoPayloadAndLineRange("apps/foo.ts:12-15"), {
    payload: "apps/foo.ts",
    lineStart: 12,
    lineEnd: 15,
  });
  assert.deepEqual(splitInfoPayloadAndLineRange("zsh:1-5"), {
    payload: "zsh",
    lineStart: 1,
    lineEnd: 5,
  });
});
