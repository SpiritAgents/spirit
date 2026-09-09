import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { test } from "vitest";

import { McpService } from "./service.js";
import { resolveSpiritUiOpen } from "./spirit-ui.js";

const fixtureServer = join(
  dirname(fileURLToPath(import.meta.url)),
  "test-fixtures/spirit-ui-server.mjs",
);

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

test("resolveSpiritUiOpen rejects unowned and foreign view ids", async () => {
  await assert.rejects(
    () =>
      resolveSpiritUiOpen({
        ownership: undefined,
        opener: async () => ({ kind: "opened", result: true }),
        viewId: "own",
      }),
    /no extension UI ownership/,
  );
  await assert.rejects(
    () =>
      resolveSpiritUiOpen({
        ownership: { extensionId: "built-in/demo", viewIds: ["own"] },
        opener: async () => ({ kind: "opened", result: true }),
        viewId: "other",
      }),
    /not owned/,
  );
});

test("resolveSpiritUiOpen returns unavailable when the host has no UI", async () => {
  assert.deepEqual(
    await resolveSpiritUiOpen({
      ownership: { extensionId: "built-in/demo", viewIds: ["own"] },
      opener: undefined,
      viewId: "own",
    }),
    { kind: "unavailable", reason: "host-has-no-ui" },
  );
});

test("extension MCP can open an owned view during tools/call", async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "spirit-ui-owned-ws-"));
  const dataDir = mkdtempSync(join(tmpdir(), "spirit-ui-owned-data-"));
  try {
    await withEnv({ SPIRIT_DATA_DIR: dataDir }, async () => {
      const service = new McpService(workspaceRoot, true, {
        extraConfigs: () => ({
          servers: {
            demo: {
              transport: { type: "stdio", command: process.execPath, args: [fixtureServer] },
            },
          },
          extensionServerOwnership: {
            demo: { extensionId: "built-in/demo", viewIds: ["own"] },
          },
        }),
      });
      const result = await service.callTool("demo", "demo", JSON.stringify({ viewId: "own" }), {
        uiOpener: async (request) => {
          assert.equal(request.extensionId, "built-in/demo");
          assert.equal(request.viewId, "own");
          return { kind: "opened", result: { enabled: true } };
        },
      });
      const text = extractToolText(result);
      assert.match(text, /opened/);
      assert.match(text, /enabled/);
    });
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("extension MCP cannot open another extension's view", async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "spirit-ui-foreign-ws-"));
  const dataDir = mkdtempSync(join(tmpdir(), "spirit-ui-foreign-data-"));
  try {
    await withEnv({ SPIRIT_DATA_DIR: dataDir }, async () => {
      const service = new McpService(workspaceRoot, true, {
        extraConfigs: () => ({
          servers: {
            demo: {
              transport: { type: "stdio", command: process.execPath, args: [fixtureServer] },
            },
          },
          extensionServerOwnership: {
            demo: { extensionId: "built-in/demo", viewIds: ["own"] },
          },
        }),
      });
      const result = await service.callTool("demo", "demo", JSON.stringify({ viewId: "foreign" }), {
        uiOpener: async () => ({ kind: "opened", result: { leaked: true } }),
      });
      const text = extractToolText(result);
      assert.match(text, /not owned|error:/);
    });
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("user and workspace MCP servers cannot open views", async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "spirit-ui-user-ws-"));
  const dataDir = mkdtempSync(join(tmpdir(), "spirit-ui-user-data-"));
  try {
    writeFileSync(
      join(dataDir, "mcp.json"),
      JSON.stringify({
        servers: {
          demo: { transport: { type: "stdio", command: process.execPath, args: [fixtureServer] } },
        },
      }),
    );
    await withEnv({ SPIRIT_DATA_DIR: dataDir }, async () => {
      const service = new McpService(workspaceRoot, true);
      const result = await service.callTool("demo", "demo", JSON.stringify({ viewId: "own" }), {
        uiOpener: async () => ({ kind: "opened", result: { leaked: true } }),
      });
      const text = extractToolText(result);
      assert.match(text, /no extension UI ownership|error:/);
    });
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("hosts without a UI opener return unavailable", async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "spirit-ui-cli-ws-"));
  const dataDir = mkdtempSync(join(tmpdir(), "spirit-ui-cli-data-"));
  try {
    await withEnv({ SPIRIT_DATA_DIR: dataDir }, async () => {
      const service = new McpService(workspaceRoot, true, {
        extraConfigs: () => ({
          servers: {
            demo: {
              transport: { type: "stdio", command: process.execPath, args: [fixtureServer] },
            },
          },
          extensionServerOwnership: {
            demo: { extensionId: "built-in/demo", viewIds: ["own"] },
          },
        }),
      });
      const result = await service.callTool("demo", "demo", JSON.stringify({ viewId: "own" }));
      const text = extractToolText(result);
      assert.match(text, /unavailable/);
      assert.match(text, /host-has-no-ui/);
    });
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  }
});

function extractToolText(result: unknown): string {
  if (typeof result !== "object" || result === null) {
    return String(result);
  }
  const content = (result as { content?: Array<{ text?: string }> }).content;
  return content?.map((part) => part.text ?? "").join("") ?? JSON.stringify(result);
}
