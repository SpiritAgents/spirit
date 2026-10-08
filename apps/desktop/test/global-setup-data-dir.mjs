import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Repo-local scratch root for test-isolated Spirit data dirs (never the global
// system temp). The run root is removed here in global teardown — after every
// worker process has exited — rather than in per-file afterAll hooks, because
// host code intentionally fires detached async work (e.g.
// `void ensureDesktopTranscriptSessionDirForChatPath` in session-bundle.ts)
// that can recreate dirs after an in-process cleanup ran.
const repoTmpDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "tmp");

export default function setup() {
  mkdirSync(repoTmpDir, { recursive: true });
  const runRoot = mkdtempSync(path.join(repoTmpDir, "vitest-data-dir-run-"));
  process.env.SPIRIT_TEST_DATA_ROOT = runRoot;
  return () => {
    rmSync(runRoot, { recursive: true, force: true });
  };
}
