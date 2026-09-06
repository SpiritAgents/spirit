import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";

import { readMarketplaceCatalog } from "./catalog.js";
import { importPreparedDirectoryToPersonal } from "./import-zip.js";
import type { MarketplaceHostContext } from "./resolve.js";
import { addMarketplaceSource } from "./sources.js";
import { PERSONAL_MARKETPLACE_SOURCE_ID } from "./types.js";

async function writeUserRegistry(
  root: string,
  name: string,
  entryName: string,
  entryDisplayName?: string,
): Promise<void> {
  await mkdir(path.join(root, ".spirit"), { recursive: true });
  await writeFile(
    path.join(root, ".spirit", "marketplace.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        name,
        displayName: name,
        extensions: [
          {
            name: entryName,
            version: "1.0.0",
            source: `./extensions/${entryName}`,
            displayName: entryDisplayName ?? entryName,
            description: `${entryName} extension.`,
            reviewStatus: "verified",
            manifest: { supportedHosts: ["desktop"] },
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  const contentDir = path.join(root, "extensions", entryName);
  await mkdir(contentDir, { recursive: true });
  await writeFile(
    path.join(contentDir, "package.json"),
    `${JSON.stringify({ name: entryName, version: "1.0.0" }, null, 2)}\n`,
    "utf8",
  );
}

async function importPersonalExtension(
  context: MarketplaceHostContext,
  name: string,
  displayName?: string,
): Promise<void> {
  const prepared = path.join(context.spiritDataDir, "prepared", name);
  await mkdir(path.join(prepared, ".spirit"), { recursive: true });
  await writeFile(
    path.join(prepared, ".spirit", "extension.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        name,
        version: "1.0.0",
        sourceId: "self-declared",
        displayName: displayName ?? name,
        description: `${name} extension.`,
        manifest: { supportedHosts: ["desktop"] },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await importPreparedDirectoryToPersonal(context, { preparedDirectoryPath: prepared });
}

test("readMarketplaceCatalog merges every configured source", async () => {
  const spiritDataDir = await mkdtemp(path.join(tmpdir(), "spirit-catalog-all-data-"));
  const registryRoot = await mkdtemp(path.join(tmpdir(), "spirit-catalog-all-registry-"));
  try {
    const context: MarketplaceHostContext = { spiritDataDir, hostKind: "desktop" };
    await importPersonalExtension(context, "extension-personal", "Zebra Personal");
    await writeUserRegistry(registryRoot, "registry-user", "extension-user", "Alpha User");
    await addMarketplaceSource(context, registryRoot);

    const { items, warnings } = await readMarketplaceCatalog(context);
    assert.equal(warnings.length, 0);

    const personal = items.find(
      (item) =>
        item.source.id === PERSONAL_MARKETPLACE_SOURCE_ID &&
        item.entry.name === "extension-personal",
    );
    assert.ok(personal);
    assert.equal(personal.installed, true);

    const user = items.find((item) => item.source.name === "registry-user");
    assert.ok(user);
    assert.equal(user.entry.name, "extension-user");
    assert.equal(user.installed, false);

    // The merged catalog sorts globally by display name, not by source order
    // (Personal precedes user sources, yet "Alpha User" precedes "Zebra Personal").
    const displayOrder = items.map((item) => item.entry.displayName);
    assert.ok(
      displayOrder.indexOf("Alpha User") < displayOrder.indexOf("Zebra Personal"),
      `expected global display-name order, got: ${displayOrder.join(", ")}`,
    );
  } finally {
    await rm(spiritDataDir, { recursive: true, force: true });
    await rm(registryRoot, { recursive: true, force: true });
  }
});

test("readMarketplaceCatalog skips a source that fails to read", async () => {
  const spiritDataDir = await mkdtemp(path.join(tmpdir(), "spirit-catalog-fail-data-"));
  const registryRoot = await mkdtemp(path.join(tmpdir(), "spirit-catalog-fail-registry-"));
  try {
    const context: MarketplaceHostContext = { spiritDataDir, hostKind: "desktop" };
    await importPersonalExtension(context, "extension-personal");
    await writeUserRegistry(registryRoot, "registry-gone", "extension-gone");
    await addMarketplaceSource(context, registryRoot);
    // The source disappears after being added: the merge skips it instead of failing.
    await rm(registryRoot, { recursive: true, force: true });

    const { items } = await readMarketplaceCatalog(context);
    assert.ok(
      items.some(
        (item) =>
          item.source.id === PERSONAL_MARKETPLACE_SOURCE_ID &&
          item.entry.name === "extension-personal",
      ),
    );
    assert.ok(items.every((item) => item.source.name !== "registry-gone"));
  } finally {
    await rm(spiritDataDir, { recursive: true, force: true });
    await rm(registryRoot, { recursive: true, force: true });
  }
});
