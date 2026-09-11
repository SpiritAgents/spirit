#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function failSoft(reason) {
  console.error(`setup-git-hooks: ${reason}`);
  process.exit(0);
}

const probe = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
  cwd: repoRoot,
  encoding: "utf8",
});

if (probe.error) {
  failSoft(probe.error.message);
}

if (probe.status !== 0 || probe.stdout.trim() !== "true") {
  failSoft((probe.stderr || "not a git work tree").trim());
}

const result = spawnSync("git", ["config", "core.hooksPath", ".githooks"], {
  cwd: repoRoot,
  encoding: "utf8",
});

if (result.error) {
  failSoft(result.error.message);
}

if (result.status !== 0) {
  failSoft((result.stderr || "git config core.hooksPath failed").trim());
}
