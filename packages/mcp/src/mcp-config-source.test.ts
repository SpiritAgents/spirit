import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { createHostMcpService, createMcpConfigSource } from "./mcp-config-source.js";
import { McpRegistry } from "./registry.js";
import { mcpUserConfigPath, mcpWorkspaceConfigPath } from "@spiritagent/config/data-paths";

test("MCP reads the injected daemon root and workspace configuration without ambient discovery", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "product-mcp-"));
  try {
    const userRoot = path.join(root, "daemon-user");
    const secondRoot = path.join(root, "other-user");
    const workspaceRoot = path.join(root, "workspace");
    const workspaceFile = mcpWorkspaceConfigPath(workspaceRoot);
    await mkdir(userRoot, { recursive: true });
    await mkdir(path.dirname(workspaceFile), { recursive: true });
    await writeFile(
      mcpUserConfigPath(userRoot),
      JSON.stringify({
        servers: { shared: { transport: { type: "stdio", command: "user-command" } } },
      }),
    );
    await writeFile(
      workspaceFile,
      JSON.stringify({
        servers: { shared: { transport: { type: "stdio", command: "workspace-command" } } },
      }),
    );
    const source = createMcpConfigSource(userRoot, workspaceRoot);
    assert.notEqual(source.scopeKey, createMcpConfigSource(secondRoot, workspaceRoot).scopeKey);
    assert.deepEqual(source.read(false).workspace, { servers: {} });
    const service = createHostMcpService(workspaceRoot, userRoot);
    const servers = await service.listServers();
    assert.equal(servers.length, 1);
    expect(servers).toMatchObject([
      { scope: "workspace", transport: { command: "workspace-command" } },
    ]);
    const userOnly = createHostMcpService(workspaceRoot, userRoot, false);
    const userServers = await userOnly.listServers();
    expect(userServers).toMatchObject([{ scope: "user", transport: { command: "user-command" } }]);
    await writeFile(workspaceFile, "{invalid");
    assert.doesNotThrow(() => source.read(false));
    assert.throws(() => source.read(true), /Failed to parse MCP config/);
    assert.deepEqual(createMcpConfigSource(secondRoot, workspaceRoot).read(false), {
      user: { servers: {} },
      workspace: { servers: {} },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("McpRegistry.refreshAllConfigs skips forced background refresh when resolved config is unchanged", async () => {
  const http = await import("node:http");
  const root = await mkdtemp(path.join(tmpdir(), "product-mcp-registry-"));
  let listToolsCalls = 0;

  const server = http.createServer(async (req, res) => {
    if (req.method === "DELETE") {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === "GET") {
      res.writeHead(405);
      res.end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const msg = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
      id?: number | string;
      method?: string;
    };
    if (msg.method === "notifications/initialized") {
      res.writeHead(202);
      res.end();
      return;
    }
    if (msg.method === "initialize") {
      res.writeHead(200, { "Content-Type": "application/json", "Mcp-Session-Id": "sess-reg" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            protocolVersion: "2025-03-26",
            capabilities: { tools: {} },
            serverInfo: { name: "reg-test", version: "1.0.0" },
          },
        }),
      );
      return;
    }
    if (msg.method === "tools/list") {
      listToolsCalls += 1;
      res.writeHead(200, { "Content-Type": "application/json", "Mcp-Session-Id": "sess-reg" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            tools: [{ name: "ping", description: "Ping", inputSchema: { type: "object" } }],
          },
        }),
      );
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  const registry = new McpRegistry(path.join(root, "data"), () => ({
    servers: {
      reg_test: {
        transport: { type: "http", url: `http://127.0.0.1:${address.port}/mcp` },
      },
    },
  }));

  try {
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot, { recursive: true });
    const service = registry.forWorkspace(workspaceRoot, { enableMcpApps: true });
    await service.waitForInitialToolingCache(5_000);
    assert.equal(listToolsCalls, 1);

    // Unchanged extension/disk config must not trigger redundant server re-discovery.
    await registry.refreshAllConfigs();
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(listToolsCalls, 1);
  } finally {
    await registry.disposeAll();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
