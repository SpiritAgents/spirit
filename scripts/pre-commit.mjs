#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const TS_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);
const DOC_EXTENSIONS = new Set([".md", ".mdx"]);
const OXFMT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".jsonc",
  ".css",
  ".md",
  ".mdx",
]);
const LINT_ROOTS = ["packages/", "apps/desktop/", "apps/site/"];

function posixPath(relpath) {
  return relpath.split(path.sep).join("/");
}

function extensionOf(relpath) {
  const base = relpath.split("/").pop() ?? relpath;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) {
    return "";
  }
  return base.slice(dot).toLowerCase();
}

function stagedFiles() {
  const result = spawnSync(
    "git",
    ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"],
    { cwd: repoRoot, encoding: "buffer" },
  );
  if (result.error) {
    console.error(`pre-commit: git is required (${result.error.message})`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
  return result.stdout
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map(posixPath);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.error) {
    console.error(`pre-commit: ${command} is required (${result.error.message})`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function isLintTs(relpath) {
  return (
    TS_EXTENSIONS.has(extensionOf(relpath)) &&
    LINT_ROOTS.some((root) => relpath === root.slice(0, -1) || relpath.startsWith(root))
  );
}

function isDoc(relpath) {
  return DOC_EXTENSIONS.has(extensionOf(relpath));
}

function isFormattable(relpath) {
  return OXFMT_EXTENSIONS.has(extensionOf(relpath));
}

function isCliRust(relpath) {
  return relpath.startsWith("apps/cli/") && relpath.endsWith(".rs");
}

const files = stagedFiles();
if (files.length === 0) {
  process.exit(0);
}

const lintTs = files.filter(isLintTs);
const shouldFormat = files.some((file) => TS_EXTENSIONS.has(extensionOf(file)) || isDoc(file));
const formattable = shouldFormat ? files.filter(isFormattable) : [];
const rustFiles = files.filter(isCliRust);

if (lintTs.length > 0) {
  run("pnpm", ["exec", "oxlint", "--deny-warnings", ...lintTs]);
}

if (formattable.length > 0) {
  run("pnpm", ["exec", "oxfmt", "--check", ...formattable]);
}

if (rustFiles.length > 0) {
  run("cargo", ["fmt", "-p", "spirit", "--check", "--", ...rustFiles]);
}

run("python3", [path.join(repoRoot, "scripts/check-invisible-unicode.py"), "--staged"]);
