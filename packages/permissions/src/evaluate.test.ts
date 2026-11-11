import assert from "node:assert/strict";
import { homedir } from "node:os";
import path from "node:path";
import { test } from "vitest";

import type { PermissionDomainRules } from "@spiritagent/config/credentials";
import { normalizeReadFilePattern } from "./config-io.js";
import {
  evaluateReadFilePermission,
  evaluateShellPermission,
  matchReadFilePattern,
} from "./evaluate.js";

function shuffle<T>(items: T[], seed: number): T[] {
  // Deterministic LCG shuffle so permutations are reproducible.
  const result = [...items];
  let state = seed;
  for (let i = result.length - 1; i > 0; i -= 1) {
    state = (state * 1103515245 + 12345) % 2147483648;
    const j = state % (i + 1);
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

function permuteRules(rules: PermissionDomainRules, seed: number): PermissionDomainRules {
  return Object.fromEntries(shuffle(Object.entries(rules), seed));
}

/**
 * Platform-correct absolute fixture path: path.join(path.sep, ...) is only
 * drive-relative on win32, which would break absolute-pattern classification.
 */
function abs(...parts: string[]): string {
  return process.platform === "win32" ? `C:\\${parts.join("\\")}` : path.join("/", ...parts);
}

test("rule priority is order-independent: deny beats allow regardless of JSON order", () => {
  // The anti-last-match-wins case: `*` allow must NOT override the deny.
  const rules: PermissionDomainRules = { "rm -rf *": "deny", "*": "allow" };
  for (const seed of [1, 2, 3, 42]) {
    const result = evaluateShellPermission("rm -rf /", permuteRules(rules, seed));
    assert.equal(result.verdict, "deny");
    assert.deepEqual(result.matched, { pattern: "rm -rf *", action: "deny" });
  }
});

test("shuffling a rule set never changes verdicts", () => {
  const rules: PermissionDomainRules = {
    "*": "allow",
    "git push *": "ask",
    "rm -rf *": "deny",
    "sudo *": "ask",
  };
  const commands = ["ls -la", "git push origin main", "rm -rf /tmp/x", "sudo apt update"];
  for (const seed of [7, 13, 99, 1234]) {
    const shuffled = permuteRules(rules, seed);
    for (const command of commands) {
      assert.equal(
        evaluateShellPermission(command, shuffled).verdict,
        evaluateShellPermission(command, rules).verdict,
        `verdict for ${JSON.stringify(command)} changed under permutation ${seed}`,
      );
    }
  }
});

test("deny beats ask and allow; ask beats allow", () => {
  const rules: PermissionDomainRules = {
    "*": "allow",
    "git *": "ask",
    "git push *": "deny",
  };
  const denied = evaluateShellPermission("git push origin", rules);
  assert.equal(denied.verdict, "deny");
  assert.deepEqual(denied.matched, { pattern: "git push *", action: "deny" });

  const asked = evaluateShellPermission("git status", rules);
  assert.equal(asked.verdict, "ask");
  assert.deepEqual(asked.matched, { pattern: "git *", action: "ask" });

  assert.equal(evaluateShellPermission("ls", rules).verdict, "allow");
});

test("matched is the most specific (longest) pattern at the winning priority", () => {
  const rules: PermissionDomainRules = { "rm *": "deny", "rm -rf *": "deny" };
  const result = evaluateShellPermission("rm -rf /", rules);
  assert.deepEqual(result.matched, { pattern: "rm -rf *", action: "deny" });
});

test("matched prefers the specific ask rule over a match-all ask rule, order-independently", () => {
  for (const rules of [
    { "*": "ask", "git push *": "ask" },
    { "git push *": "ask", "*": "ask" },
  ] satisfies PermissionDomainRules[]) {
    const result = evaluateShellPermission("git push origin main", rules);
    assert.equal(result.verdict, "ask");
    assert.deepEqual(result.matched, { pattern: "git push *", action: "ask" });
  }
});

test("composite shell aggregation: any deny -> deny, else any ask -> ask, else allow", () => {
  const rules: PermissionDomainRules = { "echo *": "allow", "rm -rf *": "deny" };

  const withDeny = evaluateShellPermission("echo hi && rm -rf /", rules);
  assert.equal(withDeny.verdict, "deny");
  assert.deepEqual(withDeny.matched, { pattern: "rm -rf *", action: "deny" });

  const withAsk = evaluateShellPermission("echo hi && unknown-cmd", rules);
  assert.equal(withAsk.verdict, "ask");

  const allAllow = evaluateShellPermission("echo a && echo b", rules);
  assert.equal(allAllow.verdict, "allow");
  assert.deepEqual(allAllow.matched, { pattern: "echo *", action: "allow" });
});

test("shell segment detail reports each simple command with its own verdict", () => {
  const rules: PermissionDomainRules = { "echo *": "allow", "rm -rf *": "deny" };
  const result = evaluateShellPermission("echo ok && rm -rf /", rules);
  assert.equal(result.segments?.length, 2);
  assert.deepEqual(result.segments?.[0], {
    segment: "echo ok",
    verdict: "allow",
    matched: { pattern: "echo *", action: "allow" },
  });
  assert.deepEqual(result.segments?.[1], {
    segment: "rm -rf /",
    verdict: "deny",
    matched: { pattern: "rm -rf *", action: "deny" },
  });
});

test("command substitution content is evaluated (echo $(rm -rf /) is denied)", () => {
  const rules: PermissionDomainRules = { "echo *": "allow", "rm -rf *": "deny" };
  const result = evaluateShellPermission("echo $(rm -rf /)", rules);
  assert.equal(result.verdict, "deny");
  assert.equal(result.segments?.length, 2);
});

test("shell no-match is a fail-safe ask with matched undefined", () => {
  const result = evaluateShellPermission("some-random-command --flag", { "echo *": "allow" });
  assert.equal(result.verdict, "ask");
  assert.equal(result.matched, undefined);
});

test("shell parse failure is a fail-safe ask: never allow, never spurious deny", () => {
  assert.equal(evaluateShellPermission('echo "unclosed', { "*": "allow" }).verdict, "ask");
  assert.equal(evaluateShellPermission('echo "unclosed', { "*": "deny" }).verdict, "ask");
  const result = evaluateShellPermission("echo $(unclosed", { "*": "allow" });
  assert.equal(result.verdict, "ask");
  assert.equal(result.matched, undefined);
});

test("empty command line asks instead of vacuously allowing", () => {
  const result = evaluateShellPermission("   ", { "*": "allow" });
  assert.equal(result.verdict, "ask");
  assert.deepEqual(result.segments, []);
});

// --- read_file ---

test("read_file: tilde expansion produces an absolute pattern that matches the home dir", () => {
  const normalized = normalizeReadFilePattern("~/.ssh/*");
  // Compare separator-normalized: homedir() uses platform separators.
  const homePrefix = homedir().replace(/\\/gu, "/");
  assert.equal(normalized.pattern.replace(/\\/gu, "/"), `${homePrefix}/.ssh/*`);
  assert.equal(normalized.warning, undefined);

  const rules: PermissionDomainRules = { [normalized.pattern]: "deny" };
  const result = evaluateReadFilePermission(path.join(homedir(), ".ssh", "id_rsa"), rules, {
    workspaceRoot: path.join(homedir(), "some-workspace"),
  });
  assert.equal(result.verdict, "deny");
  assert.deepEqual(result.matched, { pattern: normalized.pattern, action: "deny" });
});

test("read_file: relative patterns match workspace-internal paths only", () => {
  const workspaceRoot = abs("tmp", "perm-test-workspace");
  const rules: PermissionDomainRules = { ".env": "allow", "secrets/*": "deny" };

  const inside = evaluateReadFilePermission(path.join(workspaceRoot, ".env"), rules, {
    workspaceRoot,
  });
  assert.equal(inside.verdict, "allow");
  assert.deepEqual(inside.matched, { pattern: ".env", action: "allow" });

  const nestedDeny = evaluateReadFilePermission(
    path.join(workspaceRoot, "secrets", "key.pem"),
    rules,
    {
      workspaceRoot,
    },
  );
  assert.equal(nestedDeny.verdict, "deny");

  // Outside the workspace a relative pattern never matches; with no other
  // rule this falls back to ask with matched undefined.
  const outside = evaluateReadFilePermission(abs("etc", ".env"), rules, {
    workspaceRoot,
  });
  assert.equal(outside.verdict, "ask");
  assert.equal(outside.matched, undefined);
});

test("read_file: leading-wildcard patterns match canonical paths anywhere", () => {
  const workspaceRoot = abs("tmp", "perm-test-workspace");
  const rules: PermissionDomainRules = { "*/.env*": "deny" };

  const nested = evaluateReadFilePermission(
    path.join(workspaceRoot, "config", ".env.local"),
    rules,
    {
      workspaceRoot,
    },
  );
  assert.equal(nested.verdict, "deny");

  // A leading `*` absorbs the root separator, so the pattern is absolute-form
  // and also denies paths outside the workspace.
  const outside = evaluateReadFilePermission(abs("var", "config", ".env"), rules, {
    workspaceRoot,
  });
  assert.equal(outside.verdict, "deny");
  assert.deepEqual(outside.matched, { pattern: "*/.env*", action: "deny" });
});

test("read_file: a bare * pattern matches external absolute paths", () => {
  const result = evaluateReadFilePermission(
    abs("etc", "hosts"),
    { "*": "allow" },
    {
      workspaceRoot: abs("tmp", "perm-test-workspace"),
    },
  );
  assert.equal(result.verdict, "allow");
  assert.deepEqual(result.matched, { pattern: "*", action: "allow" });
});

test("read_file: absolute patterns match canonical paths anywhere", () => {
  const workspaceRoot = abs("tmp", "perm-test-workspace");
  const pattern = abs("etc", "ssl", "*");
  const rules: PermissionDomainRules = { [pattern]: "ask" };

  const result = evaluateReadFilePermission(abs("etc", "ssl", "cert.pem"), rules, {
    workspaceRoot,
  });
  assert.equal(result.verdict, "ask");
  assert.deepEqual(result.matched, { pattern, action: "ask" });
});

test("read_file: no rule matched is ask from fallback (matched undefined)", () => {
  const result = evaluateReadFilePermission(
    abs("x", "y.txt"),
    { "*.md": "allow" },
    {
      workspaceRoot: abs("x"),
    },
  );
  assert.equal(result.verdict, "ask");
  assert.equal(result.matched, undefined);
});

test("read_file: deny beats allow order-independently", () => {
  const workspaceRoot = abs("tmp", "perm-test-workspace");
  const rules: PermissionDomainRules = { "*": "allow", "*/.env*": "deny" };
  for (const seed of [5, 51]) {
    const result = evaluateReadFilePermission(
      path.join(workspaceRoot, "app", ".env"),
      permuteRules(rules, seed),
      { workspaceRoot },
    );
    assert.equal(result.verdict, "deny");
  }
});

test("matchReadFilePattern: case handling is explicit (win32 semantics are simulated)", () => {
  // Absolute-pattern branch avoids path.relative, so it is platform-independent.
  assert.equal(matchReadFilePattern("/home/*/.env", "/home/u/.env", "/ws", false), true);
  assert.equal(matchReadFilePattern("/HOME/*/.ENV", "/home/u/.env", "/ws", false), false);
  assert.equal(matchReadFilePattern("/HOME/*/.ENV", "/home/u/.env", "/ws", true), true);
  // Windows-style absolute pattern with drive letter and backslashes.
  assert.equal(
    matchReadFilePattern(String.raw`C:\Users\*\*.TXT`, "c:/users/bob/readme.txt", "c:/ws", true),
    true,
  );
  assert.equal(
    matchReadFilePattern(String.raw`C:\Users\*\*.TXT`, "c:/users/bob/readme.txt", "c:/ws", false),
    false,
  );
});

test("evaluateReadFilePermission follows the platform's case behavior", () => {
  const workspaceRoot = abs("tmp", "perm-test-workspace");
  const rules: PermissionDomainRules = { "UPPER/*": "allow" };
  const result = evaluateReadFilePermission(path.join(workspaceRoot, "upper", "file.txt"), rules, {
    workspaceRoot,
  });
  // NTFS is case-insensitive; POSIX is not.
  assert.equal(result.verdict, process.platform === "win32" ? "allow" : "ask");
});
