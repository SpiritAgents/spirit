import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { c as createTar } from "tar";
import { test } from "vitest";

import {
  parseExtensionDumpText,
  type MarketplaceExtensionEntry,
} from "@spiritagent/extension-toolkit";

import { listInstalledExtensions } from "../extensions.js";
import type { MarketplaceIndexFetch } from "./http-index-source.js";
import { installMarketplaceExtensionEntry } from "./install.js";
import type { MarketplaceSourceRecord } from "./types.js";

const ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>\n';

function localSource(registryRoot: string): MarketplaceSourceRecord {
  return {
    id: "test-source",
    name: "test-registry",
    displayName: "Test Registry",
    kind: "local",
    locator: registryRoot,
    addedAtUnixMs: 0,
  };
}

async function writeLocalRegistry(root: string): Promise<void> {
  const index = {
    schemaVersion: 1,
    name: "test-registry",
    displayName: "Test Registry",
    extensions: [],
  };
  await mkdir(path.join(root, ".spirit"), { recursive: true });
  await writeFile(
    path.join(root, ".spirit", "marketplace.json"),
    `${JSON.stringify(index, null, 2)}\n`,
    "utf8",
  );
  const contentDir = path.join(root, "extensions", "extension-demo");
  await mkdir(contentDir, { recursive: true });
  await writeFile(
    path.join(contentDir, "package.json"),
    `${JSON.stringify({ name: "extension-demo", version: "1.0.0", main: "index.js" }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(path.join(contentDir, "index.js"), "export function activate() {}\n", "utf8");
  await writeFile(path.join(contentDir, "icon.svg"), ICON_SVG, "utf8");
}

function demoEntry(overrides?: Partial<MarketplaceExtensionEntry>): MarketplaceExtensionEntry {
  return {
    name: "extension-demo",
    version: "1.0.0",
    source: "./extensions/extension-demo",
    icon: "extensions/extension-demo/icon.svg",
    displayName: "Demo",
    description: "Demo extension.",
    author: { name: "Spirit", url: "https://spirit.dev" },
    categories: ["developer-tools"],
    reviewStatus: "verified",
    manifest: { supportedHosts: ["desktop"] },
    ...overrides,
  };
}

test("local source install copies content, dumps identity + declaration + source id", async () => {
  const spiritDataDir = await mkdtemp(path.join(tmpdir(), "spirit-install-data-"));
  const registryRoot = await mkdtemp(path.join(tmpdir(), "spirit-install-registry-"));
  try {
    await writeLocalRegistry(registryRoot);
    const source = localSource(registryRoot);
    const installed = await installMarketplaceExtensionEntry(
      { spiritDataDir, hostKind: "desktop" },
      {
        source,
        registryRoot: { kind: "path", path: registryRoot },
        entry: demoEntry(),
      },
    );

    assert.equal(installed.id, "test-source/extension-demo");
    assert.equal(installed.sourceId, "test-source");
    assert.equal(installed.installSource, "marketplace");
    assert.equal(
      installed.directoryPath,
      path.join(spiritDataDir, "extensions", "desktop", "test-source", "extension-demo"),
    );

    // The dump carries identity + display + declaration + source id.
    const dumpRaw = await readFile(
      path.join(installed.directoryPath, ".spirit", "extension.json"),
      "utf8",
    );
    const dump = parseExtensionDumpText(dumpRaw);
    assert.equal(dump.name, "extension-demo");
    assert.equal(dump.version, "1.0.0");
    assert.equal(dump.sourceId, "test-source");
    assert.equal(dump.displayName, "Demo");
    assert.deepEqual(dump.author, { name: "Spirit", url: "https://spirit.dev" });
    assert.deepEqual(dump.categories, ["developer-tools"]);
    assert.deepEqual(dump.manifest.supportedHosts, ["desktop"]);

    // The registry icon is copied into the install dir and referenced from the dump.
    assert.equal(dump.icon, ".spirit/icon.svg");
    const iconRaw = await readFile(
      path.join(installed.directoryPath, ".spirit", "icon.svg"),
      "utf8",
    );
    assert.equal(iconRaw, ICON_SVG);

    // package.json stays pure npm; main resolves at load time.
    assert.equal(installed.manifest.main, "index.js");
    assert.equal(installed.manifest.displayName, "Demo");

    const listed = await listInstalledExtensions({ spiritDataDir, hostKind: "desktop" });
    assert.equal(listed.length, 1);
    assert.equal(listed[0]!.id, "test-source/extension-demo");
  } finally {
    await rm(spiritDataDir, { recursive: true, force: true });
    await rm(registryRoot, { recursive: true, force: true });
  }
});

test("same-name extensions from two sources coexist", async () => {
  const spiritDataDir = await mkdtemp(path.join(tmpdir(), "spirit-install-coex-data-"));
  const registryA = await mkdtemp(path.join(tmpdir(), "spirit-install-a-"));
  const registryB = await mkdtemp(path.join(tmpdir(), "spirit-install-b-"));
  try {
    await writeLocalRegistry(registryA);
    await writeLocalRegistry(registryB);
    const sourceA = { ...localSource(registryA), id: "source-a", name: "registry-a" };
    const sourceB = { ...localSource(registryB), id: "source-b", name: "registry-b" };

    const first = await installMarketplaceExtensionEntry(
      { spiritDataDir, hostKind: "desktop" },
      { source: sourceA, registryRoot: { kind: "path", path: registryA }, entry: demoEntry() },
    );
    const second = await installMarketplaceExtensionEntry(
      { spiritDataDir, hostKind: "desktop" },
      { source: sourceB, registryRoot: { kind: "path", path: registryB }, entry: demoEntry() },
    );

    assert.equal(first.id, "source-a/extension-demo");
    assert.equal(second.id, "source-b/extension-demo");
    const listed = await listInstalledExtensions({ spiritDataDir, hostKind: "desktop" });
    assert.deepEqual(listed.map((item) => item.id).sort(), [
      "source-a/extension-demo",
      "source-b/extension-demo",
    ]);

    // Reinstalling into the same source without replaceExisting fails.
    await assert.rejects(
      installMarketplaceExtensionEntry(
        { spiritDataDir, hostKind: "desktop" },
        { source: sourceA, registryRoot: { kind: "path", path: registryA }, entry: demoEntry() },
      ),
      /already exists/,
    );
  } finally {
    await rm(spiritDataDir, { recursive: true, force: true });
    await rm(registryA, { recursive: true, force: true });
    await rm(registryB, { recursive: true, force: true });
  }
});

test("local source requires an existing content directory and a path registry root", async () => {
  const spiritDataDir = await mkdtemp(path.join(tmpdir(), "spirit-install-missing-data-"));
  const registryRoot = await mkdtemp(path.join(tmpdir(), "spirit-install-missing-reg-"));
  try {
    await writeLocalRegistry(registryRoot);
    await assert.rejects(
      installMarketplaceExtensionEntry(
        { spiritDataDir, hostKind: "desktop" },
        {
          source: localSource(registryRoot),
          registryRoot: { kind: "path", path: registryRoot },
          entry: demoEntry({ source: "./extensions/does-not-exist" }),
        },
      ),
      /content directory does not exist/,
    );
    await assert.rejects(
      installMarketplaceExtensionEntry(
        { spiritDataDir, hostKind: "desktop" },
        {
          source: localSource(registryRoot),
          registryRoot: { kind: "url", url: "https://example.com/market/" },
          entry: demoEntry(),
        },
      ),
      /requires a local or git marketplace registry/,
    );
  } finally {
    await rm(spiritDataDir, { recursive: true, force: true });
    await rm(registryRoot, { recursive: true, force: true });
  }
});

/** Build a real npm-shaped tarball (package/ root) in a temp dir and return bytes + SRI. */
async function makeNpmTarball(
  files: Record<string, string>,
): Promise<{ tgz: Buffer; sri: string }> {
  const packRoot = await mkdtemp(path.join(tmpdir(), "spirit-npm-pack-"));
  try {
    const packageDir = path.join(packRoot, "package");
    await mkdir(packageDir, { recursive: true });
    for (const [relativePath, content] of Object.entries(files)) {
      const target = path.join(packageDir, relativePath);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
    }
    const tgzPath = path.join(packRoot, "pkg.tgz");
    await createTar({ file: tgzPath, cwd: packRoot, gzip: true }, ["package"]);
    const tgz = await readFile(tgzPath);
    const sri = `sha512-${createHash("sha512").update(tgz).digest("base64")}`;
    return { tgz, sri };
  } finally {
    await rm(packRoot, { recursive: true, force: true });
  }
}

function npmFetchMock(routes: Record<string, Buffer | object>): MarketplaceIndexFetch {
  return (url) => {
    const hit = routes[url];
    if (hit === undefined) {
      return Promise.resolve({
        ok: false,
        status: 404,
        text: () => Promise.resolve("not found"),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      });
    }
    if (Buffer.isBuffer(hit)) {
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(hit.toString("utf8")),
        arrayBuffer: () =>
          Promise.resolve(
            hit.buffer.slice(hit.byteOffset, hit.byteOffset + hit.byteLength) as ArrayBuffer,
          ),
      });
    }
    const raw = JSON.stringify(hit);
    return Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(raw),
      arrayBuffer: () => Promise.resolve(new TextEncoder().encode(raw).buffer as ArrayBuffer),
    });
  };
}

test("npm source install fetches the packument, verifies SRI, and extracts package/", async () => {
  const spiritDataDir = await mkdtemp(path.join(tmpdir(), "spirit-install-npm-data-"));
  try {
    const { tgz, sri } = await makeNpmTarball({
      "package.json": `${JSON.stringify({ name: "@spiritagents/extension-npm-demo", version: "1.2.3", main: "index.js" }, null, 2)}\n`,
      "index.js": "export function activate() {}\n",
    });
    const packument = {
      name: "@spiritagents/extension-npm-demo",
      versions: {
        "1.2.3": {
          dist: {
            tarball:
              "https://registry.npmjs.org/@spiritagents/extension-npm-demo/-/extension-npm-demo-1.2.3.tgz",
            integrity: sri,
          },
        },
      },
    };
    const fetchImpl = npmFetchMock({
      "https://registry.npmjs.org/@spiritagents%2Fextension-npm-demo": packument,
      "https://registry.npmjs.org/@spiritagents/extension-npm-demo/-/extension-npm-demo-1.2.3.tgz":
        tgz,
    });

    const source: MarketplaceSourceRecord = {
      id: "npm-source",
      name: "npm-registry",
      displayName: "NPM Registry",
      kind: "http-index",
      locator: "https://example.com/.spirit/marketplace.json",
      addedAtUnixMs: 0,
    };
    const { icon: _icon, ...entryWithoutIcon } = demoEntry();
    const installed = await installMarketplaceExtensionEntry(
      { spiritDataDir, hostKind: "desktop", fetchImpl },
      {
        source,
        registryRoot: { kind: "url", url: "https://example.com/" },
        entry: {
          ...entryWithoutIcon,
          source: { source: "npm", package: "@spiritagents/extension-npm-demo@1.2.3" },
        },
      },
    );

    assert.equal(installed.id, "npm-source/extension-demo");
    assert.equal(installed.manifest.version, "1.0.0");
    assert.equal(installed.manifest.main, "index.js");
    const indexJs = await readFile(path.join(installed.directoryPath, "index.js"), "utf8");
    assert.match(indexJs, /activate/);
  } finally {
    await rm(spiritDataDir, { recursive: true, force: true });
  }
});

test("npm source install rejects SRI mismatch and missing dist fields", async () => {
  const spiritDataDir = await mkdtemp(path.join(tmpdir(), "spirit-install-npm-bad-"));
  try {
    const { tgz, sri } = await makeNpmTarball({ "index.js": "x" });
    const tarballUrl =
      "https://registry.npmjs.org/extension-npm-demo/-/extension-npm-demo-1.2.3.tgz";
    const packumentUrl = "https://registry.npmjs.org/extension-npm-demo";
    const source: MarketplaceSourceRecord = {
      id: "npm-source",
      name: "npm-registry",
      displayName: "NPM Registry",
      kind: "http-index",
      locator: "https://example.com/.spirit/marketplace.json",
      addedAtUnixMs: 0,
    };
    const { icon: _icon, ...entryWithoutIcon } = demoEntry();
    const entry = {
      ...entryWithoutIcon,
      source: { source: "npm" as const, package: "extension-npm-demo@1.2.3" },
    };

    // SRI mismatch.
    const badSriFetch = npmFetchMock({
      [packumentUrl]: {
        versions: { "1.2.3": { dist: { tarball: tarballUrl, integrity: "sha512-AAAA" } } },
      },
      [tarballUrl]: tgz,
    });
    await assert.rejects(
      installMarketplaceExtensionEntry(
        { spiritDataDir, hostKind: "desktop", fetchImpl: badSriFetch },
        { source, registryRoot: { kind: "url", url: "https://example.com/" }, entry },
      ),
      /integrity verification failed/,
    );

    // Missing integrity.
    const noIntegrityFetch = npmFetchMock({
      [packumentUrl]: { versions: { "1.2.3": { dist: { tarball: tarballUrl } } } },
      [tarballUrl]: tgz,
    });
    await assert.rejects(
      installMarketplaceExtensionEntry(
        { spiritDataDir, hostKind: "desktop", fetchImpl: noIntegrityFetch },
        { source, registryRoot: { kind: "url", url: "https://example.com/" }, entry },
      ),
      /missing dist.integrity/,
    );

    // Version not present in the packument.
    const noVersionFetch = npmFetchMock({
      [packumentUrl]: { versions: { "9.9.9": { dist: { tarball: tarballUrl, integrity: sri } } } },
      [tarballUrl]: tgz,
    });
    await assert.rejects(
      installMarketplaceExtensionEntry(
        { spiritDataDir, hostKind: "desktop", fetchImpl: noVersionFetch },
        { source, registryRoot: { kind: "url", url: "https://example.com/" }, entry },
      ),
      /missing dist.tarball/,
    );
  } finally {
    await rm(spiritDataDir, { recursive: true, force: true });
  }
});

test("install rejects a declared icon with script content", async () => {
  const spiritDataDir = await mkdtemp(path.join(tmpdir(), "spirit-install-icon-data-"));
  const registryRoot = await mkdtemp(path.join(tmpdir(), "spirit-install-icon-reg-"));
  try {
    await writeLocalRegistry(registryRoot);
    await writeFile(
      path.join(registryRoot, "extensions", "extension-demo", "icon.svg"),
      "<svg><script>alert(1)</script></svg>",
      "utf8",
    );
    await assert.rejects(
      installMarketplaceExtensionEntry(
        { spiritDataDir, hostKind: "desktop" },
        {
          source: localSource(registryRoot),
          registryRoot: { kind: "path", path: registryRoot },
          entry: demoEntry(),
        },
      ),
      /<script>/,
    );
  } finally {
    await rm(spiritDataDir, { recursive: true, force: true });
    await rm(registryRoot, { recursive: true, force: true });
  }
});
