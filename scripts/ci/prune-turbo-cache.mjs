#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CACHE_ENTRY_PATTERN = /^([0-9a-f]+)(?:-meta\.json|-manifest\.json|\.tar\.(?:zst|gz))$/u;

export function collectActiveTurboHashes(runsDir) {
  const hashes = new Set();
  if (!fs.existsSync(runsDir)) {
    return hashes;
  }
  for (const entry of fs.readdirSync(runsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }
    const raw = fs.readFileSync(path.join(runsDir, entry.name), "utf8");
    const summary = JSON.parse(raw);
    for (const task of summary.tasks ?? []) {
      if (typeof task?.hash === "string" && task.hash.length > 0) {
        hashes.add(task.hash);
      }
    }
  }
  return hashes;
}

/**
 * Trim `.turbo/cache` down to the hashes referenced by the current run's
 * `.turbo/runs/*.json` summaries so main-branch CI cache saves stay bounded
 * instead of growing across commits.
 */
export function pruneTurboCache(rootDir = repoRoot) {
  const turboDir = path.join(rootDir, ".turbo");
  const runsDir = path.join(turboDir, "runs");
  const cacheDir = path.join(turboDir, "cache");

  const activeHashes = collectActiveTurboHashes(runsDir);
  if (activeHashes.size === 0) {
    return { skipped: true, activeHashes: 0, keptFiles: 0, prunedFiles: 0 };
  }

  let keptFiles = 0;
  let prunedFiles = 0;
  if (fs.existsSync(cacheDir)) {
    for (const entry of fs.readdirSync(cacheDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const match = CACHE_ENTRY_PATTERN.exec(entry.name);
      if (!match) continue;
      if (activeHashes.has(match[1])) {
        keptFiles += 1;
      } else {
        fs.rmSync(path.join(cacheDir, entry.name), { force: true });
        prunedFiles += 1;
      }
    }
  }

  fs.rmSync(runsDir, { recursive: true, force: true });
  return { skipped: false, activeHashes: activeHashes.size, keptFiles, prunedFiles };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = pruneTurboCache(repoRoot);
  if (result.skipped) {
    console.log("[turbo-cache] no run summaries found; skipping prune");
  } else {
    console.log(
      `[turbo-cache] kept ${result.activeHashes} active hashes (${result.keptFiles} files), pruned ${result.prunedFiles} stale files`,
    );
  }
}
