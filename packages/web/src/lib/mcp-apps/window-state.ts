import type { McpUiDisplayMode } from "@modelcontextprotocol/ext-apps/app-bridge";

import {
  createMcpAppWorkspaceToolTab,
  type WorkspaceMcpAppToolTab,
} from "@/lib/workspace-tool-tabs";

const MCP_APP_WINDOW_STATE_STORAGE_KEY = "spirit-desktop-mcp-app-window-state";

export interface PersistedMcpAppWindowEntry {
  entryKey: string;
  appKey: string;
  sessionKey: string;
  displayMode: "pip" | "fullscreen";
  tabTitle?: string;
  tabSessionKey?: string;
}

export interface PersistedMcpAppWindowState {
  entries: Record<string, PersistedMcpAppWindowEntry>;
  activeFullscreenTabId: string | null;
}

function defaultStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined {
  try {
    return typeof sessionStorage !== "undefined" ? sessionStorage : undefined;
  } catch {
    return undefined;
  }
}

export function readMcpAppWindowState(
  storage?: Pick<Storage, "getItem">,
): PersistedMcpAppWindowState {
  const empty: PersistedMcpAppWindowState = { entries: {}, activeFullscreenTabId: null };
  try {
    const store = storage ?? defaultStorage();
    if (!store) {
      return empty;
    }
    const raw = store.getItem(MCP_APP_WINDOW_STATE_STORAGE_KEY);
    if (!raw) {
      return empty;
    }
    const parsed = JSON.parse(raw) as Partial<PersistedMcpAppWindowState> | null;
    if (!parsed || typeof parsed !== "object") {
      return empty;
    }
    const entries: Record<string, PersistedMcpAppWindowEntry> = {};
    if (parsed.entries && typeof parsed.entries === "object") {
      for (const [key, item] of Object.entries(parsed.entries)) {
        if (
          item &&
          typeof item.entryKey === "string" &&
          typeof item.appKey === "string" &&
          typeof item.sessionKey === "string" &&
          (item.displayMode === "pip" || item.displayMode === "fullscreen")
        ) {
          entries[key] = {
            entryKey: item.entryKey,
            appKey: item.appKey,
            sessionKey: item.sessionKey,
            displayMode: item.displayMode,
            ...(typeof item.tabTitle === "string" ? { tabTitle: item.tabTitle } : {}),
            ...(typeof item.tabSessionKey === "string"
              ? { tabSessionKey: item.tabSessionKey }
              : {}),
          };
        }
      }
    }
    const activeFullscreenTabId =
      typeof parsed.activeFullscreenTabId === "string" &&
      parsed.activeFullscreenTabId.startsWith("mcp-app:")
        ? parsed.activeFullscreenTabId
        : null;
    return { entries, activeFullscreenTabId };
  } catch {
    return empty;
  }
}

function writeMcpAppWindowState(
  state: PersistedMcpAppWindowState,
  storage?: Pick<Storage, "setItem" | "removeItem">,
): void {
  try {
    const store = storage ?? defaultStorage();
    if (!store) {
      return;
    }
    if (Object.keys(state.entries).length === 0 && !state.activeFullscreenTabId) {
      store.removeItem(MCP_APP_WINDOW_STATE_STORAGE_KEY);
      return;
    }
    store.setItem(MCP_APP_WINDOW_STATE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore storage quota/availability failures
  }
}

export function setMcpAppWindowEntryMode(
  input: {
    entryKey: string;
    appKey: string;
    sessionKey: string;
    displayMode: McpUiDisplayMode;
    tabTitle?: string;
    tabSessionKey?: string;
  },
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">,
): void {
  const current = readMcpAppWindowState(storage);
  const tabId = `mcp-app:${input.entryKey}`;
  if (input.displayMode === "inline") {
    if (!(input.entryKey in current.entries) && current.activeFullscreenTabId !== tabId) {
      return;
    }
    delete current.entries[input.entryKey];
    if (current.activeFullscreenTabId === tabId) {
      current.activeFullscreenTabId = null;
    }
    writeMcpAppWindowState(current, storage);
    return;
  }

  current.entries[input.entryKey] = {
    entryKey: input.entryKey,
    appKey: input.appKey,
    sessionKey: input.sessionKey,
    displayMode: input.displayMode,
    ...(input.tabTitle !== undefined ? { tabTitle: input.tabTitle } : {}),
    ...(input.tabSessionKey !== undefined ? { tabSessionKey: input.tabSessionKey } : {}),
  };
  if (input.displayMode === "fullscreen") {
    current.activeFullscreenTabId = tabId;
  } else if (current.activeFullscreenTabId === tabId) {
    current.activeFullscreenTabId = null;
  }
  writeMcpAppWindowState(current, storage);
}

export function clearMcpAppWindowEntry(
  entryKey: string,
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">,
): void {
  const current = readMcpAppWindowState(storage);
  const tabId = `mcp-app:${entryKey}`;
  if (!(entryKey in current.entries) && current.activeFullscreenTabId !== tabId) {
    return;
  }
  delete current.entries[entryKey];
  if (current.activeFullscreenTabId === tabId) {
    current.activeFullscreenTabId = null;
  }
  writeMcpAppWindowState(current, storage);
}

export function setActiveMcpAppFullscreenTabId(
  tabId: string | null,
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">,
): void {
  const current = readMcpAppWindowState(storage);
  const normalized = tabId && tabId.startsWith("mcp-app:") ? tabId : null;
  if (current.activeFullscreenTabId === normalized) {
    return;
  }
  current.activeFullscreenTabId = normalized;
  writeMcpAppWindowState(current, storage);
}

export function buildRestoredMcpAppFullscreenTabs(storage?: Pick<Storage, "getItem">): {
  tabs: WorkspaceMcpAppToolTab[];
  activeTabId: string | null;
} {
  const state = readMcpAppWindowState(storage);
  const tabs: WorkspaceMcpAppToolTab[] = [];
  for (const entry of Object.values(state.entries)) {
    if (entry.displayMode !== "fullscreen") {
      continue;
    }
    tabs.push(
      createMcpAppWorkspaceToolTab({
        instanceKey: entry.entryKey,
        appKey: entry.appKey,
        sessionKey: entry.tabSessionKey ?? entry.sessionKey,
        tabTitle: entry.tabTitle ?? entry.appKey,
      }),
    );
  }
  const activeTabId =
    state.activeFullscreenTabId && tabs.some((tab) => tab.id === state.activeFullscreenTabId)
      ? state.activeFullscreenTabId
      : null;
  return { tabs, activeTabId };
}
