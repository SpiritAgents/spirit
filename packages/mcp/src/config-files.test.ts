import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";

import {
  addMcpServer,
  deleteMcpServer,
  loadMcpConfigFileAt,
  setMcpServerEnabled,
} from "./config-files.js";
import { mcpUserConfigPath } from "@spiritagent/config/data-paths";

test("MCP file mutations share add toggle and delete semantics", async () => {
  const spiritDataDir = await mkdtemp(path.join(tmpdir(), "spirit-mcp-files-"));
  const workspaceRoot = path.join(spiritDataDir, "workspace");
  try {
    await addMcpServer({
      scope: "user",
      spiritDataDir,
      workspaceRoot,
      name: "fixture",
      config: { transport: { type: "stdio", command: "fixture-command" } },
    });
    await setMcpServerEnabled({
      scope: "user",
      spiritDataDir,
      workspaceRoot,
      name: "fixture",
      enabled: false,
    });
    assert.equal(
      loadMcpConfigFileAt(mcpUserConfigPath(spiritDataDir)).servers["fixture"]?.enabled,
      false,
    );
    await deleteMcpServer({
      scope: "user",
      spiritDataDir,
      workspaceRoot,
      name: "fixture",
    });
    assert.deepEqual(loadMcpConfigFileAt(mcpUserConfigPath(spiritDataDir)), { servers: {} });
  } finally {
    await rm(spiritDataDir, { recursive: true, force: true });
  }
});
