import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import { BUILT_IN_SKILL_NAMES, ensureBuiltInSkills, resolveBuiltInSkillsRoot } from "./skills.js";

test("resolveBuiltInSkillsRoot finds the shared template directory", async () => {
  const templateRoot = resolveBuiltInSkillsRoot();
  const createSkill = await readFile(join(templateRoot, "create-skill", "SKILL.md"), "utf8");
  assert.match(createSkill, /^---\r?\nname: create-skill\r?$/m);
});

test("ensureBuiltInSkills seeds shared built-in skills without overwriting", async () => {
  const spiritDataDir = await mkdtemp(join(tmpdir(), "spirit-host-internal-built-in-skills-"));
  try {
    await ensureBuiltInSkills(spiritDataDir);
    for (const name of BUILT_IN_SKILL_NAMES) {
      const skillPath = join(spiritDataDir, "skills", name, "SKILL.md");
      const content = await readFile(skillPath, "utf8");
      assert.match(content, /^---\r?\nname: /);
    }

    assert.deepEqual(BUILT_IN_SKILL_NAMES, [
      "create-rule",
      "create-skill",
      "create-hook",
      "create-extension",
    ]);

    const skillPath = join(spiritDataDir, "skills", "create-skill", "SKILL.md");
    const first = await readFile(skillPath, "utf8");
    const marker = `user-marker-${Date.now()}`;
    await writeFile(skillPath, `${first}\n${marker}`);
    await ensureBuiltInSkills(spiritDataDir);
    const after = await readFile(skillPath, "utf8");
    assert.match(after, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  } finally {
    await rm(spiritDataDir, { recursive: true, force: true });
  }
});
