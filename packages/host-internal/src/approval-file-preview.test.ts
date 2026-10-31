import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { test } from "vitest";

import {
  APPROVAL_FILE_PREVIEW_MAX_BYTES,
  buildApprovalFileContentPreview,
  buildApprovalFileDiffPreview,
} from "./approval-file-preview.js";
import { NodeHostToolService } from "./tools.js";

function workspaceResolver(workspaceRoot: string): (inputPath: string) => string {
  return (inputPath) => join(workspaceRoot, inputPath);
}

test("buildApprovalFileDiffPreview renders create_file as a pure create preview", async () => {
  const preview = await buildApprovalFileDiffPreview(
    { kind: "create_file", path: "docs/notes.md", content: "# Notes\n" },
    workspaceResolver("/unused"),
  );

  assert.deepEqual(preview, {
    path: "docs/notes.md",
    original: "",
    modified: "# Notes\n",
    operation: "create",
  });
});

test("buildApprovalFileDiffPreview renders create_plan under the plans/ display convention", async () => {
  const preview = await buildApprovalFileDiffPreview(
    { kind: "create_plan", planName: "ship-previews", content: "# Plan\n" },
    workspaceResolver("/unused"),
  );
  assert.equal(preview?.path, "plans/ship-previews.md");
  assert.equal(preview?.operation, "create");

  const suffixed = await buildApprovalFileDiffPreview(
    { kind: "create_plan", planName: "ship-previews.md", content: "# Plan\n" },
    workspaceResolver("/unused"),
  );
  assert.equal(suffixed?.path, "plans/ship-previews.md");
});

test("buildApprovalFileDiffPreview renders edit_file as a snippet-level update pair", async () => {
  const preview = await buildApprovalFileDiffPreview(
    { kind: "edit_file", path: "src/a.ts", oldText: "const a = 1;", newText: "const a = 2;" },
    workspaceResolver("/unused"),
  );

  assert.deepEqual(preview, {
    path: "src/a.ts",
    original: "const a = 1;",
    modified: "const a = 2;",
    operation: "update",
  });

  const empty = await buildApprovalFileDiffPreview(
    { kind: "edit_file", path: "src/a.ts", oldText: "", newText: "const a = 2;" },
    workspaceResolver("/unused"),
  );
  assert.equal(empty, undefined);
});

test("buildApprovalFileDiffPreview drops over-sized sides", async () => {
  const huge = "x".repeat(APPROVAL_FILE_PREVIEW_MAX_BYTES + 1);
  const preview = await buildApprovalFileDiffPreview(
    { kind: "create_file", path: "huge.txt", content: huge },
    workspaceResolver("/unused"),
  );
  assert.equal(preview, undefined);
});

test("buildApprovalFileDiffPreview reads delete targets and apply_patch updates from disk", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-approval-file-preview-"));

  try {
    await writeFile(join(workspaceRoot, "scratch.log"), "line one\nline two\n", "utf8");

    const deleted = await buildApprovalFileDiffPreview(
      { kind: "delete_file", path: "scratch.log" },
      workspaceResolver(workspaceRoot),
    );
    assert.deepEqual(deleted, {
      path: "scratch.log",
      original: "line one\nline two\n",
      modified: "",
      operation: "delete",
    });

    const created = await buildApprovalFileDiffPreview(
      {
        kind: "apply_patch",
        operation: { type: "create_file", path: "added.ts", diff: "+one\n+two\n*** End Patch" },
      },
      workspaceResolver(workspaceRoot),
    );
    assert.deepEqual(created, {
      path: "added.ts",
      original: "",
      modified: "one\ntwo",
      operation: "create",
    });

    const updated = await buildApprovalFileDiffPreview(
      {
        kind: "apply_patch",
        operation: {
          type: "update_file",
          path: "scratch.log",
          diff: "@@ \n line one\n-line two\n+line 2\n*** End Patch",
        },
      },
      workspaceResolver(workspaceRoot),
    );
    assert.deepEqual(updated, {
      path: "scratch.log",
      original: "line one\nline two\n",
      modified: "line one\nline 2\n",
      operation: "update",
    });

    const patchDeleted = await buildApprovalFileDiffPreview(
      { kind: "apply_patch", operation: { type: "delete_file", path: "scratch.log" } },
      workspaceResolver(workspaceRoot),
    );
    assert.equal(patchDeleted?.operation, "delete");
    assert.equal(patchDeleted?.original, "line one\nline two\n");

    await assert.rejects(
      buildApprovalFileDiffPreview(
        { kind: "delete_file", path: "missing.log" },
        workspaceResolver(workspaceRoot),
      ),
    );
    await assert.rejects(
      buildApprovalFileDiffPreview(
        {
          kind: "apply_patch",
          operation: { type: "update_file", path: "scratch.log", diff: "@@ \n-absent\n+noop" },
        },
        workspaceResolver(workspaceRoot),
      ),
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("authorize attaches diff previews to file-change approvals", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-host-tools-approval-preview-"));
  const spiritDataDir = join(workspaceRoot, ".spirit-data");

  try {
    await writeFile(join(workspaceRoot, "scratch.log"), "alpha\nbeta\n", "utf8");
    const service = new NodeHostToolService({ workspaceRoot, spiritDataDir });

    const createFile = await service.authorize({
      name: "create_file",
      path: "docs/notes.md",
      content: "# Notes\n",
    });
    assert.equal(createFile.kind, "need-approval");
    if (createFile.kind !== "need-approval" || createFile.approval.kind !== "create_file") {
      throw new Error("expected a create_file approval");
    }
    assert.deepEqual(createFile.approval.fileDiffPreview, {
      path: "docs/notes.md",
      original: "",
      modified: "# Notes\n",
      operation: "create",
    });

    const createPlan = await service.authorize({
      name: "create_plan",
      plan_name: "ship-previews",
      content: "# Plan\n",
    });
    assert.equal(createPlan.kind, "need-approval");
    if (createPlan.kind !== "need-approval" || createPlan.approval.kind !== "create_plan") {
      throw new Error("expected a create_plan approval");
    }
    assert.equal(createPlan.approval.fileDiffPreview?.path, "plans/ship-previews.md");
    assert.equal(createPlan.approval.fileDiffPreview?.modified, "# Plan\n");

    const editFile = await service.authorize({
      name: "edit_file",
      path: "scratch.log",
      old_text: "beta",
      new_text: "BETA",
    });
    assert.equal(editFile.kind, "need-approval");
    if (editFile.kind !== "need-approval" || editFile.approval.kind !== "edit_file") {
      throw new Error("expected an edit_file approval");
    }
    assert.deepEqual(editFile.approval.fileDiffPreview, {
      path: "scratch.log",
      original: "beta",
      modified: "BETA",
      operation: "update",
    });

    const deleteFile = await service.authorize({ name: "delete_file", path: "scratch.log" });
    assert.equal(deleteFile.kind, "need-approval");
    if (deleteFile.kind !== "need-approval" || deleteFile.approval.kind !== "delete_file") {
      throw new Error("expected a delete_file approval");
    }
    assert.deepEqual(deleteFile.approval.fileDiffPreview, {
      path: "scratch.log",
      original: "alpha\nbeta\n",
      modified: "",
      operation: "delete",
    });

    const applyPatch = await service.authorize({
      name: "apply_patch",
      operation: {
        type: "update_file",
        path: "scratch.log",
        diff: "@@ \n alpha\n-beta\n+BETA\n*** End Patch",
      },
    });
    assert.equal(applyPatch.kind, "need-approval");
    if (applyPatch.kind !== "need-approval" || applyPatch.approval.kind !== "apply_patch") {
      throw new Error("expected an apply_patch approval");
    }
    assert.deepEqual(applyPatch.approval.fileDiffPreview, {
      path: "scratch.log",
      original: "alpha\nbeta\n",
      modified: "alpha\nBETA\n",
      operation: "update",
    });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("buildApprovalFileContentPreview reads text files and lists directories", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-approval-content-preview-"));

  try {
    await writeFile(join(workspaceRoot, "hosts.txt"), "127.0.0.1 localhost\n", "utf8");
    await writeFile(join(workspaceRoot, "blob.bin"), Buffer.from([0x89, 0x50, 0x00, 0x4e]));
    await mkdir(join(workspaceRoot, "subdir"));

    const read = await buildApprovalFileContentPreview(
      join(workspaceRoot, "hosts.txt"),
      "read_file",
    );
    assert.deepEqual(read, {
      path: join(workspaceRoot, "hosts.txt"),
      content: "127.0.0.1 localhost\n",
    });

    // Binaries are not previewable as text lines.
    const binary = await buildApprovalFileContentPreview(
      join(workspaceRoot, "blob.bin"),
      "read_file",
    );
    assert.equal(binary, undefined);

    const listing = await buildApprovalFileContentPreview(workspaceRoot, "ls");
    assert.equal(listing?.path, workspaceRoot);
    // Directories first with a trailing slash, then files; both sorted.
    assert.deepEqual(listing?.content.split("\n"), ["subdir/", "blob.bin", "hosts.txt"]);

    await assert.rejects(
      buildApprovalFileContentPreview(join(workspaceRoot, "missing.txt"), "read_file"),
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("authorize attaches a content preview to out-of-workspace read approvals", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-host-tools-read-preview-"));
  const outsideRoot = await mkdtemp(join(tmpdir(), "spirit-host-tools-read-preview-outside-"));
  const spiritDataDir = join(workspaceRoot, ".spirit-data");

  try {
    const outsideFile = join(outsideRoot, "notes.txt");
    await writeFile(outsideFile, "outside content\n", "utf8");
    const service = new NodeHostToolService({ workspaceRoot, spiritDataDir });

    const readFileAuth = await service.authorize({ name: "read_file", path: outsideFile });
    assert.equal(readFileAuth.kind, "need-approval");
    if (readFileAuth.kind !== "need-approval" || readFileAuth.approval.kind !== "read_path") {
      throw new Error("expected a read_path approval");
    }
    assert.equal(readFileAuth.approval.fileContentPreview?.content, "outside content\n");
    assert.equal(readFileAuth.approval.fileContentPreview?.path, readFileAuth.approval.path);
    assert.equal(readFileAuth.approval.workspaceExternal, true);

    const lsAuth = await service.authorize({ name: "ls", path: outsideRoot });
    assert.equal(lsAuth.kind, "need-approval");
    if (lsAuth.kind !== "need-approval" || lsAuth.approval.kind !== "read_path") {
      throw new Error("expected a read_path approval");
    }
    assert.deepEqual(lsAuth.approval.fileContentPreview?.content, "notes.txt");

    // A binary target still prompts, just without the preview (resolveReadFileTarget requires
    // the path to exist, so the missing-file case never reaches the approval).
    const binaryFile = join(outsideRoot, "blob.bin");
    await writeFile(binaryFile, Buffer.from([0x89, 0x50, 0x00, 0x4e]));
    const binaryAuth = await service.authorize({ name: "read_file", path: binaryFile });
    assert.equal(binaryAuth.kind, "need-approval");
    if (binaryAuth.kind !== "need-approval" || binaryAuth.approval.kind !== "read_path") {
      throw new Error("expected a read_path approval");
    }
    assert.equal(binaryAuth.approval.fileContentPreview, undefined);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(outsideRoot, { recursive: true, force: true });
  }
});

test("describeApproval builds structured descriptors for auto-allowed calls", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-host-tools-describe-approval-"));
  const spiritDataDir = join(workspaceRoot, ".spirit-data");

  try {
    await writeFile(join(workspaceRoot, "scratch.log"), "alpha\nbeta\n", "utf8");
    const service = new NodeHostToolService({ workspaceRoot, spiritDataDir });

    const shell = await service.describeApproval({
      name: "shell",
      command: "pnpm test",
      reason: "Run the test suite",
    });
    assert.equal(shell?.kind, "shell");
    if (shell?.kind !== "shell") {
      throw new Error("expected a shell descriptor");
    }
    assert.equal(shell.command, "pnpm test");
    assert.ok(shell.terminal.length > 0);

    const createFile = await service.describeApproval({
      name: "create_file",
      path: "docs/notes.md",
      content: "# Notes\n",
    });
    if (createFile?.kind !== "create_file") {
      throw new Error("expected a create_file descriptor");
    }
    assert.equal(createFile.fileDiffPreview?.modified, "# Notes\n");

    // In-workspace reads describe fine: the descriptor does not consult permission rules, the
    // display path relativizes against the workspace root, and the location flag is internal.
    const readFile = await service.describeApproval({ name: "read_file", path: "scratch.log" });
    if (readFile?.kind !== "read_path") {
      throw new Error("expected a read_path descriptor");
    }
    assert.equal(readFile.operation, "read_file");
    assert.equal(readFile.workspaceExternal, false);
    assert.equal(readFile.path, "scratch.log");
    assert.equal(readFile.fileContentPreview?.path, "scratch.log");
    assert.equal(readFile.fileContentPreview?.content, "alpha\nbeta\n");

    // Out-of-workspace targets keep the global absolute path and the external flag.
    const ls = await service.describeApproval({ name: "ls", path: tmpdir() });
    if (ls?.kind !== "read_path") {
      throw new Error("expected a read_path descriptor");
    }
    assert.equal(ls.operation, "ls");
    assert.equal(ls.workspaceExternal, true);
    assert.ok(isAbsolute(ls.path));

    // No descriptor for tools without an approval form, or for unresolvable paths.
    assert.equal(await service.describeApproval({ name: "grep", pattern: "x" }), undefined);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("authorize falls back to the plain prompt when the preview cannot be built", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-host-tools-approval-preview-miss-"));
  const spiritDataDir = join(workspaceRoot, ".spirit-data");

  try {
    const service = new NodeHostToolService({ workspaceRoot, spiritDataDir });

    const missingDelete = await service.authorize({ name: "delete_file", path: "missing.log" });
    assert.equal(missingDelete.kind, "need-approval");
    if (missingDelete.kind !== "need-approval" || missingDelete.approval.kind !== "delete_file") {
      throw new Error("expected a delete_file approval");
    }
    assert.equal(missingDelete.approval.fileDiffPreview, undefined);

    await writeFile(join(workspaceRoot, "scratch.log"), "alpha\n", "utf8");
    const badPatch = await service.authorize({
      name: "apply_patch",
      operation: {
        type: "update_file",
        path: "scratch.log",
        diff: "@@ \n-absent\n+noop\n*** End Patch",
      },
    });
    assert.equal(badPatch.kind, "need-approval");
    if (badPatch.kind !== "need-approval" || badPatch.approval.kind !== "apply_patch") {
      throw new Error("expected an apply_patch approval");
    }
    assert.equal(badPatch.approval.fileDiffPreview, undefined);
    // The metadata fields stay populated so the plain prompt still describes the call.
    assert.equal(badPatch.approval.path, "scratch.log");
    assert.equal(typeof badPatch.approval.diffLines, "number");
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
