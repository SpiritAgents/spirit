import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, unlink, utimes, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import { SPIRIT_CONFIG_SCHEMA_VERSION } from "../config.js";
import { configFilePath } from "../credentials/spirit-config.js";
import {
  createPermissionConfigLoader,
  loadPermissionConfig,
  normalizeReadFilePattern,
  savePermissionRule,
} from "./config-io.js";

function baseConfig(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: SPIRIT_CONFIG_SCHEMA_VERSION,
    providers: [],
    activeModel: { providerId: "g", name: "m" },
    ...extra,
  };
}

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "spirit-permissions-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function writeConfig(dir: string, config: Record<string, unknown>): Promise<void> {
  await writeFile(configFilePath(dir), `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

test("loadPermissionConfig drops a non-object permission field with a warning", async () => {
  await withTempDir(async (dir) => {
    await writeConfig(dir, baseConfig({ permission: "nope" }));
    const { config, warnings } = loadPermissionConfig(dir);
    assert.deepEqual(config, {});
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /expected an object/u);
  });
});

test("loadPermissionConfig drops a domain whose rules are not an object", async () => {
  await withTempDir(async (dir) => {
    await writeConfig(dir, baseConfig({ permission: { shell: "nope" } }));
    const { config, warnings } = loadPermissionConfig(dir);
    assert.equal(config.shell, undefined);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /permission\.shell/u);
  });
});

test("loadPermissionConfig drops empty patterns and invalid actions", async () => {
  await withTempDir(async (dir) => {
    await writeConfig(
      dir,
      baseConfig({
        permission: {
          shell: {
            "": "allow",
            "   ": "ask",
            "git *": "maybe",
            "bad-json-action": 42,
            "good *": "allow",
          },
        },
      }),
    );
    const { config, warnings } = loadPermissionConfig(dir);
    assert.deepEqual(config.shell, { "good *": "allow" });
    assert.equal(warnings.length, 4);
    assert.ok(warnings.some((w) => w.includes("empty / whitespace-only pattern")));
    assert.ok(warnings.some((w) => w.includes('"git *"') && w.includes('"maybe"')));
    assert.ok(warnings.some((w) => w.includes('"bad-json-action"') && w.includes("42")));
  });
});

test("loadPermissionConfig keeps relative read_file patterns with a workspace warning", async () => {
  await withTempDir(async (dir) => {
    await writeConfig(dir, baseConfig({ permission: { read_file: { "src/*.ts": "allow" } } }));
    const { config, warnings } = loadPermissionConfig(dir);
    assert.deepEqual(config.read_file, { "src/*.ts": "allow" });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /only matches paths inside the workspace/u);
  });
});

test("loadPermissionConfig treats leading-wildcard read_file patterns as absolute-form", async () => {
  await withTempDir(async (dir) => {
    await writeConfig(
      dir,
      baseConfig({ permission: { read_file: { "*": "allow", "*/.env*": "ask" } } }),
    );
    const { config, warnings } = loadPermissionConfig(dir);
    assert.deepEqual(config.read_file, { "*": "allow", "*/.env*": "ask" });
    assert.deepEqual(warnings, []);
  });
});

test("loadPermissionConfig flags read_file patterns that can never match a canonical path", async () => {
  await withTempDir(async (dir) => {
    await writeConfig(
      dir,
      baseConfig({ permission: { read_file: { "../outside/*": "deny", "./dot/*": "allow" } } }),
    );
    const { config, warnings } = loadPermissionConfig(dir);
    assert.deepEqual(config.read_file, { "../outside/*": "deny", "./dot/*": "allow" });
    assert.equal(warnings.length, 2);
    assert.ok(warnings.every((w) => w.includes("can never match a canonical path")));
  });
});

test("loadPermissionConfig expands tilde patterns and keeps absolute patterns as-is", async () => {
  await withTempDir(async (dir) => {
    const absolutePattern = process.platform === "win32" ? "C:\\ssl\\*" : "/etc/ssl/*";
    await writeConfig(
      dir,
      baseConfig({ permission: { read_file: { "~/.aws/*": "deny", [absolutePattern]: "allow" } } }),
    );
    const { config, warnings } = loadPermissionConfig(dir);
    const keys = Object.keys(config.read_file ?? {});
    assert.equal(keys.length, 2);
    // Compare with normalized separators: homedir() uses platform separators.
    const homePrefix = homedir().replace(/\\/gu, "/");
    assert.ok(keys.some((k) => k.replace(/\\/gu, "/") === `${homePrefix}/.aws/*`));
    assert.ok(keys.includes(absolutePattern));
    assert.deepEqual(warnings, []);
  });
});

test("loadPermissionConfig warns on unknown domains and ignores them", async () => {
  await withTempDir(async (dir) => {
    await writeConfig(dir, baseConfig({ permission: { web_fetch: { "*": "allow" } } }));
    const { config, warnings } = loadPermissionConfig(dir);
    assert.equal((config as Record<string, unknown>)["web_fetch"], undefined);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /unknown domain/u);
  });
});

test("loadPermissionConfig returns an empty config when config.json is missing", async () => {
  await withTempDir(async (dir) => {
    const { config, warnings } = loadPermissionConfig(dir);
    assert.deepEqual(config, {});
    assert.deepEqual(warnings, []);
  });
});

test("normalizeReadFilePattern classifies tilde, absolute and relative forms", () => {
  const homePrefix = homedir().replace(/\\/gu, "/");
  const tilde = normalizeReadFilePattern("~/.config/*");
  assert.equal(tilde.pattern.replace(/\\/gu, "/"), `${homePrefix}/.config/*`);
  assert.equal(tilde.warning, undefined);

  const absolute = normalizeReadFilePattern("/var/log/*");
  assert.equal(absolute.pattern, "/var/log/*");
  assert.equal(absolute.warning, undefined);

  const drive = normalizeReadFilePattern(String.raw`D:\data\*`);
  assert.equal(drive.warning, undefined);

  const relative = normalizeReadFilePattern("src/*.ts");
  assert.equal(relative.pattern, "src/*.ts");
  assert.match(relative.warning ?? "", /relative/u);
});

test("savePermissionRule preserves unrelated config fields and unknown domains", async () => {
  await withTempDir(async (dir) => {
    await writeConfig(
      dir,
      baseConfig({
        someOtherField: { nested: true },
        permission: { web_fetch: { "*": "allow" }, shell: { "old *": "deny" } },
      }),
    );
    await savePermissionRule(dir, "shell", "git *", "allow");

    const raw = JSON.parse(await readFile(configFilePath(dir), "utf8")) as Record<string, unknown>;
    assert.equal(raw["schemaVersion"], SPIRIT_CONFIG_SCHEMA_VERSION);
    assert.deepEqual(raw["activeModel"], { providerId: "g", name: "m" });
    assert.deepEqual(raw["someOtherField"], { nested: true });
    assert.deepEqual(raw["permission"], {
      web_fetch: { "*": "allow" },
      shell: { "old *": "deny", "git *": "allow" },
    });

    // Atomic write leaves no tmp files behind.
    const files = await readdir(dir);
    assert.deepEqual(files, ["config.json"]);

    // The saved rule round-trips through the loader.
    const { config } = loadPermissionConfig(dir);
    assert.equal(config.shell?.["git *"], "allow");
  });
});

test("savePermissionRule creates a minimal config when none exists", async () => {
  await withTempDir(async (dir) => {
    await savePermissionRule(dir, "read_file", "*.env", "deny");
    const { config, warnings } = loadPermissionConfig(dir);
    assert.deepEqual(config.read_file, { "*.env": "deny" });
    // Leading-wildcard patterns are absolute-form, so no warning is produced.
    assert.deepEqual(warnings, []);
  });
});

test("savePermissionRule replaces a garbage permission field instead of merging it", async () => {
  await withTempDir(async (dir) => {
    await writeConfig(dir, baseConfig({ permission: "junk" }));
    await savePermissionRule(dir, "shell", "ls *", "allow");
    const raw = JSON.parse(await readFile(configFilePath(dir), "utf8")) as Record<string, unknown>;
    assert.deepEqual(raw["permission"], { shell: { "ls *": "allow" } });
  });
});

test("mtime loader re-reads only after the file mtime changes", async () => {
  await withTempDir(async (dir) => {
    const filePath = configFilePath(dir);
    // Pin exact integer-ms mtimes via utimes: Date truncates sub-ms precision,
    // so capturing mtimeMs from stat would not round-trip.
    const t0 = new Date(1_700_000_000_000);
    await writeConfig(dir, baseConfig({ permission: { shell: { "rule-a *": "allow" } } }));
    await utimes(filePath, t0, t0);

    const loader = createPermissionConfigLoader(dir);
    const first = loader();
    assert.deepEqual(first.config.shell, { "rule-a *": "allow" });

    // Rewrite with a new rule but force the SAME mtime: cached copy is served.
    await writeConfig(dir, baseConfig({ permission: { shell: { "rule-b *": "deny" } } }));
    await utimes(filePath, t0, t0);
    const cached = loader();
    assert.deepEqual(cached.config.shell, { "rule-a *": "allow" });

    // Bump the mtime: the loader re-reads and sees the new rules.
    const t1 = new Date(t0.getTime() + 10_000);
    await utimes(filePath, t1, t1);
    const reloaded = loader();
    assert.deepEqual(reloaded.config.shell, { "rule-b *": "deny" });

    // Stat failure (file deleted): keep serving the last snapshot.
    await unlink(filePath);
    const afterDelete = loader();
    assert.deepEqual(afterDelete.config.shell, { "rule-b *": "deny" });
  });
});
