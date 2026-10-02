import { readFileSync } from "node:fs";
import path from "node:path";

import {
  McpConfigError,
  McpService,
  parseMcpConfigFile,
  type McpConfigFile,
  type McpConfigSource,
  type McpServiceOptions,
} from "@spiritagent/agent-core";

import { mcpUserConfigPath, mcpWorkspaceConfigPath } from "./data-paths.js";

function readConfig(filePath: string): McpConfigFile {
  try {
    return parseMcpConfigFile(JSON.parse(readFileSync(filePath, "utf8")) as unknown);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { servers: {} };
    }
    if (error instanceof SyntaxError) {
      throw new McpConfigError(`Failed to parse MCP config: ${filePath}`, { cause: error });
    }
    throw new McpConfigError(`Failed to read MCP config: ${filePath}`, {
      cause: error instanceof Error ? error : undefined,
    });
  }
}

export function createMcpConfigSource(
  spiritDataDir: string,
  workspaceRoot: string,
): McpConfigSource {
  return {
    scopeKey: path.resolve(spiritDataDir),
    read(includeWorkspace) {
      return {
        user: readConfig(mcpUserConfigPath(spiritDataDir)),
        workspace: includeWorkspace
          ? readConfig(mcpWorkspaceConfigPath(workspaceRoot))
          : { servers: {} },
      };
    },
  };
}

export function createHostMcpService(
  workspaceRoot: string,
  spiritDataDir: string,
  includeWorkspace = true,
  options: Pick<McpServiceOptions, "extraConfigs"> = {},
): McpService {
  return new McpService(workspaceRoot, includeWorkspace, {
    ...options,
    configSource: createMcpConfigSource(spiritDataDir, workspaceRoot),
  });
}
