import assert from "node:assert/strict";
import { test } from "vitest";

import {
  diagnosticsPathsHeadlineDetail,
  parseDiagnosticsPathsFromRequest,
} from "../../src/lib/diagnostics-path-display.ts";

test("parseDiagnosticsPathsFromRequest normalizes paths array", () => {
  assert.deepEqual(parseDiagnosticsPathsFromRequest({ paths: [" src/a.ts ", "src/b.ts"] }), [
    "src/a.ts",
    "src/b.ts",
  ]);
});

test("diagnosticsPathsHeadlineDetail formats one, two, and many paths", () => {
  assert.equal(diagnosticsPathsHeadlineDetail(["src/App.tsx"]), "App.tsx");
  assert.equal(
    diagnosticsPathsHeadlineDetail(["src/App.tsx", "src/index.ts"]),
    "App.tsx, index.ts",
  );
  assert.equal(
    diagnosticsPathsHeadlineDetail(["src/App.tsx", "src/index.ts", "lib/util.ts"]),
    "App.tsx +2",
  );
});
