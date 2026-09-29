const DEFAULT_SUGGESTION_LIMIT = 128;

/** Trailing slash marks directory entries in suggestion lists. */
export const WORKSPACE_REFERENCE_DIRECTORY_SUFFIX = "/";

export interface ActiveWorkspaceFileReferenceQuery {
  start: number;
  end: number;
  raw: string;
}

export interface WorkspaceFileReferenceSuggestionsResult {
  query: ActiveWorkspaceFileReferenceQuery;
  suggestions: string[];
  indexReady?: boolean;
}

export function currentWorkspaceFileReferenceQuery(
  input: string,
  cursorChars: number,
): ActiveWorkspaceFileReferenceQuery | undefined {
  const cursor = charCountToCodeUnitIndex(input, cursorChars);
  const start = tokenStart(input, cursor);
  const end = tokenEnd(input, cursor);
  if (start >= end) {
    return undefined;
  }

  const token = input.slice(start, end);
  if (!token.startsWith("@") || token.includes("\n")) {
    return undefined;
  }

  return {
    start: codeUnitIndexToCharCount(input, start),
    end: codeUnitIndexToCharCount(input, end),
    raw: token,
  };
}

export function replaceWorkspaceFileReferenceQuery(
  input: string,
  query: ActiveWorkspaceFileReferenceQuery,
  path: string,
  finalize: boolean,
): { text: string; cursorChars: number } {
  let replacement = `@${path}`;
  const queryEndCodeUnits = charCountToCodeUnitIndex(input, query.end);
  const nextChar = input.slice(queryEndCodeUnits).charAt(0);
  const needsSpace = nextChar.length === 0 || !/\s/u.test(nextChar);
  if (finalize && needsSpace) {
    replacement += " ";
  }

  const queryStartCodeUnits = charCountToCodeUnitIndex(input, query.start);
  const text = `${input.slice(0, queryStartCodeUnits)}${replacement}${input.slice(queryEndCodeUnits)}`;

  return {
    text,
    cursorChars: query.start + Array.from(replacement).length,
  };
}

export function referencedWorkspaceFilePathsFromInput(input: string): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];

  for (const token of input.split(/\s+/u)) {
    const path = token.startsWith("@") ? token.slice(1) : undefined;
    if (!path) {
      continue;
    }

    const normalized = path.replace(/\\/gu, "/");
    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    paths.push(normalized);
  }

  return paths;
}

export function isWorkspaceReferenceDirectoryPath(path: string): boolean {
  return path.endsWith(WORKSPACE_REFERENCE_DIRECTORY_SUFFIX) && path.length > 1;
}

export function normalizeWorkspaceReferenceDirectoryPath(path: string): string {
  return path.replace(/\/+$/u, "");
}

export function deriveWorkspaceDirectoryPathsFromFiles(files: readonly string[]): string[] {
  const directories = new Set<string>();

  for (const file of files) {
    const segments = file.split("/").filter((segment) => segment.length > 0);
    for (let index = 1; index < segments.length; index += 1) {
      directories.add(
        `${segments.slice(0, index).join("/")}${WORKSPACE_REFERENCE_DIRECTORY_SUFFIX}`,
      );
    }
  }

  return Array.from(directories);
}

interface PreparedReferenceCandidate {
  path: string;
  isDirectory: boolean;
  pathLower: string;
  basenameLower: string;
  basenameLength: number;
  pathLength: number;
}

interface PreparedReferenceIndex {
  files: PreparedReferenceCandidate[];
  directories: PreparedReferenceCandidate[];
}

/**
 * Precompute candidates (lowercase, basename, directory derivation) cached per files-array reference,
 * avoiding repeated toLowerCase / Array.from / directory derivation over all files on every keystroke.
 */
const preparedReferenceIndexCache = new WeakMap<readonly string[], PreparedReferenceIndex>();

function prepareReferenceCandidate(path: string): PreparedReferenceCandidate {
  const normalizedPath = normalizeWorkspaceReferenceDirectoryPath(path);
  const basename = referencePathBasename(path);
  return {
    path,
    isDirectory: isWorkspaceReferenceDirectoryPath(path),
    pathLower: normalizedPath.toLowerCase(),
    basenameLower: basename.toLowerCase(),
    basenameLength: Array.from(basename).length,
    pathLength: Array.from(normalizedPath).length,
  };
}

function preparedReferenceIndexForFiles(files: readonly string[]): PreparedReferenceIndex {
  const cached = preparedReferenceIndexCache.get(files);
  if (cached) {
    return cached;
  }
  const prepared: PreparedReferenceIndex = {
    files: files.map(prepareReferenceCandidate),
    directories: deriveWorkspaceDirectoryPathsFromFiles(files).map(prepareReferenceCandidate),
  };
  preparedReferenceIndexCache.set(files, prepared);
  return prepared;
}

interface ScoredReferenceCandidate {
  score: number;
  candidate: PreparedReferenceCandidate;
}

function compareScoredReferenceCandidates(
  left: ScoredReferenceCandidate,
  right: ScoredReferenceCandidate,
): number {
  return (
    right.score - left.score ||
    Number(right.candidate.isDirectory) - Number(left.candidate.isDirectory) ||
    left.candidate.basenameLength - right.candidate.basenameLength ||
    left.candidate.pathLength - right.candidate.pathLength ||
    left.candidate.path.localeCompare(right.candidate.path)
  );
}

export function computeWorkspaceFileReferenceSuggestions(
  query: string,
  files: readonly string[],
  options?: { includeDirectories?: boolean },
): string[] {
  const needle = query.replace(/^@/u, "").trim().toLowerCase();
  const needleChars = Array.from(needle);

  const includeDirectories = options?.includeDirectories !== false;
  const index = preparedReferenceIndexForFiles(files);
  const candidates = includeDirectories ? [...index.directories, ...index.files] : index.files;

  const scored: ScoredReferenceCandidate[] = [];
  for (const candidate of candidates) {
    const score = scorePreparedReferenceCandidate(needle, needleChars, candidate);
    if (score === undefined) {
      continue;
    }
    scored.push({ score, candidate });
  }

  scored.sort(compareScoredReferenceCandidates);

  return scored.slice(0, DEFAULT_SUGGESTION_LIMIT).map((item) => item.candidate.path);
}

/**
 * Case-insensitive identity for merging: slash-normalized path without the trailing
 * directory marker, so a pooled `ui/` and an index-derived `ui/` collapse into one row.
 */
function referenceSuggestionDedupeKey(path: string): string {
  return normalizeWorkspaceReferenceDirectoryPath(path.replace(/\\/gu, "/")).toLowerCase();
}

/**
 * Merge recent-pool display paths into workspace index suggestions, VS Code Quick Open style:
 * the union is scored with the same fuzzy matcher, recent-pool hits stay on top in MRU order
 * (the order of `recentPaths`), and the remaining hits follow the regular match-quality order.
 * Recent paths may be workspace-relative or absolute; both score on basename and full path.
 */
export function mergeRecentIntoSuggestions(
  query: string,
  indexSuggestions: readonly string[],
  recentPaths: readonly string[],
  options?: { limit?: number },
): string[] {
  const needle = query.replace(/^@/u, "").trim().toLowerCase();
  const needleChars = Array.from(needle);

  const seen = new Set<string>();
  const recentHits: string[] = [];
  const scored: ScoredReferenceCandidate[] = [];

  for (const path of recentPaths) {
    const key = referenceSuggestionDedupeKey(path);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const candidate = prepareReferenceCandidate(path);
    if (scorePreparedReferenceCandidate(needle, needleChars, candidate) === undefined) {
      continue;
    }
    recentHits.push(candidate.path);
  }

  for (const path of indexSuggestions) {
    const key = referenceSuggestionDedupeKey(path);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const candidate = prepareReferenceCandidate(path);
    const score = scorePreparedReferenceCandidate(needle, needleChars, candidate);
    if (score === undefined) {
      continue;
    }
    scored.push({ score, candidate });
  }

  scored.sort(compareScoredReferenceCandidates);

  const limit = options?.limit ?? DEFAULT_SUGGESTION_LIMIT;
  return [...recentHits, ...scored.map((item) => item.candidate.path)].slice(0, limit);
}

export function charCountToCodeUnitIndex(input: string, cursorChars: number): number {
  if (cursorChars <= 0) {
    return 0;
  }

  let chars = 0;
  for (let index = 0; index < input.length;) {
    if (chars === cursorChars) {
      return index;
    }
    const codePoint = input.codePointAt(index);
    if (codePoint === undefined) {
      break;
    }
    index += codePoint > 0xffff ? 2 : 1;
    chars += 1;
  }

  return input.length;
}

export function codeUnitIndexToCharCount(input: string, codeUnitIndex: number): number {
  let chars = 0;
  for (let index = 0; index < codeUnitIndex;) {
    const codePoint = input.codePointAt(index);
    if (codePoint === undefined) {
      break;
    }
    index += codePoint > 0xffff ? 2 : 1;
    chars += 1;
  }
  return chars;
}

function tokenStart(input: string, cursor: number): number {
  for (let index = cursor; index > 0;) {
    const previousIndex = previousCodePointIndex(input, index);
    const codePoint = input.codePointAt(previousIndex);
    if (codePoint === undefined) {
      break;
    }

    const char = String.fromCodePoint(codePoint);
    if (/\s/u.test(char)) {
      return index;
    }
    index = previousIndex;
  }

  return 0;
}

function tokenEnd(input: string, cursor: number): number {
  for (let index = cursor; index < input.length;) {
    const codePoint = input.codePointAt(index);
    if (codePoint === undefined) {
      break;
    }

    const char = String.fromCodePoint(codePoint);
    if (/\s/u.test(char)) {
      return index;
    }
    index += codePoint > 0xffff ? 2 : 1;
  }

  return input.length;
}

function previousCodePointIndex(input: string, fromIndex: number): number {
  const previousIndex = fromIndex - 1;
  if (previousIndex <= 0) {
    return 0;
  }

  const codeUnit = input.charCodeAt(previousIndex);
  if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
    return previousIndex - 1;
  }
  return previousIndex;
}

function referencePathBasename(path: string): string {
  const normalized = normalizeWorkspaceReferenceDirectoryPath(path);
  return normalized.split("/").at(-1) ?? normalized;
}

function scorePreparedReferenceCandidate(
  needle: string,
  needleChars: readonly string[],
  candidate: PreparedReferenceCandidate,
): number | undefined {
  const { isDirectory, pathLower, basenameLower, basenameLength, pathLength } = candidate;

  if (!needle) {
    return isDirectory ? 1 : 0;
  }
  if (basenameLower === needle) {
    return isDirectory ? 10_100 : 10_000;
  }
  if (pathLower === needle) {
    return 9_700;
  }
  if (basenameLower.startsWith(needle)) {
    return 9_400 - basenameLength;
  }
  if (pathLower.endsWith(needle)) {
    return 9_100 - pathLength;
  }

  const basenamePosition = basenameLower.indexOf(needle);
  if (basenamePosition >= 0) {
    return 8_600 - basenamePosition * 10;
  }

  const pathPosition = pathLower.indexOf(needle);
  if (pathPosition >= 0) {
    return 8_100 - pathPosition;
  }

  const basenameSubsequenceScore = subsequenceScore(needleChars, basenameLower);
  if (basenameSubsequenceScore !== undefined) {
    return 7_000 + basenameSubsequenceScore;
  }

  const pathSubsequenceScore = subsequenceScore(needleChars, pathLower);
  if (pathSubsequenceScore !== undefined) {
    return 6_000 + pathSubsequenceScore;
  }

  return undefined;
}

/** Iterate the haystack by code point via for..of, avoiding materializing the whole string with Array.from per candidate. */
function subsequenceScore(needleChars: readonly string[], haystack: string): number | undefined {
  let needleIndex = 0;
  let haystackIndex = 0;
  let firstMatch: number | undefined;
  let lastMatch = 0;
  let consecutiveBonus = 0;
  let previousMatch: number | undefined;

  for (const haystackChar of haystack) {
    if (needleIndex >= needleChars.length) {
      break;
    }
    if (haystackChar === needleChars[needleIndex]) {
      firstMatch ??= haystackIndex;
      if (previousMatch !== undefined && haystackIndex === previousMatch + 1) {
        consecutiveBonus += 12;
      }
      previousMatch = haystackIndex;
      lastMatch = haystackIndex;
      needleIndex += 1;
    }
    haystackIndex += 1;
  }

  if (needleIndex < needleChars.length || firstMatch === undefined) {
    return undefined;
  }

  const span = lastMatch - firstMatch;
  return 1_000 - span - firstMatch + consecutiveBonus;
}
