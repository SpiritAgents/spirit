import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { zipSync } from "fflate";
import { test } from "vitest";

import { createHostExtensionManager, listInstalledExtensions } from "../extensions.js";
import { importPreparedDirectoryToPersonal } from "./import-zip.js";
import { readPersonalMarketplaceIndex, removePersonalRegistryEntry } from "./personal.js";
import { checkExtensionUpdate, type MarketplaceHostContext } from "./resolve.js";

const ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>\n';

function makeZip(dump: Record<string, unknown>, extraFiles?: Record<string, string>): string {
  const files: Record<string, Uint8Array> = {
    ".spirit/extension.json": new TextEncoder().encode(`${JSON.stringify(dump, null, 2)}\n`),
  };
  for (const [name, content] of Object.entries(extraFiles ?? {})) {
    files[name] = new TextEncoder().encode(content);
  }
  return Buffer.from(zipSync(files)).toString("base64");
}

function zipDump(version: string): Record<string, unknown> {
  return {
    schemaVersion: 1,
    name: "extension-zipped",
    version,
    sourceId: "self-declared",
    displayName: "Zipped demo",
    description: "ZIP import fixture.",
    icon: "icon.svg",
    author: { name: "Tester" },
    manifest: { supportedHosts: ["desktop"] },
  };
}

test("ZIP import writes the Personal registry, refreshes its index, and installs from it", async () => {
  const spiritDataDir = await mkdtemp(path.join(tmpdir(), "spirit-zip-personal-"));
  try {
    const context: MarketplaceHostContext = { spiritDataDir, hostKind: "desktop" };
    const { importExtensionArchive } = await import("../extensions.js");
    const installed = await importExtensionArchive(context, {
      archiveBase64: makeZip(zipDump("1.0.0"), { "icon.svg": ICON_SVG, "note.txt": "hello" }),
      fileName: "zipped.zip",
    });

    assert.equal(installed.id, "personal/extension-zipped");
    assert.equal(installed.installSource, "archive");
    assert.equal(installed.archiveFileName, "zipped.zip");

    // Personal registry was created with the entry appended (unverified).
    const index = await readPersonalMarketplaceIndex(spiritDataDir);
    const entry = index.extensions.find((candidate) => candidate.name === "extension-zipped");
    assert.ok(entry);
    assert.equal(entry.reviewStatus, "unverified");
    assert.equal(entry.version, "1.0.0");
    assert.equal(entry.source, "extensions/extension-zipped");
    assert.equal(entry.icon, "extensions/extension-zipped/icon.svg");

    // Content landed in the Personal registry root and the install dir.
    const registryContent = await readFile(
      path.join(
        spiritDataDir,
        "marketplaces",
        "personal",
        "extensions",
        "extension-zipped",
        "note.txt",
      ),
      "utf8",
    );
    assert.equal(registryContent, "hello");
    const installedNote = await readFile(path.join(installed.directoryPath, "note.txt"), "utf8");
    assert.equal(installedNote, "hello");
    // The dump icon was re-pointed at the install-dir copy.
    assert.equal(installed.manifest.icon, ".spirit/icon.svg");
    const iconRaw = await readFile(
      path.join(installed.directoryPath, ".spirit", "icon.svg"),
      "utf8",
    );
    assert.equal(iconRaw, ICON_SVG);

    // Personal entries have no update semantics.
    assert.equal(await checkExtensionUpdate(context, installed.id), undefined);

    // Re-importing the same name overwrites and refreshes the index entry.
    const reimported = await importExtensionArchive(context, {
      archiveBase64: makeZip(zipDump("1.0.1"), { "icon.svg": ICON_SVG }),
    });
    assert.equal(reimported.manifest.version, "1.0.1");
    const refreshed = await readPersonalMarketplaceIndex(spiritDataDir);
    assert.equal(
      refreshed.extensions.filter((candidate) => candidate.name === "extension-zipped").length,
      1,
    );
    assert.equal(
      refreshed.extensions.find((candidate) => candidate.name === "extension-zipped")?.version,
      "1.0.1",
    );

    const listed = await listInstalledExtensions(context);
    assert.equal(listed.filter((item) => item.id === "personal/extension-zipped").length, 1);
  } finally {
    await rm(spiritDataDir, { recursive: true, force: true });
  }
});

test("uninstalling a ZIP-imported extension removes its Personal registry record", async () => {
  const spiritDataDir = await mkdtemp(path.join(tmpdir(), "spirit-zip-personal-remove-"));
  try {
    const context: MarketplaceHostContext = { spiritDataDir, hostKind: "desktop" };
    const { importExtensionArchive } = await import("../extensions.js");
    const manager = createHostExtensionManager(context);
    const installed = await importExtensionArchive(context, {
      archiveBase64: makeZip(zipDump("1.0.0"), { "icon.svg": ICON_SVG }),
    });
    assert.equal(installed.id, "personal/extension-zipped");

    await manager.remove(installed.id);

    // The index entry and the registry content copy are gone with the install.
    const index = await readPersonalMarketplaceIndex(spiritDataDir);
    assert.equal(
      index.extensions.some((candidate) => candidate.name === "extension-zipped"),
      false,
    );
    assert.equal(
      existsSync(
        path.join(spiritDataDir, "marketplaces", "personal", "extensions", "extension-zipped"),
      ),
      false,
    );
    assert.equal((await listInstalledExtensions(context)).length, 0);

    // Registry removal is idempotent (e.g. a direct install that never wrote an entry).
    await removePersonalRegistryEntry(spiritDataDir, "extension-zipped");
  } finally {
    await rm(spiritDataDir, { recursive: true, force: true });
  }
});

test("ZIP import rejects archives without a dump", async () => {
  const spiritDataDir = await mkdtemp(path.join(tmpdir(), "spirit-zip-invalid-"));
  try {
    const context: MarketplaceHostContext = { spiritDataDir, hostKind: "desktop" };
    const { importExtensionArchive } = await import("../extensions.js");
    const noDump = Buffer.from(zipSync({ "index.js": new TextEncoder().encode("x") })).toString(
      "base64",
    );
    await assert.rejects(
      importExtensionArchive(context, { archiveBase64: noDump }),
      /missing .spirit\/extension.json/,
    );
  } finally {
    await rm(spiritDataDir, { recursive: true, force: true });
  }
});

test("importPreparedDirectoryToPersonal validates the dump before writing", async () => {
  const spiritDataDir = await mkdtemp(path.join(tmpdir(), "spirit-zip-prepared-"));
  const preparedRoot = await mkdtemp(path.join(tmpdir(), "spirit-zip-prepared-dir-"));
  try {
    const context: MarketplaceHostContext = { spiritDataDir, hostKind: "desktop" };
    await assert.rejects(
      importPreparedDirectoryToPersonal(context, { preparedDirectoryPath: preparedRoot }),
      /ENOENT|not valid JSON|must be an object/,
    );
    // Nothing was written into the Personal registry.
    const index = await readPersonalMarketplaceIndex(spiritDataDir);
    assert.equal(index.extensions.length, 0);
  } finally {
    await rm(spiritDataDir, { recursive: true, force: true });
    await rm(preparedRoot, { recursive: true, force: true });
  }
});
