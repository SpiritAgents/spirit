import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

import { LspService } from "./service.js";
import { resolvePyrightOnPath } from "./resolve-server.js";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

test.skipIf(!(await resolvePyrightOnPath()))(
  "getDiagnosticsForPath reports a type error after document sync",
  async () => {
    const relativePath = "packages/agent-core/src/lsp/.diag-integration-temp.py";
    const absolutePath = path.join(workspaceRoot, relativePath);
    await writeFile(absolutePath, 'x: int = "not-a-number"\n', "utf8");

    const lsp = new LspService(workspaceRoot);
    await lsp.probe();
    assert.equal(lsp.enabled, true);

    try {
      const first = await lsp.getDiagnosticsForPath(relativePath, 12_000);
      assert.ok(
        first.diagnostics.some((item) => (item.severity ?? 1) === 1),
        `expected at least one error diagnostic; formatted=${first.formatted}`,
      );
      assert.match(first.formatted, /error/i);

      // The second call must wait again; it must not hit the empty cache from when the file was still clean.
      await writeFile(absolutePath, 'x: int = "still-wrong"\n', "utf8");
      const second = await lsp.getDiagnosticsForPath(relativePath, 12_000);
      assert.ok(
        second.diagnostics.some((item) => (item.severity ?? 1) === 1),
        `expected error after rewrite; formatted=${second.formatted}`,
      );
    } finally {
      await lsp.dispose();
      await rm(absolutePath, { force: true });
    }
  },
);
