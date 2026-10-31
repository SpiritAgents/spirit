import assert from "node:assert/strict";
import { test } from "vitest";

import {
  messageContentToRichSegments,
  parseMessageContentParts,
  segmentsToMessageText,
} from "../../src/lib/composer-segment-model.ts";
import {
  deriveGitCommitSubject,
  gitCommitContextText,
  scanGitCommitWireBlocks,
} from "../../src/lib/git-commit-wire-text.ts";

const sampleAttachment = {
  id: "git-1",
  oid: "abc123def456",
  subject: "feat: add chip",
  author: "Alice",
  authoredAt: "2024-01-02 10:00:00 +0000",
  fullMessage: "feat: add chip\n\nBody paragraph.",
};

test("gitCommitContextText serializes oid, author, authoredAt, and full message body", () => {
  const wire = gitCommitContextText(sampleAttachment);

  assert.match(wire, /^```git:abc123def456\tAlice\t2024-01-02 10:00:00 \+0000\nfeat: add chip/);
  assert.match(wire, /Body paragraph\.\n```$/);
});

test("deriveGitCommitSubject reads first line from full message", () => {
  assert.equal(
    deriveGitCommitSubject("fix(desktop): example\n\n- bullet"),
    "fix(desktop): example",
  );
});

test("scanGitCommitWireBlocks parses subject containing parentheses", () => {
  const wire = gitCommitContextText({
    id: "git-2",
    oid: "f4d96fad0282ed8a134ac5af73e425cef17baede",
    subject:
      "fix(desktop): tool-execution-finished inherits preview suppressExpand and argsExcerpt",
    author: "Yu",
    authoredAt: "2026-07-01 05:47:43 +0800",
    fullMessage:
      "fix(desktop): tool-execution-finished inherits preview suppressExpand and argsExcerpt\n\n- bullet one\n- bullet two",
  });

  const blocks = scanGitCommitWireBlocks(`${wire}\n hello`);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]?.oid, "f4d96fad0282ed8a134ac5af73e425cef17baede");
  assert.equal(blocks[0]?.author, "Yu");
  assert.equal(blocks[0]?.authoredAt, "2026-07-01 05:47:43 +0800");
  assert.equal(
    deriveGitCommitSubject(blocks[0]?.fullMessage ?? ""),
    "fix(desktop): tool-execution-finished inherits preview suppressExpand and argsExcerpt",
  );
});

test("scanGitCommitWireBlocks and message round-trip", () => {
  const wire = gitCommitContextText({
    id: "git-3",
    oid: "deadbeef",
    subject: "fix: bug",
    author: "Bob",
    authoredAt: "2025-06-01 12:00:00 +0000",
    fullMessage: "fix: bug\n\nDetails here.",
  });

  const blocks = scanGitCommitWireBlocks(wire);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]?.oid, "deadbeef");
  assert.equal(blocks[0]?.author, "Bob");
  assert.equal(blocks[0]?.authoredAt, "2025-06-01 12:00:00 +0000");
  assert.equal(blocks[0]?.fullMessage, "fix: bug\n\nDetails here.");
});

test("segmentsToMessageText round-trips git commit author and authoredAt", () => {
  const message = segmentsToMessageText([{ kind: "gitCommit", attachment: sampleAttachment }]);
  const parts = parseMessageContentParts(message);
  assert.equal(parts.length, 1);
  assert.equal(parts[0]?.kind, "gitCommit");
  if (parts[0]?.kind !== "gitCommit") {
    return;
  }
  assert.equal(parts[0].author, "Alice");
  assert.equal(parts[0].authoredAt, "2024-01-02 10:00:00 +0000");

  const segments = messageContentToRichSegments(message, "rewind");
  assert.equal(segments.length, 1);
  assert.equal(segments[0]?.kind, "gitCommit");
  if (segments[0]?.kind !== "gitCommit") {
    return;
  }
  assert.equal(segments[0].attachment.author, "Alice");
  assert.equal(segments[0].attachment.authoredAt, "2024-01-02 10:00:00 +0000");
});
