import { useCallback, useEffect, useRef, type RefObject } from "react";

import {
  SPIRIT_EXTENSION_WEB_VIEW_EVENT,
  SPIRIT_EXTENSION_WEB_VIEW_REQUEST,
  SPIRIT_EXTENSION_WEB_VIEW_RESULT,
} from "@/lib/extension-tab-frame";
import type {
  DesktopExtensionWebViewBounds,
  DesktopExtensionWebViewEvent,
  DesktopExtensionWebViewRequest,
  DesktopExtensionWebViewState,
  WorkspaceExtensionToolTab,
} from "@/types";

type LocalRegion = { bounds: DesktopExtensionWebViewBounds; visible: boolean };

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
  const apiRef = useRef(onWebView);
  apiRef.current = onWebView;

  const computeLayout = useCallback(
    (region: LocalRegion) => {
      const iframe = iframeRef.current;
      if (!iframe) {
        return { bounds: region.bounds, visible: false };
      }
      const frame = iframe.getBoundingClientRect();
      const left = Math.max(frame.left, frame.left + region.bounds.x);
      const top = Math.max(frame.top, frame.top + region.bounds.y);
      const right = Math.min(frame.right, frame.left + region.bounds.x + region.bounds.width);
      const bottom = Math.min(frame.bottom, frame.top + region.bounds.y + region.bounds.height);
      const bounds = {
        x: left,
        y: top,
        width: Math.max(0, right - left),
        height: Math.max(0, bottom - top),
      };
      return {
        bounds,
        visible:
          active &&
          region.visible &&
          bounds.width > 0 &&
          bounds.height > 0 &&
          !isOccludedByHostOverlay(bounds),
      };
    },
    [active, iframeRef],
  );

  const syncBounds = useCallback(() => {
    const api = apiRef.current;
    if (!api) {
      return;
    }
    for (const [viewId, region] of regionsRef.current) {
      const layout = computeLayout(region);
      void api({ operation: "bounds", viewId, ...layout }).catch((error: unknown) => {
        console.error("[extensions] failed to update WebView bounds", error);
      });
    }
  }, [computeLayout]);

  const handleRequest = useCallback(
    async (operation: string, payload: Record<string, unknown>) => {
      const api = apiRef.current;
      if (!api) {
        throw new Error("Native WebView is unavailable in this host.");
      }
      if (operation === "create") {
        const region = {
          bounds: readBounds(payload.localRect),
          visible: payload.visible !== false,
        };
        const layout = computeLayout(region);
        const state = (await api({
          operation: "create",
          extensionId: tab.extensionId,
          contributionId: tab.contributionId,
          instanceId: tab.instanceId,
          url: typeof payload.url === "string" ? payload.url : "about:blank",
          ...layout,
        })) as DesktopExtensionWebViewState;
        regionsRef.current.set(state.viewId, region);
        return { viewId: state.viewId, state };
      }
      const viewId = String(payload.viewId ?? "");
      if (!viewId) {
        throw new Error("Native WebView viewId is required.");
      }
      if (operation === "bounds") {
        const region = {
          bounds: readBounds(payload.localRect),
          visible: payload.visible !== false,
        };
        regionsRef.current.set(viewId, region);
        const layout = computeLayout(region);
        return api({ operation: "bounds", viewId, ...layout });
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
        }
      }
      throw new Error(`Unknown native WebView operation: ${operation}`);
    },
    [computeLayout, tab],
  );

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) {
      return;
    }
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(syncBounds);
    };
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(schedule);
    resizeObserver?.observe(iframe);
    const mutationObserver = new MutationObserver(schedule);
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "data-state"],
    });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [attempt, iframeRef, syncBounds]);

  useEffect(() => {
    syncBounds();
  }, [active, syncBounds]);

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
      for (const viewId of regions.keys()) {
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

function isOccludedByHostOverlay(bounds: DesktopExtensionWebViewBounds): boolean {
  const overlays = document.querySelectorAll(
    '[data-slot="dialog-content"], [data-radix-popper-content-wrapper], [role="menu"], [role="alertdialog"]',
  );
  for (const overlay of overlays) {
    const rect = overlay.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      continue;
    }
    if (
      bounds.x < rect.right &&
      bounds.x + bounds.width > rect.left &&
      bounds.y < rect.bottom &&
      bounds.y + bounds.height > rect.top
    ) {
      return true;
    }
  }
  return false;
}
