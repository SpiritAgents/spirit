import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  HOOK_EVENT_NAMES,
  resolveHookCommandPath,
  type HookEventName,
  type ResolvedHookDefinition,
} from "@spiritagent/agent-core";

import type { LoadedHooksConfig } from "./loader.js";

export const WORKSPACE_CAPABILITY_TRUST_FILE = "workspace-capability-trust.json";
export const WORKSPACE_CAPABILITY_TRUST_VERSION = 1 as const;

export type WorkspaceCapabilityKind = "hooks" | "tasks";

export type WorkspaceCapabilityTrustDecision = "allowOnce" | "deny" | "alwaysTrust";

export interface WorkspaceHookTrustListEntry {
  event: HookEventName;
  command: string;
  resolvedPath: string;
}

export interface WorkspaceTaskTrustListEntry {
  label: string;
  command: string;
  sourcePath: string;
}

export interface WorkspaceCapabilityTrustRequest {
  workspaceRoot: string;
  contentHash: string;
  /** True when a permanent record exists for this root but hash no longer matches. */
  hashChanged: boolean;
  hooks: WorkspaceHookTrustListEntry[];
  /** Present when the prompt is for the tasks capability instead of hooks. */
  tasks?: {
    contentHash: string;
    hashChanged: boolean;
    items: WorkspaceTaskTrustListEntry[];
  };
}

export interface WorkspaceCapabilityTrustRecord {
  workspaceRoot: string;
  contentHash: string;
  decision: "allow";
  decidedAt: string;
}

export interface WorkspaceCapabilityTrustStoreFile {
  version: typeof WORKSPACE_CAPABILITY_TRUST_VERSION;
  hooks: WorkspaceCapabilityTrustRecord[];
  /** Optional on disk: files written before the tasks capability have no `tasks` key. */
  tasks?: WorkspaceCapabilityTrustRecord[];
}

export type RequestWorkspaceCapabilityTrust = (
  request: WorkspaceCapabilityTrustRequest,
) => Promise<WorkspaceCapabilityTrustDecision>;

const sessionAllow = new Map<string, string>();
const sessionDeny = new Map<string, string>();

export function workspaceCapabilityTrustPath(spiritDataDir: string): string {
  return join(spiritDataDir, WORKSPACE_CAPABILITY_TRUST_FILE);
}

export function canonicalizeWorkspaceRoot(workspaceRoot: string): string {
  const trimmed = workspaceRoot.trim();
  if (!trimmed) {
    return trimmed;
  }
  try {
    return realpathSync.native(trimmed);
  } catch {
    return trimmed;
  }
}

function sessionKey(kind: WorkspaceCapabilityKind, workspaceRoot: string): string {
  return `${kind}\0${canonicalizeWorkspaceRoot(workspaceRoot)}`;
}

export function clearWorkspaceCapabilityTrustSessionForTests(): void {
  sessionAllow.clear();
  sessionDeny.clear();
}

export function listWorkspaceHookTrustEntries(
  loaded: LoadedHooksConfig,
): WorkspaceHookTrustListEntry[] {
  if (!loaded.workspaceConfigDir) {
    return [];
  }
  const entries: WorkspaceHookTrustListEntry[] = [];
  for (const event of HOOK_EVENT_NAMES) {
    for (const entry of loaded.workspace.hooks[event] ?? []) {
      let resolvedPath = entry.command;
      try {
        resolvedPath = resolveHookCommandPath({
          ...entry,
          scope: "workspace",
          configDir: loaded.workspaceConfigDir,
          ...(entry.timeout !== undefined ? { timeout: entry.timeout } : {}),
        });
      } catch {
        // Keep command string when path escapes / cannot resolve.
      }
      entries.push({
        event,
        command: entry.command,
        resolvedPath,
      });
    }
  }
  return entries;
}

export function computeWorkspaceHooksContentHash(loaded: LoadedHooksConfig): string | undefined {
  const entries = listWorkspaceHookTrustEntries(loaded);
  if (entries.length === 0) {
    return undefined;
  }

  const hash = createHash("sha256");
  hash.update(JSON.stringify(loaded.workspace));
  for (const entry of entries) {
    hash.update("\0");
    hash.update(entry.event);
    hash.update("\0");
    hash.update(entry.command);
    hash.update("\0");
    hash.update(entry.resolvedPath);
    hash.update("\0");
    if (existsSync(entry.resolvedPath)) {
      try {
        hash.update(readFileSync(entry.resolvedPath));
      } catch {
        hash.update("<unreadable>");
      }
    } else {
      hash.update("<missing>");
    }
  }
  return hash.digest("hex");
}

export async function loadWorkspaceCapabilityTrustStore(
  spiritDataDir: string,
): Promise<WorkspaceCapabilityTrustStoreFile> {
  const empty: WorkspaceCapabilityTrustStoreFile = {
    version: WORKSPACE_CAPABILITY_TRUST_VERSION,
    hooks: [],
    tasks: [],
  };
  const filePath = workspaceCapabilityTrustPath(spiritDataDir);
  if (!existsSync(filePath)) {
    return empty;
  }
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<WorkspaceCapabilityTrustStoreFile>;
    return {
      version: WORKSPACE_CAPABILITY_TRUST_VERSION,
      hooks: normalizeTrustRecords(parsed.hooks),
      tasks: normalizeTrustRecords(parsed.tasks),
    };
  } catch {
    return empty;
  }
}

function normalizeTrustRecords(value: unknown): WorkspaceCapabilityTrustRecord[] {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is WorkspaceCapabilityTrustRecord =>
          typeof entry?.workspaceRoot === "string" &&
          typeof entry?.contentHash === "string" &&
          entry.decision === "allow" &&
          typeof entry?.decidedAt === "string",
      )
    : [];
}

export async function saveWorkspaceCapabilityTrustStore(
  spiritDataDir: string,
  store: WorkspaceCapabilityTrustStoreFile,
): Promise<void> {
  const filePath = workspaceCapabilityTrustPath(spiritDataDir);
  await mkdir(spiritDataDir, { recursive: true });
  await writeFile(filePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

function recordsForKind(
  store: WorkspaceCapabilityTrustStoreFile,
  kind: WorkspaceCapabilityKind,
): WorkspaceCapabilityTrustRecord[] {
  return kind === "hooks" ? store.hooks : (store.tasks ?? []);
}

function withKindRecords(
  store: WorkspaceCapabilityTrustStoreFile,
  kind: WorkspaceCapabilityKind,
  records: WorkspaceCapabilityTrustRecord[],
): WorkspaceCapabilityTrustStoreFile {
  return kind === "hooks"
    ? { version: store.version, hooks: records, tasks: store.tasks ?? [] }
    : { version: store.version, hooks: store.hooks, tasks: records };
}

export async function findPermanentWorkspaceCapabilityTrust(
  spiritDataDir: string,
  kind: WorkspaceCapabilityKind,
  workspaceRoot: string,
): Promise<WorkspaceCapabilityTrustRecord | undefined> {
  const root = canonicalizeWorkspaceRoot(workspaceRoot);
  const store = await loadWorkspaceCapabilityTrustStore(spiritDataDir);
  return recordsForKind(store, kind).find(
    (entry) => canonicalizeWorkspaceRoot(entry.workspaceRoot) === root,
  );
}

export async function persistPermanentWorkspaceCapabilityTrust(
  spiritDataDir: string,
  kind: WorkspaceCapabilityKind,
  workspaceRoot: string,
  contentHash: string,
): Promise<void> {
  const root = canonicalizeWorkspaceRoot(workspaceRoot);
  const store = await loadWorkspaceCapabilityTrustStore(spiritDataDir);
  const next: WorkspaceCapabilityTrustRecord = {
    workspaceRoot: root,
    contentHash,
    decision: "allow",
    decidedAt: new Date().toISOString(),
  };
  const records = recordsForKind(store, kind).filter(
    (entry) => canonicalizeWorkspaceRoot(entry.workspaceRoot) !== root,
  );
  records.push(next);
  await saveWorkspaceCapabilityTrustStore(spiritDataDir, withKindRecords(store, kind, records));
}

export async function findPermanentWorkspaceHooksTrust(
  spiritDataDir: string,
  workspaceRoot: string,
): Promise<WorkspaceCapabilityTrustRecord | undefined> {
  return findPermanentWorkspaceCapabilityTrust(spiritDataDir, "hooks", workspaceRoot);
}

export async function persistPermanentWorkspaceHooksTrust(
  spiritDataDir: string,
  workspaceRoot: string,
  contentHash: string,
): Promise<void> {
  return persistPermanentWorkspaceCapabilityTrust(
    spiritDataDir,
    "hooks",
    workspaceRoot,
    contentHash,
  );
}

export function rememberSessionCapabilityAllow(
  kind: WorkspaceCapabilityKind,
  workspaceRoot: string,
  contentHash: string,
): void {
  sessionAllow.set(sessionKey(kind, workspaceRoot), contentHash);
}

export function hasSessionCapabilityAllow(
  kind: WorkspaceCapabilityKind,
  workspaceRoot: string,
  contentHash: string,
): boolean {
  return sessionAllow.get(sessionKey(kind, workspaceRoot)) === contentHash;
}

// Deny is remembered per content hash so ambient/eventual re-evaluations do not spam
// prompts; an actual content change re-prompts.
export function rememberSessionCapabilityDeny(
  kind: WorkspaceCapabilityKind,
  workspaceRoot: string,
  contentHash: string,
): void {
  sessionDeny.set(sessionKey(kind, workspaceRoot), contentHash);
}

export function hasSessionCapabilityDeny(
  kind: WorkspaceCapabilityKind,
  workspaceRoot: string,
  contentHash: string,
): boolean {
  return sessionDeny.get(sessionKey(kind, workspaceRoot)) === contentHash;
}

export function rememberSessionWorkspaceHooksAllow(
  workspaceRoot: string,
  contentHash: string,
): void {
  rememberSessionCapabilityAllow("hooks", workspaceRoot, contentHash);
}

export function hasSessionWorkspaceHooksAllow(workspaceRoot: string, contentHash: string): boolean {
  return hasSessionCapabilityAllow("hooks", workspaceRoot, contentHash);
}

export function rememberSessionWorkspaceHooksDeny(
  workspaceRoot: string,
  contentHash: string,
): void {
  rememberSessionCapabilityDeny("hooks", workspaceRoot, contentHash);
}

export type WorkspaceHooksTrustGateResult =
  | { status: "noWorkspaceHooks" }
  | { status: "allow"; contentHash: string; hashChanged: boolean }
  | { status: "denied" }
  | {
      status: "needsPrompt";
      request: WorkspaceCapabilityTrustRequest;
    };

export async function evaluateWorkspaceHooksTrustGate(options: {
  spiritDataDir: string;
  workspaceRoot: string | undefined;
  loaded: LoadedHooksConfig;
}): Promise<WorkspaceHooksTrustGateResult> {
  const workspaceRoot = options.workspaceRoot?.trim();
  if (!workspaceRoot || !options.loaded.workspaceConfigDir) {
    return { status: "noWorkspaceHooks" };
  }
  const contentHash = computeWorkspaceHooksContentHash(options.loaded);
  if (!contentHash) {
    return { status: "noWorkspaceHooks" };
  }

  const hooks = listWorkspaceHookTrustEntries(options.loaded);
  const permanent = await findPermanentWorkspaceHooksTrust(options.spiritDataDir, workspaceRoot);
  const hashChanged = Boolean(permanent && permanent.contentHash !== contentHash);

  if (permanent && permanent.contentHash === contentHash) {
    return { status: "allow", contentHash, hashChanged: false };
  }
  if (hasSessionWorkspaceHooksAllow(workspaceRoot, contentHash)) {
    return { status: "allow", contentHash, hashChanged };
  }
  if (hasSessionCapabilityDeny("hooks", workspaceRoot, contentHash)) {
    return { status: "denied" };
  }

  return {
    status: "needsPrompt",
    request: {
      workspaceRoot: canonicalizeWorkspaceRoot(workspaceRoot),
      contentHash,
      hashChanged,
      hooks,
    },
  };
}

export async function applyWorkspaceCapabilityTrustDecision(options: {
  spiritDataDir: string;
  workspaceRoot: string;
  contentHash: string;
  decision: WorkspaceCapabilityTrustDecision;
  kind?: WorkspaceCapabilityKind;
}): Promise<"allow" | "deny"> {
  const kind = options.kind ?? "hooks";
  if (options.decision === "deny") {
    rememberSessionCapabilityDeny(kind, options.workspaceRoot, options.contentHash);
    return "deny";
  }
  if (options.decision === "alwaysTrust") {
    await persistPermanentWorkspaceCapabilityTrust(
      options.spiritDataDir,
      kind,
      options.workspaceRoot,
      options.contentHash,
    );
  }
  rememberSessionCapabilityAllow(kind, options.workspaceRoot, options.contentHash);
  return "allow";
}

export async function applyWorkspaceTasksTrustDecision(options: {
  spiritDataDir: string;
  workspaceRoot: string;
  contentHash: string;
  decision: WorkspaceCapabilityTrustDecision;
}): Promise<"allow" | "deny"> {
  return applyWorkspaceCapabilityTrustDecision({ ...options, kind: "tasks" });
}

export function filterDefinitionsByWorkspaceTrust(
  definitions: ResolvedHookDefinition[],
  workspaceAllowed: boolean,
): ResolvedHookDefinition[] {
  if (workspaceAllowed) {
    return definitions;
  }
  return definitions.filter((definition) => definition.scope !== "workspace");
}
