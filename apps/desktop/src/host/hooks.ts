import {
  deleteHookEntry,
  hooksConfigPathForScope as resolveHooksConfigPathForScope,
  hooksConfigPathsSummary,
  listHookListItems,
  saveHookEntry,
  type DeleteHookEntryRequest as HostDeleteHookEntryRequest,
  type HookListItem,
  type SaveHookEntryRequest as HostSaveHookEntryRequest,
} from "@spiritagent/host-internal";
import { hooksUserConfigPath, hooksWorkspaceConfigPath } from "@spiritagent/host-internal";

import type {
  DeleteHookEntryRequest,
  DesktopHookListItem,
  DesktopHookScope,
  SaveHookEntryRequest,
} from "../types.js";
import { spiritDataDir } from "./storage.js";

export function desktopUserHooksConfigPath(): string {
  return hooksUserConfigPath(spiritDataDir());
}

export function desktopWorkspaceHooksConfigPath(workspaceRoot: string): string {
  return hooksWorkspaceConfigPath(workspaceRoot);
}

export function hooksConfigPathForScope(scope: DesktopHookScope, workspaceRoot: string): string {
  return resolveHooksConfigPathForScope(spiritDataDir(), workspaceRoot, scope);
}

function hookCrudContext(workspaceRoot: string, workspaceBinding: "project" | "none") {
  return {
    spiritDataDir: spiritDataDir(),
    workspaceRoot,
    workspaceBinding,
  };
}

function toDesktopHookListItem(item: HookListItem): DesktopHookListItem {
  return {
    id: item.id,
    scope: item.scope,
    event: item.event,
    index: item.index,
    command: item.command,
    configPath: item.configPath,
    ...(item.timeout !== undefined ? { timeout: item.timeout } : {}),
    ...(item.failClosed !== undefined ? { failClosed: item.failClosed } : {}),
    ...(item.matcher !== undefined ? { matcher: item.matcher } : {}),
  };
}

export function listDesktopHookListItems(
  workspaceRoot: string,
  workspaceBinding: "project" | "none",
): DesktopHookListItem[] {
  return listHookListItems(hookCrudContext(workspaceRoot, workspaceBinding)).map(
    toDesktopHookListItem,
  );
}

export async function saveDesktopHookEntry(options: {
  request: SaveHookEntryRequest;
  workspaceRoot: string;
  workspaceBinding: "project" | "none";
}): Promise<void> {
  await saveHookEntry(
    hookCrudContext(options.workspaceRoot, options.workspaceBinding),
    options.request as HostSaveHookEntryRequest,
  );
}

export async function deleteDesktopHookEntry(options: {
  request: DeleteHookEntryRequest;
  workspaceRoot: string;
  workspaceBinding: "project" | "none";
}): Promise<void> {
  await deleteHookEntry(
    hookCrudContext(options.workspaceRoot, options.workspaceBinding),
    options.request as HostDeleteHookEntryRequest,
  );
}

export function desktopHooksConfigPathsSummary(
  workspaceRoot: string,
  workspaceBinding: "project" | "none",
): { user: string; workspace: string | undefined } {
  return hooksConfigPathsSummary(hookCrudContext(workspaceRoot, workspaceBinding));
}
