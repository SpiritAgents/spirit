import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import { McpService } from "@spiritagent/agent-core";
import { installPreparedExtensionDirectory } from "@spiritagent/extensions";
import type { ExtensionStateStore } from "@spiritagent/extensions/storage";
import { createExtensionMcpExtraConfigs } from "../src/mcp-registry.js";

async function writeSecretMcpPackage(packageDir: string): Promise<void> {
  await mkdir(join(packageDir, ".spirit"), { recursive: true });
  await writeFile(
    join(packageDir, "package.json"),
    JSON.stringify({ name: "secret-mcp", version: "1.0.0" }),
  );
  await writeFile(
    join(packageDir, ".spirit", "extension.json"),
    JSON.stringify({
      schemaVersion: 1,
      name: "secret-mcp",
      version: "1.0.0",
      sourceId: "personal",
      defaultLocale: "en",
      displayName: { message: "metadata.displayName" },
      description: { message: "metadata.description" },
      messages: {
        en: {
          metadata: { displayName: "Secret MCP", description: "Secret MCP fixture." },
          mcp: { secured: { displayName: "Secured MCP" } },
        },
      },
      manifest: {
        supportedHosts: ["desktop"],
        requestedCapabilities: ["mcp", "secret-storage"],
        secretSlots: ["credentials"],
        contributes: {
          mcp: [
            {
              name: "secured",
              displayName: { message: "mcp.secured.displayName" },
              transport: "http",
            },
          ],
        },
      },
    }),
  );
}

function secretStore(secrets: Map<string, string>): ExtensionStateStore {
  return {
    async loadSettings() {
      return {};
    },
    async saveSettings() {},
    async loadSecret(extensionId, key) {
      return secrets.get(`${extensionId}::${key}`);
    },
    async saveSecret(extensionId, key, value) {
      secrets.set(`${extensionId}::${key}`, value);
    },
    async deleteSecret(extensionId, key) {
      secrets.delete(`${extensionId}::${key}`);
    },
    async hasSecret(extensionId, key) {
      return secrets.has(`${extensionId}::${key}`);
    },
  };
}

async function startFixtureMcpServer(expectedToken: string): Promise<{
  server: Server;
  url: string;
  calls: string[];
}> {
  const calls: string[] = [];
  const server = createServer(async (request, response) => {
    if (request.method !== "POST") {
      response.writeHead(405).end();
      return;
    }
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const message = JSON.parse(raw) as {
      id?: string | number;
      method?: string;
      params?: { protocolVersion?: string; name?: string };
    };
    if (request.headers.authorization !== `Bearer ${expectedToken}`) {
      response.writeHead(401).end();
      return;
    }
    if (message.id === undefined) {
      response.writeHead(202).end();
      return;
    }
    calls.push(String(message.method));
    let result: unknown;
    switch (message.method) {
      case "initialize":
        result = {
          protocolVersion: message.params?.protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: "fixture", version: "1.0.0" },
        };
        break;
      case "ping":
        result = {};
        break;
      case "tools/list":
        result = {
          tools: [
            {
              name: "fixture_account",
              description: "Return the fixture account.",
              inputSchema: { type: "object", properties: {}, additionalProperties: false },
            },
          ],
        };
        break;
      case "tools/call":
        assert.equal(message.params?.name, "fixture_account");
        result = { content: [{ type: "text", text: "fixture-account" }] };
        break;
      default:
        response.writeHead(400).end();
        return;
    }
    response
      .writeHead(200, { "Content-Type": "application/json" })
      .end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return { server, url: `http://127.0.0.1:${address.port}/mcp`, calls };
}

test("daemon MCP contributions resolve fresh secrets and call HTTP tools without exposing them", async () => {
  const spiritDataDir = await mkdtemp(join(tmpdir(), "spirit-server-secret-mcp-data-"));
  const preparedRoot = await mkdtemp(join(tmpdir(), "spirit-server-secret-mcp-package-"));
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-server-secret-mcp-workspace-"));
  const privateToken = "private-token-that-must-not-leak";
  const fixture = await startFixtureMcpServer(privateToken);
  const secrets = new Map<string, string>();
  try {
    const packageDir = join(preparedRoot, "secret-mcp");
    await writeSecretMcpPackage(packageDir);
    await writeFile(
      join(packageDir, "mcp.json"),
      JSON.stringify({
        servers: {
          secured: {
            transport: {
              type: "http",
              url: fixture.url,
              headers: { Authorization: "Bearer ${extension-secret:credentials:accessToken}" },
            },
          },
        },
      }),
    );
    const installed = await installPreparedExtensionDirectory(
      { spiritDataDir, hostKind: "desktop" },
      { preparedDirectoryPath: packageDir },
    );
    secrets.set(`${installed.id}::credentials`, JSON.stringify({ accessToken: privateToken }));
    const extraConfigs = createExtensionMcpExtraConfigs(spiritDataDir, "desktop", () =>
      secretStore(secrets),
    );
    const service = new McpService(workspaceRoot, true, {
      configSource: {
        scopeKey: spiritDataDir,
        read: () => ({ user: { servers: {} }, workspace: { servers: {} } }),
      },
      extraConfigs,
    });
    await service.ensureToolingCache();
    assert.equal(service.catalogSnapshot().servers[0]?.name, "secured");
    assert.equal(service.catalogSnapshot().servers[0]?.tools[0]?.name, "fixture_account");
    const result = await service.callTool("secured", "fixture_account");
    assert.equal(JSON.stringify(result).includes("fixture-account"), true);
    assert.ok(fixture.calls.includes("initialize"));
    assert.ok(fixture.calls.includes("tools/list"));
    assert.ok(fixture.calls.includes("tools/call"));
    assert.deepEqual(await service.listServers(), []);
    assert.doesNotMatch(JSON.stringify(service.catalogSnapshot()), new RegExp(privateToken));

    const nextToken = "next-private-token";
    secrets.set(`${installed.id}::credentials`, JSON.stringify({ accessToken: nextToken }));
    const refreshed = await extraConfigs();
    const transport = refreshed.servers.secured?.transport;
    assert.equal(transport?.type, "http");
    if (transport?.type === "http") {
      assert.equal(transport.headers?.Authorization, `Bearer ${nextToken}`);
    }

    secrets.clear();
    await service.startBackgroundRefresh();
    assert.equal(service.catalogSnapshot().servers.length, 0);
  } finally {
    await new Promise<void>((resolve, reject) =>
      fixture.server.close((error) => (error ? reject(error) : resolve())),
    );
    await Promise.all(
      [spiritDataDir, preparedRoot, workspaceRoot].map((dir) =>
        rm(dir, { recursive: true, force: true }),
      ),
    );
  }
});
