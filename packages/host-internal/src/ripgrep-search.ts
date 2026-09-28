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
  beforeContext?: number;
  afterContext?: number;
  context?: number;
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
  /** "context" entries only appear when context options are set; absent means a real match. */
  kind?: "match" | "context";
};

type RipgrepMatchLine = {
  path: { text: string };
  lines: { text?: string; bytes?: string };
  line_number: number;
  submatches?: Array<{ start: number; end: number }>;
};

type RipgrepJsonLine =
  | {
      type: "match" | "context";
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

  if (options.context !== undefined) {
    args.push("--context", String(options.context));
  }
  if (options.beforeContext !== undefined) {
    args.push("--before-context", String(options.beforeContext));
  }
  if (options.afterContext !== undefined) {
    args.push("--after-context", String(options.afterContext));
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

  if (parsed.type !== "match" && parsed.type !== "context") {
    return null;
  }

  const matchData = (parsed as { type: "match" | "context"; data: RipgrepMatchLine }).data;
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
    ...(parsed.type === "context" ? { kind: "context" as const } : {}),
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

/** Default entry cap for the grep tool; page further results with offset. */
export const GREP_TOOL_DEFAULT_HEAD_LIMIT = 250;

/** Hard internal cap on collected matches for one grep tool call. */
export const GREP_TOOL_MAX_MATCHES = 10_000;

export type GrepToolOutputMode = "content" | "files_with_matches" | "count_matches";

export type FormatGrepToolOutputOptions = {
  mode?: GrepToolOutputMode;
  /** Content mode only: prefix lines with line numbers. Defaults to true. */
  lineNumbers?: boolean;
  offset?: number;
  headLimit?: number;
  /** Content mode only: insert a `--` separator between non-contiguous blocks (used with context options). */
  blockSeparators?: boolean;
  /** True when the search hit GREP_TOOL_MAX_MATCHES and the real total is unknown. */
  truncated?: boolean;
};

function uniqueMatchPaths(matches: readonly RipgrepMatch[]): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const match of matches) {
    if (!seen.has(match.relativePath)) {
      seen.add(match.relativePath);
      paths.push(match.relativePath);
    }
  }
  return paths;
}

function renderContentEntry(entry: RipgrepMatch, lineNumbers: boolean): string {
  if (entry.kind === "context") {
    return lineNumbers
      ? `${entry.relativePath}-${entry.lineNumber}-${entry.lineText}`
      : `${entry.relativePath}-${entry.lineText}`;
  }
  return lineNumbers
    ? `${entry.relativePath}:${entry.lineNumber}:${entry.lineText}`
    : `${entry.relativePath}:${entry.lineText}`;
}

export function formatGrepToolOutput(
  matches: readonly RipgrepMatch[],
  options: FormatGrepToolOutputOptions = {},
): string {
  const realMatches = matches.filter((entry) => entry.kind !== "context");
  if (realMatches.length === 0) {
    return "No matches found";
  }

  const mode = options.mode ?? "content";
  const offset = options.offset ?? 0;
  const headLimit = options.headLimit ?? GREP_TOOL_DEFAULT_HEAD_LIMIT;

  if (mode === "content") {
    const lineNumbers = options.lineNumbers !== false;
    const blockSeparators = options.blockSeparators === true;
    const pageMatches = realMatches.slice(offset, offset + headLimit);
    let out = "";
    if (pageMatches.length > 0) {
      let startIndex = matches.indexOf(pageMatches[0]!);
      // Leading context lines belong to the first shown match only when they form a
      // contiguous block directly above it; a stray context line from an earlier match
      // is not this match's before-context.
      while (
        startIndex > 0 &&
        matches[startIndex - 1]!.kind === "context" &&
        matches[startIndex - 1]!.relativePath === matches[startIndex]!.relativePath &&
        matches[startIndex - 1]!.lineNumber === matches[startIndex]!.lineNumber - 1
      ) {
        startIndex -= 1;
      }
      let endIndex = matches.indexOf(pageMatches[pageMatches.length - 1]!);
      // Trailing context lines belong to the last shown match, so keep them on the page.
      while (
        endIndex + 1 < matches.length &&
        matches[endIndex + 1]!.kind === "context" &&
        matches[endIndex + 1]!.relativePath === matches[endIndex]!.relativePath &&
        matches[endIndex + 1]!.lineNumber === matches[endIndex]!.lineNumber + 1
      ) {
        endIndex += 1;
      }
      const rendered: string[] = [];
      for (let index = startIndex; index <= endIndex; index += 1) {
        const entry = matches[index]!;
        if (blockSeparators && index > startIndex) {
          const previous = matches[index - 1]!;
          if (
            entry.relativePath !== previous.relativePath ||
            entry.lineNumber !== previous.lineNumber + 1
          ) {
            rendered.push("--");
          }
        }
        rendered.push(renderContentEntry(entry, lineNumbers));
      }
      out += `${rendered.join("\n")}\n`;
    }
    if (offset + pageMatches.length < realMatches.length) {
      out += `\n[truncated] Showing ${pageMatches.length} of ${realMatches.length} matches (offset ${offset}). Pass offset ${offset + pageMatches.length} to continue.\n`;
    }
    if (options.truncated === true) {
      out += `\n[truncated] Search hit the internal limit of ${GREP_TOOL_MAX_MATCHES} matches; totals above are incomplete. Narrow the pattern or pass glob/type to reduce scope.\n`;
    }
    return out;
  }

  let lines: string[];
  if (mode === "files_with_matches") {
    lines = uniqueMatchPaths(realMatches);
  } else {
    const counts = new Map<string, number>();
    for (const match of realMatches) {
      counts.set(match.relativePath, (counts.get(match.relativePath) ?? 0) + 1);
    }
    lines = [...counts.entries()].map(([path, count]) => `${path}:${count}`);
  }

  const page = lines.slice(offset, offset + headLimit);
  let out = `${page.join("\n")}\n`;

  if (offset + page.length < lines.length) {
    out += `\n[truncated] Showing ${page.length} of ${lines.length} entries (offset ${offset}). Pass offset ${offset + page.length} to continue.\n`;
  }
  if (options.truncated === true) {
    out += `\n[truncated] Search hit the internal limit of ${GREP_TOOL_MAX_MATCHES} matches; totals above are incomplete. Narrow the pattern or pass glob/type to reduce scope.\n`;
  }
  return out;
}
