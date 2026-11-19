import { openExtensionDetails } from "@/lib/extension-navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  extensionPageUrl,
  matchesExtensionPageIdentity,
  EXTENSION_PAGE_READY_REQUEST,
  EXTENSION_PAGE_READY,
  EXTENSION_PAGE_ERROR,
  EXTENSION_PAGE_CONTEXT,
  EXTENSION_PAGE_REQUEST,
  EXTENSION_PAGE_RESULT,
  EXTENSION_PAGE_CLOSED,
  EXTENSION_PAGE_CLOSE,
  EXTENSION_PAGE_SIZE,
} from "@/lib/extension-page-frame";
import {
  closeAllOpenExtensionViews,
  closeOpenExtensionViewsForExtension,
  dismissOpenExtensionView,
  getOpenExtensionView,
  openExtensionView,
  resolveOpenExtensionView,
  subscribeOpenExtensionView,
  updateOpenExtensionView,
} from "@/lib/extension-view-runtime";
import { collectHostDocumentChrome, collectHostThemeCssText } from "@/lib/extension-view-tokens";
import { RADIX_OVERLAY_CLOSE_MS } from "@/lib/overlay-motion";
import type { DesktopExtensionListItem, DesktopPendingExtensionUi } from "@/types";

export function ExtensionViewHost({
  extensionsList,
  sessionKey,
  hostRequest,
  onHostResult,
  onRequest,
}: {
  extensionsList?: readonly DesktopExtensionListItem[];
  sessionKey?: string | null;
  hostRequest?: DesktopPendingExtensionUi | null;
  onHostResult?: (requestId: string, result: unknown) => void;
  onRequest?: (request: {
    extensionId: string;
    viewId: string;
    requestId: string;
    method: string;
    params?: unknown;
  }) => Promise<unknown>;
}) {
  const { t, i18n } = useTranslation();
  const [openRequest, setOpenRequest] = useState(getOpenExtensionView);
  const [dialogOpen, setDialogOpen] = useState(Boolean(openRequest));
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [frameHeight, setFrameHeight] = useState<number>();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const previousSessionKey = useRef(sessionKey ?? null);
  const hostOpenedRequestId = useRef<string | null>(null);
  const exitHoldTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = subscribeOpenExtensionView(() => {
      const next = getOpenExtensionView();
      clearTimeout(exitHoldTimer.current);
      setDialogOpen(Boolean(next));
      if (next) setOpenRequest(next);
      else exitHoldTimer.current = setTimeout(() => setOpenRequest(null), RADIX_OVERLAY_CLOSE_MS);
    });
    return () => {
      unsubscribe();
      clearTimeout(exitHoldTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!hostRequest) {
      const openedId = hostOpenedRequestId.current;
      hostOpenedRequestId.current = null;
      if (openedId) dismissOpenExtensionView(openedId);
      return;
    }
    const existing = getOpenExtensionView();
    if (existing?.requestId === hostRequest.requestId) {
      if (existing.params !== hostRequest.params)
        updateOpenExtensionView(existing.requestId, hostRequest.params);
      return;
    }
    hostOpenedRequestId.current = hostRequest.requestId;
    const view = extensionsList
      ?.find((item) => item.id === hostRequest.extensionId)
      ?.desktopViews?.find((entry) => entry.id === hostRequest.viewId);
    void openExtensionView({
      ...view,
      ...hostRequest,
      title: hostRequest.title ?? view?.title,
      width: hostRequest.width ?? view?.width,
      height: hostRequest.height ?? view?.height,
      chrome: hostRequest.chrome ?? view?.chrome,
    }).then(
      (result) => onHostResult?.(hostRequest.requestId, result),
      () => onHostResult?.(hostRequest.requestId, { dismissed: true }),
    );
  }, [hostRequest, extensionsList, onHostResult]);

  useEffect(() => {
    const open = getOpenExtensionView();
    if (
      open &&
      extensionsList &&
      !extensionsList.find((item) => item.id === open.extensionId)?.enabled
    )
      closeOpenExtensionViewsForExtension(open.extensionId);
  }, [extensionsList]);
  useEffect(() => {
    const previous = previousSessionKey.current;
    previousSessionKey.current = sessionKey ?? null;
    if (previous && previous !== sessionKey) closeAllOpenExtensionViews();
  }, [sessionKey]);
  useEffect(() => () => closeAllOpenExtensionViews(), []);

  const openExtensionId = openRequest?.extensionId;
  const openViewId = openRequest?.viewId;
  const openRequestId = openRequest?.requestId;
  const openChannelId = openRequest?.channelId;
  const identity = useMemo(
    () =>
      openExtensionId && openViewId && openRequestId && openChannelId
        ? {
            extensionId: openExtensionId,
            contributionId: openViewId,
            instanceId: openRequestId,
            channelId: openChannelId,
          }
        : null,
    [openExtensionId, openViewId, openRequestId, openChannelId],
  );

  const sendContext = useCallback(() => {
    if (!identity) return;
    iframeRef.current?.contentWindow?.postMessage(
      {
        type: EXTENSION_PAGE_CONTEXT,
        ...identity,
        params: openRequest?.params ?? null,
        visible: dialogOpen,
        locale: i18n.resolvedLanguage ?? i18n.language,
        theme: { ...collectHostDocumentChrome(), cssText: collectHostThemeCssText() },
      },
      "*",
    );
  }, [identity, openRequest?.params, dialogOpen, i18n.resolvedLanguage, i18n.language]);

  const [previousIdentity, setPreviousIdentity] = useState(identity);
  if (previousIdentity !== identity) {
    setPreviousIdentity(identity);
    if (identity) {
      setStatus("loading");
      setFrameHeight(undefined);
    }
  }
  useEffect(() => {
    if (!identity || status !== "loading") return;
    const timer = setTimeout(() => setStatus("error"), 10_000);
    return () => clearTimeout(timer);
  }, [identity, status]);
  useEffect(() => {
    if (!identity) return;
    sendContext();
    const observer = new MutationObserver(sendContext);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "lang"],
    });
    return () => observer.disconnect();
  }, [identity, sendContext]);

  useEffect(() => {
    if (!identity) return;
    const onMessage = (event: MessageEvent) => {
      const frame = iframeRef.current?.contentWindow;
      if (!frame || event.source !== frame || !matchesExtensionPageIdentity(event.data, identity))
        return;
      const data = event.data;
      switch (data.type) {
        case EXTENSION_PAGE_READY_REQUEST:
          sendContext();
          break;
        case EXTENSION_PAGE_READY:
          setStatus("ready");
          break;
        case EXTENSION_PAGE_ERROR:
          setStatus("error");
          break;
        case EXTENSION_PAGE_SIZE:
          if (typeof data.height === "number" && Number.isFinite(data.height) && data.height > 0)
            setFrameHeight(Math.min(Math.ceil(data.height), window.innerHeight));
          break;
        case EXTENSION_PAGE_CLOSE:
          resolveOpenExtensionView(identity.instanceId, data.result);
          break;
        case EXTENSION_PAGE_REQUEST: {
          const requestId = String(data.requestId ?? "");
          if (!requestId) break;
          if (data.method === "host.openExtensionDetails") {
            openExtensionDetails(identity.extensionId);
            frame?.postMessage(
              { type: EXTENSION_PAGE_RESULT, ...identity, requestId, ok: true },
              "*",
            );
            break;
          }
          const operation = onRequest
            ? onRequest({
                extensionId: identity.extensionId,
                viewId: identity.contributionId,
                requestId: identity.instanceId,
                method: String(data.method ?? ""),
                params: data.params,
              })
            : Promise.reject(new Error("Extension page requests are unavailable."));
          void operation.then(
            (result) =>
              frame?.postMessage(
                { type: EXTENSION_PAGE_RESULT, ...identity, requestId, ok: true, result },
                "*",
              ),
            (error: unknown) =>
              frame?.postMessage(
                {
                  type: EXTENSION_PAGE_RESULT,
                  ...identity,
                  requestId,
                  ok: false,
                  error: String(error),
                },
                "*",
              ),
          );
          break;
        }
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [identity, onRequest, sendContext]);
  useEffect(() => {
    const frame = iframeRef.current?.contentWindow;
    return () => {
      if (identity) frame?.postMessage({ type: EXTENSION_PAGE_CLOSED, ...identity }, "*");
    };
  }, [identity]);

  const chrome = openRequest?.chrome ?? "default";
  return (
    <Dialog
      open={dialogOpen}
      onOpenChange={(next) => {
        if (!next && openRequest) dismissOpenExtensionView(openRequest.requestId);
      }}
    >
      <DialogContent
        className="gap-0 overflow-hidden p-0"
        forceMount={openRequest !== null || undefined}
        style={
          openRequest?.width ? { width: openRequest.width, maxWidth: "calc(100vw - 2rem)" } : {}
        }
        showCloseButton={chrome !== "none" || status === "error"}
        aria-describedby={undefined}
      >
        <DialogHeader className={chrome === "default" ? "px-4 pt-4 pb-4" : "sr-only"}>
          <DialogTitle>{openRequest?.title ?? openRequest?.viewId ?? "Extension"}</DialogTitle>
        </DialogHeader>
        {status === "error" ? (
          <div role="alert" className="space-y-4 p-4 text-sm">
            <p>
              {t("workspace.extensionTabLoadError", {
                name: openRequest?.title ?? openRequest?.viewId,
              })}
            </p>
            <Button
              variant="outline"
              onClick={() => openRequest && dismissOpenExtensionView(openRequest.requestId)}
            >
              {t("common.close")}
            </Button>
          </div>
        ) : null}
        {identity ? (
          <iframe
            key={identity.instanceId}
            ref={iframeRef}
            title={openRequest?.title ?? identity.contributionId}
            sandbox="allow-scripts"
            src={extensionPageUrl("view", identity)}
            className="w-full border-0 bg-transparent"
            data-extension-page-state={status}
            style={{
              height: frameHeight ?? 160,
              maxHeight: openRequest?.height ?? "calc(100vh - 8rem)",
              visibility: status === "ready" ? "visible" : "hidden",
              ...(status === "error" ? { display: "none" } : {}),
            }}
            onError={() => setStatus("error")}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
