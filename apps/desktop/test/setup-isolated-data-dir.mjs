import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Tests must never touch the real user-level Spirit data dir (~/.spirit): even
// write-then-delete interferes with the installed product, and leftovers surface
// as phantom sessions/workspaces in Desktop. Point the product's data-dir
// override at a per-test-file temp dir under the system temp run root (swept by
// the global teardown in global-setup-data-dir.mjs); individual tests may still
// set SPIRIT_DATA_DIR themselves for per-test isolation.
const runRoot = process.env.SPIRIT_TEST_DATA_ROOT ?? tmpdir();
process.env.SPIRIT_DATA_DIR = mkdtempSync(path.join(runRoot, "spirit-vitest-data-"));
