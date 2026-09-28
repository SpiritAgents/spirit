import { spawn } from "node:child_process";
import path from "node:path";

import { resolveBundledRipgrepPath } from "./bundled-ripgrep-env.js";

const MAX_SEARCH_FILE_SIZE = "1M";

/** Maximum number of matches returned by workspace content search (Desktop file panel) */
export const WORKSPACE_CONTENT_SEARCH_MAX_MATCHES = 5000;

/** .git directories at any path are excluded from search (including --hidden full-text mode) */
const RIPGREP_EXCLUDED_GLOBS = ["!**/.git/**"] as const;

export type RipgrepSearchOptions = {
  workspaceRoot: string;
  query: string;
  isRegexp?: boolean;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  globPattern?: string | null;
  maxMatches?: number;
};

export type RipgrepSearchResult = {
  matches: RipgrepMatch[];
  truncated: boolean;
};

export type RipgrepSubmatch = {
  start: number;
  end: number;
};

export type RipgrepMatch = {
  relativePath: string;
  lineNumber: number;
  lineText: string;
  submatches: RipgrepSubmatch[];
};

type RipgrepMatchLine = {
  path: { text: string };
  lines: { text?: string; bytes?: string };
  line_number: number;
  submatches?: Array<{ start: number; end: number }>;
};

type RipgrepJsonLine =
  | {
      type: "match";
      data: RipgrepMatchLine;
    }
  | {
      type: string;
      data?: unknown;
    };

/** Strip the trailing newline from rg JSON lines; keep leading indentation so submatch byte offsets stay aligned with lineText. */
export function normalizeSearchLine(line: string): string {
  return line.replace(/\r?\n$/u, "");
}

function readRipgrepMatchLineText(lines: RipgrepMatchLine["lines"]): string | undefined {
  if (typeof lines.text === "string") {
    return lines.text;
  }
  // Binary matches only have lines.bytes; workspace text search skips them
  return undefined;
}

function appendQueryArgs(args: string[], options: RipgrepSearchOptions): void {
  const { query, isRegexp = false, caseSensitive = false, wholeWord = false } = options;

  if (wholeWord) {
    args.push("-w");
  }

  if (isRegexp) {
    if (!caseSensitive) {
      args.push("-i");
    }
    args.push("--regexp", query);
    return;
  }

  args.push("-F");
  if (!caseSensitive) {
    args.push("-i");
  }

  if (query.startsWith("-")) {
    args.push("--", query);
  } else {
    args.push(query);
  }
}

export function buildRipgrepArgs(options: RipgrepSearchOptions): string[] {
  const { globPattern } = options;
  const args: string[] = [
    "--json",
    "--no-heading",
    "--color=never",
    "--line-number",
    "--max-filesize",
    MAX_SEARCH_FILE_SIZE,
  ];

  for (const excludedGlob of RIPGREP_EXCLUDED_GLOBS) {
    args.push("-g", excludedGlob);
  }

  if (globPattern === null || globPattern === undefined) {
    args.push("--hidden");
  }

  if (globPattern !== null && globPattern !== undefined) {
    args.push("-g", globPattern);
  }

  appendQueryArgs(args, options);
  // Search "." (cwd is already workspaceRoot): with an absolute path arg, rg matches
  // workspace-relative -g globs like "src/**/*.ts" against the absolute file path,
  // so they never match. With "." the reported paths are cwd-relative and globs work.
  args.push(".");
  return args;
}

function toRelativePath(workspaceRoot: string, filePath: string): string {
  // rg prefixes cwd-relative results with "./" (or ".\" on Windows).
  const stripped =
    filePath.startsWith("./") || filePath.startsWith(".\\") ? filePath.slice(2) : filePath;
  const rel = path.isAbsolute(stripped) ? path.relative(workspaceRoot, stripped) : stripped;
  return rel.replace(/\\/gu, "/") || ".";
}

function mapRipgrepRegexError(stderr: string): Error {
  const trimmed = stderr.trim();
  if (!trimmed) {
    return new Error("Invalid regex");
  }
  const message = trimmed.split(/\r?\n/u).find((line) => line.trim().length > 0) ?? trimmed;
  return new Error(`Invalid regex: ${message}`);
}

function parseRipgrepJsonMatchLine(line: string, workspaceRoot: string): RipgrepMatch | null {
  if (!line.trim()) {
    return null;
  }

  let parsed: RipgrepJsonLine;
  try {
    parsed = JSON.parse(line) as RipgrepJsonLine;
  } catch {
    return null;
  }

  if (parsed.type !== "match") {
    return null;
  }

  const matchData = (parsed as { type: "match"; data: RipgrepMatchLine }).data;
  const rawLineText = readRipgrepMatchLineText(matchData.lines);
  if (rawLineText === undefined || !matchData.path?.text) {
    return null;
  }

  return {
    relativePath: toRelativePath(workspaceRoot, matchData.path.text),
    lineNumber: matchData.line_number,
    lineText: normalizeSearchLine(rawLineText),
    submatches: (matchData.submatches ?? []).map((item) => ({
      start: item.start,
      end: item.end,
    })),
  };
}

function appendMatchWithinLimit(
  matches: RipgrepMatch[],
  match: RipgrepMatch,
  maxMatches: number | undefined,
): boolean {
  matches.push(match);
  return maxMatches !== undefined && matches.length >= maxMatches;
}

function waitForChildClose(child: ReturnType<typeof spawn>): Promise<number | null> {
  return new Promise((resolve, reject) => {
    child.once("error", (error: Error) => {
      reject(error);
    });
    child.once("close", (code) => {
      resolve(code);
    });
  });
}

function consumeRipgrepStdoutLines(params: {
  stdoutBuffer: string;
  workspaceRoot: string;
  matches: RipgrepMatch[];
  maxMatches: number | undefined;
}): { stdoutBuffer: string; limitReached: boolean } {
  let { stdoutBuffer, workspaceRoot, matches, maxMatches } = params;
  let limitReached = false;
  let newlineIndex = stdoutBuffer.indexOf("\n");

  while (newlineIndex >= 0) {
    const line = stdoutBuffer.slice(0, newlineIndex);
    stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
    const parsed = parseRipgrepJsonMatchLine(line, workspaceRoot);
    if (parsed && appendMatchWithinLimit(matches, parsed, maxMatches)) {
      limitReached = true;
      break;
    }
    newlineIndex = stdoutBuffer.indexOf("\n");
  }

  return { stdoutBuffer, limitReached };
}

export async function runRipgrepSearch(
  options: RipgrepSearchOptions,
): Promise<RipgrepSearchResult> {
  const rgExecutable = resolveBundledRipgrepPath();
  if (!rgExecutable) {
    throw new Error("Could not resolve bundled ripgrep executable");
  }

  const args = buildRipgrepArgs(options);
  const child = spawn(rgExecutable, args, {
    cwd: options.workspaceRoot,
    windowsHide: true,
  });

  const matches: RipgrepMatch[] = [];
  let stderr = "";
  let stdoutBuffer = "";
  let limitReached = false;
  const maxMatches = options.maxMatches;

  child.stdout.on("data", (chunk: Buffer | string) => {
    if (limitReached) {
      return;
    }
    stdoutBuffer += chunk.toString();
    const consumed = consumeRipgrepStdoutLines({
      stdoutBuffer,
      workspaceRoot: options.workspaceRoot,
      matches,
      maxMatches,
    });
    stdoutBuffer = consumed.stdoutBuffer;
    if (consumed.limitReached) {
      limitReached = true;
      child.kill();
    }
  });

  child.stderr.on("data", (chunk: Buffer | string) => {
    stderr += chunk.toString();
  });

  const exitCode = await waitForChildClose(child);

  if (!limitReached) {
    const trailing = parseRipgrepJsonMatchLine(stdoutBuffer, options.workspaceRoot);
    if (trailing && appendMatchWithinLimit(matches, trailing, maxMatches)) {
      limitReached = true;
    }
  }

  if (limitReached) {
    return { matches, truncated: true };
  }

  if (exitCode === 2) {
    if (options.isRegexp) {
      throw mapRipgrepRegexError(stderr);
    }
    throw new Error(stderr.trim() || `ripgrep failed with exit code ${exitCode}`);
  }

  if (exitCode !== 0 && exitCode !== 1) {
    throw new Error(stderr.trim() || `ripgrep failed with exit code ${exitCode}`);
  }

  return { matches, truncated: false };
}

export function formatGrepToolOutput(matches: readonly RipgrepMatch[]): string {
  if (matches.length === 0) {
    return "No matches found";
  }

  const files = new Set<string>();
  let out = "";
  for (const match of matches) {
    files.add(match.relativePath);
    out += `${match.relativePath}:${match.lineNumber} | ${match.lineText}\n`;
  }
  out += "\nFiles\n";
  for (const file of [...files].sort((left, right) => left.localeCompare(right))) {
    out += `${file}\n`;
  }
  return out;
}
