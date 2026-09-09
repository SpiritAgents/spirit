// Copyright (c) 2026 N123999
// SPDX-License-Identifier: MIT

import { useEffect, useMemo, useRef, useState } from "react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  buildExtensionViewSrcdoc,
  extensionViewFileUrl,
  SPIRIT_EXTENSION_VIEW_CLOSE_MESSAGE,
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

  const open = openRequest !== null;
  const width = openRequest?.width;
  const height = openRequest?.height;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && openRequest) {
          dismissOpenExtensionView(openRequest.requestId);
        }
      }}
    >
      <DialogContent
        className="sm:max-w-lg"
        style={{
          ...(width ? { width, maxWidth: width } : {}),
          ...(height ? { height } : {}),
        }}
        aria-describedby={undefined}
      >
        <DialogHeader>
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
