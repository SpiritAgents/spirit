import assert from "node:assert/strict";
import { test } from "vitest";

import { splitShellCommandLine } from "./shell-split.js";

function segmentsOf(command: string): string[] {
  const result = splitShellCommandLine(command);
  assert.equal(result.ok, true, `expected parse success for ${JSON.stringify(command)}`);
  return result.segments;
}

test("chained commands surface every segment (no allowed && evil bypass)", () => {
  assert.deepEqual(segmentsOf("allowed-cmd && evil-cmd"), ["allowed-cmd", "evil-cmd"]);
  assert.deepEqual(segmentsOf("allowed-cmd; evil-cmd"), ["allowed-cmd", "evil-cmd"]);
});

test("operators inside quotes are not separators", () => {
  assert.deepEqual(segmentsOf('echo "a && b"'), ['echo "a && b"']);
  assert.deepEqual(segmentsOf("echo 'a | b'"), ["echo 'a | b'"]);
  assert.deepEqual(segmentsOf(String.raw`echo a\;b`), [String.raw`echo a\;b`]);
});

test("dollar-paren substitution content is extracted as an extra segment", () => {
  const segments = segmentsOf("echo $(rm -rf ~)");
  assert.deepEqual(segments, ["echo $(rm -rf ~)", "rm -rf ~"]);
});

test("backtick substitution content is extracted as an extra segment", () => {
  const segments = segmentsOf("echo `rm -rf ~`");
  assert.deepEqual(segments, ["echo `rm -rf ~`", "rm -rf ~"]);
});

test("substitution inside double quotes is extracted", () => {
  const segments = segmentsOf('echo "prefix $(rm -rf ~) suffix"');
  assert.deepEqual(segments, ['echo "prefix $(rm -rf ~) suffix"', "rm -rf ~"]);
});

test("pipes split segments", () => {
  assert.deepEqual(segmentsOf("cat log.txt | grep error | wc -l"), [
    "cat log.txt",
    "grep error",
    "wc -l",
  ]);
});

test("pipe-stderr |& splits segments", () => {
  assert.deepEqual(segmentsOf("build-cmd |& tee out.log"), ["build-cmd", "tee out.log"]);
});

test("single ampersand splits background jobs", () => {
  assert.deepEqual(segmentsOf("sleep 10 & echo done"), ["sleep 10", "echo done"]);
});

test("newlines separate commands", () => {
  assert.deepEqual(segmentsOf("echo a\necho b\n\necho c"), ["echo a", "echo b", "echo c"]);
});

test("subshell and group parens split like separators", () => {
  assert.deepEqual(segmentsOf("(echo a && echo b) | wc -l"), ["echo a", "echo b", "wc -l"]);
});

test("nested substitutions are unrolled recursively", () => {
  const segments = segmentsOf("echo $(echo $(date))");
  assert.deepEqual(segments, ["echo $(echo $(date))", "echo $(date)", "date"]);
});

test("arithmetic expansion is opaque and yields no extra segments", () => {
  assert.deepEqual(segmentsOf("echo $((1 + 2))"), ["echo $((1 + 2))"]);
});

test("comments are skipped when # starts a word", () => {
  assert.deepEqual(segmentsOf("echo a # rm -rf /"), ["echo a"]);
  assert.deepEqual(segmentsOf("# full line comment\necho b"), ["echo b"]);
  // Mid-word # is literal.
  assert.deepEqual(segmentsOf("echo a#b"), ["echo a#b"]);
});

test("empty segments are dropped and whitespace-only input yields none", () => {
  assert.deepEqual(segmentsOf("echo a ;  ; echo b"), ["echo a", "echo b"]);
  assert.deepEqual(segmentsOf("   \n  "), []);
});

test("unclosed quote, paren, substitution or backtick fails the parse", () => {
  assert.deepEqual(splitShellCommandLine('echo "unclosed'), { ok: false });
  assert.deepEqual(splitShellCommandLine("echo 'unclosed"), { ok: false });
  assert.deepEqual(splitShellCommandLine("echo $(unclosed"), { ok: false });
  assert.deepEqual(splitShellCommandLine("echo `unclosed"), { ok: false });
  assert.deepEqual(splitShellCommandLine("(echo a"), { ok: false });
  assert.deepEqual(splitShellCommandLine("echo a)"), { ok: false });
  assert.deepEqual(splitShellCommandLine("echo trailing\\"), { ok: false });
});
