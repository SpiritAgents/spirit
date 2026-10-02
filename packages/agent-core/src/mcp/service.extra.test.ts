import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import { McpService } from "./service.js";
import { parseMcpConfigFile } from "./config.js";

function withEnv(
  vars: Record<string, string | undefined>,
  run: () => Promise<void>,
): Promise<void> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(vars)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  return run().finally(() => {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });
}

test("extraConfigs merge into runtime but stay out of listServers", async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "spirit-mcp-extra-ws-"));
  const dataDir = mkdtempSync(join(tmpdir(), "spirit-mcp-extra-data-"));
  try {
    await withEnv({ SPIRIT_DATA_DIR: dataDir }, async () => {
      const service = new McpService(workspaceRoot, true, {
        configSource: {
          scopeKey: dataDir,
          read: () => ({ user: { servers: {} }, workspace: { servers: {} } }),
        },
        extraConfigs: () => ({
          servers: {
            extra_only: {
              transport: { type: "stdio", command: "from-extra" },
            },
          },
        }),
      });
      await service.refreshConfig();
      assert.equal(service.statusSnapshot().configuredServers, 1);
      assert.deepEqual(await service.listServers(), []);
    });
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("user and workspace configs overlay extraConfigs of the same server name", async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "spirit-mcp-extra-ws-"));
  const dataDir = mkdtempSync(join(tmpdir(), "spirit-mcp-extra-data-"));
  try {
    writeFileSync(
      join(dataDir, "mcp.json"),
      JSON.stringify({
        servers: {
          shared: {
            transport: { type: "stdio", command: "from-user" },
          },
        },
      }),
    );
    mkdirSync(join(workspaceRoot, ".spirit"), { recursive: true });
    writeFileSync(
      join(workspaceRoot, ".spirit", "mcp.json"),
      JSON.stringify({
        servers: {
          shared: {
            transport: { type: "stdio", command: "from-workspace" },
          },
        },
      }),
    );
    await withEnv({ SPIRIT_DATA_DIR: dataDir }, async () => {
      const service = new McpService(workspaceRoot, true, {
        configSource: {
          scopeKey: dataDir,
          read: () => ({
            user: parseMcpConfigFile(JSON.parse(readFileSync(join(dataDir, "mcp.json"), "utf8"))),
            workspace: parseMcpConfigFile(
              JSON.parse(readFileSync(join(workspaceRoot, ".spirit", "mcp.json"), "utf8")),
            ),
          }),
        },
        extraConfigs: () => ({
          servers: {
            shared: {
              transport: { type: "stdio", command: "from-extra" },
            },
          },
        }),
      });
      const listed = await service.listServers();
      assert.equal(listed.length, 1);
      const server = listed[0];
      assert.equal(typeof server, "object");
      assert.ok(server && typeof server === "object");
      const record = server as Record<string, unknown>;
      assert.equal(record.name, "shared");
      assert.equal(record.scope, "workspace");
      const transport = record.transport as Record<string, unknown>;
      assert.equal(transport.command, "from-workspace");
    });
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  }
});
