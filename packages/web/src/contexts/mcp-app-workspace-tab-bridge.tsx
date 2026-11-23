import { useCallback, useMemo, useRef, type ReactNode } from "react";

import {
  McpAppWorkspaceTabBridgeContext,
  type McpAppWorkspaceTabBridgeValue,
  type OpenMcpAppWorkspaceTabInput,
} from "@/contexts/mcp-app-contexts";
import { clearMcpAppWindowEntry } from "@/lib/mcp-apps/window-state";

export type { McpAppWorkspaceTabBridgeValue, OpenMcpAppWorkspaceTabInput };

export interface McpAppWorkspaceTabBridgeProviderProps {
  openMcpAppTab: (input: {
    instanceKey: string;
    appKey: string;
    sessionKey: string;
    tabTitle: string;
  }) => void;
  closeMcpAppTab: (instanceKey: string) => void;
  children: ReactNode;
}

/**
 * Coordinates fullscreen MCP App instances living inside ConversationView panes with
 * ephemeral tabs hosted in the app-level right WorkspaceToolsDock so live iframes move
 * atomically via `moveBefore()` across the tree without reloading.
 */
export function McpAppWorkspaceTabBridgeProvider({
  openMcpAppTab,
  closeMcpAppTab,
  children,
}: McpAppWorkspaceTabBridgeProviderProps) {
  const hostElementsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const hostListenersRef = useRef<Set<() => void>>(new Set());
  const closedByUserCallbacksRef = useRef<Map<string, () => void>>(new Map());

  const emitHostChange = useCallback(() => {
    for (const listener of hostListenersRef.current) {
      listener();
    }
  }, []);

  const openTab = useCallback(
    (input: OpenMcpAppWorkspaceTabInput) => {
      closedByUserCallbacksRef.current.set(input.instanceKey, input.onClosedByUser);
      openMcpAppTab({
        instanceKey: input.instanceKey,
        appKey: input.appKey,
        sessionKey: input.sessionKey,
        tabTitle: input.title,
      });
    },
    [openMcpAppTab],
  );

  const registerTabCloseHandler = useCallback((instanceKey: string, onClosedByUser: () => void) => {
    closedByUserCallbacksRef.current.set(instanceKey, onClosedByUser);
  }, []);

  const closeTab = useCallback(
    (instanceKey: string) => {
      closedByUserCallbacksRef.current.delete(instanceKey);
      closeMcpAppTab(instanceKey);
    },
    [closeMcpAppTab],
  );

  const setTabHostElement = useCallback(
    (instanceKey: string, element: HTMLDivElement | null) => {
      if (element) {
        hostElementsRef.current.set(instanceKey, element);
      } else {
        hostElementsRef.current.delete(instanceKey);
      }
      emitHostChange();
    },
    [emitHostChange],
  );

  const getTabHostElement = useCallback((instanceKey: string) => {
    return hostElementsRef.current.get(instanceKey) ?? null;
  }, []);

  const subscribeHostChange = useCallback((listener: () => void) => {
    hostListenersRef.current.add(listener);
    return () => {
      hostListenersRef.current.delete(listener);
    };
  }, []);

  const notifyTabClosedByUser = useCallback((instanceKey: string) => {
    clearMcpAppWindowEntry(instanceKey);
    const callback = closedByUserCallbacksRef.current.get(instanceKey);
    closedByUserCallbacksRef.current.delete(instanceKey);
    callback?.();
  }, []);

  const value = useMemo<McpAppWorkspaceTabBridgeValue>(
    () => ({
      openTab,
      closeTab,
      registerTabCloseHandler,
      setTabHostElement,
      getTabHostElement,
      subscribeHostChange,
      notifyTabClosedByUser,
    }),
    [
      closeTab,
      getTabHostElement,
      notifyTabClosedByUser,
      openTab,
      registerTabCloseHandler,
      setTabHostElement,
      subscribeHostChange,
    ],
  );

  return (
    <McpAppWorkspaceTabBridgeContext.Provider value={value}>
      {children}
    </McpAppWorkspaceTabBridgeContext.Provider>
  );
}
