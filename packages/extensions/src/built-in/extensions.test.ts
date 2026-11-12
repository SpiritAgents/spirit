import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

import { parseMarketplaceIndexText } from "@spiritagent/extension-toolkit";

import { createHostExtensionManager, installPreparedExtensionDirectory } from "../extensions.js";
import { loadBuiltInState } from "./state.js";
import {
  ensureBuiltInExtensions,
  installBuiltInExtension,
  listMarketplaceCatalog,
  readBuiltInMarketplaceIndex,
  resolveBuiltInRegistryRoot,
} from "./extensions.js";

test("the shipped built-in registry is a valid marketplace.json (dogfood)", async () => {
  const index = await readBuiltInMarketplaceIndex();
  assert.equal(index.schemaVersion, 1);
  assert.equal(index.name, "built-in");
  assert.ok(Array.isArray(index.extensions));

  const raw = await readFile(
    join(resolveBuiltInRegistryRoot(), ".spirit", "marketplace.json"),
    "utf8",
  );
  assert.equal(parseMarketplaceIndexText(raw).name, "built-in");

  const packagesRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
  for (const entry of index.extensions) {
    const contentDir = join(resolveBuiltInRegistryRoot(), "extensions", entry.name);
    const shippedPkgPath = join(contentDir, "package.json");
    assert.ok(existsSync(shippedPkgPath), `${entry.name}/package.json`);
    const sourcePkg = JSON.parse(
      await readFile(join(packagesRoot, entry.name, "package.json"), "utf8"),
    ) as { version: string };
    const shippedPkg = JSON.parse(await readFile(shippedPkgPath, "utf8")) as { version: string };
    assert.equal(entry.version, sourcePkg.version, entry.name);
    assert.equal(shippedPkg.version, sourcePkg.version, entry.name);
  }
});

interface FixtureRegistry {
  root: string;
  setVersion(version: string): Promise<void>;
}

/** A temp registry in the built-in layout: `.spirit/marketplace.json` + `extensions/<name>/`. */
async function writeFixtureRegistry(root: string, version: string): Promise<void> {
  const index = {
    schemaVersion: 1,
    name: "built-in",
    displayName: "Built-in",
    extensions: [
      {
        name: "extension-fixture",
        version,
        source: "./extensions/extension-fixture",
        displayName: "Fixture",
        description: "Built-in fixture extension.",
        defaultInstalled: true,
        manifest: { supportedHosts: ["desktop"] },
      },
      {
        name: "extension-opt-in",
        version,
        source: "./extensions/extension-opt-in",
        displayName: "Opt-in",
        description: "Opt-in fixture extension.",
        defaultInstalled: false,
        manifest: { supportedHosts: ["desktop"] },
      },
      {
        name: "extension-cli-only",
        version,
        source: "./extensions/extension-cli-only",
        displayName: "CLI only",
        description: "CLI-only fixture extension.",
        defaultInstalled: true,
        manifest: { supportedHosts: ["cli"] },
      },
    ],
  };
  await mkdir(join(root, ".spirit"), { recursive: true });
  await writeFile(
    join(root, ".spirit", "marketplace.json"),
    `${JSON.stringify(index, null, 2)}\n`,
    "utf8",
  );
  for (const name of ["extension-fixture", "extension-opt-in", "extension-cli-only"]) {
    const contentDir = join(root, "extensions", name);
    await mkdir(contentDir, { recursive: true });
    await writeFile(
      join(contentDir, "package.json"),
      `${JSON.stringify({ name, version }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(join(contentDir, "VERSION.txt"), `${version}\n`, "utf8");
  }
}

async function makeFixtureRegistry(version: string): Promise<FixtureRegistry> {
  const root = await mkdtemp(join(tmpdir(), "spirit-built-in-registry-"));
  await writeFixtureRegistry(root, version);
  return {
    root,
    async setVersion(next: string) {
      await writeFixtureRegistry(root, next);
    },
  };
}

test("ensureBuiltInExtensions seeds defaultInstalled entries and skips opt-in and other hosts", async () => {
  const spiritDataDir = await mkdtemp(join(tmpdir(), "spirit-built-in-seed-"));
  const registry = await makeFixtureRegistry("1.0.0");
  try {
    const manager = createHostExtensionManager({ spiritDataDir, hostKind: "desktop" });
    const seeded = await ensureBuiltInExtensions({
      spiritDataDir,
      hostKind: "desktop",
      manager,
      registryRoot: registry.root,
    });
    assert.deepEqual(
      seeded.map((item) => item.id),
      ["built-in/extension-fixture"],
    );

    // Same-version ensure still recopies from the bundled registry.
    const again = await ensureBuiltInExtensions({
      spiritDataDir,
      hostKind: "desktop",
      manager,
      registryRoot: registry.root,
    });
    assert.deepEqual(
      again.map((item) => item.id),
      ["built-in/extension-fixture"],
    );

    await manager.remove("built-in/extension-fixture");
    const state = await loadBuiltInState(spiritDataDir);
    assert.ok(state.removedExtensionIds.includes("built-in/extension-fixture"));
    const afterRemoval = await ensureBuiltInExtensions({
      spiritDataDir,
      hostKind: "desktop",
      manager,
      registryRoot: registry.root,
    });
    assert.equal(afterRemoval.length, 0);
  } finally {
    await rm(spiritDataDir, { recursive: true, force: true });
    await rm(registry.root, { recursive: true, force: true });
  }
});

test("ensureBuiltInExtensions recopies installed built-ins from the registry", async () => {
  const spiritDataDir = await mkdtemp(join(tmpdir(), "spirit-built-in-update-"));
  const registry = await makeFixtureRegistry("1.0.0");
  try {
    const manager = createHostExtensionManager({ spiritDataDir, hostKind: "desktop" });
    await ensureBuiltInExtensions({
      spiritDataDir,
      hostKind: "desktop",
      manager,
      registryRoot: registry.root,
    });

    await registry.setVersion("1.1.0");
    const updated = await ensureBuiltInExtensions({
      spiritDataDir,
      hostKind: "desktop",
      manager,
      registryRoot: registry.root,
    });
    assert.deepEqual(
      updated.map((item) => item.id),
      ["built-in/extension-fixture"],
    );
    const listed = await manager.list();
    const fixture = listed.find((item) => item.id === "built-in/extension-fixture");
    assert.equal(fixture?.manifest.version, "1.1.0");
    const content = await readFile(join(fixture!.directoryPath, "VERSION.txt"), "utf8");
    assert.equal(content.trim(), "1.1.0");

    await writeFile(join(registry.root, "extensions/extension-fixture/VERSION.txt"), "1.1.0-hot\n");
    const sameVersion = await ensureBuiltInExtensions({
      spiritDataDir,
      hostKind: "desktop",
      manager,
      registryRoot: registry.root,
    });
    assert.deepEqual(
      sameVersion.map((item) => item.id),
      ["built-in/extension-fixture"],
    );
    const hotContent = await readFile(join(fixture!.directoryPath, "VERSION.txt"), "utf8");
    assert.equal(hotContent.trim(), "1.1.0-hot");
  } finally {
    await rm(spiritDataDir, { recursive: true, force: true });
    await rm(registry.root, { recursive: true, force: true });
  }
});

test("listMarketplaceCatalog merges built-in entries with installed state", async () => {
  const spiritDataDir = await mkdtemp(join(tmpdir(), "spirit-built-in-catalog-"));
  const registry = await makeFixtureRegistry("1.0.0");
  try {
    const before = await listMarketplaceCatalog({
      spiritDataDir,
      hostKind: "desktop",
      registryRoot: registry.root,
    });
    const names = before.map((item) => item.id).sort();
    assert.deepEqual(names, ["built-in/extension-fixture", "built-in/extension-opt-in"]);
    assert.equal(before.find((item) => item.id === "built-in/extension-fixture")?.installed, false);
    assert.equal(
      before.find((item) => item.id === "built-in/extension-fixture")?.manifest.displayName,
      "Fixture",
    );

    await installBuiltInExtension({
      spiritDataDir,
      hostKind: "desktop",
      extensionId: "built-in/extension-fixture",
      registryRoot: registry.root,
    });
    const after = await listMarketplaceCatalog({
      spiritDataDir,
      hostKind: "desktop",
      registryRoot: registry.root,
    });
    assert.equal(after.find((item) => item.id === "built-in/extension-fixture")?.installed, true);
  } finally {
    await rm(spiritDataDir, { recursive: true, force: true });
    await rm(registry.root, { recursive: true, force: true });
  }
});

test("marketplace catalog keeps installed personal extensions and drops them after uninstall", async () => {
  const spiritDataDir = await mkdtemp(join(tmpdir(), "spirit-marketplace-catalog-"));
  const preparedRoot = await mkdtemp(join(tmpdir(), "spirit-marketplace-zip-"));
  try {
    const manager = createHostExtensionManager({
      spiritDataDir,
      hostKind: "desktop",
    });

    await ensureBuiltInExtensions({ spiritDataDir, hostKind: "desktop", manager });

    const packageDir = join(preparedRoot, "zip-ext");
    await mkdir(join(packageDir, ".spirit"), { recursive: true });
    await writeFile(
      join(packageDir, "package.json"),
      `${JSON.stringify({ name: "extension-catalog-zip-demo", version: "0.0.1" }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      join(packageDir, ".spirit", "extension.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          name: "extension-catalog-zip-demo",
          version: "0.0.1",
          sourceId: "personal",
          displayName: "Catalog zip demo",
          description: "archive catalog fixture",
          manifest: { supportedHosts: ["desktop"] },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    const zipInstalled = await installPreparedExtensionDirectory(
      { spiritDataDir, hostKind: "desktop" },
      { preparedDirectoryPath: packageDir },
    );
    assert.equal(zipInstalled.id, "personal/extension-catalog-zip-demo");
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
          extensionId: "built-in/missing",
        }),
      /Unknown built-in extension/,
    );
  } finally {
    await rm(spiritDataDir, { recursive: true, force: true });
  }
});
