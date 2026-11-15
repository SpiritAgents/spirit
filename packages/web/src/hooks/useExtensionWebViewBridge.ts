import { useCallback, useEffect, useRef, type RefObject } from "react";

import {
  SPIRIT_EXTENSION_WEB_VIEW_EVENT,
  SPIRIT_EXTENSION_WEB_VIEW_REQUEST,
  SPIRIT_EXTENSION_WEB_VIEW_RESULT,
} from "@/lib/extension-tab-frame";
import {
  BROWSER_WEBVIEW_WEBPREFERENCES,
  waitForWebviewDomReady,
} from "@/lib/workspace-browser-webview";
import type {
  DesktopExtensionWebViewBounds,
  DesktopExtensionWebViewEvent,
  DesktopExtensionWebViewRequest,
  DesktopExtensionWebViewState,
  WorkspaceExtensionToolTab,
} from "@/types";

type LocalRegion = {
  bounds: DesktopExtensionWebViewBounds;
  visible: boolean;
  element: SpiritWebviewTag;
};

export function useExtensionWebViewBridge({
  tab,
  active,
  attempt,
  iframeRef,
  onWebView,
  subscribeEvents,
}: {
  tab: WorkspaceExtensionToolTab;
  active: boolean;
  attempt: number;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  onWebView?: (request: DesktopExtensionWebViewRequest) => Promise<unknown>;
  subscribeEvents?: (callback: (event: DesktopExtensionWebViewEvent) => void) => () => void;
}) {
  const regionsRef = useRef(new Map<string, LocalRegion>());
  const generationRef = useRef(0);
  const apiRef = useRef(onWebView);
  apiRef.current = onWebView;

  const layoutRegion = useCallback(
    (region: LocalRegion) => {
      const iframe = iframeRef.current;
      if (!iframe) {
        return;
      }
      const left = Math.max(0, region.bounds.x);
      const top = Math.max(0, region.bounds.y);
      const right = Math.min(iframe.clientWidth, region.bounds.x + region.bounds.width);
      const bottom = Math.min(iframe.clientHeight, region.bounds.y + region.bounds.height);
      const width = Math.max(0, right - left);
      const height = Math.max(0, bottom - top);
      const visible = active && region.visible && width > 0 && height > 0;
      Object.assign(region.element.style, {
        left: `${iframe.offsetLeft + left}px`,
        top: `${iframe.offsetTop + top}px`,
        width: `${width}px`,
        height: `${height}px`,
        visibility: visible ? "visible" : "hidden",
      });
    },
    [active, iframeRef],
  );

  const syncLayout = useCallback(() => {
    for (const region of regionsRef.current.values()) {
      layoutRegion(region);
    }
  }, [layoutRegion]);

  const handleRequest = useCallback(
    async (operation: string, payload: Record<string, unknown>) => {
      const api = apiRef.current;
      if (!api) {
        throw new Error("Native WebView is unavailable in this host.");
      }
      const generation = generationRef.current;
      if (operation === "create") {
        const initialRegion = {
          bounds: readBounds(payload.localRect),
          visible: payload.visible !== false,
        };
        const state = (await api({
          operation: "create",
          extensionId: tab.extensionId,
          contributionId: tab.contributionId,
          instanceId: tab.instanceId,
          url: typeof payload.url === "string" ? payload.url : "about:blank",
        })) as DesktopExtensionWebViewState;
        if (generation !== generationRef.current) {
          await api({ operation: "destroy", viewId: state.viewId });
          throw new Error("The extension tab was closed.");
        }
        const iframe = iframeRef.current;
        if (!iframe?.parentElement) {
          await api({ operation: "destroy", viewId: state.viewId });
          throw new Error("The extension tab has no webview container.");
        }
        const element = document.createElement("webview") as SpiritWebviewTag;
        element.setAttribute("src", "about:blank");
        element.setAttribute("partition", `extension-webview-${state.viewId}`);
        element.setAttribute("webpreferences", BROWSER_WEBVIEW_WEBPREFERENCES);
        element.setAttribute("data-extension-web-view-id", state.viewId);
        element.className = "electron-no-drag absolute";
        const region: LocalRegion = { ...initialRegion, element };
        regionsRef.current.set(state.viewId, region);
        iframe.parentElement.appendChild(element);
        layoutRegion(region);
        try {
          await waitForWebviewDomReady(element);
          if (generation !== generationRef.current) {
            throw new Error("The extension tab was closed.");
          }
          const attachedState = (await api({
            operation: "attach",
            viewId: state.viewId,
            guestWebContentsId: element.getWebContentsId(),
          })) as DesktopExtensionWebViewState;
          if (generation !== generationRef.current) {
            throw new Error("The extension tab was closed.");
          }
          return { viewId: state.viewId, state: attachedState };
        } catch (error) {
          if (regionsRef.current.get(state.viewId) === region) {
            regionsRef.current.delete(state.viewId);
            element.remove();
            await api({ operation: "destroy", viewId: state.viewId }).catch(() => undefined);
          }
          throw error;
        }
      }
      const viewId = String(payload.viewId ?? "");
      const region = regionsRef.current.get(viewId);
      if (!viewId || !region) {
        throw new Error("Native WebView is not owned by this extension tab.");
      }
      if (operation === "bounds") {
        region.bounds = readBounds(payload.localRect);
        region.visible = payload.visible !== false;
        layoutRegion(region);
        return undefined;
      }
      if (operation === "navigate") {
        return api({ operation: "navigate", viewId, url: String(payload.url ?? "") });
      }
      if (operation === "getState") {
        return api({ operation: "getState", viewId });
      }
      if (operation === "capture") {
        return api({ operation: "capture", viewId });
      }
      if (operation === "executeScript") {
        return api({ operation: "executeScript", viewId, code: String(payload.code ?? "") });
      }
      if (operation === "destroy") {
        try {
          return await api({ operation: "destroy", viewId });
        } finally {
          regionsRef.current.delete(viewId);
          region.element.remove();
        }
      }
      throw new Error(`Unknown native WebView operation: ${operation}`);
    },
    [iframeRef, layoutRegion, tab],
  );

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) {
      return;
    }
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(syncLayout);
    };
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(schedule);
    resizeObserver?.observe(iframe);
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [attempt, iframeRef, syncLayout]);

  useEffect(() => {
    syncLayout();
  }, [active, syncLayout]);

  useEffect(() => {
    if (!subscribeEvents) {
      return;
    }
    return subscribeEvents((event) => {
      if (
        event.extensionId !== tab.extensionId ||
        event.contributionId !== tab.contributionId ||
        event.instanceId !== tab.instanceId ||
        event.channelId !== tab.channelId
      ) {
        return;
      }
      iframeRef.current?.contentWindow?.postMessage(
        { type: SPIRIT_EXTENSION_WEB_VIEW_EVENT, ...event },
        "*",
      );
    });
  }, [iframeRef, subscribeEvents, tab]);

  useEffect(() => {
    const regions = regionsRef.current;
    return () => {
      generationRef.current += 1;
      for (const [viewId, region] of regions) {
        region.element.remove();
        void apiRef.current?.({ operation: "destroy", viewId }).catch(() => undefined);
      }
      regions.clear();
    };
  }, [attempt]);

  return useCallback(
    (data: Record<string, unknown>): boolean => {
      if (data.type !== SPIRIT_EXTENSION_WEB_VIEW_REQUEST) {
        return false;
      }
      const requestId = String(data.requestId ?? "");
      void handleRequest(String(data.operation ?? ""), data).then(
        (result) => {
          iframeRef.current?.contentWindow?.postMessage(
            { type: SPIRIT_EXTENSION_WEB_VIEW_RESULT, ...tab, requestId, ok: true, result },
            "*",
          );
        },
        (error: unknown) => {
          iframeRef.current?.contentWindow?.postMessage(
            {
              type: SPIRIT_EXTENSION_WEB_VIEW_RESULT,
              ...tab,
              requestId,
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            },
            "*",
          );
        },
      );
      return true;
    },
    [handleRequest, iframeRef, tab],
  );
}

function readBounds(value: unknown): DesktopExtensionWebViewBounds {
  const input = value as Partial<DesktopExtensionWebViewBounds> | undefined;
  return {
    x: finiteOrZero(input?.x),
    y: finiteOrZero(input?.y),
    width: Math.max(0, finiteOrZero(input?.width)),
    height: Math.max(0, finiteOrZero(input?.height)),
  };
}

function finiteOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
