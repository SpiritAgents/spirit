import assert from "node:assert/strict";
import { test } from "vitest";

import {
  fileContentPreviewForApprovalRequest,
  fileDiffPreviewsForApprovalRequest,
} from "../../src/lib/approval-file-previews.ts";

test("fileDiffPreviewsForApprovalRequest maps a create preview to a diff frame payload", () => {
  const previews = fileDiffPreviewsForApprovalRequest({
    kind: "create_file",
    path: "docs/notes.md",
    contentChars: 8,
    fileDiffPreview: {
      path: "docs/notes.md",
      original: "",
      modified: "# Notes\n",
      operation: "create",
    },
  });

  assert.equal(previews?.length, 1);
  assert.deepEqual(previews[0], {
    relativePath: "docs/notes.md",
    languageId: "markdown",
    original: "",
    modified: "# Notes\n",
  });
});

test("fileDiffPreviewsForApprovalRequest collapses delete previews by default", () => {
  const previews = fileDiffPreviewsForApprovalRequest({
    kind: "delete_file",
    path: "tmp/scratch.log",
    fileDiffPreview: {
      path: "tmp/scratch.log",
      original: "seed\n",
      modified: "",
      operation: "delete",
    },
  });

  assert.equal(previews?.length, 1);
  assert.equal(previews[0].defaultOpen, false);
  assert.equal(previews[0].languageId, "plaintext");
});

test("fileDiffPreviewsForApprovalRequest keeps update previews expanded", () => {
  const previews = fileDiffPreviewsForApprovalRequest({
    kind: "apply_patch",
    operation: "update_file",
    path: "src/a.ts",
    fileDiffPreview: {
      path: "src/a.ts",
      original: "const a = 1;",
      modified: "const a = 2;",
      operation: "update",
    },
  });

  assert.equal(previews?.length, 1);
  assert.equal(previews[0].defaultOpen, undefined);
  assert.equal(previews[0].languageId, "typescript");
});

test("fileDiffPreviewsForApprovalRequest returns undefined when no preview is attached", () => {
  assert.equal(
    fileDiffPreviewsForApprovalRequest({ kind: "delete_file", path: "tmp/missing.log" }),
    undefined,
  );
  assert.equal(
    fileDiffPreviewsForApprovalRequest({ kind: "web_fetch", url: "https://example.com" }),
    undefined,
  );
  assert.equal(
    fileDiffPreviewsForApprovalRequest({ kind: "shell", command: "ls", terminal: "zsh" }),
    undefined,
  );
});

test("fileContentPreviewForApprovalRequest maps a read_file preview to a content frame payload", () => {
  const preview = fileContentPreviewForApprovalRequest({
    kind: "read_path",
    operation: "read_file",
    path: "/etc/hosts",
    fileContentPreview: { path: "/etc/hosts", content: "127.0.0.1 localhost\n" },
  });

  assert.deepEqual(preview, {
    relativePath: "/etc/hosts",
    languageId: "plaintext",
    content: "127.0.0.1 localhost\n",
  });
});

test("fileContentPreviewForApprovalRequest maps an ls preview with a plaintext listing", () => {
  const preview = fileContentPreviewForApprovalRequest({
    kind: "read_path",
    operation: "ls",
    path: "/opt/tools",
    fileContentPreview: { path: "/opt/tools", content: "bin/\nREADME.md" },
  });

  assert.equal(preview?.languageId, "plaintext");
  assert.equal(preview?.content, "bin/\nREADME.md");
  assert.equal(preview?.defaultOpen, undefined);
  assert.equal(preview?.directory, true);
});

test("fileContentPreviewForApprovalRequest highlights code reads by extension", () => {
  const preview = fileContentPreviewForApprovalRequest({
    kind: "read_path",
    operation: "read_file",
    path: "/opt/tools/index.ts",
    fileContentPreview: { path: "/opt/tools/index.ts", content: "export {};\n" },
  });

  assert.equal(preview?.languageId, "typescript");
  assert.equal(preview?.directory, undefined);
});

test("fileContentPreviewForApprovalRequest returns undefined for other kinds or missing previews", () => {
  assert.equal(
    fileContentPreviewForApprovalRequest({ kind: "read_path", operation: "read_file", path: "/x" }),
    undefined,
  );
  assert.equal(
    fileContentPreviewForApprovalRequest({ kind: "shell", command: "ls", terminal: "zsh" }),
    undefined,
  );
});
