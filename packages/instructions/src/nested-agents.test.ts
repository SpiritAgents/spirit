import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";

import {
  createNestedAgentsTracker,
  extractDirectoriesFromShellCommand,
  extractStaticPrefixFromGlob,
} from "./nested-agents.js";

async function withTempFixture(
  run: (root: string, workspaceRoot: string, dataDir: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "spirit-nested-agents-"));
  const workspaceRoot = path.join(root, "projects", "repo");
  const dataDir = path.join(root, "spirit-data");
  await mkdir(workspaceRoot, { recursive: true });
  await mkdir(dataDir, { recursive: true });
  try {
    await run(root, workspaceRoot, dataDir);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("extractStaticPrefixFromGlob returns leading non-glob directory segments", () => {
  assert.equal(extractStaticPrefixFromGlob("packages/icons/**/*.ts"), "packages/icons");
  assert.equal(extractStaticPrefixFromGlob("./apps/site/content/*.mdx"), "apps/site/content");
  assert.equal(extractStaticPrefixFromGlob("**/*.ts"), undefined);
  assert.equal(extractStaticPrefixFromGlob("!node_modules/**"), undefined);
});

test("walks upward past workspace root to filesystem root, skips system-prompt root AGENTS.md, deduplicates, and detects content hash updates", async () => {
  await withTempFixture(async (root, workspaceRoot, dataDir) => {
    const outerAgents = path.join(root, "projects", "AGENTS.md");
    const rootAgents = path.join(workspaceRoot, "AGENTS.md");
    const pkgAgents = path.join(workspaceRoot, "packages", "icons", "AGENTS.md");
    const leafFile = path.join(workspaceRoot, "packages", "icons", "src", "star.svg");

    await mkdir(path.dirname(leafFile), { recursive: true });
    await writeFile(outerAgents, "# Outer Projects Rules\n");
    await writeFile(rootAgents, "# Repo Root Rules\n");
    await writeFile(pkgAgents, "# Icons Rules v1\n");
    await writeFile(leafFile, "<svg/>");

    const systemRules = [{ path: rootAgents, content: "# Repo Root Rules\n" }];
    const tracker = createNestedAgentsTracker({
      workspaceRoot,
      spiritDataDir: dataDir,
      getSystemInjectedAgentsRules: () => systemRules,
    });

    // 1. First read discovers closest-first (pkg -> outer), skipping system-injected root.
    const first = await tracker.discoverForToolCall({
      toolName: "read_file",
      request: { name: "read_file", path: "packages/icons/src/star.svg" },
      rawOutput: "[read]\n...",
      failed: false,
    });
    assert.deepEqual(first, [
      { path: path.resolve(pkgAgents), reason: "new" },
      { path: path.resolve(outerAgents), reason: "new" },
    ]);

    // 2. Second read in same uncompacted context does not re-notify unchanged files.
    const second = await tracker.discoverForToolCall({
      toolName: "read_file",
      request: { name: "read_file", path: "packages/icons/src/star.svg" },
      rawOutput: "[read]\n...",
      failed: false,
    });
    assert.deepEqual(second, []);

    // 3. Modifying pkg AGENTS.md changes its SHA-256 hash and triggers an "updated" reminder.
    await writeFile(pkgAgents, "# Icons Rules v2\n");
    const third = await tracker.discoverForToolCall({
      toolName: "read_file",
      request: { name: "read_file", path: "packages/icons/src/star.svg" },
      rawOutput: "[read]\n...",
      failed: false,
    });
    assert.deepEqual(third, [{ path: path.resolve(pkgAgents), reason: "updated" }]);

    // 4. Subsequent read after updated notification is quiet again.
    const fourth = await tracker.discoverForToolCall({
      toolName: "read_file",
      request: { name: "read_file", path: "packages/icons/src/star.svg" },
      rawOutput: "[read]\n...",
      failed: false,
    });
    assert.deepEqual(fourth, []);

    // 5. After compaction, dynamic entries reset while unchanged system-prompt root stays suppressed.
    tracker.resetForCompaction();
    const afterCompact = await tracker.discoverForToolCall({
      toolName: "read_file",
      request: { name: "read_file", path: "packages/icons/src/star.svg" },
      rawOutput: "[read]\n...",
      failed: false,
    });
    assert.deepEqual(afterCompact, [
      { path: path.resolve(pkgAgents), reason: "new" },
      { path: path.resolve(outerAgents), reason: "new" },
    ]);

    // 6. If root AGENTS.md itself changes on disk while system prompt still holds v1, notify updated.
    await writeFile(rootAgents, "# Repo Root Rules v2\n");
    const rootUpdated = await tracker.discoverForToolCall({
      toolName: "read_file",
      request: { name: "read_file", path: "packages/icons/src/star.svg" },
      rawOutput: "[read]\n...",
      failed: false,
    });
    assert.deepEqual(rootUpdated, [{ path: path.resolve(rootAgents), reason: "updated" }]);
  });
});

test("ls discovers target directory, ancestors, and direct first-level child subdirectories only", async () => {
  await withTempFixture(async (_root, workspaceRoot, dataDir) => {
    const packagesDir = path.join(workspaceRoot, "packages");
    const pkgAgents = path.join(packagesDir, "AGENTS.md");
    const childAgents = path.join(packagesDir, "alpha", "AGENTS.md");
    const grandchildAgents = path.join(packagesDir, "alpha", "deep", "AGENTS.md");
    const nodeModulesAgents = path.join(packagesDir, "node_modules", "AGENTS.md");

    await mkdir(path.dirname(grandchildAgents), { recursive: true });
    await mkdir(path.dirname(nodeModulesAgents), { recursive: true });
    await writeFile(pkgAgents, "# Packages\n");
    await writeFile(childAgents, "# Alpha\n");
    await writeFile(grandchildAgents, "# Deep\n");
    await writeFile(nodeModulesAgents, "# Ignored\n");

    const tracker = createNestedAgentsTracker({ workspaceRoot, spiritDataDir: dataDir });
    const notifications = await tracker.discoverForToolCall({
      toolName: "ls",
      request: { name: "ls", path: packagesDir },
      rawOutput: "[list]\n...",
      failed: false,
    });

    assert.deepEqual(notifications, [
      { path: path.resolve(childAgents), reason: "new" },
      { path: path.resolve(pkgAgents), reason: "new" },
    ]);
  });
});

test("glob and grep discover from both static prefixes and matched file paths", async () => {
  await withTempFixture(async (_root, workspaceRoot, dataDir) => {
    const pkgAAgents = path.join(workspaceRoot, "packages", "a", "AGENTS.md");
    const pkgBAgents = path.join(workspaceRoot, "packages", "b", "AGENTS.md");
    const pkgCAgents = path.join(workspaceRoot, "packages", "c", "AGENTS.md");
    const fileB = path.join(workspaceRoot, "packages", "b", "src", "foo.ts");
    const fileC = path.join(workspaceRoot, "packages", "c", "src", "bar.ts");

    await mkdir(path.dirname(pkgAAgents), { recursive: true });
    await mkdir(path.dirname(fileB), { recursive: true });
    await mkdir(path.dirname(fileC), { recursive: true });
    await writeFile(pkgAAgents, "# A\n");
    await writeFile(pkgBAgents, "# B\n");
    await writeFile(pkgCAgents, "# C\n");
    await writeFile(fileB, "export const b = 1;\n");
    await writeFile(fileC, "export const c = 2;\n");

    const tracker = createNestedAgentsTracker({ workspaceRoot, spiritDataDir: dataDir });

    const globNotifications = await tracker.discoverForToolCall({
      toolName: "glob",
      request: { name: "glob", pattern: "**/*.ts" },
      rawOutput: "[glob]\npattern: **/*.ts\nmatches: 1\n\npackages/b/src/foo.ts\n",
      failed: false,
    });
    assert.deepEqual(globNotifications, [{ path: path.resolve(pkgBAgents), reason: "new" }]);

    const grepNotifications = await tracker.discoverForToolCall({
      toolName: "grep",
      request: { name: "grep", pattern: "const", glob: "packages/a/**/*.ts" },
      rawOutput: "packages/c/src/bar.ts:1:export const c = 2;\n",
      failed: false,
    });
    assert.deepEqual(
      new Set(grepNotifications.map((item) => item.path)),
      new Set([path.resolve(pkgAAgents), path.resolve(pkgCAgents)]),
    );

    // Hyphenated paths with digits (e.g. `lib-2-utils/issue-123-fix.ts`) must not be truncated
    // by `-<digits>-` or `-` matching, and sibling matches must precede shared parent AGENTS.md.
    const sharedParentAgents = path.join(workspaceRoot, "packages", "AGENTS.md");
    const hyphenAgents = path.join(workspaceRoot, "packages", "lib-2-utils", "AGENTS.md");
    const hyphenFile = path.join(workspaceRoot, "packages", "lib-2-utils", "issue-123-fix.ts");
    const siblingAgents = path.join(workspaceRoot, "packages", "pkg-z", "AGENTS.md");
    const siblingFile = path.join(workspaceRoot, "packages", "pkg-z", "index.ts");
    await mkdir(path.dirname(hyphenFile), { recursive: true });
    await mkdir(path.dirname(siblingFile), { recursive: true });
    await writeFile(sharedParentAgents, "# Shared Packages\n");
    await writeFile(hyphenAgents, "# Hyphen Pkg\n");
    await writeFile(hyphenFile, "export const h = 1;\n");
    await writeFile(siblingAgents, "# Sibling Z\n");
    await writeFile(siblingFile, "export const z = 1;\n");

    const hyphenAndSibling = await tracker.discoverForToolCall({
      toolName: "grep",
      request: { name: "grep", pattern: "export" },
      rawOutput: [
        "packages/lib-2-utils/issue-123-fix.ts:1:export const h = 1;",
        "packages/pkg-z/index.ts:1:export const z = 1;",
      ].join("\n"),
      failed: false,
    });
    assert.deepEqual(hyphenAndSibling, [
      { path: path.resolve(hyphenAgents), reason: "new" },
      { path: path.resolve(siblingAgents), reason: "new" },
      { path: path.resolve(sharedParentAgents), reason: "new" },
    ]);
  });
});

test("direct read_file and edit_file on AGENTS.md skip self-reminder while discovering parents", async () => {
  await withTempFixture(async (_root, workspaceRoot, dataDir) => {
    const parentAgents = path.join(workspaceRoot, "packages", "AGENTS.md");
    const childAgents = path.join(workspaceRoot, "packages", "icons", "AGENTS.md");
    const siblingFile = path.join(workspaceRoot, "packages", "icons", "src", "a.ts");

    await mkdir(path.dirname(siblingFile), { recursive: true });
    await writeFile(parentAgents, "# Packages\n");
    await writeFile(childAgents, "# Icons v1\n");
    await writeFile(siblingFile, "export {};\n");

    const tracker = createNestedAgentsTracker({ workspaceRoot, spiritDataDir: dataDir });

    // Direct read of child AGENTS.md skips child self-reminder, still notifies parent.
    const onDirectRead = await tracker.discoverForToolCall({
      toolName: "read_file",
      request: { name: "read_file", path: "packages/icons/AGENTS.md" },
      rawOutput: "[read]\n...",
      failed: false,
    });
    assert.deepEqual(onDirectRead, [{ path: path.resolve(parentAgents), reason: "new" }]);

    // Subsequent read of sibling file does NOT re-notify child AGENTS.md since its hash was recorded.
    const onSibling = await tracker.discoverForToolCall({
      toolName: "read_file",
      request: { name: "read_file", path: "packages/icons/src/a.ts" },
      rawOutput: "[read]\n...",
      failed: false,
    });
    assert.deepEqual(onSibling, []);

    // Direct edit_file on child AGENTS.md records its new post-edit hash so no self-reminder fires.
    await writeFile(childAgents, "# Icons v2\n");
    const onDirectEdit = await tracker.discoverForToolCall({
      toolName: "edit_file",
      request: { name: "edit_file", path: "packages/icons/AGENTS.md" },
      rawOutput: "[write]\n...",
      failed: false,
    });
    assert.deepEqual(onDirectEdit, []);
  });
});

test("write tools (create_file, delete_file, apply_patch), get_diagnostics, and @file attachments trigger discovery", async () => {
  await withTempFixture(async (_root, workspaceRoot, dataDir) => {
    const aAgents = path.join(workspaceRoot, "packages", "a", "AGENTS.md");
    const bAgents = path.join(workspaceRoot, "packages", "b", "AGENTS.md");
    const cAgents = path.join(workspaceRoot, "packages", "c", "AGENTS.md");
    const dAgents = path.join(workspaceRoot, "packages", "d", "AGENTS.md");
    for (const file of [aAgents, bAgents, cAgents, dAgents]) {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, `# ${file}\n`);
    }
    const fileA = path.join(workspaceRoot, "packages", "a", "index.ts");
    const fileB = path.join(workspaceRoot, "packages", "b", "index.ts");
    const fileC = path.join(workspaceRoot, "packages", "c", "index.ts");
    const fileD = path.join(workspaceRoot, "packages", "d", "index.ts");
    await writeFile(fileA, "");
    await writeFile(fileB, "");
    await writeFile(fileC, "");
    await writeFile(fileD, "");

    const tracker = createNestedAgentsTracker({ workspaceRoot, spiritDataDir: dataDir });

    const onCreate = await tracker.discoverForToolCall({
      toolName: "create_file",
      request: { name: "create_file", path: "packages/a/new.ts" },
      rawOutput: "[write]\n...",
      failed: false,
    });
    assert.deepEqual(onCreate, [{ path: path.resolve(aAgents), reason: "new" }]);

    const onPatch = await tracker.discoverForToolCall({
      toolName: "apply_patch",
      request: {
        name: "apply_patch",
        operation: { type: "update_file", path: "packages/b/index.ts" },
      },
      rawOutput: "[write]\n...",
      failed: false,
    });
    assert.deepEqual(onPatch, [{ path: path.resolve(bAgents), reason: "new" }]);

    const onDiag = await tracker.discoverForToolCall({
      toolName: "get_diagnostics",
      request: { name: "get_diagnostics", paths: ["packages/c/index.ts"] },
      rawOutput: "No diagnostics",
      failed: false,
    });
    assert.deepEqual(onDiag, [{ path: path.resolve(cAgents), reason: "new" }]);

    const onAtFile = await tracker.discoverForWorkspaceFiles([fileD]);
    assert.deepEqual(onAtFile, [{ path: path.resolve(dAgents), reason: "new" }]);
  });
});

test("shell command extractor tracks cd, flags, external paths, and avoids false positives", async () => {
  await withTempFixture(async (root, workspaceRoot, dataDir) => {
    const externalDir = path.join(root, "external");
    const externalAgents = path.join(externalDir, "AGENTS.md");
    const pkgDir = path.join(workspaceRoot, "packages", "cli");
    const pkgSubDir = path.join(pkgDir, "src");
    const pkgAgents = path.join(pkgDir, "AGENTS.md");
    const subAgents = path.join(pkgSubDir, "AGENTS.md");

    await mkdir(externalDir, { recursive: true });
    await mkdir(pkgSubDir, { recursive: true });
    await writeFile(externalAgents, "# External\n");
    await writeFile(pkgAgents, "# CLI\n");
    await writeFile(subAgents, "# CLI Src\n");
    await writeFile(path.join(pkgSubDir, "main.ts"), "export {};\n");
    await writeFile(path.join(externalDir, "note.txt"), "hello\n");

    // Non-path strings with slashes must not produce false positives.
    const noMatch = await extractDirectoriesFromShellCommand(
      "echo application/json && git status origin/main",
      workspaceRoot,
    );
    assert.deepEqual(noMatch, []);

    // Invoking a toolchain binary from a `bin/` directory at command position must not trigger
    // discovery of the toolchain's own parent AGENTS.md, while project scripts still do.
    const fakeToolchainBin = path.join(root, "toolchain", "v1", "bin", "runner");
    const projectScript = path.join(pkgDir, "scripts", "check.sh");
    await mkdir(path.dirname(fakeToolchainBin), { recursive: true });
    await mkdir(path.dirname(projectScript), { recursive: true });
    await writeFile(path.join(root, "toolchain", "AGENTS.md"), "# Toolchain Repo Rules\n");
    await writeFile(fakeToolchainBin, "#!/bin/sh\n");
    await writeFile(projectScript, "#!/bin/sh\n");

    const fromBinCmd = await extractDirectoriesFromShellCommand(
      `${JSON.stringify(fakeToolchainBin)} -e "console.log(1)"`,
      workspaceRoot,
    );
    assert.deepEqual(fromBinCmd, []);

    const fromScriptCmd = await extractDirectoriesFromShellCommand(
      "./packages/cli/scripts/check.sh",
      workspaceRoot,
    );
    assert.deepEqual(fromScriptCmd, [path.resolve(path.dirname(projectScript))]);

    const tracker = createNestedAgentsTracker({ workspaceRoot, spiritDataDir: dataDir });

    // `cd` followed by nested file access discovers deepest-first (src before pkg).
    const notifications = await tracker.discoverForToolCall({
      toolName: "shell",
      request: {
        name: "shell",
        command: `cd packages/cli && cat src/main.ts && cat --file=${path.join(externalDir, "note.txt")}`,
      },
      rawOutput: "Task running.\ntask_id: t1\n",
      failed: false,
    });

    assert.deepEqual(notifications, [
      { path: path.resolve(subAgents), reason: "new" },
      { path: path.resolve(pkgAgents), reason: "new" },
      { path: path.resolve(externalAgents), reason: "new" },
    ]);
  });
});

test("respects disabled root AGENTS.md, permission deny rules, symlinks, and state snapshot/restore", async () => {
  await withTempFixture(async (root, workspaceRoot, dataDir) => {
    const rootAgents = path.join(workspaceRoot, "AGENTS.md");
    const secretDir = path.join(root, "secret");
    const secretAgents = path.join(secretDir, "AGENTS.md");
    const targetDoc = path.join(workspaceRoot, "docs", "REAL.md");
    const linkedAgents = path.join(workspaceRoot, "docs", "AGENTS.md");

    await mkdir(secretDir, { recursive: true });
    await mkdir(path.dirname(targetDoc), { recursive: true });
    await writeFile(rootAgents, "# Disabled Root\n");
    await writeFile(secretAgents, "# Secret\n");
    await writeFile(targetDoc, "# Symlinked Docs Rules\n");
    await symlink(targetDoc, linkedAgents);
    await writeFile(path.join(workspaceRoot, "docs", "page.md"), "hi\n");
    await writeFile(path.join(secretDir, "data.txt"), "x\n");

    const tracker = createNestedAgentsTracker({
      workspaceRoot,
      spiritDataDir: dataDir,
      getDisabledAgentsPaths: () => [rootAgents],
      isPathDenied: (canonical) => canonical.includes("/secret/"),
    });

    const docsNotifs = await tracker.discoverForToolCall({
      toolName: "read_file",
      request: { name: "read_file", path: "docs/page.md" },
      rawOutput: "[read]\n...",
      failed: false,
    });
    assert.deepEqual(docsNotifs, [{ path: path.resolve(linkedAgents), reason: "new" }]);

    // Denied secret path is skipped.
    const secretNotifs = await tracker.discoverForToolCall({
      toolName: "read_file",
      request: { name: "read_file", path: path.join(secretDir, "data.txt") },
      rawOutput: "[read]\n...",
      failed: false,
    });
    assert.deepEqual(secretNotifs, []);

    // Snapshot / restore preserves deduplication across a fresh tracker instance.
    const snapshot = tracker.snapshotState();
    const restored = createNestedAgentsTracker({
      workspaceRoot,
      spiritDataDir: dataDir,
      getDisabledAgentsPaths: () => [rootAgents],
    });
    restored.restoreState(snapshot);
    const afterRestore = await restored.discoverForToolCall({
      toolName: "read_file",
      request: { name: "read_file", path: "docs/page.md" },
      rawOutput: "[read]\n...",
      failed: false,
    });
    assert.deepEqual(afterRestore, []);
  });
});
