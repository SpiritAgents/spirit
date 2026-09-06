import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import { SPIRIT_CONFIG_SCHEMA_VERSION, configFilePath } from "@spiritagent/host-internal";

import { HOST_METHODS, HostService, type HostCheckPermissionResult } from "../src/host-service.js";
import type { SessionManager } from "../src/session-manager.js";

function makeService(spiritDataDir: string): HostService {
  // host.checkPermission never touches the SessionManager dependency.
  return new HostService(spiritDataDir, undefined as unknown as SessionManager);
}

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "spirit-host-service-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function writeConfig(dir: string, permission: unknown): Promise<void> {
  await writeFile(
    configFilePath(dir),
    `${JSON.stringify({
      schemaVersion: SPIRIT_CONFIG_SCHEMA_VERSION,
      providerGroups: [],
      activeModel: { groupId: "g", name: "m" },
      permission,
    })}\n`,
    "utf8",
  );
}

async function check(
  service: HostService,
  params: Record<string, unknown>,
): Promise<HostCheckPermissionResult> {
  return (await service.handle("host.checkPermission", params)) as HostCheckPermissionResult;
}

test("HOST_METHODS whitelists host.checkPermission", () => {
  assert.ok(HOST_METHODS.has("host.checkPermission"));
});

test("host.checkPermission rejects an unknown or missing domain", async () => {
  await withTempDir(async (dir) => {
    const service = makeService(dir);
    await assert.rejects(
      service.handle("host.checkPermission", { value: "ls" }),
      /invalid domain/u,
    );
    await assert.rejects(
      service.handle("host.checkPermission", { domain: "write_file", value: "ls" }),
      /invalid domain/u,
    );
  });
});

test("host.checkPermission rejects a missing or empty value", async () => {
  await withTempDir(async (dir) => {
    const service = makeService(dir);
    await assert.rejects(
      service.handle("host.checkPermission", { domain: "shell" }),
      /missing value/u,
    );
    await assert.rejects(
      service.handle("host.checkPermission", { domain: "shell", value: "   " }),
      /missing value/u,
    );
  });
});

test("host.checkPermission evaluates shell commands against config rules", async () => {
  await withTempDir(async (dir) => {
    await writeConfig(dir, { shell: { "git *": "allow", "rm -rf *": "deny" } });
    const service = makeService(dir);

    const allowed = await check(service, { domain: "shell", value: "git status" });
    assert.equal(allowed.verdict, "allow");
    assert.deepEqual(allowed.matched, { pattern: "git *", action: "allow" });
    assert.deepEqual(allowed.warnings, []);

    const denied = await check(service, { domain: "shell", value: "echo hi && rm -rf /" });
    assert.equal(denied.verdict, "deny");
    assert.deepEqual(denied.matched, { pattern: "rm -rf *", action: "deny" });

    const unmatched = await check(service, { domain: "shell", value: "make build" });
    assert.equal(unmatched.verdict, "ask");
    assert.equal(unmatched.matched, undefined);
  });
});

test("host.checkPermission resolves relative read_file paths against workspaceRoot", async () => {
  await withTempDir(async (dir) => {
    const workspaceRoot = join(dir, "workspace");
    await writeConfig(dir, { read_file: { ".env": "deny" } });
    const service = makeService(dir);

    const denied = await check(service, {
      domain: "read_file",
      value: ".env",
      workspaceRoot,
    });
    assert.equal(denied.verdict, "deny");
    assert.deepEqual(denied.matched, { pattern: ".env", action: "deny" });

    // Relative patterns never match a path outside the workspace.
    const outside = await check(service, {
      domain: "read_file",
      value: "/etc/hosts",
      workspaceRoot,
    });
    assert.equal(outside.verdict, "ask");
    assert.equal(outside.matched, undefined);
  });
});

test("host.checkPermission expands a leading ~ for read_file paths", async () => {
  await withTempDir(async (dir) => {
    await writeConfig(dir, { read_file: { [`${homedir()}/*`]: "allow" } });
    const service = makeService(dir);

    const result = await check(service, {
      domain: "read_file",
      value: "~/spirit-host-service-definitely-missing-file",
    });
    assert.equal(result.verdict, "allow");
    assert.deepEqual(result.matched, {
      pattern: `${homedir()}/*`,
      action: "allow",
    });
  });
});

test("host.checkPermission passes through config lint warnings", async () => {
  await withTempDir(async (dir) => {
    await writeConfig(dir, { shell: { ls: "maybe" } });
    const service = makeService(dir);

    const result = await check(service, { domain: "shell", value: "ls" });
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0]!, /invalid action/u);
    // The invalid rule is dropped at load time, so nothing matches.
    assert.equal(result.verdict, "ask");
    assert.equal(result.matched, undefined);
  });
});

test("HOST_METHODS whitelists local marketplace catalog RPCs", () => {
  assert.ok(HOST_METHODS.has("host.listMarketplaceCatalog"));
  assert.ok(HOST_METHODS.has("host.installBuiltInExtension"));
});

test("HOST_METHODS whitelists the multi-source marketplace RPCs", () => {
  for (const method of [
    "host.listMarketplaceSources",
    "host.addMarketplaceSource",
    "host.removeMarketplaceSource",
    "host.getMarketplaceExtensionDetail",
    "host.installMarketplaceExtension",
    "host.updateExtension",
    "host.checkExtensionUpdate",
  ]) {
    assert.ok(HOST_METHODS.has(method), method);
  }
});

async function writeRegistryFixture(
  root: string,
  name: string,
  entries: Array<Record<string, unknown>>,
): Promise<void> {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(root, ".spirit"), { recursive: true });
  await writeFile(
    join(root, ".spirit", "marketplace.json"),
    `${JSON.stringify({ schemaVersion: 1, name, displayName: name, extensions: entries }, null, 2)}\n`,
    "utf8",
  );
  for (const entry of entries) {
    const entryName = (entry as { name: string }).name;
    const contentDir = join(root, "extensions", entryName);
    await mkdir(contentDir, { recursive: true });
    await writeFile(
      join(contentDir, "package.json"),
      `${JSON.stringify({ name: entryName, version: "0.0.0" }, null, 2)}\n`,
      "utf8",
    );
  }
}

function fixtureEntry(
  name: string,
  version: string,
  reviewStatus?: string,
): Record<string, unknown> {
  return {
    name,
    version,
    source: `./extensions/${name}`,
    displayName: name,
    description: `${name} extension.`,
    ...(reviewStatus ? { reviewStatus } : {}),
    manifest: { supportedHosts: ["desktop", "cli"] },
  };
}

test("marketplace source RPCs add, list, catalog, detail, install, update, remove", async () => {
  await withTempDir(async (dir) => {
    let refreshed = 0;
    const service = new HostService(dir, {
      refreshExtensions: async () => {
        refreshed += 1;
      },
    } as unknown as SessionManager);

    const registryDir = await mkdtemp(join(tmpdir(), "spirit-host-service-registry-"));
    try {
      await writeRegistryFixture(registryDir, "fixture-registry", [
        fixtureEntry("extension-alpha", "1.0.0", "verified"),
        fixtureEntry("extension-beta", "1.0.0"),
      ]);

      // add (locator is an absolute path here; clients resolve relative paths)
      const added = (await service.handle("host.addMarketplaceSource", {
        locator: registryDir,
      })) as { id: string; name: string; kind: string };
      assert.equal(added.name, "fixture-registry");
      assert.equal(added.kind, "local");

      // list includes built-in + personal + the added source
      const sources = (await service.handle("host.listMarketplaceSources", {})) as Array<{
        id: string;
        name: string;
        internal: boolean;
      }>;
      assert.deepEqual(
        sources.map((source) => source.name),
        ["built-in", "personal", "fixture-registry"],
      );
      assert.equal(sources[0]?.internal, true);
      assert.equal(sources[2]?.internal, false);

      // per-source catalog
      const catalog = (await service.handle("host.listMarketplaceCatalog", {
        hostKind: "desktop",
        sourceId: added.id,
      })) as {
        items: Array<{ id: string; name: string; installed: boolean; reviewStatus: string }>;
      };
      assert.deepEqual(
        catalog.items.map((item) => item.id),
        [`${added.id}/extension-alpha`, `${added.id}/extension-beta`],
      );
      assert.equal(catalog.items[0]?.reviewStatus, "verified");
      assert.equal(catalog.items[1]?.reviewStatus, "unverified");

      // detail
      const detail = (await service.handle("host.getMarketplaceExtensionDetail", {
        hostKind: "desktop",
        sourceId: added.id,
        name: "extension-alpha",
      })) as { id: string; installed: boolean };
      assert.equal(detail.id, `${added.id}/extension-alpha`);
      assert.equal(detail.installed, false);

      // install: verified entry installs straight away
      const installed = (await service.handle("host.installMarketplaceExtension", {
        hostKind: "desktop",
        name: "extension-alpha",
      })) as { status: string; extension: { id: string } };
      assert.equal(installed.status, "installed");
      assert.equal(installed.extension.id, `${added.id}/extension-alpha`);
      assert.ok(refreshed > 0);

      // install: unverified entry hits the review gate, then passes with acknowledgement
      const gated = (await service.handle("host.installMarketplaceExtension", {
        hostKind: "desktop",
        name: "extension-beta",
      })) as { status: string; reviewStatus: string };
      assert.equal(gated.status, "review-required");
      assert.equal(gated.reviewStatus, "unverified");
      const acknowledged = (await service.handle("host.installMarketplaceExtension", {
        hostKind: "desktop",
        name: "extension-beta",
        reviewAcknowledged: true,
      })) as { status: string };
      assert.equal(acknowledged.status, "installed");

      // update check: no update yet
      const noUpdate = (await service.handle("host.checkExtensionUpdate", {
        hostKind: "desktop",
        id: `${added.id}/extension-alpha`,
      })) as { updateAvailable: boolean };
      assert.equal(noUpdate.updateAvailable, false);

      // bump the registry version, then update
      await writeRegistryFixture(registryDir, "fixture-registry", [
        fixtureEntry("extension-alpha", "1.1.0", "verified"),
        fixtureEntry("extension-beta", "1.0.0"),
      ]);
      const hasUpdate = (await service.handle("host.checkExtensionUpdate", {
        hostKind: "desktop",
        id: `${added.id}/extension-alpha`,
      })) as { updateAvailable: boolean; version: string };
      assert.equal(hasUpdate.updateAvailable, true);
      assert.equal(hasUpdate.version, "1.1.0");
      const updated = (await service.handle("host.updateExtension", {
        hostKind: "desktop",
        id: `${added.id}/extension-alpha`,
      })) as { status: string; extension: { version: string } };
      assert.equal(updated.status, "updated");
      assert.equal(updated.extension.version, "1.1.0");

      // remove
      const removed = (await service.handle("host.removeMarketplaceSource", {
        name: "fixture-registry",
      })) as { name: string };
      assert.equal(removed.name, "fixture-registry");
      const after = (await service.handle("host.listMarketplaceSources", {})) as Array<unknown>;
      assert.equal(after.length, 2);
    } finally {
      await rm(registryDir, { recursive: true, force: true });
    }
  });
});

test("host.listMarketplaceCatalog returns an array for the current host", async () => {
  await withTempDir(async (dir) => {
    const service = makeService(dir);
    const catalog = (await service.handle("host.listMarketplaceCatalog", {
      hostKind: "desktop",
    })) as Array<{ id: string; installed: boolean }>;
    assert.ok(Array.isArray(catalog));
  });
});

test("host.installBuiltInExtension requires an id and rejects unknown ids", async () => {
  await withTempDir(async (dir) => {
    let refreshed = 0;
    const service = new HostService(dir, {
      refreshExtensions: async () => {
        refreshed += 1;
      },
    } as unknown as SessionManager);

    await assert.rejects(
      service.handle("host.installBuiltInExtension", { hostKind: "desktop" }),
      /missing extension id/u,
    );
    await assert.rejects(
      service.handle("host.installBuiltInExtension", {
        hostKind: "desktop",
        id: "spirit.missing",
      }),
      /Unknown built-in extension/u,
    );
    assert.equal(refreshed, 0);
  });
});
