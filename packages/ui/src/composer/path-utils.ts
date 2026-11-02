/* Path helpers for composer chips. The directory-predicate pair mirrors
 * `@spiritagent/host-internal/workspace-file-reference-query` (the write-time source of truth);
 * keep the suffix semantics aligned with it. */

/** Directory references carry a trailing `/` (the workspace reference query convention). */
export function isWorkspaceReferenceDirectoryPath(path: string): boolean {
  return path.endsWith("/") && path.length > 1;
}

export function normalizeWorkspaceReferenceDirectoryPath(path: string): string {
  return path.replace(/\/+$/u, "");
}

export function workspaceFileBasename(relativePath: string): string {
  const normalized = relativePath.replace(/\/+$/u, "");
  const segments = normalized.split("/");
  return segments[segments.length - 1] || normalized;
}

/* Code-point ↔ UTF-16 code-unit conversion; mirrors host-internal's workspace-file-reference-query
 * (the slash/@ query wire format counts code points, DOM carets count code units). */

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
