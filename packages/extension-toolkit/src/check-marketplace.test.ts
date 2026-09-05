import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "vitest";

import { checkMarketplaceRegistry } from "./check-marketplace.js";

const fixtureDirs: string[] = [];

async function fixture(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "extension-toolkit-registry-"));
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
const VALID_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7"/></svg>\n';

function indexWith(entry: Record<string, unknown>): string {
  return `${JSON.stringify(
    {
      schemaVersion: 1,
      name: "test-registry",
      displayName: "Test Registry",
      extensions: [entry],
    },
    null,
    2,
  )}\n`;
}

const LOCAL_ENTRY = {
  name: "demo-ext",
  version: "1.0.0",
  source: "./extensions/demo-ext",
  icon: "extensions/demo-ext/icon.svg",
  displayName: "Demo",
  description: "Demo extension.",
  reviewStatus: "verified",
  manifest: {
    supportedHosts: ["cli"],
    requestedCapabilities: ["skills"],
    contributes: { skills: true },
  },
};

const VALID_REGISTRY_FILES: Record<string, string> = {
  ".spirit/marketplace.json": indexWith(LOCAL_ENTRY),
  "extensions/demo-ext/package.json": '{"name": "demo-ext", "version": "1.0.0"}\n',
  "extensions/demo-ext/icon.svg": VALID_ICON,
  "extensions/demo-ext/skills/demo/SKILL.md": VALID_SKILL,
};

test("a valid registry produces no findings", async () => {
  const dir = await fixture(VALID_REGISTRY_FILES);
  assert.deepEqual(await checkMarketplaceRegistry(dir), []);
});

test("a missing marketplace index is reported", async () => {
  const dir = await fixture({});
  const findings = await checkMarketplaceRegistry(dir);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.path, ".spirit/marketplace.json");
});

test("a schema-invalid index is reported", async () => {
  const dir = await fixture({
    ".spirit/marketplace.json": indexWith({ ...LOCAL_ENTRY, reviewStatus: "bogus" }),
    "extensions/demo-ext/package.json": '{"name": "demo-ext", "version": "1.0.0"}\n',
    "extensions/demo-ext/icon.svg": VALID_ICON,
    "extensions/demo-ext/skills/demo/SKILL.md": VALID_SKILL,
  });
  const findings = await checkMarketplaceRegistry(dir);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.path, ".spirit/marketplace.json");
  assert.match(findings[0]?.message ?? "", /reviewStatus/);
});

test("a local entry whose content directory is missing is reported", async () => {
  const dir = await fixture({
    ".spirit/marketplace.json": indexWith({ ...LOCAL_ENTRY, icon: undefined }),
  });
  const findings = await checkMarketplaceRegistry(dir);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.path, "extensions[demo-ext].source");
});

test("an icon containing a script element is reported", async () => {
  const dir = await fixture({
    ...VALID_REGISTRY_FILES,
    "extensions/demo-ext/icon.svg":
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>\n',
  });
  const findings = await checkMarketplaceRegistry(dir);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.path, "extensions[demo-ext].icon");
});

test("npm-sourced entries skip content checks", async () => {
  const dir = await fixture({
    ".spirit/marketplace.json": indexWith({
      name: "npm-ext",
      version: "1.0.0",
      source: { source: "npm", package: "demo-ext@1.0.0" },
      displayName: "Npm Demo",
      description: "Registry entry backed by an npm artifact.",
      reviewStatus: "unverified",
      manifest: { supportedHosts: ["cli"] },
    }),
  });
  assert.deepEqual(await checkMarketplaceRegistry(dir), []);
});
