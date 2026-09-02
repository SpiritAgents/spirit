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
