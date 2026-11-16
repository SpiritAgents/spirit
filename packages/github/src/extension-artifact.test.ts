import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { test } from "vitest";
import { pathToFileURL } from "node:url";
import path from "node:path";

test("the built extension backend has no workspace or host runtime dependency", async () => {
  const root = path.resolve(import.meta.dirname, "../dist/extension");
  const main = await readFile(path.join(root, "index.mjs"), "utf8");
  assert.doesNotMatch(main, /from\s*["']@spiritagent\//);
  assert.doesNotMatch(main, /from\s*["']electron["']|keyring|oauth-bridge/);
  const module = await import(pathToFileURL(path.join(root, "index.mjs")).href);
  assert.equal(typeof module.activate, "function");
  const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  assert.equal(manifest.version, "1.0.0");
  assert.equal(manifest.author.name, "Spirit");
  for (const file of ["README.md", "LICENSE", "icon.svg"])
    assert.ok((await stat(path.join(root, file))).size > 0);
});
