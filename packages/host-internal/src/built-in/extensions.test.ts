import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import { createHostExtensionManager, installPreparedExtensionDirectory } from "../extensions.js";
import { loadBuiltInState } from "./state.js";
import {
  ensureBuiltInExtensions,
  installBuiltInExtension,
  listMarketplaceCatalog,
  shouldSkipBuiltInExtensionSeed,
} from "./extensions.js";

test("shouldSkipBuiltInExtensionSeed honors defaultInstalled, tombstones, and installed ids", () => {
  const empty = new Set<string>();
  assert.equal(
    shouldSkipBuiltInExtensionSeed({
      extensionId: "spirit.demo",
      removedIds: empty,
      installedIds: empty,
    }),
    false,
  );
  assert.equal(
    shouldSkipBuiltInExtensionSeed({
      extensionId: "spirit.demo",
      defaultInstalled: false,
      removedIds: empty,
      installedIds: empty,
    }),
    true,
  );
  assert.equal(
    shouldSkipBuiltInExtensionSeed({
      extensionId: "spirit.demo",
      removedIds: new Set(["spirit.demo"]),
      installedIds: empty,
    }),
    true,
  );
  assert.equal(
    shouldSkipBuiltInExtensionSeed({
      extensionId: "Spirit.Demo",
      removedIds: empty,
      installedIds: new Set(["spirit.demo"]),
    }),
    true,
  );
});

test("installPreparedDirectory records defaultInstalled false from the manifest", async () => {
  const spiritDataDir = await mkdtemp(join(tmpdir(), "spirit-default-off-ext-"));
  const preparedRoot = await mkdtemp(join(tmpdir(), "spirit-default-off-prepared-"));
  try {
    const packageDir = join(preparedRoot, "opt-in-ext");
    await mkdir(packageDir, { recursive: true });
    await writeFile(
      join(packageDir, "package.json"),
      `${JSON.stringify(
        {
          name: "@spiritagent/extension-opt-in-demo",
          version: "0.0.1",
          description: "defaultInstalled false fixture",
          spiritExtension: {
            schemaVersion: 1,
            displayName: "Opt-in demo",
            supportedHosts: ["desktop"],
            defaultInstalled: false,
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const installed = await installPreparedExtensionDirectory(
      { spiritDataDir, hostKind: "desktop" },
      { preparedDirectoryPath: packageDir, installSource: "archive" },
    );
    assert.equal(installed.manifest.defaultInstalled, false);
  } finally {
    await rm(spiritDataDir, { recursive: true, force: true });
    await rm(preparedRoot, { recursive: true, force: true });
  }
});

test("marketplace catalog keeps installed archives and drops them after uninstall", async () => {
  const spiritDataDir = await mkdtemp(join(tmpdir(), "spirit-marketplace-catalog-"));
  const preparedRoot = await mkdtemp(join(tmpdir(), "spirit-marketplace-zip-"));
  try {
    const manager = createHostExtensionManager({
      spiritDataDir,
      hostKind: "desktop",
    });

    await ensureBuiltInExtensions({ spiritDataDir, hostKind: "desktop", manager });
    assert.equal((await manager.list()).length, 0);

    const packageDir = join(preparedRoot, "zip-ext");
    await mkdir(packageDir, { recursive: true });
    await writeFile(
      join(packageDir, "package.json"),
      `${JSON.stringify(
        {
          name: "@spiritagent/extension-catalog-zip-demo",
          version: "0.0.1",
          description: "archive catalog fixture",
          spiritExtension: {
            schemaVersion: 1,
            displayName: "Catalog zip demo",
            supportedHosts: ["desktop"],
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    const zipInstalled = await installPreparedExtensionDirectory(
      { spiritDataDir, hostKind: "desktop" },
      { preparedDirectoryPath: packageDir, installSource: "archive" },
    );
    const withZip = await listMarketplaceCatalog({ spiritDataDir, hostKind: "desktop" });
    assert.equal(withZip.find((item) => item.id === zipInstalled.id)?.installed, true);

    await manager.remove(zipInstalled.id);
    const withoutZip = await listMarketplaceCatalog({ spiritDataDir, hostKind: "desktop" });
    assert.equal(
      withoutZip.some((item) => item.id === zipInstalled.id),
      false,
    );
    const state = await loadBuiltInState(spiritDataDir);
    assert.equal(state.removedExtensionIds.includes(zipInstalled.id), false);
  } finally {
    await rm(spiritDataDir, { recursive: true, force: true });
    await rm(preparedRoot, { recursive: true, force: true });
  }
});

test("installBuiltInExtension rejects unknown ids", async () => {
  const spiritDataDir = await mkdtemp(join(tmpdir(), "spirit-install-built-in-reject-"));
  try {
    await assert.rejects(
      () =>
        installBuiltInExtension({
          spiritDataDir,
          hostKind: "desktop",
          extensionId: "spirit.missing",
        }),
      /Unknown built-in extension/,
    );
  } finally {
    await rm(spiritDataDir, { recursive: true, force: true });
  }
});
