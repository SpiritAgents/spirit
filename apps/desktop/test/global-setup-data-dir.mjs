import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Scratch root for test-isolated Spirit data dirs, under the system temp
// directory. The run root is removed here in global teardown — after every
// worker process has exited — rather than in per-file afterAll hooks, because
// host code intentionally fires detached async work (e.g.
// `void ensureDesktopTranscriptSessionDirForChatPath` in session-bundle.ts)
// that can recreate dirs after an in-process cleanup ran.
export default function setup() {
  const runRoot = mkdtempSync(path.join(tmpdir(), "spirit-vitest-data-dir-run-"));
  process.env.SPIRIT_TEST_DATA_ROOT = runRoot;
  return () => {
    rmSync(runRoot, { recursive: true, force: true });
  };
}
