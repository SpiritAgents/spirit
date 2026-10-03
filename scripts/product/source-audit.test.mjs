import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const keyringFiles = new Set([
  "apps/cli/src/adapters.rs",
  "apps/cli/src/model_registry.rs",
  "apps/desktop/src/host/storage.ts",
  "apps/desktop/src/host/github-auth-storage.ts",
  "packages/host-internal/src/credentials/provider-accounts.ts",
]);
const pattern =
  /https?:\/\/(?:download\.)?spirit\.dev|spirit:\/\/|["'`]\.spirit(?:["'`/])|["'`]Spirit(?:["'`]| [A-Za-z])/u;

test("current executable consumers do not redeclare product facts", async () => {
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split(
    "\0",
  );
  const findings = [];
  for (const file of files) {
    if (!/^(apps|packages|scripts)\//.test(file) || !/\.(ts|tsx|mjs|rs|json)$/.test(file)) continue;
    // Never read installation templates, their generator, or generated installers.
    if (/\/install\/|generate-install-scripts|\/public\/install(?:\.ps1)?$/.test(file)) continue;
    if (
      /\/(?:test|tests|smoke|built-in|locales)\//.test(file) ||
      /(?:\.test\.|\/tests\.rs$|^scripts\/eval-)/.test(file)
    )
      continue;
    let source = await readFile(path.join(root, file), "utf8");
    if (file.endsWith(".rs")) source = source.split("#[cfg(test)]")[0];
    for (const [index, line] of source.split(/\r?\n/).entries()) {
      if (/^\s*(?:\/\/|\/\*|\*)/.test(line) || !pattern.test(line)) continue;
      if (keyringFiles.has(file) && /KEYRING_SERVICE|keyring::Entry::new/.test(line)) continue;
      findings.push(`${file}:${index + 1}: ${line.trim()}`);
    }
  }
  assert.deepEqual(
    findings,
    [],
    "Product literals need a generated source or an explicitly reviewed technical-identity exception",
  );
});
