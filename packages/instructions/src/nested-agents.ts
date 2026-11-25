import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type {
  NestedAgentsNotification,
  NestedAgentsToolCallInput,
  NestedAgentsTrackerPort,
} from "@spiritagent/agent-core";
import {
  createPermissionConfigLoader,
  evaluateReadFilePermission,
  type PermissionConfigLoadResult,
} from "@spiritagent/permissions";
import { splitShellCommandLine } from "@spiritagent/permissions/shell-split";

import { stablePathId, WORKSPACE_RULE_FILE_NAME } from "./storage.js";

const LS_CHILD_SKIP_DIRS = new Set([".git", "node_modules"]);
const TOOLCHAIN_BIN_DIR_NAMES = new Set(["bin", "sbin", ".bin"]);
const URL_SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//iu;
const GLOB_META_RE = /[*?[\]{}!]/u;
const ENV_ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=/u;

export interface SystemInjectedAgentsRule {
  path: string;
  content: string;
}

export interface CreateNestedAgentsTrackerOptions {
  workspaceRoot: string;
  spiritDataDir?: string;
  /** Returns currently-enabled AGENTS.md rules present in the system prompt. */
  getSystemInjectedAgentsRules?: () => readonly SystemInjectedAgentsRule[];
  /** Returns paths of AGENTS.md rules explicitly disabled by the user (e.g. Settings > Rules). */
  getDisabledAgentsPaths?: () => readonly string[];
  /** Optional override for read_file deny checks (defaults to permission.read_file rules in spiritDataDir). */
  isPathDenied?: (canonicalPath: string) => boolean;
}

export interface DiscoveredAgentsFile {
  canonicalKey: string;
  displayPath: string;
  sha256: string;
}

function normalizeSlash(filePath: string): string {
  return filePath.replace(/\\/gu, "/");
}

function sha256Hex(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

function isAgentsFilePath(filePath: string): boolean {
  const base = path.basename(filePath);
  if (process.platform === "win32" || process.platform === "darwin") {
    return base.toLowerCase() === WORKSPACE_RULE_FILE_NAME.toLowerCase();
  }
  return base === WORKSPACE_RULE_FILE_NAME;
}

async function canonicalPathKey(filePath: string): Promise<string> {
  return stablePathId(filePath);
}

async function tryStat(targetPath: string) {
  try {
    return await stat(targetPath);
  } catch {
    return undefined;
  }
}

async function readAgentsFileAt(
  filePath: string,
  isDenied: (canonicalPath: string) => boolean,
): Promise<DiscoveredAgentsFile | undefined> {
  const st = await tryStat(filePath);
  if (!st || !st.isFile()) {
    return undefined;
  }

  const canonicalKey = await canonicalPathKey(filePath);
  if (isDenied(canonicalKey)) {
    return undefined;
  }

  let bytes: Buffer;
  try {
    bytes = await readFile(filePath);
  } catch {
    return undefined;
  }

  return {
    canonicalKey,
    displayPath: path.resolve(filePath),
    sha256: sha256Hex(bytes),
  };
}

/**
 * Walk upward from `startDir` all the way to the filesystem root, collecting every
 * readable `AGENTS.md` file in closest-first order.
 */
async function walkAncestorsForAgentsFiles(
  startDir: string,
  visitedDirs: Set<string>,
  isDenied: (canonicalPath: string) => boolean,
): Promise<DiscoveredAgentsFile[]> {
  const found: DiscoveredAgentsFile[] = [];
  let current = path.resolve(startDir);

  while (true) {
    const dirKey = normalizeSlash(current);
    if (visitedDirs.has(dirKey)) {
      break;
    }
    visitedDirs.add(dirKey);

    const candidate = path.join(current, WORKSPACE_RULE_FILE_NAME);
    const file = await readAgentsFileAt(candidate, isDenied);
    if (file) {
      found.push(file);
    }

    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return found;
}

/**
 * Scan only direct first-level child subdirectories of `dir` for `AGENTS.md` (non-recursive).
 */
async function scanDirectChildSubdirsForAgentsFiles(
  dir: string,
  isDenied: (canonicalPath: string) => boolean,
): Promise<DiscoveredAgentsFile[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const childNames = entries
    .map((entry) => entry.name)
    .filter((name) => !LS_CHILD_SKIP_DIRS.has(name))
    .sort((left, right) => left.localeCompare(right));

  const found: DiscoveredAgentsFile[] = [];
  for (const name of childNames) {
    const childDir = path.join(dir, name);
    const childStat = await tryStat(childDir);
    if (!childStat || !childStat.isDirectory()) {
      continue;
    }
    const file = await readAgentsFileAt(path.join(childDir, WORKSPACE_RULE_FILE_NAME), isDenied);
    if (file) {
      found.push(file);
    }
  }

  return found;
}

/** Extract leading static directory segments from a glob pattern (before the first wildcard). */
export function extractStaticPrefixFromGlob(pattern: string): string | undefined {
  const normalized = pattern
    .trim()
    .replace(/\\/gu, "/")
    .replace(/^\.\/+/u, "");
  if (!normalized || normalized.startsWith("!")) {
    return undefined;
  }

  const segments = normalized.split("/");
  const staticSegments: string[] = [];
  for (const segment of segments) {
    if (!segment) {
      continue;
    }
    if (GLOB_META_RE.test(segment)) {
      break;
    }
    staticSegments.push(segment);
  }

  if (staticSegments.length === 0) {
    return undefined;
  }

  return staticSegments.join("/");
}

/** Parse workspace-relative matched file paths from `glob` tool raw output. */
function parseGlobMatchedRelativePaths(rawOutput: string): string[] {
  const separatorIndex = rawOutput.indexOf("\n\n");
  if (separatorIndex < 0) {
    return [];
  }
  const body = rawOutput.slice(separatorIndex + 2);
  const paths: string[] = [];
  for (const line of body.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === "No files matched") {
      continue;
    }
    paths.push(trimmed);
  }
  return paths;
}

/** Parse workspace-relative matched file paths from `grep` tool raw output across all 3 modes. */
function parseGrepMatchedRelativePaths(rawOutput: string, outputMode?: string): string[] {
  const trimmedAll = rawOutput.trim();
  if (!trimmedAll || trimmedAll === "No matches found") {
    return [];
  }

  const candidates = new Set<string>();
  for (const line of rawOutput.split(/\r?\n/u)) {
    if (!line || line === "--" || line.startsWith("[truncated] ")) {
      continue;
    }

    if (outputMode === "files_with_matches") {
      const candidate = line.trim();
      if (candidate) {
        candidates.add(candidate);
      }
      continue;
    }

    if (outputMode === "count_matches") {
      const lastColon = line.lastIndexOf(":");
      if (lastColon > 0) {
        candidates.add(line.slice(0, lastColon));
      }
      continue;
    }

    // Content mode: match lines use `:` (`<path>:<line>:<text>` or `<path>:<text>`); context
    // lines use `-` (`<path>-<line>-<text>` or `<path>-<text>`). Always prefer `:` before `-`
    // so hyphenated paths like `packages/lib-2-utils/issue-123-fix.ts` are never truncated at `-`.
    const colonNumbered = /^(.+?):\d+:/u.exec(line);
    if (colonNumbered?.[1]) {
      candidates.add(colonNumbered[1]);
      continue;
    }

    const firstColon = line.indexOf(":");
    if (firstColon > 0) {
      candidates.add(line.slice(0, firstColon));
    }

    // Context lines (`<path>-<line>-<text>`): collect every `-<digits>-` prefix so callers
    // checking existence on disk match the full hyphenated path rather than an inner segment.
    for (const match of line.matchAll(/-\d+-/gu)) {
      if (match.index !== undefined && match.index > 0) {
        candidates.add(line.slice(0, match.index));
      }
    }
  }

  return [...candidates];
}

function expandHomeDir(token: string): string {
  if (token === "~") {
    return os.homedir();
  }
  if (token.startsWith("~/") || token.startsWith("~\\")) {
    return path.join(os.homedir(), token.slice(2));
  }
  return token;
}

/**
 * Tokenize one simple shell command segment into unquoted words, splitting attached
 * redirection prefixes (e.g. `>packages/a/out.txt` -> `packages/a/out.txt`).
 */
function tokenizeShellSegment(segment: string): string[] {
  const words: string[] = [];
  let current = "";
  let hasToken = false;

  const flush = (): void => {
    if (hasToken) {
      words.push(current);
      current = "";
      hasToken = false;
    }
  };

  let i = 0;
  while (i < segment.length) {
    const ch = segment[i]!;

    if (/\s/u.test(ch)) {
      flush();
      i += 1;
      continue;
    }

    if (ch === "'" || ch === '"') {
      hasToken = true;
      const quote = ch;
      i += 1;
      while (i < segment.length && segment[i] !== quote) {
        if (quote === '"' && segment[i] === "\\" && i + 1 < segment.length) {
          current += segment[i + 1]!;
          i += 2;
          continue;
        }
        current += segment[i]!;
        i += 1;
      }
      if (i < segment.length && segment[i] === quote) {
        i += 1;
      }
      continue;
    }

    if (ch === "\\" && i + 1 < segment.length) {
      hasToken = true;
      current += segment[i + 1]!;
      i += 2;
      continue;
    }

    if (ch === ">" || ch === "<") {
      flush();
      i += 1;
      if (i < segment.length && (segment[i] === ">" || segment[i] === "<" || segment[i] === "&")) {
        i += 1;
      }
      continue;
    }

    // Handle fd-prefixed redirections like `2>foo/bar` when at word start.
    if (!hasToken && /[0-9]/u.test(ch) && (segment[i + 1] === ">" || segment[i + 1] === "<")) {
      i += 2;
      if (i < segment.length && (segment[i] === ">" || segment[i] === "&")) {
        i += 1;
      }
      continue;
    }

    hasToken = true;
    current += ch;
    i += 1;
  }

  flush();
  return words;
}

function hasPathLikeSyntax(rawToken: string): boolean {
  return (
    rawToken.includes("/") ||
    rawToken.includes("\\") ||
    rawToken === "." ||
    rawToken === ".." ||
    rawToken === "~"
  );
}

async function resolveCandidateToDirectory(
  rawToken: string,
  currentCwd: string,
): Promise<string | undefined> {
  const trimmed = rawToken.trim();
  if (!trimmed || URL_SCHEME_RE.test(trimmed)) {
    return undefined;
  }

  const expanded = expandHomeDir(trimmed);
  const resolved = path.isAbsolute(expanded)
    ? path.resolve(expanded)
    : path.resolve(currentCwd, expanded);

  const existing = await tryStat(resolved);
  if (existing) {
    return existing.isDirectory() ? resolved : path.dirname(resolved);
  }

  // For non-existent paths (e.g. `touch packages/a/new.ts` or `mkdir -p packages/a/b/c`),
  // accept only explicit path-like tokens anchored under an existing directory so arbitrary
  // slash-bearing strings like `application/json` or `origin/main` do not false-match.
  if (!hasPathLikeSyntax(trimmed)) {
    return undefined;
  }

  if (path.isAbsolute(expanded)) {
    const parent = path.dirname(resolved);
    const parentStat = await tryStat(parent);
    return parentStat?.isDirectory() ? parent : undefined;
  }

  // Relative non-existent path: require that its leading path segment exists in currentCwd,
  // then walk up from dirname(resolved) to the nearest existing directory.
  const firstSegment = expanded.replace(/\\/gu, "/").split("/")[0];
  if (!firstSegment || firstSegment === "." || firstSegment === "..") {
    const parent = path.dirname(resolved);
    const parentStat = await tryStat(parent);
    return parentStat?.isDirectory() ? parent : undefined;
  }
  const anchor = path.resolve(currentCwd, firstSegment);
  const anchorStat = await tryStat(anchor);
  if (!anchorStat) {
    return undefined;
  }

  let cursor = path.dirname(resolved);
  while (true) {
    const st = await tryStat(cursor);
    if (st?.isDirectory()) {
      return cursor;
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) {
      return undefined;
    }
    cursor = parent;
  }
}

/**
 * Extract valid directories referenced by a shell command string (tracking `cd` / `pushd`
 * across chained segments and inspecting path-like command and argument tokens).
 */
export async function extractDirectoriesFromShellCommand(
  command: string,
  workspaceRoot: string,
): Promise<string[]> {
  const split = splitShellCommandLine(command);
  const segments = split.ok
    ? split.segments
    : command
        .split(/(?:&&|\|\||[;\n|])/u)
        .map((part) => part.trim())
        .filter(Boolean);

  let currentCwd = path.resolve(workspaceRoot);
  const directories: string[] = [];
  const seenDirs = new Set<string>();

  const pushDir = (dir: string): void => {
    const key = normalizeSlash(path.resolve(dir));
    if (!seenDirs.has(key)) {
      seenDirs.add(key);
      directories.push(path.resolve(dir));
    }
  };

  for (const segment of segments) {
    const words = tokenizeShellSegment(segment);
    let idx = 0;
    while (idx < words.length && ENV_ASSIGNMENT_RE.test(words[idx]!)) {
      idx += 1;
    }
    if (idx >= words.length) {
      continue;
    }

    const cmd = words[idx]!;
    const args = words.slice(idx + 1);
    const cmdLower = cmd.toLowerCase();

    if (cmdLower === "cd" || cmdLower === "pushd" || cmdLower === "set-location") {
      const targetArg = args.find((arg) => arg !== "--" && !arg.startsWith("-"));
      if (targetArg === undefined) {
        currentCwd = os.homedir();
        pushDir(currentCwd);
      } else if (targetArg !== "-") {
        const expanded = expandHomeDir(targetArg);
        const resolved = path.isAbsolute(expanded)
          ? path.resolve(expanded)
          : path.resolve(currentCwd, expanded);
        const st = await tryStat(resolved);
        if (st?.isDirectory()) {
          currentCwd = resolved;
          pushDir(currentCwd);
        }
      }
      continue;
    }

    if (hasPathLikeSyntax(cmd)) {
      const cmdDir = await resolveCandidateToDirectory(cmd, currentCwd);
      // Skip toolchain executable binaries invoked from `.../bin/<tool>` (e.g. `~/.nvm/.../bin/node`,
      // `node_modules/.bin/tsc`) at command position so invoking a runtime binary does not pull in
      // that toolchain's own repo AGENTS.md; explicit path arguments are still inspected below.
      if (cmdDir && !TOOLCHAIN_BIN_DIR_NAMES.has(path.basename(cmdDir).toLowerCase())) {
        pushDir(cmdDir);
      }
    }

    for (const arg of args) {
      if (!arg) {
        continue;
      }

      let candidate = arg;
      if (arg.startsWith("-")) {
        const eqIndex = arg.indexOf("=");
        if (eqIndex < 0 || eqIndex === arg.length - 1) {
          continue;
        }
        candidate = arg.slice(eqIndex + 1);
      }

      const dir = await resolveCandidateToDirectory(candidate, currentCwd);
      if (dir) {
        pushDir(dir);
      }
    }
  }

  return directories;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readStringField(
  record: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function resolveUserPath(workspaceRoot: string, inputPath: string): string | undefined {
  const trimmed = inputPath.trim();
  if (!trimmed || URL_SCHEME_RE.test(trimmed)) {
    return undefined;
  }
  const expanded = expandHomeDir(trimmed);
  return path.isAbsolute(expanded) ? path.resolve(expanded) : path.resolve(workspaceRoot, expanded);
}

async function resolveTargetToExistingDirectory(targetPath: string): Promise<string | undefined> {
  const st = await tryStat(targetPath);
  if (st) {
    return st.isDirectory() ? targetPath : path.dirname(targetPath);
  }
  let cursor = path.dirname(targetPath);
  while (true) {
    const parentStat = await tryStat(cursor);
    if (parentStat?.isDirectory()) {
      return cursor;
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) {
      return undefined;
    }
    cursor = parent;
  }
}

export function createNestedAgentsTracker(
  options: CreateNestedAgentsTrackerOptions,
): NestedAgentsTrackerPort {
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const permissionConfigLoader: (() => PermissionConfigLoadResult) | undefined =
    options.isPathDenied === undefined && options.spiritDataDir
      ? createPermissionConfigLoader(path.resolve(options.spiritDataDir))
      : undefined;

  const isDenied = (canonicalPath: string): boolean => {
    if (options.isPathDenied) {
      return options.isPathDenied(canonicalPath);
    }
    if (!permissionConfigLoader) {
      return false;
    }
    const { config } = permissionConfigLoader();
    const evaluation = evaluateReadFilePermission(canonicalPath, config.read_file ?? {}, {
      workspaceRoot,
    });
    return evaluation.verdict === "deny";
  };

  /** Dynamic canonicalKey -> sha256 notified or directly read/written in the current uncompacted context. */
  const contextSeen = new Map<string, string>();

  async function computeSystemBaseline(): Promise<Map<string, string>> {
    const baseline = new Map<string, string>();
    const rules = options.getSystemInjectedAgentsRules?.() ?? [];
    for (const rule of rules) {
      if (!rule.path || !isAgentsFilePath(rule.path)) {
        continue;
      }
      const key = await canonicalPathKey(rule.path);
      baseline.set(key, sha256Hex(Buffer.from(rule.content, "utf8")));
    }
    return baseline;
  }

  async function computeDisabledKeys(): Promise<Set<string>> {
    const disabled = new Set<string>();
    const paths = options.getDisabledAgentsPaths?.() ?? [];
    for (const filePath of paths) {
      if (!filePath || !isAgentsFilePath(filePath)) {
        continue;
      }
      disabled.add(await canonicalPathKey(filePath));
    }
    return disabled;
  }

  /**
   * When the model directly reads or writes an AGENTS.md file (or user attaches it via @file),
   * record its current on-disk hash so we skip a redundant self-reminder while still walking parents.
   */
  async function recordDirectAgentsFileAccess(filePath: string): Promise<string | undefined> {
    const file = await readAgentsFileAt(filePath, isDenied);
    if (file) {
      contextSeen.set(file.canonicalKey, file.sha256);
    }
    return path.dirname(path.dirname(filePath));
  }

  async function collectNotificationsFromDiscovered(
    discovered: readonly DiscoveredAgentsFile[],
  ): Promise<NestedAgentsNotification[]> {
    if (discovered.length === 0) {
      return [];
    }

    const [systemBaseline, disabledKeys] = await Promise.all([
      computeSystemBaseline(),
      computeDisabledKeys(),
    ]);

    const notifications: NestedAgentsNotification[] = [];
    const emittedInBatch = new Set<string>();

    for (const file of discovered) {
      if (emittedInBatch.has(file.canonicalKey)) {
        continue;
      }
      if (disabledKeys.has(file.canonicalKey)) {
        continue;
      }

      const prevHash = contextSeen.get(file.canonicalKey) ?? systemBaseline.get(file.canonicalKey);
      if (prevHash === file.sha256) {
        continue;
      }

      const reason = prevHash === undefined ? "new" : "updated";
      contextSeen.set(file.canonicalKey, file.sha256);
      emittedInBatch.add(file.canonicalKey);
      notifications.push({ path: file.displayPath, reason });
    }

    return notifications;
  }

  async function discoverFromDirectories(
    directories: readonly string[],
    lsFirstLevelDirs: readonly string[] = [],
  ): Promise<NestedAgentsNotification[]> {
    // Walk deepest directories first so closest-first precedence holds even when one tool call
    // touches both a parent directory and a nested descendant (e.g. `cd pkg && cat sub/file.ts`).
    const sortedDirs = [...directories]
      .map((dir, index) => ({
        dir: path.resolve(dir),
        depth: normalizeSlash(path.resolve(dir)).split("/").filter(Boolean).length,
        index,
      }))
      .sort((left, right) => right.depth - left.depth || left.index - right.index)
      .map((entry) => entry.dir);

    const visitedDirs = new Set<string>();
    const discovered: DiscoveredAgentsFile[] = [];

    for (const dir of sortedDirs) {
      const files = await walkAncestorsForAgentsFiles(dir, visitedDirs, isDenied);
      discovered.push(...files);
    }

    for (const lsDir of lsFirstLevelDirs) {
      const childFiles = await scanDirectChildSubdirsForAgentsFiles(lsDir, isDenied);
      discovered.push(...childFiles);
    }

    // Sort all discovered AGENTS.md files deepest-first (preserving discovery order on ties)
    // so sibling directories always appear before shared ancestors.
    const closestFirst = discovered
      .map((file, index) => ({
        file,
        depth: normalizeSlash(path.dirname(file.displayPath)).split("/").filter(Boolean).length,
        index,
      }))
      .sort((left, right) => right.depth - left.depth || left.index - right.index)
      .map((entry) => entry.file);

    return collectNotificationsFromDiscovered(closestFirst);
  }

  async function resolveGlobOrGrepTargetDirs(
    patternOrGlob: string | undefined,
    matchedRelativePaths: readonly string[],
    verifyMatchedExists: boolean,
  ): Promise<string[]> {
    const dirs: string[] = [];
    const seen = new Set<string>();
    const addDir = (dir: string): void => {
      const key = normalizeSlash(path.resolve(dir));
      if (!seen.has(key)) {
        seen.add(key);
        dirs.push(path.resolve(dir));
      }
    };

    if (patternOrGlob) {
      const prefix = extractStaticPrefixFromGlob(patternOrGlob);
      if (prefix) {
        const resolvedPrefix = resolveUserPath(workspaceRoot, prefix);
        if (resolvedPrefix) {
          const dir = await resolveTargetToExistingDirectory(resolvedPrefix);
          if (dir) {
            addDir(dir);
          }
        }
      }
    }

    for (const relPath of matchedRelativePaths) {
      const resolved = resolveUserPath(workspaceRoot, relPath);
      if (!resolved) {
        continue;
      }
      if (verifyMatchedExists) {
        const st = await tryStat(resolved);
        if (!st) {
          continue;
        }
        addDir(st.isDirectory() ? resolved : path.dirname(resolved));
      } else {
        addDir(path.dirname(resolved));
      }
    }

    return dirs;
  }

  async function handleSingleFileTool(
    inputPath: string | undefined,
    mode: "read" | "write" | "delete",
    failed: boolean,
  ): Promise<NestedAgentsNotification[]> {
    if (!inputPath) {
      return [];
    }
    const resolved = resolveUserPath(workspaceRoot, inputPath);
    if (!resolved) {
      return [];
    }

    if (isAgentsFilePath(resolved) && !failed) {
      if (mode === "delete") {
        const key = await canonicalPathKey(resolved);
        contextSeen.delete(key);
        const parentDir = path.dirname(path.dirname(resolved));
        const existingParent = await resolveTargetToExistingDirectory(parentDir);
        return existingParent ? discoverFromDirectories([existingParent]) : [];
      }
      const parentDir = await recordDirectAgentsFileAccess(resolved);
      if (!parentDir) {
        return [];
      }
      const existingParent = await resolveTargetToExistingDirectory(parentDir);
      return existingParent ? discoverFromDirectories([existingParent]) : [];
    }

    const dir = await resolveTargetToExistingDirectory(resolved);
    return dir ? discoverFromDirectories([dir]) : [];
  }

  return {
    async discoverForToolCall(
      input: NestedAgentsToolCallInput,
    ): Promise<readonly NestedAgentsNotification[]> {
      const req = asRecord(input.request);

      switch (input.toolName) {
        case "read_file":
          return handleSingleFileTool(readStringField(req, "path"), "read", input.failed);

        case "create_file":
        case "edit_file":
          return handleSingleFileTool(readStringField(req, "path"), "write", input.failed);

        case "delete_file":
          return handleSingleFileTool(readStringField(req, "path"), "delete", input.failed);

        case "apply_patch": {
          const op = asRecord(req?.operation);
          const opType = readStringField(op, "type");
          const opPath = readStringField(op, "path");
          const mode = opType === "delete_file" ? "delete" : "write";
          return handleSingleFileTool(opPath, mode, input.failed);
        }

        case "ls": {
          const inputPath = readStringField(req, "path");
          if (!inputPath) {
            return [];
          }
          const resolved = resolveUserPath(workspaceRoot, inputPath);
          if (!resolved) {
            return [];
          }
          const st = await tryStat(resolved);
          if (!st?.isDirectory()) {
            const fallbackDir = await resolveTargetToExistingDirectory(resolved);
            return fallbackDir ? discoverFromDirectories([fallbackDir]) : [];
          }
          return discoverFromDirectories([resolved], [resolved]);
        }

        case "glob": {
          const pattern = readStringField(req, "pattern");
          const matchedPaths = input.failed ? [] : parseGlobMatchedRelativePaths(input.rawOutput);
          const dirs = await resolveGlobOrGrepTargetDirs(pattern, matchedPaths, false);
          return discoverFromDirectories(dirs);
        }

        case "grep": {
          const glob = readStringField(req, "glob");
          const outputMode =
            readStringField(req, "outputMode") ?? readStringField(req, "output_mode");
          const matchedPaths = input.failed
            ? []
            : parseGrepMatchedRelativePaths(input.rawOutput, outputMode);
          const dirs = await resolveGlobOrGrepTargetDirs(glob, matchedPaths, true);
          return discoverFromDirectories(dirs);
        }

        case "shell": {
          const command = readStringField(req, "command");
          if (!command) {
            return [];
          }
          const dirs = await extractDirectoriesFromShellCommand(command, workspaceRoot);
          return discoverFromDirectories(dirs);
        }

        case "get_diagnostics": {
          const rawPaths = req?.paths;
          if (!Array.isArray(rawPaths)) {
            return [];
          }
          const dirs: string[] = [];
          for (const item of rawPaths) {
            if (typeof item !== "string" || !item.trim()) {
              continue;
            }
            const resolved = resolveUserPath(workspaceRoot, item);
            if (!resolved) {
              continue;
            }
            const dir = await resolveTargetToExistingDirectory(resolved);
            if (dir) {
              dirs.push(dir);
            }
          }
          return discoverFromDirectories(dirs);
        }

        default:
          return [];
      }
    },

    async discoverForWorkspaceFiles(
      paths: readonly string[],
    ): Promise<readonly NestedAgentsNotification[]> {
      const dirs: string[] = [];
      for (const item of paths) {
        const resolved = resolveUserPath(workspaceRoot, item);
        if (!resolved) {
          continue;
        }
        if (isAgentsFilePath(resolved)) {
          const parentDir = await recordDirectAgentsFileAccess(resolved);
          if (parentDir) {
            const existingParent = await resolveTargetToExistingDirectory(parentDir);
            if (existingParent) {
              dirs.push(existingParent);
            }
          }
          continue;
        }
        const dir = await resolveTargetToExistingDirectory(resolved);
        if (dir) {
          dirs.push(dir);
        }
      }
      return discoverFromDirectories(dirs);
    },

    resetForCompaction(): void {
      contextSeen.clear();
    },

    snapshotState(): Record<string, string> {
      return Object.fromEntries(contextSeen.entries());
    },

    restoreState(state: Readonly<Record<string, string>>): void {
      contextSeen.clear();
      for (const [key, value] of Object.entries(state)) {
        if (typeof value === "string" && value.length > 0) {
          contextSeen.set(key, value);
        }
      }
    },
  };
}
