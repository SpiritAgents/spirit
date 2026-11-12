/**
 * Simple wildcard matching for permission rule patterns.
 *
 * Semantics:
 * - `*` matches ZERO or more of ANY character, including `/`. There is no
 *   support for `?`, character classes (`[]`) or brace expansion (`{}`);
 *   every other character (including `\`) is literal.
 * - Full-string match: the pattern must cover the entire value; there is no
 *   substring or prefix semantics.
 * - Trailing rule: a pattern ending with `" *"` (space + asterisk) ALSO
 *   matches the bare string with that suffix removed. `"git *"` matches both
 *   `git` and `git status`, while the pattern `git` matches only `git`.
 * - Case-sensitive on purpose: rule authors see exactly what a pattern
 *   matches. (Path matching lowercases both sides on win32 before calling
 *   into this; see evaluate.ts.)
 */

export function matchPermissionPattern(pattern: string, value: string): boolean {
  if (pattern.endsWith(" *") && value === pattern.slice(0, -2)) {
    return true;
  }
  return wildcardMatch(pattern, value);
}

/** Classic two-pointer wildcard scan with backtracking on the last `*`. */
function wildcardMatch(pattern: string, value: string): boolean {
  let p = 0;
  let v = 0;
  let starPattern = -1;
  let starValue = 0;

  while (v < value.length) {
    const pc = p < pattern.length ? pattern[p] : undefined;
    if (pc !== undefined && pc === value[v]) {
      p += 1;
      v += 1;
    } else if (pc === "*") {
      starPattern = p;
      starValue = v;
      p += 1;
    } else if (starPattern !== -1) {
      // Mismatch after a `*`: let the star consume one more character.
      p = starPattern + 1;
      starValue += 1;
      v = starValue;
    } else {
      return false;
    }
  }

  while (p < pattern.length && pattern[p] === "*") {
    p += 1;
  }
  return p === pattern.length;
}
