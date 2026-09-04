import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { test } from "vitest";

import type { MarketplaceIndexFetch } from "./http-index-source.js";
import {
  addMarketplaceSource,
  listMarketplaceSources,
  readMarketplaceSourceIndex,
  removeMarketplaceSource,
  type MarketplaceSourceManagerContext,
} from "./sources.js";

const execFileAsync = promisify(execFile);

const FIXTURE_INDEX = {
  schemaVersion: 1,
  name: "fixture-registry",
  displayName: "Fixture Registry",
  extensions: [
    {
      name: "i-am-a-extension",
      version: "1.0.0",
      source: "./extensions/i-am-a-extension",
      displayName: "Fixture",
      description: "Fixture extension.",
      manifest: { supportedHosts: ["cli"] },
    },
  ],
};

async function writeFixtureRegistry(root: string, index: unknown = FIXTURE_INDEX): Promise<void> {
  await mkdir(path.join(root, ".spirit"), { recursive: true });
  await writeFile(
    path.join(root, ".spirit", "marketplace.json"),
    `${JSON.stringify(index, null, 2)}\n`,
    "utf8",
  );
}

async function makeTempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "spirit-marketplace-sources-"));
}

function contextFor(spiritDataDir: string, overrides?: Partial<MarketplaceSourceManagerContext>) {
  return { spiritDataDir, ...overrides };
}

test("local source: add, list, read, remove", async () => {
  const dataDir = await makeTempDir();
  const registryDir = await makeTempDir();
  try {
    await writeFixtureRegistry(registryDir);

    const context = contextFor(dataDir);
    const record = await addMarketplaceSource(context, registryDir);
    assert.equal(record.kind, "local");
    assert.equal(record.name, "fixture-registry");
    assert.equal(record.displayName, "Fixture Registry");
    assert.equal(record.locator, path.resolve(registryDir));

    const listed = await listMarketplaceSources(context);
    assert.equal(listed.length, 1);
    assert.equal(listed[0]!.id, record.id);

    const read = await readMarketplaceSourceIndex(context, record);
    assert.equal(read.index.name, "fixture-registry");
    assert.deepEqual(read.registryRoot, { kind: "path", path: path.resolve(registryDir) });
    assert.equal(read.warning, undefined);

    const removed = await removeMarketplaceSource(context, "fixture-registry");
    assert.equal(removed.id, record.id);
    assert.deepEqual(await listMarketplaceSources(context), []);
    await assert.rejects(
      removeMarketplaceSource(context, "fixture-registry"),
      /No marketplace named/,
    );
  } finally {
    await rm(dataDir, { recursive: true, force: true });
    await rm(registryDir, { recursive: true, force: true });
  }
});

test("add rejects duplicate names and duplicate locators", async () => {
  const dataDir = await makeTempDir();
  const registryDir = await makeTempDir();
  const aliasDir = await makeTempDir();
  try {
    await writeFixtureRegistry(registryDir);
    await writeFixtureRegistry(aliasDir);

    const context = contextFor(dataDir);
    await addMarketplaceSource(context, registryDir);
    // Same name from a different directory.
    await assert.rejects(addMarketplaceSource(context, aliasDir), /already added/);
    // Same locator twice.
    await assert.rejects(addMarketplaceSource(context, registryDir), /already added/);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
    await rm(registryDir, { recursive: true, force: true });
    await rm(aliasDir, { recursive: true, force: true });
  }
});

test("add fails when marketplace.json is missing or invalid", async () => {
  const dataDir = await makeTempDir();
  const emptyDir = await makeTempDir();
  const invalidDir = await makeTempDir();
  try {
    await writeFixtureRegistry(invalidDir, { schemaVersion: 1, name: "bad-name" });

    const context = contextFor(dataDir);
    await assert.rejects(addMarketplaceSource(context, emptyDir), /no .spirit\/marketplace.json/);
    await assert.rejects(addMarketplaceSource(context, invalidDir), /displayName/);
    assert.deepEqual(await listMarketplaceSources(context), []);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
    await rm(emptyDir, { recursive: true, force: true });
    await rm(invalidDir, { recursive: true, force: true });
  }
});

test("--ref is rejected for non-git sources", async () => {
  const dataDir = await makeTempDir();
  const registryDir = await makeTempDir();
  try {
    await writeFixtureRegistry(registryDir);
    await assert.rejects(
      addMarketplaceSource(contextFor(dataDir), registryDir, { ref: "v1.0.0" }),
      /--ref is only supported for git/,
    );
  } finally {
    await rm(dataDir, { recursive: true, force: true });
    await rm(registryDir, { recursive: true, force: true });
  }
});

test("http-index source: fetch, snapshot write, and offline fallback", async () => {
  const dataDir = await makeTempDir();
  try {
    const raw = `${JSON.stringify(FIXTURE_INDEX, null, 2)}\n`;
    let fail = false;
    const fetchImpl: MarketplaceIndexFetch = () => {
      if (fail) {
        return Promise.reject(new Error("network down"));
      }
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(raw) });
    };

    const context = contextFor(dataDir, { fetchImpl });
    const record = await addMarketplaceSource(context, "https://example.com/market");
    assert.equal(record.kind, "http-index");
    assert.equal(record.locator, "https://example.com/market/.spirit/marketplace.json");
    assert.equal(record.name, "fixture-registry");

    // Snapshot was written on the successful fetch.
    const snapshotPath = path.join(dataDir, "marketplaces", record.id, "snapshot.json");
    assert.equal(await readFile(snapshotPath, "utf8"), raw);

    // Offline: falls back to the snapshot with a warning.
    fail = true;
    const read = await readMarketplaceSourceIndex(context, record);
    assert.equal(read.index.name, "fixture-registry");
    assert.match(read.warning ?? "", /last successful snapshot/);
    assert.deepEqual(read.registryRoot, {
      kind: "url",
      url: "https://example.com/market/",
    });
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("http-index source: first fetch failure without snapshot is an error", async () => {
  const dataDir = await makeTempDir();
  try {
    const fetchImpl: MarketplaceIndexFetch = () =>
      Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve("") });
    await assert.rejects(
      addMarketplaceSource(contextFor(dataDir, { fetchImpl }), "https://example.com/market"),
      /no snapshot is available|HTTP 404/,
    );
    assert.deepEqual(await listMarketplaceSources(contextFor(dataDir)), []);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

async function git(args: string[], cwd: string): Promise<void> {
  await execFileAsync(
    "git",
    ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args],
    { cwd },
  );
}

/**
 * Create an upstream registry git repo. The directory is named `repo.git` so
 * the locator satisfies the deterministic git classification rule (`.git`
 * suffix); git clones fine from a non-bare worktree path.
 */
async function makeUpstreamRegistry(): Promise<{ root: string; upstream: string }> {
  const root = await makeTempDir();
  const upstream = path.join(root, "repo.git");
  await mkdir(upstream, { recursive: true });
  await git(["init", "--quiet", "-b", "main"], upstream);
  await writeFixtureRegistry(upstream);
  await git(["add", "."], upstream);
  await git(["commit", "--quiet", "-m", "initial"], upstream);
  return { root, upstream };
}

test("git source: clone, refresh advances branch, offline falls back to clone", async () => {
  const dataDir = await makeTempDir();
  const { root, upstream } = await makeUpstreamRegistry();
  const hidden = await makeTempDir();
  try {
    // A local path that exists would classify as local; force git classification.
    const context = contextFor(dataDir, { pathExists: () => false });
    const record = await addMarketplaceSource(context, upstream);
    assert.equal(record.kind, "git");

    const read = await readMarketplaceSourceIndex(context, record);
    assert.equal(read.index.name, "fixture-registry");
    assert.equal(read.warning, undefined);

    // Advance the upstream default branch.
    const updated = {
      ...FIXTURE_INDEX,
      displayName: "Fixture Registry v2",
    };
    await writeFixtureRegistry(upstream, updated);
    await git(["add", "."], upstream);
    await git(["commit", "--quiet", "-m", "bump"], upstream);

    const refreshed = await readMarketplaceSourceIndex(context, record);
    assert.equal(refreshed.index.displayName, "Fixture Registry v2");

    // Offline: upstream moved away, refresh falls back to the existing clone.
    await rename(upstream, path.join(hidden, "repo.git"));
    const offline = await readMarketplaceSourceIndex(context, record);
    assert.equal(offline.index.displayName, "Fixture Registry v2");
    assert.match(offline.warning ?? "", /existing clone/);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
    await rm(hidden, { recursive: true, force: true });
  }
});

test("git source: tag ref stays put while the branch advances", async () => {
  const dataDir = await makeTempDir();
  const { root, upstream } = await makeUpstreamRegistry();
  try {
    await git(["tag", "v1.0.0"], upstream);
    const updated = { ...FIXTURE_INDEX, displayName: "Fixture Registry v2" };
    await writeFixtureRegistry(upstream, updated);
    await git(["add", "."], upstream);
    await git(["commit", "--quiet", "-m", "bump"], upstream);

    const context = contextFor(dataDir, { pathExists: () => false });
    const record = await addMarketplaceSource(context, upstream, { ref: "v1.0.0" });
    const read = await readMarketplaceSourceIndex(context, record);
    assert.equal(read.index.displayName, "Fixture Registry");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});

test("git source: unknown ref and first-clone failure are errors", async () => {
  const dataDir = await makeTempDir();
  const { root, upstream } = await makeUpstreamRegistry();
  try {
    const context = contextFor(dataDir, { pathExists: () => false });
    await assert.rejects(
      addMarketplaceSource(context, upstream, { ref: "does-not-exist" }),
      /ref not found/,
    );
    await assert.rejects(
      addMarketplaceSource(context, "/nonexistent/repo.git"),
      /Failed to clone marketplace repository/,
    );
    assert.deepEqual(await listMarketplaceSources(context), []);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});
