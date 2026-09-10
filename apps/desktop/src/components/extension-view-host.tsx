// Copyright (c) 2026 N123999
// SPDX-License-Identifier: MIT

import { useEffect, useMemo, useRef, useState } from "react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  buildExtensionViewSrcdoc,
  extensionViewFileUrl,
  SPIRIT_EXTENSION_VIEW_CLOSE_MESSAGE,
  SPIRIT_EXTENSION_VIEW_READY_MESSAGE,
  SPIRIT_EXTENSION_VIEW_THEME_MESSAGE,
} from "@/lib/extension-view-frame";
import {
  closeAllOpenExtensionViews,
  closeOpenExtensionViewsForExtension,
  dismissOpenExtensionView,
  getOpenExtensionView,
  openExtensionView,
  resolveOpenExtensionView,
  subscribeOpenExtensionView,
} from "@/lib/extension-view-runtime";
import {
  collectHostDocumentChrome,
  collectHostStylesheetCssText,
} from "@/lib/extension-view-tokens";
import { cn } from "@/lib/utils";
import type { DesktopExtensionListItem, DesktopPendingExtensionUi } from "@/types";

export function ExtensionViewHost({
  extensionsList,
  sessionKey,
  hostRequest,
  onHostResult,
}: {
  extensionsList?: readonly DesktopExtensionListItem[];
  sessionKey?: string | null;
  hostRequest?: DesktopPendingExtensionUi | null;
  onHostResult?: (requestId: string, result: unknown) => void;
}) {
  const [openRequest, setOpenRequest] = useState(getOpenExtensionView);
  const [readyRequestId, setReadyRequestId] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const previousSessionKey = useRef(sessionKey ?? null);
  const hostOpenedRequestId = useRef<string | null>(null);

  useEffect(() => subscribeOpenExtensionView(() => setOpenRequest(getOpenExtensionView())), []);

  useEffect(() => {
    if (!hostRequest) {
      const openedId = hostOpenedRequestId.current;
      hostOpenedRequestId.current = null;
      if (openedId) {
        dismissOpenExtensionView(openedId);
      }
      return;
    }
    const existing = getOpenExtensionView();
    if (existing?.requestId === hostRequest.requestId) {
      return;
    }
    const requestId = hostRequest.requestId;
    hostOpenedRequestId.current = requestId;
    const view = extensionsList
      ?.find((item) => item.id === hostRequest.extensionId)
      ?.desktopViews?.find((entry) => entry.id === hostRequest.viewId);
    void openExtensionView({
      requestId,
      extensionId: hostRequest.extensionId,
      viewId: hostRequest.viewId,
      viewUrl: extensionViewFileUrl(hostRequest.extensionId, hostRequest.viewId),
      title: hostRequest.title ?? view?.title,
      ...(hostRequest.width === undefined && view?.width === undefined
        ? {}
        : { width: hostRequest.width ?? view?.width }),
      ...(hostRequest.height === undefined && view?.height === undefined
        ? {}
        : { height: hostRequest.height ?? view?.height }),
      ...(hostRequest.chrome === undefined && view?.chrome === undefined
        ? {}
        : { chrome: hostRequest.chrome ?? view?.chrome }),
      params: hostRequest.params,
    }).then(
      (result) => onHostResult?.(requestId, result),
      () => onHostResult?.(requestId, { dismissed: true }),
    );
  }, [hostRequest, extensionsList, onHostResult]);

  useEffect(() => {
    const open = getOpenExtensionView();
    if (!open || !extensionsList) {
      return;
    }
    const item = extensionsList.find((entry) => entry.id === open.extensionId);
    if (!item?.enabled) {
      closeOpenExtensionViewsForExtension(open.extensionId);
    }
  }, [extensionsList]);

  useEffect(() => {
    const previous = previousSessionKey.current;
    const next = sessionKey ?? null;
    previousSessionKey.current = next;
    if (previous && previous !== next) {
      closeAllOpenExtensionViews();
    }
  }, [sessionKey]);

  useEffect(() => () => closeAllOpenExtensionViews(), []);

  const srcdoc = useMemo(() => {
    if (!openRequest) {
      return "";
    }
    return buildExtensionViewSrcdoc({
      cssText: collectHostStylesheetCssText(),
      chrome: collectHostDocumentChrome(),
      viewUrl: openRequest.viewUrl,
      params: openRequest.params,
      requestId: openRequest.requestId,
    });
  }, [openRequest]);

  useEffect(() => {
    if (!openRequest) {
      return;
    }

    const syncTheme = () => {
      const iframeWindow = iframeRef.current?.contentWindow;
      if (!iframeWindow) {
        return;
      }
      const chrome = collectHostDocumentChrome();
      iframeWindow.postMessage(
        {
          type: SPIRIT_EXTENSION_VIEW_THEME_MESSAGE,
          htmlClassName: chrome.htmlClassName,
          htmlStyle: chrome.htmlStyle,
        },
        "*",
      );
    };

    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });

    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) {
        return;
      }
      if (event.data?.type === SPIRIT_EXTENSION_VIEW_READY_MESSAGE) {
        if (event.data.requestId === openRequest.requestId) {
          setReadyRequestId(event.data.requestId);
        }
        return;
      }
      if (event.data?.type !== SPIRIT_EXTENSION_VIEW_CLOSE_MESSAGE) {
        return;
      }
      resolveOpenExtensionView(openRequest.requestId, event.data.result);
    };
    window.addEventListener("message", onMessage);
    return () => {
      observer.disconnect();
      window.removeEventListener("message", onMessage);
    };
  }, [openRequest]);

  useEffect(() => {
    if (!openRequest) {
      return;
    }
    // The view signals readiness via SPIRIT_EXTENSION_VIEW_READY_MESSAGE. If the frame
    // process dies or the view module never executes, no signal arrives and the pending
    // tool call would hang with no visible dialog to dismiss; this timeout is the single
    // fallback that opens the (possibly blank) dialog so the user can close it.
    const timer = window.setTimeout(() => setReadyRequestId(openRequest.requestId), 3000);
    return () => window.clearTimeout(timer);
  }, [openRequest]);

  const frameReady = openRequest !== null && readyRequestId === openRequest.requestId;
  const open = openRequest !== null && frameReady;
  const width = openRequest?.width;
  const height = openRequest?.height;
  const chrome = openRequest?.chrome ?? "default";
  const hideTitle = chrome === "close-only" || chrome === "none";
  const showCloseButton = chrome !== "none";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Only a visible dialog can be dismissed; while the view is still loading
        // (force-mounted but hidden), outside clicks and Escape must not cancel it.
        if (!next && openRequest && frameReady) {
          dismissOpenExtensionView(openRequest.requestId);
        }
      }}
    >
      <DialogContent
        className={cn("sm:max-w-lg", openRequest !== null && !frameReady && "hidden")}
        overlayClassName={openRequest !== null && !frameReady ? "hidden" : undefined}
        forceMount={(openRequest !== null) || undefined}
        style={{
          ...(width ? { width, maxWidth: width } : {}),
          ...(height ? { height } : {}),
        }}
        showCloseButton={showCloseButton}
        aria-describedby={undefined}
      >
        <DialogHeader className={hideTitle ? "sr-only" : undefined}>
          <DialogTitle>{openRequest?.title ?? openRequest?.viewId ?? "Extension"}</DialogTitle>
        </DialogHeader>
        {openRequest ? (
          <iframe
            ref={iframeRef}
            title={openRequest.title ?? openRequest.viewId}
            sandbox="allow-scripts"
            srcDoc={srcdoc}
            className="h-full min-h-64 w-full rounded-lg border-0 bg-background"
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
