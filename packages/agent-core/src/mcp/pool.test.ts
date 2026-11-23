import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

import { MCP_APPS_EXTENSION_ID, MCP_APPS_RESOURCE_MIME_TYPE, SdkMcpConnection } from "./client.js";
import { McpService } from "./service.js";

const fixtureServer = join(
  dirname(fileURLToPath(import.meta.url)),
  "test-fixtures/pool-test-server.mjs",
);

interface PingInfoPayload {
  pid: number;
  callCount: number;
  envTag: string | null;
  extensions: Record<string, unknown> | null;
}

function parseToolPayload(result: unknown): PingInfoPayload {
  const content = (result as { content?: Array<{ text?: string }> }).content ?? [];
  const text = content.map((part) => part.text ?? "").join("");
  return JSON.parse(text) as PingInfoPayload;
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForPidExit(pid: number, timeoutMs = 2_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return !isPidAlive(pid);
}

test("McpService reuses pooled connections across calls and closes stdio child on dispose", async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "spirit-mcp-pool-reuse-"));
  const service = new McpService(workspaceRoot, false, {
    extraConfigs: () => ({
      servers: {
        pooled: {
          transport: { type: "stdio", command: process.execPath, args: [fixtureServer] },
        },
      },
    }),
  });

  try {
    const first = parseToolPayload(await service.callTool("pooled", "ping_info", "{}"));
    const second = parseToolPayload(await service.callTool("pooled", "ping_info", "{}"));

    assert.equal(first.pid, second.pid);
    assert.equal(first.callCount, 1);
    assert.equal(second.callCount, 2);
    assert.equal(service.pooledConnectionCount(), 1);
    assert.equal(first.extensions, null);

    await service.dispose();
    assert.equal(service.pooledConnectionCount(), 0);
    assert.equal(await waitForPidExit(first.pid), true);
  } finally {
    await service.dispose();
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test("McpService advertises io.modelcontextprotocol/ui capability only when enableMcpApps is true", async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "spirit-mcp-pool-cap-"));
  const service = new McpService(workspaceRoot, false, {
    enableMcpApps: true,
    extraConfigs: () => ({
      servers: {
        uiServer: {
          transport: { type: "stdio", command: process.execPath, args: [fixtureServer] },
        },
      },
    }),
  });

  try {
    const payload = parseToolPayload(await service.callTool("uiServer", "ping_info", "{}"));
    assert.deepEqual(payload.extensions, {
      [MCP_APPS_EXTENSION_ID]: {
        mimeTypes: [MCP_APPS_RESOURCE_MIME_TYPE],
      },
    });
  } finally {
    await service.dispose();
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test("McpService invalidates and replaces pooled connection when resolved config/env changes", async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "spirit-mcp-pool-digest-"));
  let envTag = "token-v1";
  const service = new McpService(workspaceRoot, false, {
    extraConfigs: () => ({
      servers: {
        pooled: {
          transport: {
            type: "stdio",
            command: process.execPath,
            args: [fixtureServer],
            env: { POOL_TAG: envTag },
          },
        },
      },
    }),
  });

  try {
    const first = parseToolPayload(await service.callTool("pooled", "ping_info", "{}"));
    assert.equal(first.envTag, "token-v1");

    envTag = "token-v2";
    const second = parseToolPayload(await service.callTool("pooled", "ping_info", "{}"));
    assert.equal(second.envTag, "token-v2");
    assert.notEqual(second.pid, first.pid);
    assert.equal(second.callCount, 1);
    assert.equal(await waitForPidExit(first.pid), true);
  } finally {
    await service.dispose();
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test("McpService recovers cleanly after a pooled stdio server crashes", async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "spirit-mcp-pool-crash-"));
  const service = new McpService(workspaceRoot, false, {
    extraConfigs: () => ({
      servers: {
        pooled: {
          transport: { type: "stdio", command: process.execPath, args: [fixtureServer] },
        },
      },
    }),
  });

  try {
    const first = parseToolPayload(await service.callTool("pooled", "ping_info", "{}"));
    await assert.rejects(() => service.callTool("pooled", "crash_now", "{}"));
    assert.equal(await waitForPidExit(first.pid), true);

    const recovered = parseToolPayload(await service.callTool("pooled", "ping_info", "{}"));
    assert.notEqual(recovered.pid, first.pid);
    assert.equal(recovered.callCount, 1);
  } finally {
    await service.dispose();
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test("McpService deduplicates concurrent cold and post-change pool connects without orphaning", async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "spirit-mcp-pool-race-"));
  let envTag = "v1";
  const service = new McpService(workspaceRoot, false, {
    extraConfigs: () => ({
      servers: {
        pooled: {
          transport: {
            type: "stdio",
            command: process.execPath,
            args: [fixtureServer],
            env: { POOL_TAG: envTag },
          },
        },
      },
    }),
  });

  try {
    const coldResults = (
      await Promise.all([
        service.callTool("pooled", "ping_info", "{}"),
        service.callTool("pooled", "ping_info", "{}"),
        service.callTool("pooled", "ping_info", "{}"),
      ])
    ).map(parseToolPayload);
    const coldPids = new Set(coldResults.map((r) => r.pid));
    assert.equal(coldPids.size, 1);
    assert.equal(service.pooledConnectionCount(), 1);

    const firstPid = coldResults[0]!.pid;
    envTag = "v2";
    const rotatedResults = (
      await Promise.all([
        service.callTool("pooled", "ping_info", "{}"),
        service.callTool("pooled", "ping_info", "{}"),
        service.callTool("pooled", "ping_info", "{}"),
      ])
    ).map(parseToolPayload);
    const rotatedPids = new Set(rotatedResults.map((r) => r.pid));
    assert.equal(rotatedPids.size, 1);
    assert.notEqual(rotatedResults[0]!.pid, firstPid);
    assert.equal(await waitForPidExit(firstPid), true);
  } finally {
    await service.dispose();
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test("McpService isolates distinct overlapping spirit/ui/open openers on a pooled connection", async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "spirit-mcp-pool-opener-"));
  const service = new McpService(workspaceRoot, false, {
    extraConfigs: () => ({
      servers: {
        pooled: {
          transport: { type: "stdio", command: process.execPath, args: [fixtureServer] },
        },
      },
      extensionServerOwnership: {
        pooled: { extensionId: "ext.demo", viewIds: ["settings"] },
      },
    }),
  });

  try {
    // Warm the pool first so overlapping calls share the pooled connection deterministically.
    await service.callTool("pooled", "ping_info", "{}");

    // Case 1: first call is slower than second — distinct openers must serialize so each routes to its own callback.
    const slowFirstOpener = async () => ({ kind: "opened" as const, result: "slow-first" });
    const fastSecondOpener = async () => ({ kind: "opened" as const, result: "fast-second" });
    const slowFirst = service.callTool(
      "pooled",
      "delayed_open_ui",
      JSON.stringify({ delayMs: 80, viewId: "settings" }),
      { uiOpener: slowFirstOpener },
    );
    await new Promise((resolve) => setTimeout(resolve, 15));
    const fastSecond = service.callTool(
      "pooled",
      "delayed_open_ui",
      JSON.stringify({ delayMs: 10, viewId: "settings" }),
      { uiOpener: fastSecondOpener },
    );

    const [slowFirstRaw, fastSecondRaw] = await Promise.all([slowFirst, fastSecond]);
    const slowFirstResult = parseToolPayload(slowFirstRaw) as unknown as {
      kind: string;
      result: string;
    };
    const fastSecondResult = parseToolPayload(fastSecondRaw) as unknown as {
      kind: string;
      result: string;
    };
    assert.equal(slowFirstResult.kind, "opened");
    assert.equal(slowFirstResult.result, "slow-first");
    assert.equal(fastSecondResult.kind, "opened");
    assert.equal(fastSecondResult.result, "fast-second");

    // Case 2: first call is faster than second — previously misrouted under LIFO stack.
    const fastFirstOpener = async () => ({ kind: "opened" as const, result: "fast-first" });
    const slowSecondOpener = async () => ({ kind: "opened" as const, result: "slow-second" });
    const fastFirst = service.callTool(
      "pooled",
      "delayed_open_ui",
      JSON.stringify({ delayMs: 10, viewId: "settings" }),
      { uiOpener: fastFirstOpener },
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    const slowSecond = service.callTool(
      "pooled",
      "delayed_open_ui",
      JSON.stringify({ delayMs: 80, viewId: "settings" }),
      { uiOpener: slowSecondOpener },
    );

    const [fastFirstRaw, slowSecondRaw] = await Promise.all([fastFirst, slowSecond]);
    const fastFirstResult = parseToolPayload(fastFirstRaw) as unknown as {
      kind: string;
      result: string;
    };
    const slowSecondResult = parseToolPayload(slowSecondRaw) as unknown as {
      kind: string;
      result: string;
    };
    assert.equal(fastFirstResult.kind, "opened");
    assert.equal(fastFirstResult.result, "fast-first");
    assert.equal(slowSecondResult.kind, "opened");
    assert.equal(slowSecondResult.result, "slow-second");
  } finally {
    await service.dispose();
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test("McpService invalidates tooling cache when pooled server emits notifications/tools/list_changed", async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "spirit-mcp-pool-listchanged-"));
  const service = new McpService(workspaceRoot, false, {
    extraConfigs: () => ({
      servers: {
        pooled: {
          transport: { type: "stdio", command: process.execPath, args: [fixtureServer] },
        },
      },
    }),
  });

  try {
    await service.ensureToolingCache();
    const initialTools = service
      .catalogSnapshot()
      .servers.flatMap((s) => s.tools.map((t) => t.name));
    assert.ok(initialTools.includes("ping_info"));
    assert.ok(!initialTools.includes("dynamic_tool"));

    await service.callTool("pooled", "enable_dynamic_tool", "{}");
    // Wait briefly for the notification + background refresh or explicit ensureToolingCache.
    await new Promise((resolve) => setTimeout(resolve, 50));
    await service.ensureToolingCache();

    const updatedTools = service
      .catalogSnapshot()
      .servers.flatMap((s) => s.tools.map((t) => t.name));
    assert.ok(updatedTools.includes("dynamic_tool"));
  } finally {
    await service.dispose();
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test("SdkMcpConnection rejects connect and marks broken if transport closes during handshake", async () => {
  const connection = new SdkMcpConnection();
  connection.client.connect = async () => {
    // Simulate transport closing immediately after initialize response before connect() resolves.
    connection.client.onclose?.();
  };

  await assert.rejects(
    () =>
      connection.connect({
        name: "flaky",
        displayName: "flaky",
        enabled: true,
        capabilities: { tools: true, resources: true, prompts: true },
        transport: {
          type: "stdio",
          command: process.execPath,
          args: ["-e", ""],
          env: {},
          stderr: "pipe",
          timeoutMs: 5_000,
        },
      }),
    /closed during handshake/i,
  );
  assert.equal(connection.isConnected, false);
});

test("McpService evicts stale pooled HTTP connections on fetch failed and retries read operations cleanly", async () => {
  const http = await import("node:http");
  const workspaceRoot = mkdtempSync(join(tmpdir(), "spirit-mcp-http-retry-"));
  let initializeCount = 0;
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
      chunks.push(Buffer.from(chunk));
    }
    const msg = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
      id?: number;
      method?: string;
    };
    if (msg.method === "notifications/initialized") {
      res.writeHead(202, { "Mcp-Session-Id": `sess-${initializeCount}` });
      res.end();
      return;
    }
    if (msg.method === "initialize") {
      initializeCount += 1;
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Mcp-Session-Id": `sess-${initializeCount}`,
      });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            protocolVersion: "2025-11-25",
            capabilities: { tools: {} },
            serverInfo: { name: "flaky-http", version: "1.0.0" },
          },
        }),
      );
      return;
    }
    if (msg.method === "tools/list") {
      listToolsCalls += 1;
      // Drop the TCP socket abruptly on the 2nd tools/list call to trigger undici `TypeError: fetch failed`.
      if (listToolsCalls === 2) {
        req.socket.destroy();
        return;
      }
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Mcp-Session-Id": `sess-${initializeCount}`,
      });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            tools: [{ name: "hello", inputSchema: { type: "object" } }],
          },
        }),
      );
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  const service = new McpService(workspaceRoot, false, {
    extraConfigs: () => ({
      servers: {
        http_flaky: {
          transport: { type: "http", url: `http://127.0.0.1:${address.port}/mcp` },
        },
      },
    }),
  });

  try {
    const first = await service.listTools("http_flaky");
    assert.equal(first.length, 1);
    assert.equal(initializeCount, 1);

    // Second call hits abrupt socket reset (`fetch failed`); McpService must evict and retry on a fresh connection.
    const second = await service.listTools("http_flaky");
    assert.equal(second.length, 1);
    assert.equal(initializeCount, 2);
    assert.equal(listToolsCalls, 3);
    assert.equal(service.statusSnapshot().state, "ready");
  } finally {
    await service.dispose();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test("McpService requeues discovery when list_changed invalidation arrives while a refresh is in flight", async () => {
  const http = await import("node:http");
  const workspaceRoot = mkdtempSync(join(tmpdir(), "spirit-mcp-overlap-invalidation-"));
  let listToolsCalls = 0;
  let currentToolName = "v1_tool";
  let releaseFirstList: (() => void) | undefined;
  let firstListEnteredResolve: (() => void) | undefined;
  const firstListEntered = new Promise<void>((resolve) => {
    firstListEnteredResolve = resolve;
  });

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
      chunks.push(Buffer.from(chunk));
    }
    const msg = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
      id?: number;
      method?: string;
    };
    if (msg.method === "notifications/initialized") {
      res.writeHead(202, { "Mcp-Session-Id": "sess-overlap" });
      res.end();
      return;
    }
    if (msg.method === "initialize") {
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Mcp-Session-Id": "sess-overlap",
      });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            protocolVersion: "2025-11-25",
            capabilities: { tools: { listChanged: true } },
            serverInfo: { name: "overlap-http", version: "1.0.0" },
          },
        }),
      );
      return;
    }
    if (msg.method === "tools/list") {
      listToolsCalls += 1;
      const snapshotToolName = currentToolName;
      if (listToolsCalls === 1) {
        firstListEnteredResolve?.();
        await new Promise<void>((resolve) => {
          releaseFirstList = resolve;
        });
      }
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Mcp-Session-Id": "sess-overlap",
      });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            tools: [{ name: snapshotToolName, inputSchema: { type: "object" } }],
          },
        }),
      );
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  const service = new McpService(workspaceRoot, false, {
    extraConfigs: () => ({
      servers: {
        overlap: {
          transport: { type: "http", url: `http://127.0.0.1:${address.port}/mcp` },
        },
      },
    }),
  });

  try {
    service.startBackgroundRefreshInBackground(true);
    await firstListEntered;

    // Server updates tools and emits list_changed while the first discovery is still in flight.
    currentToolName = "v2_tool";
    (
      service as unknown as { invalidateToolingCacheForServer(serverName: string): void }
    ).invalidateToolingCacheForServer("overlap");

    releaseFirstList?.();

    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const names = service.catalogSnapshot().servers.flatMap((s) => s.tools.map((t) => t.name));
      if (names.includes("v2_tool")) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    assert.deepEqual(
      service.catalogSnapshot().servers.flatMap((s) => s.tools.map((t) => t.name)),
      ["v2_tool"],
    );
    assert.equal(listToolsCalls, 2);
  } finally {
    await service.dispose();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
