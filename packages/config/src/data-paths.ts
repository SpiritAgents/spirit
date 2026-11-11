import { homedir } from "node:os";
import path from "node:path";

import { product } from "@spiritagent/product";

export interface DataDirectoryEnvironment {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  homeDirectory?: () => string;
}

function resolveProductHome(options: DataDirectoryEnvironment): string {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const homeVariable = platform === "win32" ? env.USERPROFILE : env.HOME;
  const home = homeVariable?.trim() || (options.homeDirectory ?? homedir)().trim();
  if (!home) throw new Error("Cannot resolve the user home directory for product storage.");
  return home;
}

export function resolveDefaultSpiritDataDir(options: DataDirectoryEnvironment = {}): string {
  const paths = (options.platform ?? process.platform) === "win32" ? path.win32 : path.posix;
  return paths.join(resolveProductHome(options), product.userDataFolderName);
}

export function resolveSpiritDataDir(options: DataDirectoryEnvironment = {}): string {
  return (
    (options.env ?? process.env).SPIRIT_DATA_DIR?.trim() || resolveDefaultSpiritDataDir(options)
  );
}

export function resolveWorkspaceDataDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, product.workspaceDataFolderName);
}

export function mcpUserConfigPath(dataDir: string): string {
  return path.join(dataDir, "mcp.json");
}

export function mcpWorkspaceConfigPath(workspaceRoot: string): string {
  return path.join(resolveWorkspaceDataDir(workspaceRoot), "mcp.json");
}

export function hooksUserConfigPath(dataDir: string): string {
  return path.join(dataDir, "hooks.json");
}

export function hooksWorkspaceConfigPath(workspaceRoot: string): string {
  return path.join(resolveWorkspaceDataDir(workspaceRoot), "hooks.json");
}

export function hooksUserScriptsDir(dataDir: string): string {
  return path.join(dataDir, "hooks");
}

export function hooksWorkspaceScriptsDir(workspaceRoot: string): string {
  return path.join(resolveWorkspaceDataDir(workspaceRoot), "hooks");
}
