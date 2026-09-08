import { existsSync } from "node:fs";
import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SKILL_FILE_NAME, SKILLS_DIR_NAME } from "../storage.js";
import { loadBuiltInState } from "./state.js";

export const BUILT_IN_SKILL_NAMES = [
  "create-rule",
  "create-skill",
  "create-hook",
  "create-extension",
] as const;

export type BuiltInSkillName = (typeof BUILT_IN_SKILL_NAMES)[number];

export function isBuiltInSkillName(skillName: string): skillName is BuiltInSkillName {
  const normalized = skillName.trim().toLowerCase();
  return (BUILT_IN_SKILL_NAMES as readonly string[]).includes(normalized);
}

export function resolveBuiltInSkillsRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // src/built-in and dist/built-in are the same depth relative to package root.
  return path.join(here, "../../built-in/skills");
}

export async function ensureBuiltInSkills(
  spiritDataDir: string,
  skillNames: readonly BuiltInSkillName[] = BUILT_IN_SKILL_NAMES,
): Promise<void> {
  const templateRoot = resolveBuiltInSkillsRoot();
  const userSkillsRoot = path.join(spiritDataDir, SKILLS_DIR_NAME);
  const state = await loadBuiltInState(spiritDataDir);
  const removed = new Set(state.removedSkillNames.map((name) => name.toLowerCase()));

  await mkdir(userSkillsRoot, { recursive: true });

  for (const skillName of skillNames) {
    if (removed.has(skillName.toLowerCase())) {
      continue;
    }

    const templateSkillDir = path.join(templateRoot, skillName);
    const templateSkillFile = path.join(templateSkillDir, SKILL_FILE_NAME);
    if (!existsSync(templateSkillFile)) {
      continue;
    }

    const targetSkillDir = path.join(userSkillsRoot, skillName);
    const targetSkillFile = path.join(targetSkillDir, SKILL_FILE_NAME);
    if (existsSync(targetSkillFile)) {
      continue;
    }

    await mkdir(targetSkillDir, { recursive: true });
    await cp(templateSkillFile, targetSkillFile);
  }
}
