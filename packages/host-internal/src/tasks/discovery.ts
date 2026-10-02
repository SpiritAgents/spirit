import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveWorkspaceDataDir } from "../data-paths.js";

import type { LoadedTaskFile, TaskFileSourceKind } from "./schema.js";

export interface LoadTaskFilesInput {
  workspaceRoot?: string;
  spiritDataDir: string;
}

export function workspaceTasksFilePath(workspaceRoot: string): string {
  return path.join(resolveWorkspaceDataDir(path.resolve(workspaceRoot)), "tasks.json");
}

export function userTasksFilePath(spiritDataDir: string): string {
  return path.join(path.resolve(spiritDataDir), "tasks.json");
}

export function vscodeTasksFilePath(workspaceRoot: string): string {
  return path.join(path.resolve(workspaceRoot), ".vscode", "tasks.json");
}

export function matchesTaskFileVersion(sourceKind: TaskFileSourceKind, json: unknown): boolean {
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return false;
  }
  const record = json as Record<string, unknown>;
  if (sourceKind === "vscode-compat") {
    return record.version === "2.0.0";
  }
  return record.schemaVersion === 1;
}

export async function loadTaskFiles(input: LoadTaskFilesInput): Promise<LoadedTaskFile[]> {
  const candidates: { path: string; sourceKind: TaskFileSourceKind }[] = [];
  if (input.workspaceRoot !== undefined) {
    candidates.push({ path: workspaceTasksFilePath(input.workspaceRoot), sourceKind: "workspace" });
  }
  candidates.push({ path: userTasksFilePath(input.spiritDataDir), sourceKind: "user" });
  if (input.workspaceRoot !== undefined) {
    candidates.push({
      path: vscodeTasksFilePath(input.workspaceRoot),
      sourceKind: "vscode-compat",
    });
  }
  const files: LoadedTaskFile[] = [];
  for (const candidate of candidates) {
    const loaded = await readTaskFile(candidate.path, candidate.sourceKind);
    if (loaded === undefined || !matchesTaskFileVersion(candidate.sourceKind, loaded.json)) {
      continue;
    }
    files.push({ path: candidate.path, sourceKind: candidate.sourceKind, ...loaded });
  }
  return files;
}

// tasks.json content is untrusted data: files that fail to read or parse simply contribute
// no tasks. Spirit's own files keep strict JSON; real-world .vscode/tasks.json is JSONC, so
// the vscode-compat source first strips comments and trailing commas. The raw text is kept
// unstripped so trust hashes cover the exact file bytes, including comments.
async function readTaskFile(
  filePath: string,
  sourceKind: TaskFileSourceKind,
): Promise<{ json: unknown; rawText: string } | undefined> {
  let rawText: string;
  try {
    rawText = await readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
  try {
    const json = JSON.parse(sourceKind === "vscode-compat" ? jsoncToJson(rawText) : rawText);
    return { json, rawText };
  } catch {
    return undefined;
  }
}

function jsoncToJson(raw: string): string {
  return stripTrailingCommas(stripComments(raw));
}

function stripComments(raw: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    if (inString) {
      out += ch;
      if (ch === "\\") {
        i += 1;
        if (i < raw.length) {
          out += raw[i]!;
        }
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === "/" && raw[i + 1] === "/") {
      while (i < raw.length && raw[i] !== "\n") {
        i += 1;
      }
      if (i < raw.length) {
        out += "\n";
      }
      continue;
    }
    if (ch === "/" && raw[i + 1] === "*") {
      i += 2;
      while (i < raw.length && !(raw[i] === "*" && raw[i + 1] === "/")) {
        i += 1;
      }
      i += 1;
      continue;
    }
    out += ch;
  }
  return out;
}

function stripTrailingCommas(raw: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    if (inString) {
      out += ch;
      if (ch === "\\") {
        i += 1;
        if (i < raw.length) {
          out += raw[i]!;
        }
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === ",") {
      let j = i + 1;
      while (j < raw.length && /\s/.test(raw[j]!)) {
        j += 1;
      }
      if (raw[j] === "}" || raw[j] === "]") {
        continue;
      }
    }
    out += ch;
  }
  return out;
}
