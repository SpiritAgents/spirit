function normalizePathForCompare(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/u, "");
}

function isWindowsStylePath(path: string): boolean {
  return /^(?:[A-Za-z]:[\\/]|\\\\)/u.test(path.trim());
}

function pathsEqual(left: string, right: string): boolean {
  const a = normalizePathForCompare(left);
  const b = normalizePathForCompare(right);
  if (isWindowsStylePath(left) || isWindowsStylePath(right)) {
    return a.toLowerCase() === b.toLowerCase();
  }
  return a === b;
}

function pathStartsWith(prefix: string, candidate: string): boolean {
  const normalizedPrefix = normalizePathForCompare(prefix);
  const normalizedCandidate = normalizePathForCompare(candidate);
  const caseInsensitive = isWindowsStylePath(prefix) || isWindowsStylePath(candidate);
  const lowerPrefix = caseInsensitive ? normalizedPrefix.toLowerCase() : normalizedPrefix;
  const lowerCandidate = caseInsensitive ? normalizedCandidate.toLowerCase() : normalizedCandidate;
  if (lowerCandidate === lowerPrefix) {
    return true;
  }
  return lowerCandidate.startsWith(`${lowerPrefix}/`);
}

/** Map an absolute path under workspaceRoot to a workspace-relative path. */
export function tryResolveWorkspaceRelativePath(
  workspaceRoot: string,
  absolutePath: string,
): string | null {
  const root = workspaceRoot.trim();
  const absolute = absolutePath.trim();
  if (!root || !absolute) {
    return null;
  }
  if (!pathStartsWith(root, absolute)) {
    return null;
  }
  const rootNormalized = normalizePathForCompare(root);
  const absoluteNormalized = normalizePathForCompare(absolute);
  if (pathsEqual(rootNormalized, absoluteNormalized)) {
    return ".";
  }
  const suffix = absoluteNormalized.slice(rootNormalized.length).replace(/^\//u, "");
  return suffix.replace(/\\/g, "/") || ".";
}
