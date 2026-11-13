import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { afterEach, beforeEach, test } from "vitest";

const require = createRequire(import.meta.url);
const appBuilderRequire = createRequire(require.resolve("app-builder-lib/package.json"));
const { FileMatcher } = appBuilderRequire("app-builder-lib/out/fileMatcher");
const { computeFileSets } = appBuilderRequire("app-builder-lib/out/util/appFileCopier");
const asar = require("@electron/asar");

let fixtureRoot;

beforeEach(async () => {
  fixtureRoot = await mkdtemp(join(tmpdir(), "spirit-packaging-minimatch-"));
  await mkdir(join(fixtureRoot, "app", "dist-electron", "electron"), { recursive: true });
  await mkdir(join(fixtureRoot, "app", "target", "debug"), { recursive: true });
  await writeFile(join(fixtureRoot, "app", "package.json"), '{"name":"fixture"}\n');
  await writeFile(join(fixtureRoot, "app", "dist-electron", "electron", "main.js"), "export {};\n");
  await writeFile(join(fixtureRoot, "app", "target", "debug", "ignored"), "excluded\n");
});

afterEach(async () => {
  await rm(fixtureRoot, { recursive: true, force: true });
});

test("Minimatch 11 supports app-builder FileMatcher file enumeration", async () => {
  const appRoot = join(fixtureRoot, "app");
  const matcher = new FileMatcher(appRoot, join(fixtureRoot, "out"), (value) => value, [
    "package.json",
    "dist-electron/**/*",
    "!**/target/**/*",
  ]);
  const fileSets = await computeFileSets(
    [matcher],
    undefined,
    { info: { areNodeModulesHandledExternally: true } },
    false,
  );
  const files = fileSets
    .flatMap((fileSet) => fileSet.files)
    .map((file) => relative(appRoot, file).replace(/\\/g, "/"));

  assert.deepEqual(files.sort(), ["dist-electron/electron/main.js", "package.json"]);
});

test("Minimatch 11 supports ASAR package creation and extraction", async () => {
  await mkdir(join(fixtureRoot, "app", "nested"), { recursive: true });
  await writeFile(join(fixtureRoot, "app", "nested", "message.txt"), "minimatch-11-smoke\n");
  const output = join(fixtureRoot, "app.asar");

  await asar.createPackage(join(fixtureRoot, "app"), output);

  assert.equal(asar.extractFile(output, "nested/message.txt").toString(), "minimatch-11-smoke\n");
});
