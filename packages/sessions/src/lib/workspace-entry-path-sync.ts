export function normalizeWorkspaceEntryRel(relativePath: string): string {
  return relativePath.replace(/\\/g, "/");
}

/** Workspace-relative path for copying to the clipboard; the root directory is `.`. */
export function formatWorkspaceRelativePathForCopy(relativePath: string): string {
  const normalized = normalizeWorkspaceEntryRel(relativePath).replace(/^\/+|\/+$/g, "");
  return normalized.length === 0 ? "." : normalized;
}

function workspacePathSeparator(workspaceRoot: string): "\\" | "/" {
  return /\\/.test(workspaceRoot) ? "\\" : "/";
}

/** Joins the workspace root and a relative path into an absolute path (browser-safe, no Node path dependency). */
export function joinWorkspaceAbsolutePath(workspaceRoot: string, relativePath: string): string {
  const root = workspaceRoot.replace(/[/\\]+$/, "");
  const rel = formatWorkspaceRelativePathForCopy(relativePath);
  if (rel === ".") {
    return root;
  }
  const sep = workspacePathSeparator(workspaceRoot);
  return `${root}${sep}${rel.replace(/\//g, sep)}`;
}

/** Whether the candidate path equals prefix or lies under the prefix directory. */
export function isUnderWorkspaceEntryPath(prefixRel: string, candidateRel: string): boolean {
  const prefix = normalizeWorkspaceEntryRel(prefixRel);
  const candidate = normalizeWorkspaceEntryRel(candidateRel);
  if (prefix === candidate) {
    return true;
  }
  if (prefix === "") {
    return false;
  }
  return candidate.startsWith(`${prefix}/`);
}

/** Maps the relative position of currentPath under oldPrefix to newPrefix; returns null when unrelated. */
export function remapWorkspaceEntryPath(
  oldPrefix: string,
  newPrefix: string,
  currentPath: string,
): string | null {
  const current = normalizeWorkspaceEntryRel(currentPath);
  const oldP = normalizeWorkspaceEntryRel(oldPrefix);
  const newP = normalizeWorkspaceEntryRel(newPrefix);
  if (current === oldP) {
    return newP;
  }
  if (!isUnderWorkspaceEntryPath(oldP, current)) {
    return null;
  }
  const suffix = current.slice(oldP.length);
  return `${newP}${suffix}`;
}

/** Removes the prefix and its sub-path keys from a record keyed by relative directory. */
export function evictRecordKeysUnderPrefix<T>(
  record: Record<string, T>,
  prefixRel: string,
): Record<string, T> {
  const prefix = normalizeWorkspaceEntryRel(prefixRel);
  const shouldEvict = (key: string): boolean => {
    const normalized = normalizeWorkspaceEntryRel(key);
    if (normalized === prefix) {
      return true;
    }
    if (prefix === "") {
      return normalized !== "";
    }
    return normalized.startsWith(`${prefix}/`);
  };

  const next: Record<string, T> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!shouldEvict(key)) {
      next[key] = value;
    }
  }
  return next;
}
