/**
 * Pure permission evaluation: no I/O, no side effects, callable from any
 * layer. Rules come from `config.json` (`permission` field) already
 * normalized by config-io.ts.
 *
 * Rule priority is order-INDEPENDENT: all rules matching a value are
 * collected, then any deny wins over any ask wins over any allow. This is a
 * deliberate anti-goal against last-match-wins semantics: with rules
 * `{ "rm -rf *": "deny", "*": "allow" }` (in that JSON order), `rm -rf /`
 * must deny. `matched` reports the most specific (longest) pattern at the
 * winning priority, breaking ties by config order, so results are stable
 * regardless of evaluation strategy.
 */
import path from "node:path";

import type { PermissionDomainRules, PermissionRuleAction } from "@spiritagent/config/credentials";
import { isAbsolutePathPattern } from "./config-io.js";
import { matchPermissionPattern } from "./matcher.js";
import { splitShellCommandLine } from "./shell-split.js";

export type PermissionVerdict = "allow" | "ask" | "deny";

export interface PermissionMatch {
  pattern: string;
  action: PermissionRuleAction;
}

export interface SegmentResult {
  segment: string;
  verdict: PermissionVerdict;
  matched?: PermissionMatch;
}

export interface PermissionEvalResult {
  verdict: PermissionVerdict;
  /** The rule that determined the verdict; undefined when nothing matched. */
  matched?: PermissionMatch;
  /** Shell only: per-simple-command detail. */
  segments?: SegmentResult[];
}

/** deny > ask > allow over every matching rule; no match at all is a fail-safe ask. */
function pickVerdict(matches: PermissionMatch[]): PermissionEvalResult {
  const deny = mostSpecific(matches, "deny");
  if (deny) {
    return { verdict: "deny", matched: deny };
  }
  const ask = mostSpecific(matches, "ask");
  if (ask) {
    return { verdict: "ask", matched: ask };
  }
  const allow = mostSpecific(matches, "allow");
  if (allow) {
    return { verdict: "allow", matched: allow };
  }
  return { verdict: "ask" };
}

/**
 * Among matches at the winning action, report the longest (most specific)
 * pattern; ties keep config order, so results stay deterministic.
 */
function mostSpecific(
  matches: PermissionMatch[],
  action: PermissionRuleAction,
): PermissionMatch | undefined {
  let winner: PermissionMatch | undefined;
  for (const match of matches) {
    if (match.action !== action) {
      continue;
    }
    if (!winner || match.pattern.length > winner.pattern.length) {
      winner = match;
    }
  }
  return winner;
}

function collectMatches(value: string, rules: PermissionDomainRules): PermissionMatch[] {
  const matches: PermissionMatch[] = [];
  for (const [pattern, action] of Object.entries(rules)) {
    if (matchPermissionPattern(pattern, value)) {
      matches.push({ pattern, action });
    }
  }
  return matches;
}

/**
 * Splits `command` into the simple commands that would execute and evaluates
 * each segment's full trimmed text against the rules. Aggregation: any
 * segment deny -> overall deny; else any segment ask (including
 * no-rule-match, which for shell is a fail-safe ask) -> overall ask; all
 * allow -> overall allow. A split parse failure yields `{ verdict: "ask" }`:
 * fail-safe, never an auto-allow and never a spurious deny.
 */
export function evaluateShellPermission(
  command: string,
  rules: PermissionDomainRules,
): PermissionEvalResult {
  const split = splitShellCommandLine(command);
  if (!split.ok) {
    return { verdict: "ask" };
  }
  if (split.segments.length === 0) {
    // Empty / comment-only command line: no rule can meaningfully match, so
    // do not vacuously allow it.
    return { verdict: "ask", segments: [] };
  }

  const segments: SegmentResult[] = split.segments.map((segment) => {
    const result = pickVerdict(collectMatches(segment, rules));
    return {
      segment,
      verdict: result.verdict,
      ...(result.matched ? { matched: result.matched } : {}),
    };
  });

  const denySegment = segments.find((s) => s.verdict === "deny");
  if (denySegment) {
    return {
      verdict: "deny",
      ...(denySegment.matched ? { matched: denySegment.matched } : {}),
      segments,
    };
  }
  const askSegment = segments.find((s) => s.verdict === "ask");
  if (askSegment) {
    return {
      verdict: "ask",
      ...(askSegment.matched ? { matched: askSegment.matched } : {}),
      segments,
    };
  }
  const allowSegment = segments.find((s) => s.matched !== undefined);
  return {
    verdict: "allow",
    ...(allowSegment?.matched ? { matched: allowSegment.matched } : {}),
    segments,
  };
}

/**
 * Evaluates a canonical (realpath'd) absolute `filePath` — resolved by the
 * caller — against read_file rules normalized at config-load time.
 *
 * - Absolute patterns match against the canonical path directly.
 * - Relative patterns have workspace-relative semantics: the path is
 *   expressed relative to `ctx.workspaceRoot`; if it escapes the workspace
 *   (`..` prefix or absolute), the pattern never matches. Otherwise the
 *   pattern is matched against the workspace-relative form with `/`
 *   separators.
 * - Path separators are normalized to `/` on both sides, and on win32 both
 *   sides are lowercased (NTFS is case-insensitive, akin to `pathCompareKey`
 *   in tools.ts); POSIX matching stays case-sensitive.
 *
 * No-match contract: when no rule matched, the result is
 * `{ verdict: "ask" }` with `matched` undefined. The CALLER distinguishes
 * this "ask from fallback" from "ask from rule" via `matched === undefined`
 * and substitutes its built-in location fallback.
 */
export function evaluateReadFilePermission(
  filePath: string,
  rules: PermissionDomainRules,
  ctx: { workspaceRoot: string },
): PermissionEvalResult {
  const caseInsensitive = process.platform === "win32";
  const matches: PermissionMatch[] = [];
  for (const [pattern, action] of Object.entries(rules)) {
    if (matchReadFilePattern(pattern, filePath, ctx.workspaceRoot, caseInsensitive)) {
      matches.push({ pattern, action });
    }
  }
  return pickVerdict(matches);
}

/**
 * Low-level read_file pattern match with explicit case handling, exported so
 * win32 semantics can be exercised on any platform. Prefer
 * `evaluateReadFilePermission`, which derives `caseInsensitive` from the
 * current platform.
 */
export function matchReadFilePattern(
  pattern: string,
  filePath: string,
  workspaceRoot: string,
  caseInsensitive: boolean,
): boolean {
  if (isAbsolutePathPattern(pattern)) {
    return matchPermissionPattern(
      pathMatchKey(pattern, caseInsensitive),
      pathMatchKey(filePath, caseInsensitive),
    );
  }
  const relative = path.relative(workspaceRoot, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return false; // escapes the workspace: relative patterns never match
  }
  return matchPermissionPattern(
    pathMatchKey(pattern, caseInsensitive),
    pathMatchKey(relative, caseInsensitive),
  );
}

function pathMatchKey(value: string, caseInsensitive: boolean): string {
  const key = value.replace(/\\/gu, "/");
  return caseInsensitive ? key.toLowerCase() : key;
}
