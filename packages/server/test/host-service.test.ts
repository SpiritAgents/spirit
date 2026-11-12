import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import { SPIRIT_CONFIG_SCHEMA_VERSION } from "@spiritagent/config";
import { configFilePath } from "@spiritagent/config/credentials";
import { installPreparedExtensionDirectory } from "@spiritagent/extensions";

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
      providers: [],
      activeModel: { providerId: "g", name: "m" },
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

test("HOST_METHODS whitelists shared model skill and stored-session contracts", () => {
  for (const method of [
    "host.getConfig",
    "host.updateConfig",
    "host.addModel",
    "host.resolveActiveSkill",
    "session.listStored",
    "session.loadStored",
    "session.saveStored",
    "session.rewind",
    "session.fork",
  ]) {
    assert.ok(HOST_METHODS.has(method), method);
  }
});

test("host.getConfig initializes the shared schema in the daemon data dir", async () => {
  await withTempDir(async (dir) => {
    const previous = process.env.SPIRIT_DATA_DIR;
    process.env.SPIRIT_DATA_DIR = dir;
    try {
      const service = makeService(dir);
      const config = (await service.handle("host.getConfig", {})) as {
        schemaVersion: number;
        providers: unknown[];
      };
      assert.equal(config.schemaVersion, SPIRIT_CONFIG_SCHEMA_VERSION);
      assert.deepEqual(config.providers, []);
    } finally {
      if (previous === undefined) {
        delete process.env.SPIRIT_DATA_DIR;
      } else {
        process.env.SPIRIT_DATA_DIR = previous;
      }
    }
  });
});

test("host config and stored sessions stay isolated to each daemon data dir", async () => {
  await withTempDir(async (dir) => {
    const firstDir = join(dir, "first");
    const secondDir = join(dir, "second");
    const processDir = join(dir, "process");
    const previous = process.env.SPIRIT_DATA_DIR;
    process.env.SPIRIT_DATA_DIR = processDir;
    try {
      const first = makeService(firstDir);
      const second = makeService(secondDir);
      await Promise.all([first.handle("host.getConfig", {}), second.handle("host.getConfig", {})]);
      assert.equal(
        JSON.parse(await readFile(join(firstDir, "config.json"), "utf8")).schemaVersion,
        SPIRIT_CONFIG_SCHEMA_VERSION,
      );
      assert.equal(
        JSON.parse(await readFile(join(secondDir, "config.json"), "utf8")).schemaVersion,
        SPIRIT_CONFIG_SCHEMA_VERSION,
      );
      await assert.rejects(readFile(join(processDir, "config.json"), "utf8"), {
        code: "ENOENT",
      });

      const timeline = [
        {
          turnId: 1,
          createdOrder: 1,
          userRow: {
            rowId: "user-1",
            messageId: 1,
            turnId: 1,
            kind: "user",
            createdOrder: 1,
            content: "Daemon chat",
            pending: false,
          },
          segments: [],
        },
      ];
      await mkdir(join(firstDir, "chats"), { recursive: true });
      await mkdir(join(processDir, "chats"), { recursive: true });
      const storedSession = (displayName: string) => ({
        chatSchemaVersion: 2,
        llmHistory: [],
        subagentSessions: [],
        desktopMessageTimeline: timeline,
        savedAtUnixMs: 1,
        sessionDisplayName: displayName,
      });
      await writeFile(
        join(firstDir, "chats", "chat.json"),
        JSON.stringify(storedSession("Daemon chat")),
      );
      await writeFile(
        join(processDir, "chats", "chat.json"),
        JSON.stringify(storedSession("Process chat")),
      );
      const stored = (await first.handle("session.listStored", {})) as Array<{
        displayName: string;
      }>;
      assert.deepEqual(
        stored.map((entry) => entry.displayName),
        ["Daemon chat"],
      );
    } finally {
      if (previous === undefined) {
        delete process.env.SPIRIT_DATA_DIR;
      } else {
        process.env.SPIRIT_DATA_DIR = previous;
      }
    }
  });
});

test("host.resolveActiveSkill uses the TypeScript payload builder", async () => {
  await withTempDir(async (dir) => {
    const workspaceRoot = join(dir, "workspace");
    const skillDir = join(workspaceRoot, ".spirit", "skills", "fixture");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      "---\nname: fixture\ndescription: Fixture skill\n---\nUse the fixture.\n",
    );
    const service = makeService(dir);
    const skill = (await service.handle("host.resolveActiveSkill", {
      workspaceRoot,
      skill: { name: "fixture" },
    })) as { name: string; content: string; resources: unknown[] };
    assert.equal(skill.name, "fixture");
    assert.equal(skill.content, "Use the fixture.");
    assert.deepEqual(skill.resources, []);
  });
});

test("host.resolveActiveSkill resolves extension skills with base-name precedence", async () => {
  await withTempDir(async (dir) => {
    const spiritDataDir = join(dir, "data");
    const workspaceRoot = join(dir, "workspace");
    const preparedDirectoryPath = join(dir, "prepared");
    const baseSkillDir = join(workspaceRoot, ".spirit", "skills", "shared");
    await mkdir(baseSkillDir, { recursive: true });
    await writeFile(
      join(baseSkillDir, "SKILL.md"),
      "---\nname: shared\ndescription: Base skill\n---\nUse the base skill.\n",
    );
    await mkdir(join(preparedDirectoryPath, ".spirit"), { recursive: true });
    await writeFile(
      join(preparedDirectoryPath, "package.json"),
      JSON.stringify({ name: "fixture-skills", version: "0.0.1" }),
    );
    await writeFile(
      join(preparedDirectoryPath, ".spirit", "extension.json"),
      JSON.stringify({
        schemaVersion: 1,
        name: "fixture-skills",
        version: "0.0.1",
        sourceId: "personal",
        displayName: "Fixture Skills",
        description: "Fixture extension skills.",
        manifest: {
          supportedHosts: ["cli"],
          requestedCapabilities: ["skills"],
          contributes: { skills: true },
        },
      }),
    );
    for (const [name, description] of [
      ["shared", "Extension shadow"],
      ["extension-only", "Extension skill"],
    ] as const) {
      const skillDir = join(preparedDirectoryPath, "skills", name);
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, "SKILL.md"),
        `---\nname: ${name}\ndescription: ${description}\n---\nUse ${description}.\n`,
      );
    }
    await installPreparedExtensionDirectory(
      { spiritDataDir, hostKind: "cli" },
      { preparedDirectoryPath },
    );

    const service = makeService(spiritDataDir);
    const metadata = (await service.handle("host.loadCliMetadata", {
      workspaceRoot,
      hostKind: "cli",
    })) as { extensionSkillEntries: Array<{ name: string }> };
    assert.deepEqual(
      metadata.extensionSkillEntries.map((entry) => entry.name),
      ["extension-only"],
    );
    const shared = (await service.handle("host.resolveActiveSkill", {
      workspaceRoot,
      skill: { name: "shared" },
    })) as { scope: string; content: string };
    assert.equal(shared.scope, "workspace");
    assert.equal(shared.content, "Use the base skill.");
    const extension = (await service.handle("host.resolveActiveSkill", {
      workspaceRoot,
      skill: { name: "extension-only" },
    })) as { scope: string; content: string };
    assert.equal(extension.scope, "extension");
    assert.equal(extension.content, "Use Extension skill.");
  });
});

test("session.listStored reads only the daemon data dir", async () => {
  await withTempDir(async (dir) => {
    const previous = process.env.SPIRIT_DATA_DIR;
    process.env.SPIRIT_DATA_DIR = dir;
    try {
      const service = makeService(dir);
      assert.deepEqual(await service.handle("session.listStored", {}), []);
    } finally {
      if (previous === undefined) {
        delete process.env.SPIRIT_DATA_DIR;
      } else {
        process.env.SPIRIT_DATA_DIR = previous;
      }
    }
  });
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
  assert.ok(HOST_METHODS.has("host.refreshExtensions"));
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
