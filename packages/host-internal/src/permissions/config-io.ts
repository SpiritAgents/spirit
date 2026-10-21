/**
 * Load / save of the `permission` field in `config.json`, with validation +
 * lint warnings. Invalid entries are dropped (never fatal), and every drop
 * or semantic caveat produces a human-readable warning for the host UI.
 *
 * read_file patterns are normalized at load time (see
 * `normalizeReadFilePattern`) so evaluation works on canonical forms.
 */
import { statSync } from "node:fs";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname } from "node:path";

import { emptyModelRef, SPIRIT_CONFIG_SCHEMA_VERSION } from "../config.js";
import { configFilePath, loadSpiritConfig } from "../credentials/spirit-config.js";
import type { SpiritConfigFile } from "../config.js";
import type {
  PermissionConfig,
  PermissionDomainRules,
  PermissionRuleAction,
} from "../credentials/types.js";

export interface PermissionConfigLoadResult {
  config: PermissionConfig;
  warnings: string[];
}

const RULE_ACTIONS: ReadonlySet<string> = new Set(["allow", "ask", "deny"]);

/** Domains this version evaluates; unknown domains are ignored with a warning. */
const KNOWN_DOMAINS: ReadonlySet<string> = new Set(["shell", "read_file"]);

export function loadPermissionConfig(spiritDataDir: string): PermissionConfigLoadResult {
  const warnings: string[] = [];
  const config: PermissionConfig = {};

  const raw = loadSpiritConfig(spiritDataDir);
  const permission: unknown = raw?.["permission"];
  if (permission === undefined) {
    return { config, warnings };
  }
  if (!isPlainRecord(permission)) {
    warnings.push(
      `permission: expected an object mapping domains to rules, got ${describeValue(permission)}; dropping all permission rules`,
    );
    return { config, warnings };
  }

  for (const [domain, domainRules] of Object.entries(permission)) {
    if (!KNOWN_DOMAINS.has(domain)) {
      warnings.push(
        `permission: unknown domain ${JSON.stringify(domain)}; ignoring its rules (this version does not evaluate it)`,
      );
      continue;
    }
    if (!isPlainRecord(domainRules)) {
      warnings.push(
        `permission.${domain}: expected an object mapping patterns to actions, got ${describeValue(domainRules)}; dropping the domain`,
      );
      continue;
    }

    const rules: PermissionDomainRules = {};
    for (const [pattern, actionRaw] of Object.entries(domainRules)) {
      if (pattern.trim() === "") {
        warnings.push(`permission.${domain}: dropping an empty / whitespace-only pattern`);
        continue;
      }
      if (typeof actionRaw !== "string" || !RULE_ACTIONS.has(actionRaw)) {
        warnings.push(
          `permission.${domain}: pattern ${JSON.stringify(pattern)} has invalid action ${JSON.stringify(actionRaw)}; dropping the rule (expected "allow" | "ask" | "deny")`,
        );
        continue;
      }
      let normalizedPattern = pattern;
      if (domain === "read_file") {
        const normalized = normalizeReadFilePattern(pattern);
        normalizedPattern = normalized.pattern;
        if (normalized.warning !== undefined) {
          warnings.push(normalized.warning);
        }
      }
      rules[normalizedPattern] = actionRaw as PermissionRuleAction;
    }
    (config as Record<string, PermissionDomainRules>)[domain] = rules;
  }

  return { config, warnings };
}

export interface NormalizedReadFilePattern {
  pattern: string;
  warning?: string | undefined;
}

/**
 * Normalizes a read_file pattern once at load time:
 * - `~` or `~/...` expands to the user's home directory.
 * - Absolute patterns (POSIX `/`, Windows drive letter or UNC) are kept as-is
 *   and match canonical absolute paths at evaluation time.
 * - Relative patterns are kept relative: they get workspace-relative
 *   semantics at evaluation time, so a warning notes they only match inside
 *   the workspace.
 * - Patterns containing `.` / `..` path segments can never match a canonical
 *   path (realpath output has no such segments, and the matcher treats them
 *   literally); kept but flagged.
 */
export function normalizeReadFilePattern(pattern: string): NormalizedReadFilePattern {
  let normalized = pattern;
  if (pattern === "~" || pattern.startsWith("~/") || pattern.startsWith("~\\")) {
    normalized = homedir() + pattern.slice(1);
  }

  const segments = normalized.replace(/\\/gu, "/").split("/");
  if (segments.some((segment) => segment === "." || segment === "..")) {
    return {
      pattern: normalized,
      warning: `permission.read_file: pattern ${JSON.stringify(pattern)} contains "." or ".." segments and can never match a canonical path; keeping it anyway`,
    };
  }
  if (!isAbsolutePathPattern(normalized)) {
    return {
      pattern: normalized,
      warning: `permission.read_file: pattern ${JSON.stringify(pattern)} is relative; it only matches paths inside the workspace`,
    };
  }
  return { pattern: normalized };
}

/**
 * Absolute path form: POSIX root, Windows drive letter, UNC share, or a
 * leading wildcard. A leading `*` absorbs the root separator because the
 * matcher lets `*` cross `/`, so star-leading patterns match canonical
 * absolute paths directly instead of being workspace-relative.
 */
export function isAbsolutePathPattern(pattern: string): boolean {
  return (
    pattern.startsWith("*") ||
    pattern.startsWith("/") ||
    pattern.startsWith("\\\\") ||
    /^[a-zA-Z]:[\\/]/u.test(pattern)
  );
}

/**
 * mtime-based reload cache (the repo has no fs-watch mechanism; this is the
 * hot-reload substitute). Records `statSync(configFile).mtimeMs` at load,
 * re-stats on each call, and only re-reads when the mtime changed. If the
 * stat fails (file deleted / unreadable), the last cached snapshot keeps
 * being served.
 */
export function createPermissionConfigLoader(
  spiritDataDir: string,
): () => PermissionConfigLoadResult {
  const filePath = configFilePath(spiritDataDir);
  let cached: PermissionConfigLoadResult | undefined;
  let cachedMtimeMs: number | undefined;

  return () => {
    let mtimeMs: number | undefined;
    try {
      mtimeMs = statSync(filePath).mtimeMs;
    } catch {
      mtimeMs = undefined;
    }
    if (cached !== undefined && (mtimeMs === undefined || mtimeMs === cachedMtimeMs)) {
      return cached;
    }
    cached = loadPermissionConfig(spiritDataDir);
    cachedMtimeMs = mtimeMs;
    return cached;
  };
}

/**
 * Sets one rule (`permission[domain][pattern] = action`) in `config.json`,
 * preserving every other config field untouched, and writes it ATOMICALLY:
 * a tmp file in the same directory is renamed over the target, so a crash
 * mid-write cannot leave a truncated config (same pattern as
 * `saveStoredSession` in apps/desktop/src/host/storage.ts).
 */
export async function savePermissionRule(
  spiritDataDir: string,
  domain: "shell" | "read_file",
  pattern: string,
  action: PermissionRuleAction,
): Promise<void> {
  const existing = loadSpiritConfig(spiritDataDir);
  const config: SpiritConfigFile = existing ?? {
    schemaVersion: SPIRIT_CONFIG_SCHEMA_VERSION,
    providers: [],
    activeModel: emptyModelRef(),
  };

  // Invalid pre-existing `permission` / domain data is replaced rather than
  // merged; load-time validation would drop it anyway.
  const rawPermission: unknown = config["permission"];
  const permission: Record<string, unknown> = isPlainRecord(rawPermission)
    ? { ...rawPermission }
    : {};
  const rawDomainRules: unknown = permission[domain];
  const domainRules: Record<string, unknown> = isPlainRecord(rawDomainRules)
    ? { ...rawDomainRules }
    : {};
  domainRules[pattern] = action;
  permission[domain] = domainRules;

  const next: SpiritConfigFile = {
    ...config,
    permission: permission as unknown as PermissionConfig,
  };

  const filePath = configFilePath(spiritDataDir);
  await mkdir(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(tmpPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    await rename(tmpPath, filePath);
  } catch (error) {
    await unlink(tmpPath).catch(() => {});
    throw error;
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeValue(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "an array";
  }
  return typeof value;
}
