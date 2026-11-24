import {
  AppBridge,
  PostMessageTransport,
  buildAllowAttribute,
  type McpUiDisplayMode,
  type McpUiResourceCsp,
  type McpUiResourcePermissions,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import type { CallToolResult } from "@modelcontextprotocol/client";
import type { ToolExecutionMcpAppUi } from "@spiritagent/agent-core";
import { X } from "@spiritagent/icons/x";
import { useDragResizeCursor } from "@spiritagent/ui/resize-cursor";
import { AlertCircle, Maximize2 } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTheme } from "@/hooks/useTheme";
import type { useDesktopRuntime } from "@/hooks/useDesktopRuntime";
import { DESKTOP_COMPOSER_EDGE, DESKTOP_ELEVATION_SHADOW_SM } from "@/lib/desktop-chrome";
import {
  buildMcpAppCallToolResult,
  buildMcpAppHostContext,
  extractMcpAppMessageText,
  extractMcpAppModelContext,
  parseMcpAppToolArguments,
} from "@/lib/mcp-apps/theme-tokens";
import { clampMcpAppInlineHeight, formatMcpAppTabTitle } from "@/lib/mcp-apps/pane-state";
import {
  movePipRect,
  pipResizeEdgeCursor,
  readCurrentPipViewport,
  resizePipRect,
  type McpAppPipRect,
  type McpAppPipResizeEdge,
} from "@/lib/mcp-apps/pip-geometry";
import { cn } from "@/lib/utils";
import type { ToolBlockSnapshot } from "@/types";

type DesktopRuntime = ReturnType<typeof useDesktopRuntime>;

const PIP_RESIZE_HANDLES: readonly {
  edge: McpAppPipResizeEdge;
  className: string;
}[] = [
  { edge: "n", className: "-top-1 left-2.5 right-2.5 h-2 z-10" },
  { edge: "s", className: "-bottom-1 left-2.5 right-2.5 h-2 z-10" },
  { edge: "e", className: "-right-1 top-2.5 bottom-2.5 w-2 z-10" },
  { edge: "w", className: "-left-1 top-2.5 bottom-2.5 w-2 z-10" },
  { edge: "nw", className: "-top-1 -left-1 size-3.5 z-20" },
  { edge: "ne", className: "-top-1 -right-1 size-3.5 z-20" },
  { edge: "sw", className: "-bottom-1 -left-1 size-3.5 z-20" },
  { edge: "se", className: "-bottom-1 -right-1 size-3.5 z-20" },
];

export interface McpAppInstanceProps {
  entryKey: string;
  appKey: string;
  tool: ToolBlockSnapshot;
  mcpApp: ToolExecutionMcpAppUi;
  sessionPath?: string;
  sandboxUrl?: string;
  displayMode: McpUiDisplayMode;
  runtime: DesktopRuntime;
  isHiddenBySessionSwitch: boolean;
  onDisplayModeChange: (entryKey: string, nextMode: McpUiDisplayMode) => void;
  onInlineHeightChange: (entryKey: string, heightPx: number) => void;
  onRequestComposerPrefill: (text: string, appTitle: string) => void;
  onRequestOpenLink: (
    rawUrl: string,
    options: { csp?: McpUiResourceCsp; extensionId?: string; appTitle: string },
  ) => Promise<void>;
  onRequestToolCallApproval: (input: {
    appTitle: string;
    server: string;
    tool: string;
    arguments?: Record<string, unknown>;
  }) => Promise<void>;
  registerWrapperElement: (entryKey: string, element: HTMLDivElement | null) => void;
  registerEnsureBridgeWindow: (entryKey: string, ensure: (() => void) | null) => void;
  pipRect?: McpAppPipRect;
  pipZOrder?: number;
  onPipRectCommit: (entryKey: string, rect: McpAppPipRect) => void;
  onPipFocus: (entryKey: string) => void;
}

const RECENT_USER_GESTURE_MS = 5000;

export function McpAppIframeInstance({
  entryKey,
  appKey,
  tool,
  mcpApp,
  sessionPath,
  sandboxUrl,
  displayMode,
  runtime,
  isHiddenBySessionSwitch,
  onDisplayModeChange,
  onInlineHeightChange,
  onRequestComposerPrefill,
  onRequestOpenLink,
  onRequestToolCallApproval,
  registerWrapperElement,
  registerEnsureBridgeWindow,
  pipRect,
  pipZOrder = 1,
  onPipRectCommit,
  onPipFocus,
}: McpAppInstanceProps) {
  const { t, i18n } = useTranslation();
  const { resolvedDark } = useTheme();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const connectedWindowRef = useRef<Window | null>(null);
  const bridgeEffectRanRef = useRef(false);
  const bridgeRef = useRef<AppBridge | null>(null);
  const initializedRef = useRef(false);
  const lastToolResultSignatureRef = useRef<string>("");
  const lastToolArgsSignatureRef = useRef<string>("");
  const cspRef = useRef<McpUiResourceCsp | undefined>(undefined);
  const lastGestureAtRef = useRef<number>(0);

  const [loadState, setLoadState] = useState<{
    runKey: string;
    status: "loading" | "ready" | "error";
    errorMessage: string | null;
  } | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  useLayoutEffect(() => {
    registerEnsureBridgeWindow(entryKey, () => {
      if (!bridgeEffectRanRef.current) {
        return;
      }
      const currentWindow = iframeRef.current?.contentWindow ?? null;
      if (currentWindow && currentWindow !== connectedWindowRef.current) {
        setReloadNonce((n) => n + 1);
      }
    });
    return () => {
      registerEnsureBridgeWindow(entryKey, null);
    };
  }, [entryKey, registerEnsureBridgeWindow]);

  const appTitle = formatMcpAppTabTitle(mcpApp);
  const runKey = `${sandboxUrl ?? ""}:${reloadNonce}`;
  const status: "loading" | "ready" | "error" = !sandboxUrl
    ? "error"
    : loadState?.runKey === runKey
      ? loadState.status
      : "loading";
  const errorMessage: string | null = !sandboxUrl
    ? t("mcpApp.sandboxUnavailable")
    : loadState?.runKey === runKey
      ? loadState.errorMessage
      : null;

  const latestRef = useRef({
    displayMode,
    resolvedDark,
    locale: i18n.language || "en",
    hostKind: runtime.hostKind,
    runtime,
    mcpApp,
    tool,
    sessionPath,
    onDisplayModeChange,
    onInlineHeightChange,
    onRequestComposerPrefill,
    onRequestOpenLink,
    onRequestToolCallApproval,
    appTitle,
  });
  useLayoutEffect(() => {
    latestRef.current = {
      displayMode,
      resolvedDark,
      locale: i18n.language || "en",
      hostKind: runtime.hostKind,
      runtime,
      mcpApp,
      tool,
      sessionPath,
      onDisplayModeChange,
      onInlineHeightChange,
      onRequestComposerPrefill,
      onRequestOpenLink,
      onRequestToolCallApproval,
      appTitle,
    };
  });

  const markUserGesture = useCallback(() => {
    lastGestureAtRef.current = Date.now();
  }, []);

  const buildHostContextFor = useCallback(
    (params: {
      mode: McpUiDisplayMode;
      dark: boolean;
      locale: string;
      hostKind: "electron" | "web" | null;
    }) => {
      const containerDimensions =
        params.mode === "inline"
          ? { maxHeight: 800 }
          : params.mode === "pip"
            ? { width: 380, height: 280 }
            : typeof window !== "undefined"
              ? { width: window.innerWidth, height: Math.max(240, window.innerHeight - 48) }
              : undefined;
      return buildMcpAppHostContext({
        resolvedDark: params.dark,
        displayMode: params.mode,
        locale: params.locale,
        hostKind: params.hostKind,
        containerDimensions,
      });
    },
    [],
  );

  const pushLatestToolData = useCallback(
    (bridge: AppBridge, currentTool: ToolBlockSnapshot, currentMcpApp: ToolExecutionMcpAppUi) => {
      const argsJson = currentMcpApp.argumentsJson ?? "";
      if (lastToolArgsSignatureRef.current !== argsJson) {
        lastToolArgsSignatureRef.current = argsJson;
        void bridge.sendToolInput({
          arguments: parseMcpAppToolArguments(argsJson),
        });
      }

      if (currentTool.phase === "succeeded" || currentTool.phase === "failed") {
        const fallbackText =
          currentTool.detailLines.length > 0
            ? currentTool.detailLines.join("\n")
            : currentTool.headline;
        const resultSig = JSON.stringify({
          phase: currentTool.phase,
          toolResult: currentMcpApp.toolResult ?? null,
          fallbackText,
        });
        if (lastToolResultSignatureRef.current !== resultSig) {
          lastToolResultSignatureRef.current = resultSig;
          if (currentTool.phase === "failed" && !currentMcpApp.toolResult) {
            void bridge.sendToolCancelled({
              reason: fallbackText || "Tool execution failed",
            });
          } else {
            void bridge.sendToolResult(
              buildMcpAppCallToolResult(
                currentMcpApp.toolResult,
                fallbackText,
                currentTool.phase === "failed",
              ),
            );
          }
        }
      }
    },
    [],
  );

  // Main AppBridge + double-iframe sandbox handshake. Keyed ONLY on sandboxUrl & reloadNonce
  // so mode switches (inline <-> pip <-> fullscreen) and theme changes never reload the iframe.
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !sandboxUrl) {
      return;
    }

    bridgeEffectRanRef.current = true;
    let cancelled = false;
    initializedRef.current = false;
    lastToolArgsSignatureRef.current = "";
    lastToolResultSignatureRef.current = "";
    cspRef.current = undefined;

    const contentWindow = iframe.contentWindow;
    if (!contentWindow) {
      connectedWindowRef.current = null;
      return;
    }
    connectedWindowRef.current = contentWindow;

    const initial = latestRef.current;
    const bridge = new AppBridge(
      null,
      { name: "Spirit", version: "1.0.0" },
      {
        openLinks: {},
        serverTools: {},
        serverResources: {},
        logging: {},
        message: { text: {} },
        updateModelContext: { text: {}, structuredContent: {} },
        sandbox: {
          csp: {},
          permissions: {
            clipboardWrite: {},
          },
        },
      },
      {
        hostContext: buildHostContextFor({
          mode: initial.displayMode,
          dark: initial.resolvedDark,
          locale: initial.locale,
          hostKind: initial.hostKind,
        }),
      },
    );
    bridgeRef.current = bridge;

    let resolveSandboxReady: (() => void) | null = null;
    const sandboxReadyPromise = new Promise<void>((resolve) => {
      resolveSandboxReady = resolve;
    });

    bridge.addEventListener("sandboxready", () => {
      resolveSandboxReady?.();
      resolveSandboxReady = null;
    });

    bridge.addEventListener("initialized", () => {
      if (cancelled) {
        return;
      }
      initializedRef.current = true;
      setLoadState({ runKey, status: "ready", errorMessage: null });
      const current = latestRef.current;
      bridge.setHostContext(
        buildHostContextFor({
          mode: current.displayMode,
          dark: current.resolvedDark,
          locale: current.locale,
          hostKind: current.hostKind,
        }),
      );
      pushLatestToolData(bridge, current.tool, current.mcpApp);
    });

    bridge.addEventListener("sizechange", (params) => {
      if (cancelled) {
        return;
      }
      if (latestRef.current.displayMode !== "inline") {
        return;
      }
      if (
        typeof params.height === "number" &&
        Number.isFinite(params.height) &&
        params.height > 0
      ) {
        latestRef.current.onInlineHeightChange(entryKey, clampMcpAppInlineHeight(params.height));
      }
    });

    bridge.oncalltool = async (params) => {
      const current = latestRef.current;
      const response = await current.runtime.mcpAppCallTool({
        server: current.mcpApp.server,
        tool: params.name,
        ...(params.arguments ? { arguments: params.arguments } : {}),
        ...(current.sessionPath ? { sessionPath: current.sessionPath } : {}),
      });
      if (response.status === "ok") {
        return response.result as CallToolResult;
      }
      await current.onRequestToolCallApproval({
        appTitle: current.appTitle,
        server: response.server,
        tool: response.tool,
        ...(params.arguments ? { arguments: params.arguments } : {}),
      });
      const approvedResponse = await latestRef.current.runtime.mcpAppCallTool({
        server: latestRef.current.mcpApp.server,
        tool: params.name,
        ...(params.arguments ? { arguments: params.arguments } : {}),
        ...(latestRef.current.sessionPath ? { sessionPath: latestRef.current.sessionPath } : {}),
        approved: true,
      });
      if (approvedResponse.status !== "ok") {
        throw new Error(`MCP App tool call not approved: ${response.server}/${response.tool}`);
      }
      return approvedResponse.result as CallToolResult;
    };

    bridge.onreadresource = async (params) => {
      const current = latestRef.current;
      const resource = await current.runtime.mcpAppReadResource({
        server: current.mcpApp.server,
        uri: params.uri,
        ...(current.sessionPath ? { sessionPath: current.sessionPath } : {}),
      });
      return {
        contents: [
          {
            uri: resource.uri,
            mimeType: resource.mimeType,
            text: resource.html,
          },
        ],
      };
    };

    bridge.onupdatemodelcontext = async (params) => {
      const current = latestRef.current;
      const extracted = extractMcpAppModelContext(params);
      const structuredRecord =
        extracted.structuredContent &&
        typeof extracted.structuredContent === "object" &&
        !Array.isArray(extracted.structuredContent)
          ? (extracted.structuredContent as Record<string, unknown>)
          : undefined;
      await current.runtime.mcpAppUpdateModelContext({
        appId: appKey,
        server: current.mcpApp.server,
        toolName: current.mcpApp.toolName,
        ...(extracted.text ? { text: extracted.text } : {}),
        ...(structuredRecord ? { structuredContent: structuredRecord } : {}),
        ...(current.sessionPath ? { sessionPath: current.sessionPath } : {}),
      });
      return {};
    };

    bridge.onmessage = async (params) => {
      const text = extractMcpAppMessageText(params.content);
      if (!text) {
        return { isError: true };
      }
      latestRef.current.onRequestComposerPrefill(text, appTitle);
      return {};
    };

    bridge.onopenlink = async (params) => {
      try {
        await latestRef.current.onRequestOpenLink(params.url, {
          csp: cspRef.current,
          extensionId: latestRef.current.mcpApp.extensionId,
          appTitle,
        });
        return {};
      } catch {
        return { isError: true };
      }
    };

    bridge.onrequestdisplaymode = async (params) => {
      const requested = params.mode;
      const current = latestRef.current.displayMode;
      if (requested !== "inline" && requested !== "pip" && requested !== "fullscreen") {
        return { mode: current };
      }
      if (requested !== "inline" && current === "inline") {
        const hasRecentWrapperGesture =
          Date.now() - lastGestureAtRef.current <= RECENT_USER_GESTURE_MS;
        // Pointer/keyboard events inside a cross-origin iframe never bubble to the
        // parent wrapper; Chromium propagates transient user activation up to the
        // host window and focuses the outer <iframe> element when the user interacts inside it.
        const hasIframeUserActivation =
          Boolean(navigator.userActivation?.isActive) &&
          document.activeElement === iframeRef.current;
        if (!hasRecentWrapperGesture && !hasIframeUserActivation) {
          return { mode: current };
        }
      }
      latestRef.current.onDisplayModeChange(entryKey, requested);
      return { mode: requested };
    };

    const transport = new PostMessageTransport(contentWindow, contentWindow);
    let connected = false;

    void (async () => {
      try {
        await bridge.connect(transport);
        if (cancelled) {
          void bridge.close().catch(() => {});
          return;
        }
        connected = true;

        // Read resource metadata first so `iframe.allow` is applied before navigating
        // to the cross-origin sandbox proxy (Permissions-Policy is computed at navigation time).
        const current = latestRef.current;
        const resource = await current.runtime.mcpAppReadResource({
          server: current.mcpApp.server,
          uri: current.mcpApp.resourceUri,
          ...(current.sessionPath ? { sessionPath: current.sessionPath } : {}),
        });
        if (cancelled) {
          return;
        }

        const csp = resource.uiMeta?.csp;
        const permissions = resource.uiMeta?.permissions as McpUiResourcePermissions | undefined;
        cspRef.current = csp;

        const allowAttr = buildAllowAttribute(permissions);
        if (allowAttr) {
          iframe.allow = allowAttr;
        } else {
          iframe.removeAttribute("allow");
        }

        iframe.src = sandboxUrl;
        await sandboxReadyPromise;
        if (cancelled) {
          return;
        }

        await bridge.sendSandboxResourceReady({
          html: resource.html,
          ...(csp ? { csp } : {}),
          ...(permissions ? { permissions } : {}),
        });
      } catch (error) {
        if (cancelled) {
          return;
        }
        setLoadState({
          runKey,
          status: "error",
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      }
    })();

    return () => {
      cancelled = true;
      initializedRef.current = false;
      bridgeRef.current = null;
      if (connectedWindowRef.current === contentWindow) {
        connectedWindowRef.current = null;
      }
      if (connected) {
        void bridge.teardownResource({}).catch(() => {});
      }
      // PostMessageTransport.start() attaches its window "message" listener synchronously
      // inside bridge.connect(); always close transport + bridge unconditionally so
      // StrictMode cleanup before connect() settles never leaks a duplicate listener.
      void transport.close().catch(() => {});
      void bridge.close().catch(() => {});
      iframe.src = "about:blank";
    };
  }, [appKey, appTitle, buildHostContextFor, entryKey, pushLatestToolData, runKey, sandboxUrl]);

  // Push live theme / locale / displayMode updates without remounting the iframe.
  useEffect(() => {
    const bridge = bridgeRef.current;
    if (!bridge || !initializedRef.current) {
      return;
    }
    bridge.setHostContext(
      buildHostContextFor({
        mode: displayMode,
        dark: resolvedDark,
        locale: i18n.language || "en",
        hostKind: runtime.hostKind,
      }),
    );
  }, [buildHostContextFor, displayMode, i18n.language, resolvedDark, runtime.hostKind]);

  // Push tool input / result updates when streaming completes.
  useEffect(() => {
    const bridge = bridgeRef.current;
    if (!bridge || !initializedRef.current) {
      return;
    }
    pushLatestToolData(bridge, tool, mcpApp);
  }, [mcpApp, pushLatestToolData, tool]);

  const dragCursor = useDragResizeCursor();
  const [viewport, setViewport] = useState(readCurrentPipViewport);
  const [livePipRect, setLivePipRect] = useState<McpAppPipRect | null>(null);
  const [isPointerInteracting, setIsPointerInteracting] = useState(false);

  const pipDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startRect: McpAppPipRect;
    latestRect: McpAppPipRect;
  } | null>(null);

  const pipResizeRef = useRef<{
    pointerId: number;
    edge: McpAppPipResizeEdge;
    startX: number;
    startY: number;
    startRect: McpAppPipRect;
    latestRect: McpAppPipRect;
  } | null>(null);

  useEffect(() => {
    if (displayMode !== "pip") {
      dragCursor.end();
      pipDragRef.current = null;
      pipResizeRef.current = null;
      return;
    }
    const handleResize = () => {
      setViewport(readCurrentPipViewport());
    };
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [displayMode, dragCursor]);

  const activePipRect = displayMode === "pip" ? (livePipRect ?? pipRect) : undefined;
  const pointerInteracting = displayMode === "pip" && isPointerInteracting;

  const handleRetry = useCallback(() => {
    markUserGesture();
    setReloadNonce((n) => n + 1);
  }, [markUserGesture]);

  const handleSetMode = useCallback(
    (nextMode: McpUiDisplayMode) => {
      markUserGesture();
      onDisplayModeChange(entryKey, nextMode);
    },
    [entryKey, markUserGesture, onDisplayModeChange],
  );

  const wrapperRefCallback = useCallback(
    (node: HTMLDivElement | null) => {
      registerWrapperElement(entryKey, node);
    },
    [entryKey, registerWrapperElement],
  );

  const handleWrapperPointerDown = useCallback(() => {
    markUserGesture();
    if (displayMode === "pip") {
      onPipFocus(entryKey);
    }
  }, [displayMode, entryKey, markUserGesture, onPipFocus]);

  const handlePipHeaderPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (displayMode !== "pip" || !activePipRect || event.button !== 0) {
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("button, a, input, textarea, select, [role='button']")) {
        return;
      }
      event.preventDefault();
      markUserGesture();
      onPipFocus(entryKey);
      pipDragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startRect: activePipRect,
        latestRect: activePipRect,
      };
      setLivePipRect(activePipRect);
      setIsPointerInteracting(true);
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Synthetic pointer events in tests may not support pointer capture.
      }
    },
    [activePipRect, displayMode, entryKey, markUserGesture, onPipFocus],
  );

  const handlePipHeaderPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = pipDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    const next = movePipRect(
      drag.startRect,
      event.clientX - drag.startX,
      event.clientY - drag.startY,
      readCurrentPipViewport(),
    );
    drag.latestRect = next;
    setLivePipRect(next);
  }, []);

  const endPipHeaderDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = pipDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) {
        return;
      }
      pipDragRef.current = null;
      setIsPointerInteracting(false);
      setLivePipRect(null);
      onPipRectCommit(entryKey, drag.latestRect);
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // already released
      }
    },
    [entryKey, onPipRectCommit],
  );

  const handleResizePointerDown = useCallback(
    (edge: McpAppPipResizeEdge, event: ReactPointerEvent<HTMLDivElement>) => {
      if (displayMode !== "pip" || !activePipRect || event.button !== 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      markUserGesture();
      onPipFocus(entryKey);
      const currentViewport = readCurrentPipViewport();
      setViewport(currentViewport);
      dragCursor.start(pipResizeEdgeCursor(activePipRect, edge, currentViewport));
      pipResizeRef.current = {
        pointerId: event.pointerId,
        edge,
        startX: event.clientX,
        startY: event.clientY,
        startRect: activePipRect,
        latestRect: activePipRect,
      };
      setLivePipRect(activePipRect);
      setIsPointerInteracting(true);
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Synthetic pointer events in tests may not support pointer capture.
      }
    },
    [activePipRect, displayMode, dragCursor, entryKey, markUserGesture, onPipFocus],
  );

  const handleResizePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const resize = pipResizeRef.current;
      if (!resize || resize.pointerId !== event.pointerId) {
        return;
      }
      const currentViewport = readCurrentPipViewport();
      const next = resizePipRect(
        resize.startRect,
        resize.edge,
        event.clientX - resize.startX,
        event.clientY - resize.startY,
        currentViewport,
      );
      dragCursor.update(pipResizeEdgeCursor(next, resize.edge, currentViewport));
      resize.latestRect = next;
      setLivePipRect(next);
    },
    [dragCursor],
  );

  const endPipResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const resize = pipResizeRef.current;
      if (!resize || resize.pointerId !== event.pointerId) {
        return;
      }
      dragCursor.end();
      pipResizeRef.current = null;
      setIsPointerInteracting(false);
      setLivePipRect(null);
      onPipRectCommit(entryKey, resize.latestRect);
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // already released
      }
    },
    [dragCursor, entryKey, onPipRectCommit],
  );

  const wrapperClassName = useMemo(() => {
    if (isHiddenBySessionSwitch) {
      return "pointer-events-none invisible flex h-full w-full flex-col overflow-hidden bg-transparent text-foreground";
    }
    if (displayMode === "fullscreen") {
      return "pointer-events-auto relative flex h-full w-full flex-col overflow-hidden bg-background text-foreground";
    }
    if (displayMode === "pip") {
      return "pointer-events-auto electron-no-drag absolute flex flex-col overflow-visible text-foreground";
    }
    return "pointer-events-auto relative flex h-full w-full flex-col overflow-hidden bg-transparent text-foreground";
  }, [displayMode, isHiddenBySessionSwitch]);

  const innerSurfaceClassName = useMemo(() => {
    if (displayMode === "pip") {
      return cn(
        "flex h-full w-full min-h-0 flex-1 flex-col overflow-hidden rounded-xl bg-card text-foreground",
        DESKTOP_COMPOSER_EDGE,
        DESKTOP_ELEVATION_SHADOW_SM,
      );
    }
    return "flex h-full w-full min-h-0 flex-1 flex-col overflow-hidden bg-transparent";
  }, [displayMode]);

  const wrapperInlineStyle = useMemo(() => {
    if (isHiddenBySessionSwitch) {
      return undefined;
    }
    if (displayMode === "pip" && activePipRect) {
      return {
        left: `${activePipRect.x}px`,
        top: `${activePipRect.y}px`,
        width: `${activePipRect.width}px`,
        height: `${activePipRect.height}px`,
        zIndex: pipZOrder,
      };
    }
    return undefined;
  }, [activePipRect, displayMode, isHiddenBySessionSwitch, pipZOrder]);

  return (
    <div
      ref={wrapperRefCallback}
      data-spirit-mcp-app-instance={appKey}
      data-spirit-mcp-app-mode={displayMode}
      data-spirit-mcp-app-status={status}
      className={wrapperClassName}
      style={wrapperInlineStyle}
      onPointerDown={handleWrapperPointerDown}
      onKeyDown={markUserGesture}
    >
      <div className={innerSurfaceClassName}>
        {displayMode === "pip" ? (
          <div
            data-spirit-mcp-app-header="pip"
            className="electron-no-drag flex h-8 shrink-0 cursor-default select-none items-center justify-between gap-2 border-b border-border/70 bg-background px-2.5 touch-none"
            onPointerDown={handlePipHeaderPointerDown}
            onPointerMove={handlePipHeaderPointerMove}
            onPointerUp={endPipHeaderDrag}
            onPointerCancel={endPipHeaderDrag}
          >
            <div className="flex min-w-0 items-center">
              <span className="truncate text-xs font-normal text-foreground">{appTitle}</span>
            </div>

            <div className="flex shrink-0 items-center gap-0.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t("mcpApp.fullscreen")}
                    onClick={() => handleSetMode("fullscreen")}
                  >
                    <Maximize2 className="size-3.5" strokeWidth={1.75} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("mcpApp.fullscreen")}</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t("mcpApp.returnInline")}
                    onClick={() => handleSetMode("inline")}
                  >
                    <X className="size-3.5" strokeWidth={1.75} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("mcpApp.returnInline")}</TooltipContent>
              </Tooltip>
            </div>
          </div>
        ) : null}

        <div
          className={cn(
            "relative min-h-0 flex-1 overflow-hidden",
            displayMode === "pip" ? "bg-card" : "bg-transparent",
          )}
        >
          {/* Outer sandbox proxy runs on a separate cross-origin loopback origin (MCP Apps double-iframe isolation); inner app iframe omits allow-same-origin. */}
          <iframe
            ref={iframeRef}
            title={appTitle}
            // oxlint-disable-next-line react/iframe-missing-sandbox
            sandbox="allow-scripts allow-same-origin allow-forms"
            src="about:blank"
            className={cn(
              "block h-full w-full border-0 bg-transparent",
              status === "error" && "invisible",
              pointerInteracting && "pointer-events-none",
            )}
          />

          {status === "loading" ? (
            <div
              className={cn(
                "pointer-events-none absolute inset-0 flex items-center justify-center gap-2 text-xs text-muted-foreground",
                displayMode === "pip" ? "bg-card/85" : "bg-transparent",
              )}
            >
              <Spinner className="size-3.5" />
              <span>{t("mcpApp.loading")}</span>
            </div>
          ) : null}

          {status === "error" ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
              <AlertCircle className="size-4 text-destructive" strokeWidth={1.75} />
              <p className="text-xs font-medium text-foreground">{t("mcpApp.loadFailed")}</p>
              {errorMessage ? (
                <p className="max-w-sm break-words text-[11px] text-muted-foreground">
                  {errorMessage}
                </p>
              ) : null}
              <Button type="button" variant="outline" size="sm" onClick={handleRetry}>
                {t("mcpApp.retry")}
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      {displayMode === "pip" && activePipRect
        ? PIP_RESIZE_HANDLES.map(({ edge, className }) => (
            <div
              key={edge}
              aria-hidden
              data-spirit-mcp-app-resize-handle={edge}
              className={cn("electron-no-drag absolute touch-none select-none", className)}
              style={{ cursor: pipResizeEdgeCursor(activePipRect, edge, viewport) }}
              onPointerDown={(event) => handleResizePointerDown(edge, event)}
              onPointerMove={handleResizePointerMove}
              onPointerUp={endPipResize}
              onPointerCancel={endPipResize}
            />
          ))
        : null}
    </div>
  );
}
