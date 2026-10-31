import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import {
  createRuleFile,
  deleteRuleFile,
  resolveRuleFilePath,
} from "../../dist-electron/src/host/rules.js";
import { desktopInstructionPaths } from "../../dist-electron/src/host/skills.js";

test("createRuleFile writes template and rejects duplicates", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-rules-create-"));
  try {
    const instructionPaths = desktopInstructionPaths(workspaceRoot);
    const targetPath = resolveRuleFilePath(instructionPaths, "workspaceSpirit");
    await createRuleFile(workspaceRoot, {
      rootKind: "workspaceSpirit",
      description: "Commit messages use English",
    });
    const content = await import("node:fs/promises").then((fs) => fs.readFile(targetPath, "utf8"));
    assert.match(content, /Commit messages use English/);
    await assert.rejects(
      () =>
        createRuleFile(workspaceRoot, {
          rootKind: "workspaceSpirit",
          description: "duplicate",
        }),
      /已存在|already exists/i,
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("deleteRuleFile removes managed rule file", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-rules-delete-"));
  const spiritDataDir = join(workspaceRoot, "user-data");
  try {
    await mkdir(join(workspaceRoot, ".spirit"), { recursive: true });
    const instructionPaths = desktopInstructionPaths(workspaceRoot);
    const targetPath = resolveRuleFilePath(instructionPaths, "workspaceSpirit");
    await writeFile(targetPath, "# Rules\n", "utf8");
    const entries = await import("@spiritagent/host-internal").then((mod) =>
      mod.discoverRuleEntries({
        workspaceRoot,
        spiritDataDir,
      }),
    );
    const entry = entries.find((item) => item.source.rootKind === "workspaceSpirit");
    assert.ok(entry?.exists);
    await deleteRuleFile(workspaceRoot, { id: entry.source.id }, { workspaceRoot, spiritDataDir });
    const after = await import("node:fs/promises").then((fs) =>
      fs.stat(targetPath).catch(() => null),
    );
    assert.equal(after, null);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
