import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { createHostMcpService, createMcpConfigSource } from "./mcp-config-source.js";
import { mcpUserConfigPath, mcpWorkspaceConfigPath } from "./data-paths.js";

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
