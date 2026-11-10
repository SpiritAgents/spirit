import assert from "node:assert/strict";
import { test } from "vitest";

import {
  messageContentToRichSegments,
  parseMessageContentParts,
  segmentsToMessageText,
} from "@spiritagent/ui/composer";
import { scanWorkspaceFileWireBlocks, workspaceFileContextText } from "@spiritagent/ui/composer";

test("workspaceFileContextText serializes typed fence block", () => {
  const wire = workspaceFileContextText("src/App.tsx");
  assert.equal(wire, "```file:src/App.tsx\n\n```");
});

test("scanWorkspaceFileWireBlocks parses fence format", () => {
  const wire = workspaceFileContextText("README.md");
  const blocks = scanWorkspaceFileWireBlocks(wire);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]?.path, "README.md");
});

test("segmentsToMessageText round-trips workspace file chips", () => {
  const message = segmentsToMessageText([
    { kind: "text", value: "fix " },
    { kind: "workspaceFile", path: "src/App.tsx" },
  ]);
  assert.match(message, /^fix \n```file:src\/App\.tsx/);
  const parts = parseMessageContentParts(message);
  assert.equal(parts.length, 2);
  assert.equal(parts[1]?.kind, "workspaceFile");
  if (parts[1]?.kind !== "workspaceFile") {
    return;
  }
  assert.equal(parts[1].path, "src/App.tsx");

  const segments = messageContentToRichSegments(message, "rewind");
  assert.equal(
    segments.some((segment) => segment.kind === "workspaceFile"),
    true,
  );
});
