import assert from "node:assert/strict";
import { test } from "vitest";

const { assertRichSegmentsRoundTrip, richSegmentsRoundTrip } =
  await import("@spiritagent/ui/composer");
const { segmentsToPlainText } = await import("@spiritagent/ui/composer");

const sampleAttachment = {
  id: "file-dom-1",
  filePath: "apps/desktop/src/App.tsx",
  lineStart: 3,
  lineEnd: 7,
  selectedText: "line one\n```\nline two",
};

test("file snippet chip round-trips through lexical bridge", () => {
  const segments = [{ kind: "fileSnippet", attachment: sampleAttachment }];
  assert.ok(assertRichSegmentsRoundTrip(segments));
  const roundTripped = richSegmentsRoundTrip(segments);
  assert.equal(roundTripped.length, 1);
  assert.equal(roundTripped[0]?.kind, "fileSnippet");
  if (roundTripped[0]?.kind !== "fileSnippet") {
    return;
  }
  assert.equal(roundTripped[0].attachment.id, sampleAttachment.id);
  assert.equal(roundTripped[0].attachment.filePath, sampleAttachment.filePath);
  assert.equal(roundTripped[0].attachment.lineStart, sampleAttachment.lineStart);
  assert.equal(roundTripped[0].attachment.lineEnd, sampleAttachment.lineEnd);
  assert.equal(roundTripped[0].attachment.selectedText, sampleAttachment.selectedText);
});

test("file snippet chip preserves multiline selectedText through lexical bridge", () => {
  const attachment = {
    id: "file-dom-2",
    filePath: "README.md",
    lineStart: 0,
    lineEnd: 0,
    selectedText: "alpha\nbeta\ngamma",
  };
  const roundTripped = richSegmentsRoundTrip([{ kind: "fileSnippet", attachment }]);
  assert.equal(roundTripped[0]?.kind, "fileSnippet");
  if (roundTripped[0]?.kind !== "fileSnippet") {
    return;
  }
  assert.equal(roundTripped[0].attachment.selectedText, attachment.selectedText);
});

test("lexical bridge round-trips plain text segments", () => {
  const segments = [{ kind: "text", value: "Concurrent" }];
  const roundTripped = richSegmentsRoundTrip(segments);
  assert.equal(segmentsToPlainText(roundTripped), "Concurrent");
});

test("lexical bridge keeps trailing newline in text segment", () => {
  const segments = [{ kind: "text", value: "Hello\n" }];
  const roundTripped = richSegmentsRoundTrip(segments);
  assert.equal(segmentsToPlainText(roundTripped), "Hello\n");
});
