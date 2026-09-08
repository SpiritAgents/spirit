import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "vitest";

import { checkExtensionPackage } from "./check-package.js";

const fixtureDirs: string[] = [];

async function fixture(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "extension-toolkit-check-"));
  fixtureDirs.push(dir);
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(dir, ...relativePath.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
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
    version: "1.0.0",
    sourceId: "test",
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

test("a valid extension package produces no findings", async () => {
  const dir = await fixture({
    "package.json": `${JSON.stringify({ name: "demo-ext", version: "1.0.0" })}\n`,
    "skills/demo/SKILL.md": VALID_SKILL,
    "rule.md": "# Rules\n",
    "mcp.json": '{"servers": {}}\n',
  });
  assert.deepEqual(await checkExtensionPackage(dir), []);
});

test("a skill whose frontmatter name mismatches its directory is reported", async () => {
  const dir = await fixture({
    "package.json": `${JSON.stringify({ name: "demo-ext", version: "1.0.0" })}\n`,
    "skills/demo/SKILL.md": "---\nname: other\ndescription: Mismatch.\n---\n\nBody.\n",
  });
  const findings = await checkExtensionPackage(dir);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.path, "skills/demo/SKILL.md");
});

test("an mcp.json failing the runtime parser is reported", async () => {
  const dir = await fixture({
    "package.json": `${JSON.stringify({ name: "demo-ext", version: "1.0.0" })}\n`,
    "mcp.json": '{"servers": []}\n',
  });
  const findings = await checkExtensionPackage(dir);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.path, "mcp.json");
});

test("a directory without package.json or a dump is reported", async () => {
  const dir = await fixture({});
  const findings = await checkExtensionPackage(dir);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.path, "package.json");
});

test("dump mode checks declared contributions against the content", async () => {
  const dir = await fixture({ ".spirit/extension.json": VALID_DUMP });
  const findings = await checkExtensionPackage(dir);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.path, "manifest.contributes");
});

test("dump mode passes when the declared skills ship valid files", async () => {
  const dir = await fixture({
    ".spirit/extension.json": VALID_DUMP,
    "skills/demo/SKILL.md": VALID_SKILL,
  });
  assert.deepEqual(await checkExtensionPackage(dir), []);
});
