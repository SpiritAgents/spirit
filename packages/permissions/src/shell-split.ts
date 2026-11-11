/**
 * Hand-written POSIX-ish shell lexer that splits a command line into the
 * simple commands that would actually execute, so each one can be checked
 * against the permission rules on its own.
 *
 * Covered:
 * - Single quotes, double quotes and backslash escapes; operators like `&&`
 *   or `|` inside quotes are NOT separators.
 * - Top-level separators: `&&`, `||`, `;`, `|`, `|&`, a single `&`, newline,
 *   and `(` / `)` (subshell / command groups).
 * - Command substitution: the content of `$(...)` and backticks is extracted
 *   as ADDITIONAL segments (recursively, so nested substitutions work). This
 *   blocks bypasses like `echo $(rm -rf ~)`.
 * - `#` starts a comment when it begins a word (start of input, or after
 *   whitespace / a separator), matching POSIX shells.
 * - `$(( ... ))` arithmetic expansion is skipped opaquely: it contains no
 *   commands, and treating its contents as segments would produce spurious
 *   permission prompts.
 *
 * Not covered: PowerShell / cmd-specific syntax (`;` is the only statement
 * separator there and IS covered, but e.g. `$( )` means something else in
 * PowerShell). `&&`, `;`, `|` and `&` are common operators across all three
 * shells, which is what matters for a conservative permission check: the
 * lexer errs on the side of producing MORE segments, never fewer, and any
 * parse failure is reported so the caller can fall back to asking.
 */

export type ShellSplitResult = { ok: true; segments: string[] } | { ok: false };

export function splitShellCommandLine(command: string): ShellSplitResult {
  const segments: string[] = [];
  const substitutions: string[] = [];
  if (!scanTopLevel(command, segments, substitutions)) {
    return { ok: false };
  }
  // Each substitution's own simple commands are additional segments; nested
  // substitutions are unrolled by the recursion.
  for (const substitution of substitutions) {
    const inner = splitShellCommandLine(substitution);
    if (!inner.ok) {
      return { ok: false };
    }
    segments.push(...inner.segments);
  }
  return { ok: true, segments };
}

/**
 * Scans `input` at top level, pushing trimmed simple commands into `segments`
 * and raw `$(...)` / backtick contents into `substitutions`. Returns false on
 * unclosed quotes, substitutions or subshell parens.
 */
function scanTopLevel(input: string, segments: string[], substitutions: string[]): boolean {
  let current = "";
  let parenDepth = 0;

  const pushCurrent = (): void => {
    const trimmed = current.trim();
    if (trimmed !== "") {
      segments.push(trimmed);
    }
    current = "";
  };

  let i = 0;
  while (i < input.length) {
    const ch = input[i]!;

    if (ch === "\\") {
      if (i + 1 >= input.length) {
        return false; // dangling escape
      }
      current += input.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (ch === "'") {
      const end = input.indexOf("'", i + 1);
      if (end === -1) {
        return false; // unclosed single quote
      }
      current += input.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    if (ch === '"') {
      const end = skipDoubleQuoted(input, i, substitutions);
      if (end === -1) {
        return false; // unclosed double quote
      }
      current += input.slice(i, end);
      i = end;
      continue;
    }
    if (ch === "`") {
      const end = skipBacktick(input, i, substitutions);
      if (end === -1) {
        return false; // unclosed backtick
      }
      current += input.slice(i, end);
      i = end;
      continue;
    }
    if (ch === "$" && input[i + 1] === "(") {
      const end = skipDollarParen(input, i, substitutions);
      if (end === -1) {
        return false; // unclosed $(...)
      }
      current += input.slice(i, end);
      i = end;
      continue;
    }
    // `#` begins a comment when it starts a word (after whitespace, a
    // separator, or at the very start of the input).
    if (ch === "#" && (current === "" || /\s/u.test(current[current.length - 1]!))) {
      const newline = input.indexOf("\n", i);
      if (newline === -1) {
        break;
      }
      current = "";
      i = newline;
      continue;
    }

    const two = input.slice(i, i + 2);
    if (two === "&&" || two === "||" || two === "|&") {
      pushCurrent();
      i += 2;
      continue;
    }
    if (ch === ";" || ch === "|" || ch === "&" || ch === "\n") {
      pushCurrent();
      i += 1;
      continue;
    }
    if (ch === "(") {
      pushCurrent();
      parenDepth += 1;
      i += 1;
      continue;
    }
    if (ch === ")") {
      pushCurrent();
      parenDepth -= 1;
      if (parenDepth < 0) {
        return false; // unbalanced )
      }
      i += 1;
      continue;
    }

    current += ch;
    i += 1;
  }

  if (parenDepth !== 0) {
    return false; // unclosed ( subshell
  }
  pushCurrent();
  return true;
}

/**
 * Skips a double-quoted region starting at `start` (the opening quote).
 * Returns the index just past the closing quote, or -1 if unclosed.
 * Command substitutions inside the quotes are still extracted.
 */
function skipDoubleQuoted(input: string, start: number, substitutions: string[]): number {
  let i = start + 1;
  while (i < input.length) {
    const ch = input[i]!;
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === '"') {
      return i + 1;
    }
    if (ch === "`") {
      const end = skipBacktick(input, i, substitutions);
      if (end === -1) {
        return -1;
      }
      i = end;
      continue;
    }
    if (ch === "$" && input[i + 1] === "(") {
      const end = skipDollarParen(input, i, substitutions);
      if (end === -1) {
        return -1;
      }
      i = end;
      continue;
    }
    i += 1;
  }
  return -1;
}

/**
 * Skips a backtick substitution starting at `start`. POSIX backticks cannot
 * nest (a nested one would have to be escaped), so the next unescaped
 * backtick closes it. Returns the index just past the closing backtick, or
 * -1 if unclosed.
 */
function skipBacktick(input: string, start: number, substitutions: string[]): number {
  let i = start + 1;
  while (i < input.length) {
    const ch = input[i]!;
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "`") {
      substitutions.push(input.slice(start + 1, i));
      return i + 1;
    }
    i += 1;
  }
  return -1;
}

/**
 * Skips a `$(` substitution starting at `start` (the `$`). Returns the index
 * just past the matching `)`, or -1 if unbalanced. The raw inner content is
 * pushed to `substitutions`; `$(( ... ))` arithmetic is skipped opaquely
 * because it contains no commands.
 */
function skipDollarParen(input: string, start: number, substitutions: string[]): number {
  const openParen = start + 1;
  if (input[start + 2] === "(") {
    // Arithmetic expansion: opaque, never contains commands.
    return findMatchingParen(input, openParen);
  }
  const end = findMatchingParen(input, openParen);
  if (end === -1) {
    return -1;
  }
  substitutions.push(input.slice(openParen + 1, end - 1));
  return end;
}

/**
 * Finds the `)` matching the `(` at `openParen`, honoring quotes and escapes
 * so parens inside strings do not miscount. Returns the index just past the
 * match, or -1 if unbalanced.
 */
function findMatchingParen(input: string, openParen: number): number {
  let depth = 0;
  let i = openParen;
  while (i < input.length) {
    const ch = input[i]!;
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "'") {
      const end = input.indexOf("'", i + 1);
      if (end === -1) {
        return -1;
      }
      i = end + 1;
      continue;
    }
    if (ch === '"') {
      // Quoted parens do not count; substitutions inside the quotes are
      // re-extracted when the captured content is scanned recursively.
      const end = skipDoubleQuoted(input, i, []);
      if (end === -1) {
        return -1;
      }
      i = end;
      continue;
    }
    if (ch === "`") {
      const end = skipBacktick(input, i, []);
      if (end === -1) {
        return -1;
      }
      i = end;
      continue;
    }
    if (ch === "(") {
      depth += 1;
    } else if (ch === ")") {
      depth -= 1;
      if (depth === 0) {
        return i + 1;
      }
    }
    i += 1;
  }
  return -1;
}
