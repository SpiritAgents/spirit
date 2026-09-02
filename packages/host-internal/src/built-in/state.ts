import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const BUILT_IN_STATE_FILE_NAME = "built-in-state.json";

export interface BuiltInState {
  removedSkillNames: string[];
  removedExtensionIds: string[];
}

const EMPTY_STATE: BuiltInState = {
  removedSkillNames: [],
  removedExtensionIds: [],
};

function resolveBuiltInStatePath(spiritDataDir: string): string {
  return path.join(spiritDataDir, BUILT_IN_STATE_FILE_NAME);
}

function normalizeNameList(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  const normalized = values
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(normalized)].sort((left, right) => left.localeCompare(right, "en"));
}

export async function loadBuiltInState(spiritDataDir: string): Promise<BuiltInState> {
  const filePath = resolveBuiltInStatePath(spiritDataDir);
  if (!existsSync(filePath)) {
    return { ...EMPTY_STATE, removedSkillNames: [], removedExtensionIds: [] };
  }

  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<BuiltInState>;
    return {
      removedSkillNames: normalizeNameList(parsed.removedSkillNames),
      removedExtensionIds: normalizeNameList(parsed.removedExtensionIds),
    };
  } catch {
    return { ...EMPTY_STATE, removedSkillNames: [], removedExtensionIds: [] };
  }
}

async function saveBuiltInState(spiritDataDir: string, state: BuiltInState): Promise<void> {
  const filePath = resolveBuiltInStatePath(spiritDataDir);
  await mkdir(path.dirname(filePath), { recursive: true });
  const payload: BuiltInState = {
    removedSkillNames: normalizeNameList(state.removedSkillNames),
    removedExtensionIds: normalizeNameList(state.removedExtensionIds),
  };
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export async function noteBuiltInSkillRemoved(
  spiritDataDir: string,
  skillName: string,
): Promise<void> {
  const normalized = skillName.trim().toLowerCase();
  if (!normalized) {
    return;
  }
  const state = await loadBuiltInState(spiritDataDir);
  if (state.removedSkillNames.includes(normalized)) {
    return;
  }
  await saveBuiltInState(spiritDataDir, {
    ...state,
    removedSkillNames: [...state.removedSkillNames, normalized],
  });
}

export async function noteBuiltInExtensionRemoved(
  spiritDataDir: string,
  extensionId: string,
): Promise<void> {
  const normalized = extensionId.trim().toLowerCase();
  if (!normalized) {
    return;
  }
  const state = await loadBuiltInState(spiritDataDir);
  if (state.removedExtensionIds.includes(normalized)) {
    return;
  }
  await saveBuiltInState(spiritDataDir, {
    ...state,
    removedExtensionIds: [...state.removedExtensionIds, normalized],
  });
}

export async function clearBuiltInExtensionRemoved(
  spiritDataDir: string,
  extensionId: string,
): Promise<void> {
  const normalized = extensionId.trim().toLowerCase();
  if (!normalized) {
    return;
  }
  const state = await loadBuiltInState(spiritDataDir);
  if (!state.removedExtensionIds.includes(normalized)) {
    return;
  }
  await saveBuiltInState(spiritDataDir, {
    ...state,
    removedExtensionIds: state.removedExtensionIds.filter((id) => id !== normalized),
  });
}
