import assert from "node:assert/strict";
import { test } from "vitest";

import { parseMcpToolApprovalAnnotations } from "./approval-annotations.js";

test("parseMcpToolApprovalAnnotations returns undefined for non-objects", () => {
  assert.equal(parseMcpToolApprovalAnnotations(undefined), undefined);
  assert.equal(parseMcpToolApprovalAnnotations(null), undefined);
  assert.equal(parseMcpToolApprovalAnnotations("readonly"), undefined);
  assert.equal(parseMcpToolApprovalAnnotations([]), undefined);
});

test("parseMcpToolApprovalAnnotations ignores non-boolean hints", () => {
  assert.equal(
    parseMcpToolApprovalAnnotations({
      readOnlyHint: "true",
      openWorldHint: 0,
      destructiveHint: true,
    }),
    undefined,
  );
});

test("parseMcpToolApprovalAnnotations keeps only boolean readOnlyHint and openWorldHint", () => {
  assert.deepEqual(
    parseMcpToolApprovalAnnotations({
      title: "Search",
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: true,
    }),
    { readOnlyHint: true, openWorldHint: false },
  );
  assert.deepEqual(parseMcpToolApprovalAnnotations({ readOnlyHint: true }), {
    readOnlyHint: true,
  });
  assert.deepEqual(parseMcpToolApprovalAnnotations({ openWorldHint: false }), {
    openWorldHint: false,
  });
});
