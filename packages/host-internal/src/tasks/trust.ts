import { createHash } from "node:crypto";

import {
  findPermanentWorkspaceCapabilityTrust,
  hasSessionCapabilityAllow,
  hasSessionCapabilityDeny,
  type WorkspaceTaskTrustListEntry,
} from "../hooks/trust.js";
import { normalizeTaskFile, type LoadedTaskFile, type NormalizedTask } from "./schema.js";

const WORKSPACE_CONTROLLED_KINDS = new Set<LoadedTaskFile["sourceKind"]>([
  "workspace",
  "vscode-compat",
]);

// The hash covers the exact file bytes (rawText), so JSONC comments and formatting changes
// re-prompt even when the parsed task set is unchanged. The source kind stands in for the
// path so the hash does not depend on how the workspace root was spelled (symlinks,
// canonicalization); the two workspace-controlled sources always have distinct kinds.
export function computeWorkspaceTasksContentHash(files: LoadedTaskFile[]): string {
  const controlled = files
    .filter((file) => WORKSPACE_CONTROLLED_KINDS.has(file.sourceKind))
    .sort((left, right) => sourceRank(left.sourceKind) - sourceRank(right.sourceKind));
  const hash = createHash("sha256");
  for (const file of controlled) {
    hash.update(file.sourceKind);
    hash.update("\0");
    hash.update(file.rawText);
    hash.update("\0");
  }
  return hash.digest("hex");
}

function sourceRank(sourceKind: LoadedTaskFile["sourceKind"]): number {
  return sourceKind === "workspace" ? 0 : 1;
}

export function listWorkspaceTaskTrustEntries(
  files: LoadedTaskFile[],
): WorkspaceTaskTrustListEntry[] {
  const entries: WorkspaceTaskTrustListEntry[] = [];
  for (const file of files.filter((file) => WORKSPACE_CONTROLLED_KINDS.has(file.sourceKind))) {
    const normalized = normalizeTaskFile(file.json);
    if (normalized === undefined) {
      continue;
    }
    for (const task of normalized.tasks) {
      entries.push({
        label: task.label,
        command: trustDisplayCommand(task),
        sourcePath: file.path,
      });
    }
  }
  return entries;
}

function trustDisplayCommand(task: NormalizedTask): string {
  const command = task.command;
  const base =
    command === undefined
      ? ""
      : typeof command === "string"
        ? command
        : Array.isArray(command)
          ? command.join(" ")
          : command.value;
  const args = (task.args ?? []).map((arg) => (typeof arg === "string" ? arg : arg.value));
  return [base, ...args].filter((part) => part.length > 0).join(" ");
}

export type WorkspaceTasksTrustGateResult =
  | { status: "noWorkspaceFiles" }
  | { status: "allow"; contentHash: string; hashChanged: boolean }
  | { status: "denied" }
  | {
      status: "needsPrompt";
      tasks: {
        contentHash: string;
        hashChanged: boolean;
        items: WorkspaceTaskTrustListEntry[];
      };
    };

export async function evaluateWorkspaceTasksTrustGate(options: {
  spiritDataDir: string;
  workspaceRoot: string | undefined;
  files: LoadedTaskFile[];
}): Promise<WorkspaceTasksTrustGateResult> {
  const workspaceRoot = options.workspaceRoot?.trim();
  const files = options.files.filter((file) => WORKSPACE_CONTROLLED_KINDS.has(file.sourceKind));
  if (!workspaceRoot || files.length === 0) {
    return { status: "noWorkspaceFiles" };
  }
  const contentHash = computeWorkspaceTasksContentHash(files);
  const permanent = await findPermanentWorkspaceCapabilityTrust(
    options.spiritDataDir,
    "tasks",
    workspaceRoot,
  );
  const hashChanged = Boolean(permanent && permanent.contentHash !== contentHash);

  if (permanent && permanent.contentHash === contentHash) {
    return { status: "allow", contentHash, hashChanged: false };
  }
  if (hasSessionCapabilityAllow("tasks", workspaceRoot, contentHash)) {
    return { status: "allow", contentHash, hashChanged };
  }
  if (hasSessionCapabilityDeny("tasks", workspaceRoot, contentHash)) {
    return { status: "denied" };
  }

  return {
    status: "needsPrompt",
    tasks: {
      contentHash,
      hashChanged,
      items: listWorkspaceTaskTrustEntries(files),
    },
  };
}
