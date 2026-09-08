import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";

import { ensureBuiltInExtensions } from "../built-in/extensions.js";
import { createHostExtensionManager, listInstalledExtensions } from "../extensions.js";
import { MarketplaceReviewAcknowledgementRequiredError } from "./errors.js";
import { importPreparedDirectoryToPersonal } from "./import-zip.js";
import { readMarketplaceSourceRegistry } from "./registry-store.js";
import {
  addMarketplaceSource,
  removeMarketplaceSource,
  type MarketplaceSourceManagerContext,
} from "./sources.js";
import {
  checkExtensionUpdate,
  installMarketplaceExtensionByName,
  resolveMarketplaceExtensionEntry,
  updateExtensionById,
  type MarketplaceHostContext,
} from "./resolve.js";

function makeEntry(name: string, version: string, reviewStatus?: string): Record<string, unknown> {
  return {
    name,
    version,
    source: `./extensions/${name}`,
    displayName: name,
    description: `${name} extension.`,
    ...(reviewStatus ? { reviewStatus } : {}),
    manifest: { supportedHosts: ["desktop"] },
  };
}

async function writeRegistry(
  root: string,
  name: string,
  entries: Record<string, unknown>[],
): Promise<void> {
  await mkdir(path.join(root, ".spirit"), { recursive: true });
  await writeFile(
    path.join(root, ".spirit", "marketplace.json"),
    `${JSON.stringify(
      { schemaVersion: 1, name, displayName: name, extensions: entries },
      null,
      2,
    )}\n`,
    "utf8",
  );
  for (const entry of entries) {
    const entryName = (entry as { name: string }).name;
    const contentDir = path.join(root, "extensions", entryName);
    await mkdir(contentDir, { recursive: true });
    await writeFile(
      path.join(contentDir, "package.json"),
      `${JSON.stringify({ name: entryName, version: "0.0.0" }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      path.join(contentDir, "VERSION.txt"),
      `${(entry as { version: string }).version}\n`,
      "utf8",
    );
  }
}

async function fixture(): Promise<{
  spiritDataDir: string;
  registryA: string;
  registryB: string;
  context: MarketplaceHostContext & MarketplaceSourceManagerContext;
}> {
  const spiritDataDir = await mkdtemp(path.join(tmpdir(), "spirit-resolve-data-"));
  const registryA = await mkdtemp(path.join(tmpdir(), "spirit-resolve-a-"));
  const registryB = await mkdtemp(path.join(tmpdir(), "spirit-resolve-b-"));
  return {
    spiritDataDir,
    registryA,
    registryB,
    context: { spiritDataDir, hostKind: "desktop" },
  };
}

test("install resolves a unique entry across sources and records the source id", async () => {
  const { spiritDataDir, registryA, registryB, context } = await fixture();
  try {
    await writeRegistry(registryA, "registry-a", [
      makeEntry("extension-alpha", "1.0.0", "verified"),
    ]);
    await writeRegistry(registryB, "registry-b", [
      makeEntry("extension-beta", "2.0.0", "verified"),
    ]);
    await addMarketplaceSource(context, registryA);
    await addMarketplaceSource(context, registryB);

    const installed = await installMarketplaceExtensionByName(context, "extension-beta");
    const sources = await readMarketplaceSourceRegistry(spiritDataDir);
    const sourceB = sources.find((s) => s.name === "registry-b")!;
    assert.equal(installed.id, `${sourceB.id}/extension-beta`);
    assert.equal(installed.manifest.version, "2.0.0");

    await assert.rejects(
      installMarketplaceExtensionByName(context, "extension-missing"),
      /not found in any configured marketplace/,
    );
  } finally {
    await rm(spiritDataDir, { recursive: true, force: true });
    await rm(registryA, { recursive: true, force: true });
    await rm(registryB, { recursive: true, force: true });
  }
});

test("same-name entries in multiple sources conflict; --marketplace disambiguates", async () => {
  const { spiritDataDir, registryA, registryB, context } = await fixture();
  try {
    await writeRegistry(registryA, "registry-a", [
      makeEntry("extension-shared", "1.0.0", "verified"),
    ]);
    await writeRegistry(registryB, "registry-b", [
      makeEntry("extension-shared", "1.0.0", "verified"),
    ]);
    await addMarketplaceSource(context, registryA);
    await addMarketplaceSource(context, registryB);

    await assert.rejects(
      resolveMarketplaceExtensionEntry(context, "extension-shared"),
      /multiple marketplaces: registry-a, registry-b.*--marketplace/,
    );

    const resolved = await resolveMarketplaceExtensionEntry(context, "extension-shared", {
      marketplace: "registry-b",
    });
    assert.equal(resolved.source.name, "registry-b");

    await assert.rejects(
      resolveMarketplaceExtensionEntry(context, "extension-shared", { marketplace: "nope" }),
      /No marketplace named "nope" is added/,
    );
    await assert.rejects(
      resolveMarketplaceExtensionEntry(context, "extension-shared", {
        marketplace: "registry-a",
      }).then(() =>
        resolveMarketplaceExtensionEntry(context, "extension-beta", { marketplace: "registry-a" }),
      ),
      /does not have an extension named/,
    );

    // Both sources can install the same name without overwriting each other.
    const first = await installMarketplaceExtensionByName(context, "extension-shared", {
      marketplace: "registry-a",
    });
    const second = await installMarketplaceExtensionByName(context, "extension-shared", {
      marketplace: "registry-b",
    });
    assert.notEqual(first.id, second.id);
    const listed = await listInstalledExtensions(context);
    assert.equal(listed.filter((item) => item.manifest.name === "extension-shared").length, 2);
  } finally {
    await rm(spiritDataDir, { recursive: true, force: true });
    await rm(registryA, { recursive: true, force: true });
    await rm(registryB, { recursive: true, force: true });
  }
});

test("unverified entries require review acknowledgement for install", async () => {
  const { spiritDataDir, registryA, context } = await fixture();
  try {
    await writeRegistry(registryA, "registry-a", [makeEntry("extension-alpha", "1.0.0")]);
    await addMarketplaceSource(context, registryA);

    await assert.rejects(installMarketplaceExtensionByName(context, "extension-alpha"), (error) => {
      assert.ok(error instanceof MarketplaceReviewAcknowledgementRequiredError);
      assert.equal(error.reviewStatus, "unverified");
      return true;
    });
    const installed = await installMarketplaceExtensionByName(context, "extension-alpha", {
      reviewAcknowledged: true,
    });
    assert.equal(installed.manifest.name, "extension-alpha");
  } finally {
    await rm(spiritDataDir, { recursive: true, force: true });
    await rm(registryA, { recursive: true, force: true });
  }
});

test("update routing: newer registry version updates in place through the recorded source", async () => {
  const { spiritDataDir, registryA, registryB, context } = await fixture();
  try {
    await writeRegistry(registryA, "registry-a", [
      makeEntry("extension-alpha", "1.0.0", "verified"),
    ]);
    await writeRegistry(registryB, "registry-b", [
      makeEntry("extension-alpha", "9.9.9", "verified"),
    ]);
    await addMarketplaceSource(context, registryA);
    await addMarketplaceSource(context, registryB);

    const installed = await installMarketplaceExtensionByName(context, "extension-alpha", {
      marketplace: "registry-a",
    });

    // No update yet.
    assert.equal(await checkExtensionUpdate(context, installed.id), undefined);
    assert.equal(await updateExtensionById(context, installed.id), undefined);

    // Bump the owning source; the other source's newer version must not leak in.
    await writeRegistry(registryA, "registry-a", [
      makeEntry("extension-alpha", "1.1.0", "verified"),
    ]);
    const update = await checkExtensionUpdate(context, installed.id);
    assert.equal(update?.entry.version, "1.1.0");
    assert.equal(update?.installedVersion, "1.0.0");

    const updated = await updateExtensionById(context, installed.id);
    assert.equal(updated?.manifest.version, "1.1.0");
    assert.equal(updated?.id, installed.id);
    const content = await readFile(path.join(updated!.directoryPath, "VERSION.txt"), "utf8");
    assert.equal(content.trim(), "1.1.0");
  } finally {
    await rm(spiritDataDir, { recursive: true, force: true });
    await rm(registryA, { recursive: true, force: true });
    await rm(registryB, { recursive: true, force: true });
  }
});

test("update falls back to the review gate when the new version is unverified", async () => {
  const { spiritDataDir, registryA, context } = await fixture();
  try {
    await writeRegistry(registryA, "registry-a", [
      makeEntry("extension-alpha", "1.0.0", "verified"),
    ]);
    await addMarketplaceSource(context, registryA);
    const installed = await installMarketplaceExtensionByName(context, "extension-alpha");

    // Version bump drops verified status (registry curation rule).
    await writeRegistry(registryA, "registry-a", [makeEntry("extension-alpha", "1.1.0")]);
    await assert.rejects(updateExtensionById(context, installed.id), (error) => {
      assert.ok(error instanceof MarketplaceReviewAcknowledgementRequiredError);
      assert.equal(error.reviewStatus, "unverified");
      return true;
    });
    const updated = await updateExtensionById(context, installed.id, { reviewAcknowledged: true });
    assert.equal(updated?.manifest.version, "1.1.0");
  } finally {
    await rm(spiritDataDir, { recursive: true, force: true });
    await rm(registryA, { recursive: true, force: true });
  }
});

test("update errors when the source was removed or the entry disappeared", async () => {
  const { spiritDataDir, registryA, context } = await fixture();
  try {
    await writeRegistry(registryA, "registry-a", [
      makeEntry("extension-alpha", "1.0.0", "verified"),
    ]);
    const source = await addMarketplaceSource(context, registryA);
    const installed = await installMarketplaceExtensionByName(context, "extension-alpha");

    // Entry disappears from the source.
    await writeRegistry(registryA, "registry-a", []);
    await assert.rejects(checkExtensionUpdate(context, installed.id), /no longer exists/);

    // Source removed entirely.
    await writeRegistry(registryA, "registry-a", [
      makeEntry("extension-alpha", "1.1.0", "verified"),
    ]);
    await removeMarketplaceSource(context, source.name);
    await assert.rejects(checkExtensionUpdate(context, installed.id), /no longer added/);
  } finally {
    await rm(spiritDataDir, { recursive: true, force: true });
    await rm(registryA, { recursive: true, force: true });
  }
});

test("built-in and personal installs have no manual update semantics", async () => {
  const { spiritDataDir, registryA, context } = await fixture();
  try {
    // Seed a built-in install through the test registry-root override.
    await writeRegistry(registryA, "built-in", [
      { ...makeEntry("extension-builtin", "1.0.0", "verified"), defaultInstalled: true },
    ]);
    const manager = createHostExtensionManager(context);
    await ensureBuiltInExtensions({
      spiritDataDir,
      hostKind: "desktop",
      manager,
      registryRoot: registryA,
    });

    // A Personal install through the ZIP reroute.
    const preparedRoot = await mkdtemp(path.join(tmpdir(), "spirit-resolve-personal-"));
    const preparedDir = path.join(preparedRoot, "content");
    await mkdir(path.join(preparedDir, ".spirit"), { recursive: true });
    await writeFile(
      path.join(preparedDir, ".spirit", "extension.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          name: "extension-personal",
          version: "1.0.0",
          sourceId: "personal",
          displayName: "Personal demo",
          description: "Personal fixture.",
          manifest: { supportedHosts: ["desktop"] },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await importPreparedDirectoryToPersonal(context, { preparedDirectoryPath: preparedDir });

    assert.equal(await checkExtensionUpdate(context, "built-in/extension-builtin"), undefined);
    assert.equal(await checkExtensionUpdate(context, "personal/extension-personal"), undefined);
    await assert.rejects(
      checkExtensionUpdate(context, "nope/extension-alpha"),
      /Extension not found/,
    );

    await rm(preparedRoot, { recursive: true, force: true });
  } finally {
    await rm(spiritDataDir, { recursive: true, force: true });
    await rm(registryA, { recursive: true, force: true });
  }
});
