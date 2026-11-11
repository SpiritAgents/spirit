import assert from "node:assert/strict";

import { test } from "vitest";

import {
  detectSupportedDocumentFile,
  hasSupportedDocumentExtension,
} from "./document-file-support.js";

test("document detection accepts only signature-validated PDF files", () => {
  assert.equal(hasSupportedDocumentExtension("PAPER.PDF"), true);
  assert.equal(hasSupportedDocumentExtension("paper.txt"), false);
  assert.equal(
    detectSupportedDocumentFile("paper.pdf", new TextEncoder().encode("%PDF-1.7\n")),
    true,
  );
  assert.equal(
    detectSupportedDocumentFile("paper.pdf", new TextEncoder().encode("plain text")),
    false,
  );
  assert.equal(
    detectSupportedDocumentFile("paper.txt", new TextEncoder().encode("%PDF-1.7\n")),
    false,
  );
});
