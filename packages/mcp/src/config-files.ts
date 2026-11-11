import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  findMcpServerNameConflict,
  parseMcpConfigFile,
  type McpConfigFile,
  type McpServerConfig,
} from "@spiritagent/agent-core";
import { mcpUserConfigPath, mcpWorkspaceConfigPath } from "@spiritagent/config/data-paths";

export type McpConfigScope = "user" | "workspace";

export function loadMcpConfigFileAt(configPath: string): McpConfigFile {
  if (!existsSync(configPath)) {
    return { servers: {} };
  }
  return parseMcpConfigFile(JSON.parse(readFileSync(configPath, "utf8")) as unknown);
}

export async function saveMcpConfigFileAt(
  configPath: string,
  config: McpConfigFile,
): Promise<void> {
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export function mcpConfigPathForScope(input: {
  scope: McpConfigScope;
  spiritDataDir: string;
  workspaceRoot: string;
}): string {
  return input.scope === "workspace"
    ? mcpWorkspaceConfigPath(input.workspaceRoot)
    : mcpUserConfigPath(input.spiritDataDir);
}

export async function initializeMcpConfig(input: {
  scope: McpConfigScope;
  spiritDataDir: string;
  workspaceRoot: string;
  force?: boolean;
}): Promise<string> {
  const configPath = mcpConfigPathForScope(input);
  if (existsSync(configPath) && input.force !== true) {
    throw new Error(`MCP config already exists: ${configPath}`);
  }
  await saveMcpConfigFileAt(configPath, { servers: {} });
  return configPath;
}

export async function addMcpServer(input: {
  scope: McpConfigScope;
  spiritDataDir: string;
  workspaceRoot: string;
  name: string;
  config: McpServerConfig;
}): Promise<string> {
  const name = input.name.trim();
  if (!name) {
    throw new Error("MCP server name is required.");
  }
  const user = loadMcpConfigFileAt(mcpUserConfigPath(input.spiritDataDir));
  const workspace = loadMcpConfigFileAt(mcpWorkspaceConfigPath(input.workspaceRoot));
  if (findMcpServerNameConflict(user, workspace, name)) {
    throw new Error(`MCP server already exists: ${name}`);
  }
  const configPath = mcpConfigPathForScope(input);
  const config = loadMcpConfigFileAt(configPath);
  config.servers[name] = input.config;
  await saveMcpConfigFileAt(configPath, config);
  return configPath;
}

export async function deleteMcpServer(input: {
  scope: McpConfigScope;
  spiritDataDir: string;
  workspaceRoot: string;
  name: string;
}): Promise<void> {
  const configPath = mcpConfigPathForScope(input);
  const config = loadMcpConfigFileAt(configPath);
  if (!config.servers[input.name.trim()]) {
    throw new Error(`Unknown MCP server: ${input.name}`);
  }
  delete config.servers[input.name.trim()];
  await saveMcpConfigFileAt(configPath, config);
}

export async function setMcpServerEnabled(input: {
  scope: McpConfigScope;
  spiritDataDir: string;
  workspaceRoot: string;
  name: string;
  enabled: boolean;
}): Promise<void> {
  const configPath = mcpConfigPathForScope(input);
  const config = loadMcpConfigFileAt(configPath);
  const server = config.servers[input.name.trim()];
  if (!server) {
    throw new Error(`Unknown MCP server: ${input.name}`);
  }
  server.enabled = input.enabled;
  await saveMcpConfigFileAt(configPath, config);
}
