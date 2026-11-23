import type { McpUiDisplayMode } from "@modelcontextprotocol/ext-apps/app-bridge";
import type { ToolExecutionMcpAppUi } from "@spiritagent/agent-core";
import { createContext, useContext, type Context } from "react";

import type { McpAppPipRect } from "@/lib/mcp-apps/pip-geometry";
import type { ToolBlockSnapshot } from "@/types";

export interface McpAppRegistryEntry {
  entryKey: string;
  appKey: string;
  sessionKey: string;
  sessionPath?: string;
  tool: ToolBlockSnapshot;
  mcpApp: ToolExecutionMcpAppUi;
  displayMode: McpUiDisplayMode;
  inlineExpanded: boolean;
  inlineHeightPx: number;
  lastTouchedAt: number;
  portalContainer: HTMLDivElement;
  pipRect?: McpAppPipRect;
  pipZOrder: number;
}

export interface McpAppPaneContextValue {
  registerApp: (input: {
    appKey: string;
    tool: ToolBlockSnapshot;
    mcpApp: ToolExecutionMcpAppUi;
    initialHeightPx?: number;
  }) => void;
  setSlotElement: (
    appKey: string,
    element: HTMLDivElement | null,
    onBeforeResize?: (() => void) | null,
  ) => void;
  setDisplayMode: (appKey: string, mode: McpUiDisplayMode) => void;
  setInlineExpanded: (appKey: string, expanded: boolean) => void;
  getEntry: (appKey: string) => McpAppRegistryEntry | undefined;
}

export interface PaneComposerBridge {
  paneId: string;
  sessionKey: string;
  getCurrentComposerText: () => string;
  onReplaceComposerText: (text: string) => void;
  onAppendComposerText: (text: string) => void;
  onFocusComposer: () => void;
  onOpenExternalUrl?: (url: string) => Promise<void>;
}

export interface McpAppGlobalHostContextValue {
  registerApp: (input: {
    sessionKey: string;
    sessionPath?: string;
    appKey: string;
    tool: ToolBlockSnapshot;
    mcpApp: ToolExecutionMcpAppUi;
    initialHeightPx?: number;
  }) => void;
  setSlotElement: (
    sessionKey: string,
    appKey: string,
    element: HTMLDivElement | null,
    onBeforeResize?: (() => void) | null,
  ) => void;
  setDisplayMode: (sessionKey: string, appKey: string, mode: McpUiDisplayMode) => void;
  setInlineExpanded: (sessionKey: string, appKey: string, expanded: boolean) => void;
  getEntry: (sessionKey: string, appKey: string) => McpAppRegistryEntry | undefined;
  registerPaneBridge: (bridge: PaneComposerBridge) => () => void;
}

export interface OpenMcpAppWorkspaceTabInput {
  instanceKey: string;
  appKey: string;
  sessionKey: string;
  title: string;
  onClosedByUser: () => void;
}

export interface McpAppWorkspaceTabBridgeValue {
  openTab: (input: OpenMcpAppWorkspaceTabInput) => void;
  closeTab: (instanceKey: string) => void;
  registerTabCloseHandler: (instanceKey: string, onClosedByUser: () => void) => void;
  setTabHostElement: (instanceKey: string, element: HTMLDivElement | null) => void;
  getTabHostElement: (instanceKey: string) => HTMLDivElement | null;
  subscribeHostChange: (listener: () => void) => () => void;
  notifyTabClosedByUser: (instanceKey: string) => void;
}

const HMR_CONTEXT_REGISTRY_KEY = "__spiritMcpAppHmrContexts__";

function createHmrStableContext<T>(name: string, defaultValue: T): Context<T> {
  if (import.meta.hot) {
    const root = globalThis as Record<string, unknown>;
    let registry = root[HMR_CONTEXT_REGISTRY_KEY] as Map<string, Context<unknown>> | undefined;
    if (!registry) {
      registry = new Map();
      root[HMR_CONTEXT_REGISTRY_KEY] = registry;
    }
    const existing = registry.get(name);
    if (existing) {
      return existing as Context<T>;
    }
    const created = createContext<T>(defaultValue);
    registry.set(name, created as Context<unknown>);
    return created;
  }
  return createContext<T>(defaultValue);
}

export const McpAppPaneContext = createHmrStableContext<McpAppPaneContextValue | null>(
  "McpAppPaneContext",
  null,
);

export const McpAppGlobalHostContext = createHmrStableContext<McpAppGlobalHostContextValue | null>(
  "McpAppGlobalHostContext",
  null,
);

export const McpAppWorkspaceTabBridgeContext =
  createHmrStableContext<McpAppWorkspaceTabBridgeValue | null>(
    "McpAppWorkspaceTabBridgeContext",
    null,
  );

export function useMcpAppPane(): McpAppPaneContextValue | null {
  return useContext(McpAppPaneContext);
}

export function useMcpAppGlobalHost(): McpAppGlobalHostContextValue | null {
  return useContext(McpAppGlobalHostContext);
}

export function useMcpAppWorkspaceTabBridge(): McpAppWorkspaceTabBridgeValue | null {
  return useContext(McpAppWorkspaceTabBridgeContext);
}
