import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { LspService, resolvePyrightOnPath } from "../index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(here, "../../../..");
const sampleFile = path.join(workspaceRoot, "packages/lsp/src/.smoke-pyright-temp.py");

async function main(): Promise<void> {
  const resolved = await resolvePyrightOnPath();
  if (!resolved) {
    console.log("skip: no pyright-langserver on PATH");
    return;
  }

  await writeFile(sampleFile, "x: int = 1\n", "utf8");
  const lsp = new LspService(workspaceRoot);
  await lsp.probe();
  if (!lsp.enabled) {
    console.log("skip: LSP probe disabled");
    await rm(sampleFile, { force: true });
    return;
  }

  try {
    const relativePath = path.relative(workspaceRoot, sampleFile).replace(/\\/g, "/");
    const result = await lsp.getDiagnosticsForPath(relativePath, 8_000);
    if (result.formatted === undefined) {
      throw new Error("expected formatted diagnostics text");
    }
    console.log(`ok: diagnostics for ${relativePath} (${result.diagnostics.length} items)`);
  } finally {
    await lsp.dispose();
    await rm(sampleFile, { force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
