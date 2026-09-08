import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { afterEach, test } from "vitest";

import { packExtension } from "./pack.js";
import { parseExtensionDumpText } from "./schema.js";

const fixtureDirs: string[] = [];

async function fixture(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "extension-toolkit-pack-"));
  fixtureDirs.push(dir);
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(dir, ...relativePath.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
  return dir;
}

async function outDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "extension-toolkit-pack-out-"));
  fixtureDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(fixtureDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const VALID_SKILL = "---\nname: demo\ndescription: Demo skill.\n---\n\nDo the demo thing.\n";

const VALID_DUMP = `${JSON.stringify(
  {
    schemaVersion: 1,
    name: "demo-ext",
    version: "1.2.0",
    sourceId: "self-declared",
    displayName: "Demo",
    description: "Demo extension.",
    manifest: {
      supportedHosts: ["cli"],
      requestedCapabilities: ["skills"],
      contributes: { skills: true },
    },
  },
  null,
  2,
)}\n`;

const VALID_PACKAGE_FILES: Record<string, string> = {
  "package.json": '{"name": "demo-ext", "version": "1.2.0"}\n',
  ".spirit/extension.json": VALID_DUMP,
  "skills/demo/SKILL.md": VALID_SKILL,
};

test("pack produces a zip whose dump parses and whose content is complete", async () => {
  const dir = await fixture(VALID_PACKAGE_FILES);
  const out = await outDir();
  const result = await packExtension(dir, out);

  assert.equal(result.name, "demo-ext");
  assert.equal(result.version, "1.2.0");
  assert.equal(result.fileCount, 3);
  assert.ok(result.zipPath.endsWith("demo-ext-1.2.0.zip"));

  const unzipped = unzipSync(new Uint8Array(await readFile(result.zipPath)));
  const dump = parseExtensionDumpText(
    strFromU8(unzipped[".spirit/extension.json"] ?? new Uint8Array()),
  );
  assert.equal(dump.name, "demo-ext");
  assert.equal(dump.version, "1.2.0");
  assert.equal(strFromU8(unzipped["skills/demo/SKILL.md"] ?? new Uint8Array()), VALID_SKILL);
  assert.ok(unzipped["package.json"]);
});

test("pack rejects a bare package without the self-declared dump", async () => {
  const dir = await fixture({ "package.json": '{"name": "demo-ext", "version": "1.2.0"}\n' });
  await assert.rejects(packExtension(dir, await outDir()), /extension-toolkit init/);
});

test("pack rejects a package that fails check", async () => {
  const dir = await fixture({
    "package.json": '{"name": "demo-ext", "version": "1.2.0"}\n',
    ".spirit/extension.json": VALID_DUMP,
    // Declared skills contribution but no skills directory.
  });
  await assert.rejects(packExtension(dir, await outDir()), /check failed/);
});
