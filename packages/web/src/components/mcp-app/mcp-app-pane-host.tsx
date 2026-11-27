import type { McpUiDisplayMode, McpUiResourceCsp } from "@modelcontextprotocol/ext-apps/app-bridge";
import type { ToolExecutionMcpAppUi } from "@spiritagent/agent-core";
import {
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { McpAppIframeInstance } from "@/components/mcp-app/mcp-app-iframe-instance";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  McpAppGlobalHostContext,
  McpAppPaneContext,
  useMcpAppWorkspaceTabBridge,
  type McpAppGlobalHostContextValue,
  type McpAppPaneContextValue,
  type McpAppRegistryEntry,
  type PaneComposerBridge,
} from "@/contexts/mcp-app-contexts";
import type { useDesktopRuntime } from "@/hooks/useDesktopRuntime";
import { runAfterRadixOverlayClose } from "@/lib/overlay-motion";
import {
  atomicMoveNode,
  clampMcpAppInlineHeight,
  DEFAULT_MCP_APP_INLINE_HEIGHT_PX,
  formatMcpAppTabTitle,
  MAX_ACTIVE_MCP_APPS_PER_PANE,
  selectEvictableMcpAppKeys,
} from "@/lib/mcp-apps/pane-state";
import {
  clampPipRect,
  computeInitialPipRect,
  readCurrentPipViewport,
  readMcpAppPipGeometry,
  writeMcpAppPipGeometry,
  type McpAppPipRect,
} from "@/lib/mcp-apps/pip-geometry";
import { isTrustedMcpAppExternalUrl, validateMcpAppExternalUrl } from "@/lib/mcp-apps/theme-tokens";
import {
  clearMcpAppWindowEntry,
  readMcpAppWindowState,
  setMcpAppWindowEntryMode,
} from "@/lib/mcp-apps/window-state";
import type { ToolBlockSnapshot } from "@/types";

export type { McpAppPaneContextValue, McpAppRegistryEntry };

type DesktopRuntime = ReturnType<typeof useDesktopRuntime>;

function makeMcpAppEntryKey(sessionKey: string, appKey: string): string {
  return `${sessionKey}::${appKey}`;
}

interface PendingDraftConflict {
  appTitle: string;
  text: string;
}

interface PendingExternalLinkConfirm {
  appTitle: string;
  url: string;
  resolve: () => void;
  reject: (reason?: unknown) => void;
}

interface PendingToolCallApproval {
  appTitle: string;
  server: string;
  tool: string;
  argumentsJson?: string;
  resolve: () => void;
  reject: (reason?: unknown) => void;
}

export interface McpAppGlobalHostProviderProps {
  activeSessionKey: string;
  sandboxUrl?: string;
  runtime: DesktopRuntime;
  conversationSurfaceVisible?: boolean;
  onEnsureConversationSurface?: () => void;
  onOpenExternalUrl?: (url: string) => Promise<void>;
  children: ReactNode;
}

/**
 * App-level host owning live MCP App instances, cross-session / cross-surface PiP
 * floating windows, portal containers, and approval/confirmation dialogs.
 * Keeping the registry above conversation views ensures PiP windows persist without
 * reloading when switching sessions, opening new threads, or visiting Settings,
 * Extensions, or Automations.
 */
export function McpAppGlobalHostProvider({
  activeSessionKey,
  sandboxUrl,
  runtime,
  conversationSurfaceVisible = true,
  onEnsureConversationSurface,
  onOpenExternalUrl,
  children,
}: McpAppGlobalHostProviderProps) {
  const { t } = useTranslation();
  const workspaceTabBridge = useMcpAppWorkspaceTabBridge();
  const workspaceTabBridgeRef = useRef(workspaceTabBridge);
  useLayoutEffect(() => {
    workspaceTabBridgeRef.current = workspaceTabBridge;
  }, [workspaceTabBridge]);

  const [entries, setEntries] = useState<McpAppRegistryEntry[]>([]);
  const entriesRef = useRef(entries);

  const activeSessionKeyRef = useRef(activeSessionKey);
  const conversationSurfaceVisibleRef = useRef(conversationSurfaceVisible);
  const onEnsureConversationSurfaceRef = useRef(onEnsureConversationSurface);
  const onOpenExternalUrlRef = useRef(onOpenExternalUrl);
  const runtimeRef = useRef(runtime);
  useLayoutEffect(() => {
    activeSessionKeyRef.current = activeSessionKey;
    conversationSurfaceVisibleRef.current = conversationSurfaceVisible;
    onEnsureConversationSurfaceRef.current = onEnsureConversationSurface;
    onOpenExternalUrlRef.current = onOpenExternalUrl;
    runtimeRef.current = runtime;
  }, [
    activeSessionKey,
    conversationSurfaceVisible,
    onEnsureConversationSurface,
    onOpenExternalUrl,
    runtime,
  ]);

  const overlayLayerRef = useRef<HTMLDivElement | null>(null);
  const parkLayerRef = useRef<HTMLDivElement | null>(null);

  const portalContainersRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const slotElementsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const lastInlineSizeRef = useRef<Map<string, { width: number; height: number }>>(new Map());
  const beforeResizeCallbacksRef = useRef<Map<string, () => void>>(new Map());
  const wrapperElementsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const ensureBridgeWindowCallbacksRef = useRef<Map<string, () => void>>(new Map());
  const openedTabInstanceKeysRef = useRef<Set<string>>(new Set());
  const prevEntryKeysRef = useRef<Set<string>>(new Set());
  const pipZCounterRef = useRef(1);
  const paneBridgesRef = useRef<Map<string, PaneComposerBridge>>(new Map());
  const pendingComposerPrefillRef = useRef<{ text: string; appTitle: string } | null>(null);

  const tabInstanceKeyFor = useCallback((entryKey: string) => entryKey, []);

  const [draftConflict, setDraftConflict] = useState<PendingDraftConflict | null>(null);
  const [draftConflictOpen, setDraftConflictOpen] = useState(false);
  const draftConflictOpenRef = useRef(false);

  const [externalLinkConfirm, setExternalLinkConfirm] = useState<PendingExternalLinkConfirm | null>(
    null,
  );
  const [externalLinkConfirmOpen, setExternalLinkConfirmOpen] = useState(false);
  const externalLinkConfirmOpenRef = useRef(false);
  const externalLinkConfirmRef = useRef<PendingExternalLinkConfirm | null>(null);

  const [displayedToolCallApproval, setDisplayedToolCallApproval] =
    useState<PendingToolCallApproval | null>(null);
  const [toolCallApprovalOpen, setToolCallApprovalOpen] = useState(false);
  const toolCallApprovalQueueRef = useRef<PendingToolCallApproval[]>([]);

  const openDraftConflict = useCallback((next: PendingDraftConflict) => {
    draftConflictOpenRef.current = true;
    setDraftConflict(next);
    setDraftConflictOpen(true);
  }, []);

  // Keep bound dialog payload mounted through the Radix exit animation;
  // clearing it on openChange(false) flashes empty app/message content on the closing frames.
  const dismissDraftConflict = useCallback(() => {
    draftConflictOpenRef.current = false;
    setDraftConflictOpen(false);
    runAfterRadixOverlayClose(() => {
      if (!draftConflictOpenRef.current) {
        setDraftConflict(null);
      }
    });
  }, []);

  const openExternalLinkConfirm = useCallback((next: PendingExternalLinkConfirm) => {
    externalLinkConfirmRef.current = next;
    externalLinkConfirmOpenRef.current = true;
    setExternalLinkConfirm(next);
    setExternalLinkConfirmOpen(true);
  }, []);

  useEffect(() => {
    return () => {
      if (externalLinkConfirmOpenRef.current && externalLinkConfirmRef.current) {
        externalLinkConfirmOpenRef.current = false;
        const pendingLink = externalLinkConfirmRef.current;
        externalLinkConfirmRef.current = null;
        pendingLink.reject(new Error("MCP App host unmounted before link confirmation completed"));
      }
      const pending = toolCallApprovalQueueRef.current.splice(0);
      for (const item of pending) {
        item.reject(new Error("MCP App host unmounted before tool call approval completed"));
      }
    };
  }, []);

  const syncPortalMountsNow = useCallback(() => {
    const overlayLayerEl = overlayLayerRef.current;
    const parkLayerEl = parkLayerRef.current;

    const parkEntry = (entryKey: string, hostDiv: HTMLDivElement) => {
      if (parkLayerEl) {
        atomicMoveNode(parkLayerEl, hostDiv);
      }
      const lastSize = lastInlineSizeRef.current.get(entryKey);
      if (lastSize && lastSize.width > 0 && lastSize.height > 0) {
        hostDiv.style.width = `${Math.round(lastSize.width)}px`;
        hostDiv.style.height = `${Math.round(lastSize.height)}px`;
      } else {
        hostDiv.style.width = "";
        hostDiv.style.height = "";
      }
      hostDiv.style.visibility = "hidden";
      hostDiv.style.pointerEvents = "none";
      hostDiv.inert = true;
    };

    for (const entry of entriesRef.current) {
      const hostDiv = entry.portalContainer;

      if (entry.displayMode === "pip") {
        if (overlayLayerEl) {
          atomicMoveNode(overlayLayerEl, hostDiv);
          ensureBridgeWindowCallbacksRef.current.get(entry.entryKey)?.();
        }
        hostDiv.style.width = "";
        hostDiv.style.height = "";
        hostDiv.style.visibility = "";
        hostDiv.style.pointerEvents = "";
        hostDiv.inert = false;
        continue;
      }

      if (entry.displayMode === "fullscreen") {
        const tabHost = workspaceTabBridgeRef.current?.getTabHostElement(
          tabInstanceKeyFor(entry.entryKey),
        );
        if (!tabHost || !tabHost.isConnected) {
          parkEntry(entry.entryKey, hostDiv);
          continue;
        }
        hostDiv.style.width = "100%";
        hostDiv.style.height = "100%";
        hostDiv.style.visibility = "";
        hostDiv.style.pointerEvents = "";
        hostDiv.inert = false;
        atomicMoveNode(tabHost, hostDiv);
        ensureBridgeWindowCallbacksRef.current.get(entry.entryKey)?.();
        continue;
      }

      const slot = slotElementsRef.current.get(entry.entryKey);
      if (!slot || !slot.isConnected) {
        parkEntry(entry.entryKey, hostDiv);
        continue;
      }

      // Mount directly inside the inline slot so DOM focus order (Tab / Shift+Tab),
      // accessibility tree, scrolling, and stacking stay naturally aligned with the message flow.
      hostDiv.style.width = "100%";
      hostDiv.style.height = "100%";
      hostDiv.style.visibility = "";
      hostDiv.style.pointerEvents = "";
      hostDiv.inert = false;
      atomicMoveNode(slot, hostDiv);
      ensureBridgeWindowCallbacksRef.current.get(entry.entryKey)?.();
    }
  }, [tabInstanceKeyFor]);

  // Remove detached portal containers on host unmount. Declared before the mount-sync
  // layout effect so React StrictMode / Fast Refresh cleanup+setup cycles always
  // re-attach live portal containers synchronously via `syncPortalMountsNow`.
  useLayoutEffect(() => {
    const portalContainers = portalContainersRef.current;
    return () => {
      for (const container of portalContainers.values()) {
        container.remove();
      }
    };
  }, []);

  useLayoutEffect(() => {
    entriesRef.current = entries;
    syncPortalMountsNow();
  }, [entries, syncPortalMountsNow]);

  // Keep a stable host-lifetime subscription to right-panel tab host mount/unmount events.
  // Tying this effect to fullscreen keys would unsubscribe during commitMutationEffects
  // before the sibling WorkspaceToolsDock detaches the closing tab host ref, causing
  // removeChild to detach the live iframe before moveBefore rescues it.
  useLayoutEffect(() => {
    if (!workspaceTabBridge) {
      return;
    }
    return workspaceTabBridge.subscribeHostChange(syncPortalMountsNow);
  }, [syncPortalMountsNow, workspaceTabBridge]);

  // Keep open PiP windows clamped inside the viewport whenever the app window resizes.
  useEffect(() => {
    const handleWindowResize = () => {
      const viewport = readCurrentPipViewport();
      setEntries((prev) => {
        let changed = false;
        const next = prev.map((entry) => {
          if (entry.displayMode !== "pip" || !entry.pipRect) {
            return entry;
          }
          const clamped = clampPipRect(entry.pipRect, viewport);
          if (
            clamped.x === entry.pipRect.x &&
            clamped.y === entry.pipRect.y &&
            clamped.width === entry.pipRect.width &&
            clamped.height === entry.pipRect.height
          ) {
            return entry;
          }
          changed = true;
          return { ...entry, pipRect: clamped };
        });
        return changed ? next : prev;
      });
    };
    window.addEventListener("resize", handleWindowResize);
    return () => {
      window.removeEventListener("resize", handleWindowResize);
    };
  }, []);

  // Remove detached portal containers and close tabs ONLY for entries that were previously
  // committed in `entries` and subsequently evicted (never for brand-new entries whose
  // `registerApp` ran in a child effect during the same commit before `setEntries` flushed).
  useEffect(() => {
    const activeKeys = new Set(entries.map((entry) => entry.entryKey));
    for (const prevKey of prevEntryKeysRef.current) {
      if (!activeKeys.has(prevKey)) {
        const instanceKey = tabInstanceKeyFor(prevKey);
        if (openedTabInstanceKeysRef.current.delete(instanceKey)) {
          clearMcpAppWindowEntry(prevKey);
          workspaceTabBridgeRef.current?.closeTab(instanceKey);
        }
        portalContainersRef.current.get(prevKey)?.remove();
        portalContainersRef.current.delete(prevKey);
        lastInlineSizeRef.current.delete(prevKey);
      }
    }
    prevEntryKeysRef.current = activeKeys;
  }, [entries, tabInstanceKeyFor]);

  const pickActivePaneBridge = useCallback((): PaneComposerBridge | null => {
    const bridges = Array.from(paneBridgesRef.current.values());
    if (bridges.length === 0) {
      return null;
    }
    const activeKey = activeSessionKeyRef.current;
    for (let i = bridges.length - 1; i >= 0; i -= 1) {
      if (bridges[i]!.sessionKey === activeKey) {
        return bridges[i]!;
      }
    }
    return bridges[bridges.length - 1] ?? null;
  }, []);

  const applyComposerPrefillWithBridge = useCallback(
    (bridge: PaneComposerBridge, text: string, appTitle: string) => {
      const currentDraft = bridge.getCurrentComposerText().trim();
      if (!currentDraft) {
        bridge.onReplaceComposerText(text);
        bridge.onFocusComposer();
        return;
      }
      openDraftConflict({ appTitle, text });
    },
    [openDraftConflict],
  );

  // Flush deferred composer prefill once the conversation surface becomes visible again.
  useEffect(() => {
    if (!conversationSurfaceVisible || !pendingComposerPrefillRef.current) {
      return;
    }
    let cancelled = false;
    queueMicrotask(() => {
      if (
        cancelled ||
        !conversationSurfaceVisibleRef.current ||
        !pendingComposerPrefillRef.current
      ) {
        return;
      }
      const bridge = pickActivePaneBridge();
      if (!bridge) {
        return;
      }
      const pending = pendingComposerPrefillRef.current;
      pendingComposerPrefillRef.current = null;
      applyComposerPrefillWithBridge(bridge, pending.text, pending.appTitle);
    });
    return () => {
      cancelled = true;
    };
  }, [applyComposerPrefillWithBridge, conversationSurfaceVisible, pickActivePaneBridge]);

  const registerPaneBridge = useCallback(
    (bridge: PaneComposerBridge) => {
      paneBridgesRef.current.set(bridge.paneId, bridge);
      if (conversationSurfaceVisibleRef.current && pendingComposerPrefillRef.current) {
        queueMicrotask(() => {
          if (!conversationSurfaceVisibleRef.current || !pendingComposerPrefillRef.current) {
            return;
          }
          const activeBridge = paneBridgesRef.current.get(bridge.paneId);
          if (!activeBridge) {
            return;
          }
          const pending = pendingComposerPrefillRef.current;
          pendingComposerPrefillRef.current = null;
          applyComposerPrefillWithBridge(activeBridge, pending.text, pending.appTitle);
        });
      }
      return () => {
        paneBridgesRef.current.delete(bridge.paneId);
      };
    },
    [applyComposerPrefillWithBridge],
  );

  const registerApp = useCallback(
    (input: {
      sessionKey: string;
      sessionPath?: string;
      appKey: string;
      tool: ToolBlockSnapshot;
      mcpApp: ToolExecutionMcpAppUi;
      initialHeightPx?: number;
    }) => {
      const entryKey = makeMcpAppEntryKey(input.sessionKey, input.appKey);
      let portalContainer = portalContainersRef.current.get(entryKey);
      if (!portalContainer) {
        portalContainer = document.createElement("div");
        portalContainer.setAttribute("data-spirit-mcp-app-portal", input.appKey);
        portalContainersRef.current.set(entryKey, portalContainer);
      }

      const savedWindowEntry = readMcpAppWindowState().entries[entryKey];
      const restoredMode: McpUiDisplayMode = savedWindowEntry?.displayMode ?? "inline";
      const instanceKey = tabInstanceKeyFor(entryKey);
      if (restoredMode === "fullscreen") {
        openedTabInstanceKeysRef.current.add(instanceKey);
        workspaceTabBridgeRef.current?.registerTabCloseHandler(instanceKey, () => {
          openedTabInstanceKeysRef.current.delete(instanceKey);
          clearMcpAppWindowEntry(entryKey);
          setEntries((prev) =>
            prev.map((item) =>
              item.entryKey === entryKey && item.displayMode === "fullscreen"
                ? { ...item, displayMode: "inline", lastTouchedAt: Date.now() }
                : item,
            ),
          );
        });
      }

      const now = Date.now();
      const restoredViewport = restoredMode === "pip" ? readCurrentPipViewport() : null;
      const restoredPipGeometry = restoredMode === "pip" ? readMcpAppPipGeometry() : null;
      setEntries((prev) => {
        const existingIndex = prev.findIndex((item) => item.entryKey === entryKey);
        if (existingIndex >= 0) {
          const existing = prev[existingIndex]!;
          if (
            existing.tool === input.tool &&
            existing.mcpApp === input.mcpApp &&
            existing.sessionKey === input.sessionKey &&
            existing.sessionPath === input.sessionPath
          ) {
            return prev;
          }
          const next = [...prev];
          next[existingIndex] = {
            ...existing,
            sessionKey: input.sessionKey,
            ...(input.sessionPath !== undefined ? { sessionPath: input.sessionPath } : {}),
            tool: input.tool,
            mcpApp: input.mcpApp,
            lastTouchedAt: now,
          };
          return next;
        }

        const existingPipRects =
          restoredMode === "pip"
            ? prev
                .filter((item) => item.displayMode === "pip" && item.pipRect)
                .map((item) => item.pipRect!)
            : [];
        const initialPipRect =
          restoredMode === "pip" && restoredViewport
            ? computeInitialPipRect(restoredViewport, restoredPipGeometry, existingPipRects)
            : undefined;
        const initialPipZOrder = restoredMode === "pip" ? ++pipZCounterRef.current : 1;

        const appended: McpAppRegistryEntry[] = [
          ...prev,
          {
            entryKey,
            appKey: input.appKey,
            sessionKey: input.sessionKey,
            ...(input.sessionPath !== undefined ? { sessionPath: input.sessionPath } : {}),
            tool: input.tool,
            mcpApp: input.mcpApp,
            displayMode: restoredMode,
            inlineExpanded: true,
            inlineHeightPx: clampMcpAppInlineHeight(
              input.initialHeightPx ?? DEFAULT_MCP_APP_INLINE_HEIGHT_PX,
            ),
            lastTouchedAt: now,
            portalContainer,
            ...(initialPipRect ? { pipRect: initialPipRect } : {}),
            pipZOrder: initialPipZOrder,
          },
        ];

        const toEvict = new Set(
          selectEvictableMcpAppKeys(
            appended.map((item) => ({
              appKey: item.entryKey,
              displayMode: item.displayMode,
              lastTouchedAt: item.lastTouchedAt,
            })),
            MAX_ACTIVE_MCP_APPS_PER_PANE,
          ),
        );
        if (toEvict.size === 0) {
          return appended;
        }
        return appended.filter((item) => !toEvict.has(item.entryKey));
      });
    },
    [tabInstanceKeyFor],
  );

  const setSlotElement = useCallback(
    (
      sessionKey: string,
      appKey: string,
      element: HTMLDivElement | null,
      onBeforeResize?: (() => void) | null,
    ) => {
      const entryKey = makeMcpAppEntryKey(sessionKey, appKey);
      if (element) {
        slotElementsRef.current.set(entryKey, element);
        if (onBeforeResize) {
          beforeResizeCallbacksRef.current.set(entryKey, onBeforeResize);
        } else {
          beforeResizeCallbacksRef.current.delete(entryKey);
        }
        syncPortalMountsNow();
      } else {
        const prevSlot = slotElementsRef.current.get(entryKey);
        if (prevSlot) {
          const rect = prevSlot.getBoundingClientRect();
          const width = prevSlot.offsetWidth || rect.width;
          const height = prevSlot.offsetHeight || rect.height;
          if (width > 0 && height > 0) {
            lastInlineSizeRef.current.set(entryKey, { width, height });
          }
        }
        slotElementsRef.current.delete(entryKey);
        beforeResizeCallbacksRef.current.delete(entryKey);
        // React detaches refs during commitDeletionEffects before removeChild runs,
        // so moving the portal container to park-layer here keeps the iframe connected.
        syncPortalMountsNow();
      }
    },
    [syncPortalMountsNow],
  );

  const registerWrapperElement = useCallback(
    (entryKey: string, element: HTMLDivElement | null) => {
      if (element) {
        wrapperElementsRef.current.set(entryKey, element);
      } else {
        wrapperElementsRef.current.delete(entryKey);
      }
      syncPortalMountsNow();
    },
    [syncPortalMountsNow],
  );

  const registerEnsureBridgeWindow = useCallback(
    (entryKey: string, ensure: (() => void) | null) => {
      if (ensure) {
        ensureBridgeWindowCallbacksRef.current.set(entryKey, ensure);
      } else {
        ensureBridgeWindowCallbacksRef.current.delete(entryKey);
      }
    },
    [],
  );

  const setDisplayModeByEntryKey = useCallback(
    (entryKey: string, nextMode: McpUiDisplayMode) => {
      const instanceKey = tabInstanceKeyFor(entryKey);
      const entry = entriesRef.current.find((item) => item.entryKey === entryKey);
      const title = entry ? formatMcpAppTabTitle(entry.mcpApp) : entryKey;
      const fromAnotherSessionOrSurface =
        !conversationSurfaceVisibleRef.current ||
        (entry !== undefined && entry.sessionKey !== activeSessionKeyRef.current);
      const tabSessionKey = fromAnotherSessionOrSurface ? "" : (entry?.sessionKey ?? "");

      if (nextMode === "fullscreen") {
        if (!conversationSurfaceVisibleRef.current) {
          onEnsureConversationSurfaceRef.current?.();
        }
        openedTabInstanceKeysRef.current.add(instanceKey);
        workspaceTabBridgeRef.current?.openTab({
          instanceKey,
          appKey: entry?.appKey ?? entryKey,
          // When promoted to fullscreen from a cross-session PiP, keep the tab visible in
          // the active conversation's right dock instead of hiding it behind the origin session.
          sessionKey: tabSessionKey,
          title,
          onClosedByUser: () => {
            openedTabInstanceKeysRef.current.delete(instanceKey);
            clearMcpAppWindowEntry(entryKey);
            setEntries((prev) =>
              prev.map((item) =>
                item.entryKey === entryKey && item.displayMode === "fullscreen"
                  ? { ...item, displayMode: "inline", lastTouchedAt: Date.now() }
                  : item,
              ),
            );
          },
        });
      } else if (openedTabInstanceKeysRef.current.delete(instanceKey)) {
        workspaceTabBridgeRef.current?.closeTab(instanceKey);
      }

      if (entry) {
        setMcpAppWindowEntryMode({
          entryKey,
          appKey: entry.appKey,
          sessionKey: entry.sessionKey,
          displayMode: nextMode,
          ...(nextMode === "fullscreen" ? { tabTitle: title, tabSessionKey } : {}),
        });
      } else if (nextMode === "inline") {
        clearMcpAppWindowEntry(entryKey);
      }

      const viewport = nextMode === "pip" ? readCurrentPipViewport() : null;
      const storedPipGeometry = nextMode === "pip" ? readMcpAppPipGeometry() : null;

      setEntries((prev) => {
        const existingPipRects =
          nextMode === "pip"
            ? prev
                .filter(
                  (item) =>
                    item.entryKey !== entryKey && item.displayMode === "pip" && item.pipRect,
                )
                .map((item) => item.pipRect!)
            : [];

        return prev.map((item) => {
          if (item.entryKey !== entryKey) {
            return item;
          }
          const nextPipRect =
            nextMode === "pip" && viewport
              ? computeInitialPipRect(viewport, item.pipRect ?? storedPipGeometry, existingPipRects)
              : item.pipRect;
          const nextZOrder = nextMode === "pip" ? ++pipZCounterRef.current : item.pipZOrder;
          return {
            ...item,
            displayMode: nextMode,
            ...(nextMode === "inline" ? { inlineExpanded: true } : {}),
            ...(nextPipRect ? { pipRect: nextPipRect } : {}),
            pipZOrder: nextZOrder,
            lastTouchedAt: Date.now(),
          };
        });
      });
    },
    [tabInstanceKeyFor],
  );

  const setDisplayMode = useCallback(
    (sessionKey: string, appKey: string, nextMode: McpUiDisplayMode) => {
      setDisplayModeByEntryKey(makeMcpAppEntryKey(sessionKey, appKey), nextMode);
    },
    [setDisplayModeByEntryKey],
  );

  const setInlineExpanded = useCallback((sessionKey: string, appKey: string, expanded: boolean) => {
    const entryKey = makeMcpAppEntryKey(sessionKey, appKey);
    setEntries((prev) =>
      prev.map((item) =>
        item.entryKey === entryKey && item.inlineExpanded !== expanded
          ? { ...item, inlineExpanded: expanded, lastTouchedAt: Date.now() }
          : item,
      ),
    );
  }, []);

  const handleInlineHeightChange = useCallback((entryKey: string, heightPx: number) => {
    beforeResizeCallbacksRef.current.get(entryKey)?.();
    setEntries((prev) =>
      prev.map((item) =>
        item.entryKey === entryKey && item.inlineHeightPx !== heightPx
          ? { ...item, inlineHeightPx: heightPx }
          : item,
      ),
    );
  }, []);

  const handlePipRectCommit = useCallback((entryKey: string, rect: McpAppPipRect) => {
    const clamped = clampPipRect(rect, readCurrentPipViewport());
    writeMcpAppPipGeometry(clamped);
    setEntries((prev) =>
      prev.map((item) =>
        item.entryKey === entryKey
          ? { ...item, pipRect: clamped, lastTouchedAt: Date.now() }
          : item,
      ),
    );
  }, []);

  const handlePipFocus = useCallback((entryKey: string) => {
    setEntries((prev) => {
      const target = prev.find((item) => item.entryKey === entryKey);
      if (!target || target.displayMode !== "pip") {
        return prev;
      }
      const maxZ = prev.reduce(
        (max, item) => (item.displayMode === "pip" ? Math.max(max, item.pipZOrder) : max),
        0,
      );
      if (target.pipZOrder === maxZ && maxZ > 0) {
        return prev;
      }
      const nextZ = Math.max(maxZ, pipZCounterRef.current) + 1;
      pipZCounterRef.current = nextZ;
      return prev.map((item) =>
        item.entryKey === entryKey ? { ...item, pipZOrder: nextZ } : item,
      );
    });
  }, []);

  const handleRequestComposerPrefill = useCallback(
    (text: string, appTitle: string) => {
      const bridge = conversationSurfaceVisibleRef.current ? pickActivePaneBridge() : null;
      if (bridge) {
        applyComposerPrefillWithBridge(bridge, text, appTitle);
        return;
      }
      pendingComposerPrefillRef.current = { text, appTitle };
      onEnsureConversationSurfaceRef.current?.();
    },
    [applyComposerPrefillWithBridge, pickActivePaneBridge],
  );

  const openExternalUrlWithFallback = useCallback(
    async (url: string) => {
      const paneHandler = pickActivePaneBridge()?.onOpenExternalUrl;
      if (paneHandler) {
        await paneHandler(url);
        return;
      }
      if (onOpenExternalUrlRef.current) {
        await onOpenExternalUrlRef.current(url);
        return;
      }
      const handled = await runtimeRef.current.openExtensionLink({ url });
      if (!handled && typeof window !== "undefined") {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    },
    [pickActivePaneBridge],
  );

  const handleRequestOpenLink = useCallback(
    async (
      rawUrl: string,
      options: { csp?: McpUiResourceCsp; extensionId?: string; appTitle: string },
    ) => {
      const parsed = validateMcpAppExternalUrl(rawUrl);
      if (!parsed) {
        throw new Error("Invalid or unsupported URL scheme");
      }
      const normalizedUrl = parsed.toString();
      if (
        isTrustedMcpAppExternalUrl(parsed, { csp: options.csp, extensionId: options.extensionId })
      ) {
        await openExternalUrlWithFallback(normalizedUrl);
        return;
      }
      await new Promise<void>((resolve, reject) => {
        openExternalLinkConfirm({
          appTitle: options.appTitle,
          url: normalizedUrl,
          resolve,
          reject,
        });
      });
    },
    [openExternalLinkConfirm, openExternalUrlWithFallback],
  );

  const settleExternalLinkConfirm = useCallback(
    (confirmed: boolean) => {
      if (!externalLinkConfirmOpenRef.current) {
        return;
      }
      const pending = externalLinkConfirmRef.current;
      externalLinkConfirmRef.current = null;
      externalLinkConfirmOpenRef.current = false;
      setExternalLinkConfirmOpen(false);
      runAfterRadixOverlayClose(() => {
        if (!externalLinkConfirmOpenRef.current) {
          setExternalLinkConfirm(null);
        }
      });
      if (!pending) {
        return;
      }
      if (confirmed) {
        void openExternalUrlWithFallback(pending.url).then(pending.resolve, pending.reject);
      } else {
        pending.reject(new Error("User cancelled link navigation"));
      }
    },
    [openExternalUrlWithFallback],
  );

  const handleRequestToolCallApproval = useCallback(
    async (input: {
      appTitle: string;
      server: string;
      tool: string;
      arguments?: Record<string, unknown>;
    }) => {
      let argumentsJson: string | undefined;
      if (input.arguments && Object.keys(input.arguments).length > 0) {
        try {
          argumentsJson = JSON.stringify(input.arguments, null, 2);
        } catch {
          argumentsJson = undefined;
        }
      }
      await new Promise<void>((resolve, reject) => {
        const entry: PendingToolCallApproval = {
          appTitle: input.appTitle,
          server: input.server,
          tool: input.tool,
          ...(argumentsJson ? { argumentsJson } : {}),
          resolve,
          reject,
        };
        toolCallApprovalQueueRef.current.push(entry);
        if (toolCallApprovalQueueRef.current.length === 1) {
          setDisplayedToolCallApproval(entry);
          setToolCallApprovalOpen(true);
        }
      });
    },
    [],
  );

  const settleActiveToolCallApproval = useCallback((approved: boolean) => {
    const current = toolCallApprovalQueueRef.current.shift();
    if (!current) {
      return;
    }
    const next = toolCallApprovalQueueRef.current[0] ?? null;
    if (next) {
      setDisplayedToolCallApproval(next);
      setToolCallApprovalOpen(true);
    } else {
      setToolCallApprovalOpen(false);
      runAfterRadixOverlayClose(() => {
        if (toolCallApprovalQueueRef.current.length === 0) {
          setDisplayedToolCallApproval(null);
        }
      });
    }
    if (approved) {
      current.resolve();
    } else {
      current.reject(new Error("User denied MCP App tool call"));
    }
  }, []);

  const getEntry = useCallback(
    (sessionKey: string, appKey: string) => {
      const entryKey = makeMcpAppEntryKey(sessionKey, appKey);
      return entries.find((item) => item.entryKey === entryKey);
    },
    [entries],
  );

  const globalContextValue = useMemo<McpAppGlobalHostContextValue>(
    () => ({
      registerApp,
      setSlotElement,
      setDisplayMode,
      setInlineExpanded,
      getEntry,
      registerPaneBridge,
    }),
    [getEntry, registerApp, registerPaneBridge, setDisplayMode, setInlineExpanded, setSlotElement],
  );

  return (
    <McpAppGlobalHostContext.Provider value={globalContextValue}>
      {children}

      <div
        ref={overlayLayerRef}
        data-spirit-surface="mcp-app-host-layer"
        className="pointer-events-none fixed inset-0 z-40 overflow-hidden"
      />
      <div
        ref={parkLayerRef}
        data-spirit-surface="mcp-app-park-layer"
        className="pointer-events-none invisible fixed -left-[99999px] top-0 h-0 w-0 overflow-hidden"
      />

      {entries.map((entry) =>
        createPortal(
          <McpAppIframeInstance
            entryKey={entry.entryKey}
            appKey={entry.appKey}
            tool={entry.tool}
            mcpApp={entry.mcpApp}
            sessionPath={entry.sessionPath}
            sandboxUrl={sandboxUrl}
            displayMode={entry.displayMode}
            runtime={runtime}
            isHiddenBySessionSwitch={false}
            onDisplayModeChange={setDisplayModeByEntryKey}
            onInlineHeightChange={handleInlineHeightChange}
            onRequestComposerPrefill={handleRequestComposerPrefill}
            onRequestOpenLink={handleRequestOpenLink}
            onRequestToolCallApproval={handleRequestToolCallApproval}
            registerWrapperElement={registerWrapperElement}
            registerEnsureBridgeWindow={registerEnsureBridgeWindow}
            pipRect={entry.pipRect}
            pipZOrder={entry.pipZOrder}
            onPipRectCommit={handlePipRectCommit}
            onPipFocus={handlePipFocus}
          />,
          entry.portalContainer,
          entry.entryKey,
        ),
      )}

      <Dialog
        open={draftConflictOpen}
        onOpenChange={(open) => {
          if (!open) {
            dismissDraftConflict();
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("mcpApp.draftConflictTitle")}</DialogTitle>
            <DialogDescription>
              {t("mcpApp.draftConflictDescription", {
                app: draftConflict?.appTitle ?? "",
              })}
            </DialogDescription>
          </DialogHeader>
          {draftConflict?.text ? (
            <div className="max-h-32 overflow-y-auto rounded-md border border-border bg-muted/40 p-2.5 text-xs whitespace-pre-wrap text-foreground">
              {draftConflict.text}
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={dismissDraftConflict}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (!draftConflictOpenRef.current || !draftConflict) {
                  return;
                }
                const bridge = pickActivePaneBridge();
                if (bridge) {
                  bridge.onAppendComposerText(draftConflict.text);
                  bridge.onFocusComposer();
                }
                dismissDraftConflict();
              }}
            >
              {t("mcpApp.appendDraft")}
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (!draftConflictOpenRef.current || !draftConflict) {
                  return;
                }
                const bridge = pickActivePaneBridge();
                if (bridge) {
                  bridge.onReplaceComposerText(draftConflict.text);
                  bridge.onFocusComposer();
                }
                dismissDraftConflict();
              }}
            >
              {t("mcpApp.replaceDraft")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={externalLinkConfirmOpen}
        onOpenChange={(open) => {
          if (!open) {
            settleExternalLinkConfirm(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("mcpApp.openExternalLinkTitle")}</DialogTitle>
            <DialogDescription>
              {t("mcpApp.openExternalLinkDescription", {
                app: externalLinkConfirm?.appTitle ?? "",
              })}
            </DialogDescription>
          </DialogHeader>
          {externalLinkConfirm?.url ? (
            <div className="break-all rounded-md border border-border bg-muted/40 p-2.5 font-mono text-xs text-foreground">
              {externalLinkConfirm.url}
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => settleExternalLinkConfirm(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button type="button" onClick={() => settleExternalLinkConfirm(true)}>
              {t("mcpApp.openLink")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={toolCallApprovalOpen}
        onOpenChange={(open) => {
          if (!open) {
            settleActiveToolCallApproval(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("mcpApp.toolApprovalTitle")}</DialogTitle>
            <DialogDescription>
              {t("mcpApp.toolApprovalDescription", {
                app: displayedToolCallApproval?.appTitle ?? "",
                server: displayedToolCallApproval?.server ?? "",
                tool: displayedToolCallApproval?.tool ?? "",
              })}
            </DialogDescription>
          </DialogHeader>
          {displayedToolCallApproval ? (
            <div className="space-y-2">
              <div className="rounded-md border border-border bg-muted/40 px-2.5 py-1.5 font-mono text-xs text-foreground">
                {displayedToolCallApproval.server} / {displayedToolCallApproval.tool}
              </div>
              {displayedToolCallApproval.argumentsJson ? (
                <pre className="max-h-40 overflow-y-auto rounded-md border border-border bg-muted/40 p-2.5 font-mono text-xs whitespace-pre-wrap break-words text-foreground">
                  {displayedToolCallApproval.argumentsJson}
                </pre>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => settleActiveToolCallApproval(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button type="button" onClick={() => settleActiveToolCallApproval(true)}>
              {t("mcpApp.toolApprovalAllow")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </McpAppGlobalHostContext.Provider>
  );
}

export interface McpAppPaneProviderProps {
  sessionKey: string;
  sessionPath?: string;
  sandboxUrl?: string;
  runtime: DesktopRuntime;
  pipBottomOffsetPx?: number;
  getCurrentComposerText: () => string;
  onReplaceComposerText: (text: string) => void;
  onAppendComposerText: (text: string) => void;
  onFocusComposer: () => void;
  onOpenExternalUrl: (url: string) => Promise<void>;
  children: ReactNode;
}

function McpAppPaneBridge({
  sessionKey,
  sessionPath,
  getCurrentComposerText,
  onReplaceComposerText,
  onAppendComposerText,
  onFocusComposer,
  onOpenExternalUrl,
  children,
}: Omit<McpAppPaneProviderProps, "sandboxUrl" | "runtime" | "pipBottomOffsetPx">) {
  const paneId = useId();
  const globalHost = useContext(McpAppGlobalHostContext)!;

  const callbacksRef = useRef({
    getCurrentComposerText,
    onReplaceComposerText,
    onAppendComposerText,
    onFocusComposer,
    onOpenExternalUrl,
  });
  useLayoutEffect(() => {
    callbacksRef.current = {
      getCurrentComposerText,
      onReplaceComposerText,
      onAppendComposerText,
      onFocusComposer,
      onOpenExternalUrl,
    };
  }, [
    getCurrentComposerText,
    onAppendComposerText,
    onFocusComposer,
    onOpenExternalUrl,
    onReplaceComposerText,
  ]);

  useLayoutEffect(() => {
    return globalHost.registerPaneBridge({
      paneId,
      sessionKey,
      getCurrentComposerText: () => callbacksRef.current.getCurrentComposerText(),
      onReplaceComposerText: (text) => callbacksRef.current.onReplaceComposerText(text),
      onAppendComposerText: (text) => callbacksRef.current.onAppendComposerText(text),
      onFocusComposer: () => callbacksRef.current.onFocusComposer(),
      onOpenExternalUrl: (url) => callbacksRef.current.onOpenExternalUrl(url),
    });
  }, [globalHost, paneId, sessionKey]);

  const registerApp = useCallback(
    (input: {
      appKey: string;
      tool: ToolBlockSnapshot;
      mcpApp: ToolExecutionMcpAppUi;
      initialHeightPx?: number;
    }) => {
      globalHost.registerApp({
        sessionKey,
        ...(sessionPath !== undefined ? { sessionPath } : {}),
        appKey: input.appKey,
        tool: input.tool,
        mcpApp: input.mcpApp,
        ...(input.initialHeightPx !== undefined ? { initialHeightPx: input.initialHeightPx } : {}),
      });
    },
    [globalHost, sessionKey, sessionPath],
  );

  const setSlotElement = useCallback(
    (appKey: string, element: HTMLDivElement | null, onBeforeResize?: (() => void) | null) => {
      globalHost.setSlotElement(sessionKey, appKey, element, onBeforeResize);
    },
    [globalHost, sessionKey],
  );

  const setDisplayMode = useCallback(
    (appKey: string, mode: McpUiDisplayMode) => {
      globalHost.setDisplayMode(sessionKey, appKey, mode);
    },
    [globalHost, sessionKey],
  );

  const setInlineExpanded = useCallback(
    (appKey: string, expanded: boolean) => {
      globalHost.setInlineExpanded(sessionKey, appKey, expanded);
    },
    [globalHost, sessionKey],
  );

  const getEntry = useCallback(
    (appKey: string) => globalHost.getEntry(sessionKey, appKey),
    [globalHost, sessionKey],
  );

  const contextValue = useMemo<McpAppPaneContextValue>(
    () => ({
      registerApp,
      setSlotElement,
      setDisplayMode,
      setInlineExpanded,
      getEntry,
    }),
    [getEntry, registerApp, setDisplayMode, setInlineExpanded, setSlotElement],
  );

  return <McpAppPaneContext.Provider value={contextValue}>{children}</McpAppPaneContext.Provider>;
}

export function McpAppPaneProvider(props: McpAppPaneProviderProps) {
  const existingGlobalHost = useContext(McpAppGlobalHostContext);
  if (existingGlobalHost) {
    return (
      <McpAppPaneBridge
        sessionKey={props.sessionKey}
        sessionPath={props.sessionPath}
        getCurrentComposerText={props.getCurrentComposerText}
        onReplaceComposerText={props.onReplaceComposerText}
        onAppendComposerText={props.onAppendComposerText}
        onFocusComposer={props.onFocusComposer}
        onOpenExternalUrl={props.onOpenExternalUrl}
      >
        {props.children}
      </McpAppPaneBridge>
    );
  }

  return (
    <McpAppGlobalHostProvider
      activeSessionKey={props.sessionKey}
      sandboxUrl={props.sandboxUrl}
      runtime={props.runtime}
      onOpenExternalUrl={props.onOpenExternalUrl}
    >
      <McpAppPaneBridge
        sessionKey={props.sessionKey}
        sessionPath={props.sessionPath}
        getCurrentComposerText={props.getCurrentComposerText}
        onReplaceComposerText={props.onReplaceComposerText}
        onAppendComposerText={props.onAppendComposerText}
        onFocusComposer={props.onFocusComposer}
        onOpenExternalUrl={props.onOpenExternalUrl}
      >
        {props.children}
      </McpAppPaneBridge>
    </McpAppGlobalHostProvider>
  );
}
