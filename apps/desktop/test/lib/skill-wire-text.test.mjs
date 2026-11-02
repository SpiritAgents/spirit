import assert from "node:assert/strict";
import { test } from "vitest";

import {
  messageContentToRichSegments,
  parseMessageContentParts,
  segmentsToMessageText,
} from "@spiritagent/ui/composer";
import { scanSkillWireBlocks, skillContextText } from "@spiritagent/ui/composer";

test("skillContextText serializes typed fence block", () => {
  const wire = skillContextText("/git-commit");
  assert.equal(wire, "```skill:/git-commit\n\n```");
});

test("scanSkillWireBlocks parses fence format", () => {
  const wire = skillContextText("/git-push");
  const blocks = scanSkillWireBlocks(wire);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]?.alias, "/git-push");
});

test("segmentsToMessageText round-trips skill chips", () => {
  const message = segmentsToMessageText([
    { kind: "skill", alias: "/git-commit" },
    { kind: "text", value: " fix typo" },
  ]);
  assert.match(message, /^```skill:\/git-commit/);
  assert.match(message, /fix typo$/);
  const parts = parseMessageContentParts(message);
  assert.equal(parts.length, 2);
  assert.equal(parts[0]?.kind, "skill");
  if (parts[0]?.kind !== "skill") {
    return;
  }
  assert.equal(parts[0].alias, "/git-commit");

  const segments = messageContentToRichSegments(message, "rewind");
  assert.equal(
    segments.some((segment) => segment.kind === "skill"),
    true,
  );
});
