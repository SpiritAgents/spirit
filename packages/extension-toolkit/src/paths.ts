/**
 * Registry-relative path rules: every relative path inside marketplace.json
 * resolves against the registry root (the parent of `.spirit/`). Paths must
 * not escape the registry root: no `..` segments, no absolute forms, and
 * POSIX separators only so all hosts resolve identically.
 */

export function assertRegistryRelativePath(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldName} must be a non-empty registry-relative path string.`);
  }
  const trimmed = value.trim();
  if (trimmed.includes("\\")) {
    throw new Error(`${fieldName} must use POSIX "/" separators: ${trimmed}`);
  }
  if (trimmed.startsWith("/") || trimmed.startsWith("//")) {
    throw new Error(
      `${fieldName} must be relative to the registry root, got absolute path: ${trimmed}`,
    );
  }
  if (/^[a-zA-Z]:/u.test(trimmed)) {
    throw new Error(
      `${fieldName} must be relative to the registry root, got absolute path: ${trimmed}`,
    );
  }

  const segments = trimmed.split("/");
  let start = 0;
  if (segments[0] === ".") {
    start = 1;
  }
  const normalized: string[] = [];
  for (let index = start; index < segments.length; index += 1) {
    const segment = segments[index] ?? "";
    if (!segment || segment === ".") {
      throw new Error(`${fieldName} contains an empty or "." path segment: ${trimmed}`);
    }
    if (segment === "..") {
      throw new Error(`${fieldName} must not contain ".." segments: ${trimmed}`);
    }
    normalized.push(segment);
  }
  if (normalized.length === 0) {
    throw new Error(`${fieldName} must point at a file inside the registry root: ${trimmed}`);
  }
  return normalized.join("/");
}

/** Resolve a validated registry-relative path against an HTTP(S) registry root URL. */
export function resolveRegistryRelativeUrl(registryRootUrl: string, relativePath: string): string {
  const base = registryRootUrl.endsWith("/") ? registryRootUrl : `${registryRootUrl}/`;
  return new URL(relativePath, base).href;
}
