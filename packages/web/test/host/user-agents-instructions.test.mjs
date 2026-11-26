import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";

import { createSkillFile, deleteSkillDir } from "../../../../packages/sessions/dist/host/skills.js";
import { createRuleFile, deleteRuleFile } from "../../../../packages/sessions/dist/host/rules.js";
import { discoverRuleEntries, discoverSkillEntries } from "@spiritagent/instructions";

async function withEnv(vars, run) {
  const previous = new Map();
  for (const [key, value] of Object.entries(vars)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    await run();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

async function pathExists(targetPath) {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

test("user generic instructions support create, discovery, and deletion under home", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "spirit-user-agents-home-"));
  const workspaceRoot = path.join(home, "workspace");
  const spiritDataDir = path.join(home, "spirit-data");
  const userAgentsDir = path.join(home, ".agents");
  await mkdir(workspaceRoot, { recursive: true });
  await mkdir(spiritDataDir, { recursive: true });

  try {
    await withEnv({ HOME: home, USERPROFILE: home, SPIRIT_DATA_DIR: spiritDataDir }, async () => {
      await createRuleFile(workspaceRoot, {
        rootKind: "userAgents",
        description: "Use the shared user instructions",
      });
      await createSkillFile(workspaceRoot, {
        name: "shared-review",
        rootKind: "userAgents",
        summary: "Review with shared user instructions",
        content: "Inspect the changes and report correctness issues.",
      });

      const rulePath = path.join(userAgentsDir, "AGENTS.md");
      const skillPath = path.join(userAgentsDir, "skills", "shared-review", "SKILL.md");
      assert.match(await readFile(rulePath, "utf8"), /Use the shared user instructions/);
      assert.match(await readFile(skillPath, "utf8"), /name: shared-review/);

      const context = { workspaceRoot, spiritDataDir, userAgentsDir };
      const rule = (await discoverRuleEntries(context)).find(
        (entry) => entry.source.rootKind === "userAgents",
      );
      assert.ok(rule?.exists);
      const skill = (await discoverSkillEntries(context)).find(
        (entry) => entry.source.rootKind === "userAgents",
      );
      assert.equal(skill?.source.path, skillPath);

      await deleteSkillDir(workspaceRoot, { name: "shared-review", rootKind: "userAgents" });
      await deleteRuleFile(workspaceRoot, { id: rule.source.id }, context);
      assert.equal(await pathExists(skillPath), false);
      assert.equal(await pathExists(rulePath), false);
    });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
