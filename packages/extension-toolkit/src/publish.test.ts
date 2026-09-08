import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, test } from "vitest";

import { publishExtension } from "./publish.js";
import { parseMarketplaceIndexText } from "./schema.js";

const fixtureDirs: string[] = [];

async function fixture(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "extension-toolkit-publish-"));
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
const VALID_ICON = '<svg xmlns="http://www.w3.org/2000/svg"/>\n';

function dumpJson(overrides: Record<string, unknown> = {}): string {
  return `${JSON.stringify(
    {
      schemaVersion: 1,
      name: "demo-ext",
      version: "1.2.0",
      sourceId: "self-declared",
      displayName: "Demo",
      description: "Demo extension.",
      icon: "icon.svg",
      author: { name: "Alice", email: "alice@example.com" },
      keywords: ["demo"],
      homepage: "https://example.com/demo-ext",
      manifest: {
        supportedHosts: ["cli"],
        requestedCapabilities: ["skills"],
        contributes: { skills: true },
      },
      ...overrides,
    },
    null,
    2,
  )}\n`;
}

function extensionFiles(overrides: Record<string, unknown> = {}): Record<string, string> {
  return {
    "package.json": '{"name": "demo-ext", "version": "1.2.0"}\n',
    ".spirit/extension.json": dumpJson(overrides),
    "icon.svg": VALID_ICON,
    "skills/demo/SKILL.md": VALID_SKILL,
  };
}

const OTHER_ENTRY = {
  name: "other-ext",
  version: "0.3.0",
  source: "./extensions/other-ext",
  displayName: "Other",
  description: "Another extension.",
  reviewStatus: "verified",
  manifest: { supportedHosts: ["cli"] },
};

function existingDemoEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "demo-ext",
    version: "1.2.0",
    source: "./extensions/demo-ext",
    icon: "extensions/demo-ext/icon.svg",
    displayName: "Old Demo",
    description: "Old description.",
    reviewStatus: "verified",
    featured: true,
    manifest: {
      supportedHosts: ["cli"],
      requestedCapabilities: ["skills"],
      contributes: { skills: true },
    },
    ...overrides,
  };
}

async function marketplaceWith(entries: unknown[]): Promise<string> {
  const dir = await fixture({
    ".spirit/marketplace.json": `${JSON.stringify(
      {
        schemaVersion: 1,
        name: "test-market",
        displayName: "Test Market",
        extensions: entries,
      },
      null,
      2,
    )}\n`,
  });
  return dir;
}

async function readIndex(marketplaceDir: string) {
  const raw = await readFile(path.join(marketplaceDir, ".spirit", "marketplace.json"), "utf8");
  return { raw, index: parseMarketplaceIndexText(raw) };
}

test("publish appends a new local entry and copies the full package content", async () => {
  const extensionDir = await fixture({
    ...extensionFiles(),
    "node_modules/dep/index.js": "module.exports = 1;\n",
    ".git/config": "[core]\n",
  });
  const marketplaceDir = await marketplaceWith([OTHER_ENTRY]);

  const result = await publishExtension(extensionDir, marketplaceDir);

  assert.equal(result.replacedExisting, false);
  assert.equal(result.sourceKind, "local");
  assert.equal(result.dryRun, false);
  assert.equal(result.contentAlreadyInPlace, false);
  assert.equal(result.contentDirRelative, "extensions/demo-ext");
  assert.deepEqual(
    [...result.copiedFiles].sort(),
    [".spirit/extension.json", "icon.svg", "package.json", "skills/demo/SKILL.md"].sort(),
  );

  const { raw, index } = await readIndex(marketplaceDir);
  assert.equal(index.extensions.length, 2);
  const entry = index.extensions[1]!;
  assert.equal(entry.name, "demo-ext");
  // The parser normalizes registry-relative paths; the raw file keeps the
  // conventional "./" prefix the entry was written with.
  assert.equal(entry.source, "extensions/demo-ext");
  assert.ok(raw.includes('"source": "./extensions/demo-ext"'));
  assert.equal(entry.icon, "extensions/demo-ext/icon.svg");
  assert.equal(entry.reviewStatus, "unverified");
  assert.ok(!("schemaVersion" in entry));
  assert.ok(!("sourceId" in entry));
  assert.ok(raw.endsWith("\n"));

  const contentDir = path.join(marketplaceDir, "extensions", "demo-ext");
  assert.ok(existsSync(path.join(contentDir, ".spirit", "extension.json")));
  assert.ok(existsSync(path.join(contentDir, "skills", "demo", "SKILL.md")));
  assert.ok(!existsSync(path.join(contentDir, "node_modules")));
  assert.ok(!existsSync(path.join(contentDir, ".git")));
});

test("publish keeps untouched entries byte-identical in the merged index", async () => {
  const extensionDir = await fixture(extensionFiles());
  const marketplaceDir = await marketplaceWith([OTHER_ENTRY]);

  await publishExtension(extensionDir, marketplaceDir);

  const { raw } = await readIndex(marketplaceDir);
  const rawExtensions = (JSON.parse(raw) as { extensions: Record<string, unknown>[] }).extensions;
  // The pre-existing entry keeps its exact raw shape, "./" prefix included.
  assert.deepEqual(rawExtensions[0], OTHER_ENTRY);
});

test("publish replaces a same-version entry in place, preserving reviewStatus and featured", async () => {
  const extensionDir = await fixture(extensionFiles());
  const marketplaceDir = await marketplaceWith([existingDemoEntry(), OTHER_ENTRY]);

  const result = await publishExtension(extensionDir, marketplaceDir);

  assert.equal(result.replacedExisting, true);
  const { index } = await readIndex(marketplaceDir);
  assert.equal(index.extensions.length, 2);
  const entry = index.extensions[0]!;
  assert.equal(entry.name, "demo-ext");
  assert.equal(entry.displayName, "Demo");
  assert.equal(entry.reviewStatus, "verified");
  assert.equal(entry.featured, true);
  assert.equal(index.extensions[1]!.name, "other-ext");
});

test("publish falls back to unverified when the version changes", async () => {
  const extensionDir = await fixture(extensionFiles());
  const marketplaceDir = await marketplaceWith([existingDemoEntry({ version: "1.1.0" })]);

  const result = await publishExtension(extensionDir, marketplaceDir);

  const { index } = await readIndex(marketplaceDir);
  const entry = index.extensions[0]!;
  assert.equal(entry.version, "1.2.0");
  assert.equal(entry.reviewStatus, "unverified");
  assert.equal(entry.featured, true);
  assert.equal(result.entry.reviewStatus, "unverified");
});

test("publish --source npm pins package.json name@version and copies only the icon", async () => {
  const extensionDir = await fixture({
    ...extensionFiles(),
    "package.json": '{"name": "@scope/demo-ext", "version": "1.2.0"}\n',
  });
  const marketplaceDir = await marketplaceWith([]);

  const result = await publishExtension(extensionDir, marketplaceDir, { source: "npm" });

  assert.deepEqual(result.entry.source, { source: "npm", package: "@scope/demo-ext@1.2.0" });
  assert.deepEqual(result.copiedFiles, ["icon.svg"]);

  const contentDir = path.join(marketplaceDir, "extensions", "demo-ext");
  assert.ok(existsSync(path.join(contentDir, "icon.svg")));
  assert.ok(!existsSync(path.join(contentDir, "package.json")));
  assert.ok(!existsSync(path.join(contentDir, "skills")));

  const { index } = await readIndex(marketplaceDir);
  assert.deepEqual(index.extensions[0]!.source, {
    source: "npm",
    package: "@scope/demo-ext@1.2.0",
  });
});

test("publish --source npm without a declared icon leaves no content directory", async () => {
  const extensionDir = await fixture({
    "package.json": '{"name": "demo-ext", "version": "1.2.0"}\n',
    ".spirit/extension.json": dumpJson({ icon: undefined }),
    "skills/demo/SKILL.md": VALID_SKILL,
  });
  const marketplaceDir = await marketplaceWith([]);
  // A stale content directory from an earlier local publish is cleared.
  const staleDir = path.join(marketplaceDir, "extensions", "demo-ext");
  await mkdir(staleDir, { recursive: true });
  await writeFile(path.join(staleDir, "stale.txt"), "stale\n", "utf8");

  const result = await publishExtension(extensionDir, marketplaceDir, { source: "npm" });

  assert.deepEqual(result.copiedFiles, []);
  assert.equal(result.contentDirRelative, undefined);
  assert.ok(!("icon" in result.entry));
  assert.ok(!existsSync(staleDir));
});

test("publish --source npm rejects a package.json without name/version", async () => {
  const extensionDir = await fixture({
    ...extensionFiles(),
    "package.json": "{}\n",
  });
  const marketplaceDir = await marketplaceWith([]);

  await assert.rejects(
    publishExtension(extensionDir, marketplaceDir, { source: "npm" }),
    /name.*version/,
  );
});

test("publish --dry-run writes nothing and reports the plan", async () => {
  const extensionDir = await fixture(extensionFiles());
  const marketplaceDir = await marketplaceWith([OTHER_ENTRY]);
  const before = await readFile(path.join(marketplaceDir, ".spirit", "marketplace.json"), "utf8");

  const result = await publishExtension(extensionDir, marketplaceDir, { dryRun: true });

  assert.equal(result.dryRun, true);
  assert.equal(result.entry.name, "demo-ext");
  assert.ok(result.copiedFiles.length > 0);
  const after = await readFile(path.join(marketplaceDir, ".spirit", "marketplace.json"), "utf8");
  assert.equal(after, before);
  assert.ok(!existsSync(path.join(marketplaceDir, "extensions", "demo-ext")));
});

test("publish rejects a directory without the self-declared dump", async () => {
  const extensionDir = await fixture({
    "package.json": '{"name": "demo-ext", "version": "1.2.0"}\n',
  });
  const marketplaceDir = await marketplaceWith([]);

  await assert.rejects(publishExtension(extensionDir, marketplaceDir), /extension-toolkit init/);
});

test("publish rejects a package that fails check and writes nothing", async () => {
  const extensionDir = await fixture({
    "package.json": '{"name": "demo-ext", "version": "1.2.0"}\n',
    ".spirit/extension.json": dumpJson(),
    "icon.svg": VALID_ICON,
    // Declared skills contribution but no skills directory.
  });
  const marketplaceDir = await marketplaceWith([OTHER_ENTRY]);
  const before = await readFile(path.join(marketplaceDir, ".spirit", "marketplace.json"), "utf8");

  await assert.rejects(publishExtension(extensionDir, marketplaceDir), /check failed/);

  const after = await readFile(path.join(marketplaceDir, ".spirit", "marketplace.json"), "utf8");
  assert.equal(after, before);
  assert.ok(!existsSync(path.join(marketplaceDir, "extensions", "demo-ext")));
});

test("publish rejects a marketplace directory without an index", async () => {
  const extensionDir = await fixture(extensionFiles());
  const marketplaceDir = await fixture({});

  await assert.rejects(publishExtension(extensionDir, marketplaceDir), /not a marketplace root/);
});

test("publish from inside the registry content directory skips the copy", async () => {
  const marketplaceDir = await marketplaceWith([OTHER_ENTRY]);
  const extensionDir = path.join(marketplaceDir, "extensions", "demo-ext");
  for (const [relativePath, content] of Object.entries(extensionFiles())) {
    const target = path.join(extensionDir, ...relativePath.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }

  const result = await publishExtension(extensionDir, marketplaceDir);

  assert.equal(result.contentAlreadyInPlace, true);
  assert.ok(existsSync(path.join(extensionDir, ".spirit", "extension.json")));
  const { index } = await readIndex(marketplaceDir);
  assert.equal(index.extensions.length, 2);
  assert.equal(index.extensions[1]!.name, "demo-ext");
});
