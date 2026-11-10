import path from "node:path";

/**
 * Comparison key for session file paths: Windows filesystems are case-insensitive, so fold to lowercase;
 * other platforms stay case-sensitive. Registry lookups and deletion comparisons must share this
 * normalization to keep session-delete and session-registry semantics consistent.
 */
export function normalizeSessionPathKey(filePath: string): string {
  const resolved = path.resolve(filePath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function sameSessionPath(left: string, right: string): boolean {
  return normalizeSessionPathKey(left) === normalizeSessionPathKey(right);
}
