import assert from "node:assert/strict";
import { test } from "vitest";

import { parseGitCommitMessageOutput, subjectFromGitFullMessage } from "./git-commit-message.js";

test("subjectFromGitFullMessage returns first line", () => {
  assert.equal(subjectFromGitFullMessage("feat: add chip\n\nBody paragraph"), "feat: add chip");
  assert.equal(subjectFromGitFullMessage("subject only"), "subject only");
});

test("parseGitCommitMessageOutput parses header fields and multiline body", () => {
  const raw = `abc123def\x1fAlice\x1f2024-01-02 10:00:00 +0000\x1ffeat: title\n\nDetailed body line.`;

  const parsed = parseGitCommitMessageOutput(raw);
  assert.ok(parsed);
  assert.equal(parsed.oid, "abc123def");
  assert.equal(parsed.author, "Alice");
  assert.equal(parsed.authoredAt, "2024-01-02 10:00:00 +0000");
  assert.equal(parsed.subject, "feat: title");
  assert.equal(parsed.fullMessage, "feat: title\n\nDetailed body line.");
});

test("parseGitCommitMessageOutput returns undefined for malformed output", () => {
  assert.equal(parseGitCommitMessageOutput(""), undefined);
  assert.equal(parseGitCommitMessageOutput("only-one-field"), undefined);
  assert.equal(parseGitCommitMessageOutput("\x1f\x1f\x1f"), undefined);
});
