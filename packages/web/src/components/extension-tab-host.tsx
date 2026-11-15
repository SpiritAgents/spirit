import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  extensionTabPageUrl,
  SPIRIT_EXTENSION_TAB_CONTEXT,
  SPIRIT_EXTENSION_TAB_REQUEST,
  SPIRIT_EXTENSION_TAB_RESULT,
  SPIRIT_EXTENSION_TAB_EVENT,
  SPIRIT_EXTENSION_TAB_CHROME,
  SPIRIT_EXTENSION_TAB_CLOSED,
  SPIRIT_EXTENSION_TAB_READY,
  SPIRIT_EXTENSION_TAB_READY_REQUEST,
} from "@/lib/extension-tab-frame";
import {
  collectHostDocumentChrome,
  collectHostStylesheetCssText,
} from "@/lib/extension-view-tokens";
import { cn } from "@/lib/utils";
import type {
  DesktopExtensionDesktopTab,
  DesktopExtensionTabChromePatch,
  DesktopExtensionTabEvent,
  WorkspaceExtensionToolTab,
} from "@/types";

export function ExtensionTabHost({
  tab,
  contribution,
  active,
  onRequest,
  onChrome,
  subscribeEvents,
}: {
  tab: WorkspaceExtensionToolTab;
  contribution: DesktopExtensionDesktopTab;
  active: boolean;
  onRequest?: (request: {
    extensionId: string;
    contributionId: string;
    instanceId: string;
    method: string;
    params?: unknown;
  }) => Promise<unknown>;
  onChrome?: (request: {
    extensionId: string;
    instanceId: string;
    patch: DesktopExtensionTabChromePatch;
  }) => Promise<void>;
  subscribeEvents?: (callback: (event: DesktopExtensionTabEvent) => void) => () => void;
}) {
  const { t } = useTranslation();
  const [attempt, setAttempt] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    if (status !== "loading") {
      return;
    }
    const timeout = window.setTimeout(() => setStatus("error"), 10_000);
    return () => window.clearTimeout(timeout);
  }, [attempt, status, tab.instanceId]);

  useEffect(() => {
    setStatus("loading");
  }, [attempt, tab.instanceId]);

  const sendContext = useCallback(() => {
    const chrome = collectHostDocumentChrome();
    iframeRef.current?.contentWindow?.postMessage(
      {
        type: SPIRIT_EXTENSION_TAB_CONTEXT,
        extensionId: tab.extensionId,
        contributionId: tab.contributionId,
        instanceId: tab.instanceId,
        channelId: tab.channelId,
        initialParams: tab.initialParams ?? null,
        scope: tab.scope,
        visible: active,
        theme: { ...chrome, cssText: collectHostStylesheetCssText() },
      },
      "*",
    );
  }, [active, tab]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) {
      return;
    }
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow) {
        return;
      }
      if (
        event.data?.extensionId !== tab.extensionId ||
        event.data?.contributionId !== tab.contributionId ||
        event.data?.instanceId !== tab.instanceId ||
        event.data?.channelId !== tab.channelId
      ) {
        return;
      }
      if (event.data.type === SPIRIT_EXTENSION_TAB_READY_REQUEST) {
        sendContext();
        return;
      }
      if (event.data.type === SPIRIT_EXTENSION_TAB_READY) {
        setStatus("ready");
        return;
      }
      if (event.data.type === SPIRIT_EXTENSION_TAB_REQUEST) {
        const requestId = String(event.data.requestId ?? "");
        if (!requestId || !onRequest) {
          return;
        }
        void onRequest({
          extensionId: tab.extensionId,
          contributionId: tab.contributionId,
          instanceId: tab.instanceId,
          method: String(event.data.method ?? ""),
          params: event.data.params,
        }).then(
          (result) => {
            iframe.contentWindow?.postMessage(
              { type: SPIRIT_EXTENSION_TAB_RESULT, ...tab, requestId, ok: true, result },
              "*",
            );
          },
          (error: unknown) => {
            iframe.contentWindow?.postMessage(
              {
                type: SPIRIT_EXTENSION_TAB_RESULT,
                ...tab,
                requestId,
                ok: false,
                error: error instanceof Error ? error.message : String(error),
              },
              "*",
            );
          },
        );
        return;
      }
      if (event.data.type === SPIRIT_EXTENSION_TAB_CHROME) {
        void onChrome?.({
          extensionId: tab.extensionId,
          instanceId: tab.instanceId,
          patch: event.data.patch as DesktopExtensionTabChromePatch,
        }).catch((error: unknown) => {
          console.error("[extensions] failed to update tab chrome", error);
        });
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [attempt, onRequest, onChrome, sendContext, tab]);

  useEffect(() => {
    if (status === "ready") {
      sendContext();
    }
  }, [active, sendContext, status]);

  useEffect(() => {
    if (status !== "ready") {
      return;
    }
    const observer = new MutationObserver(sendContext);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    return () => observer.disconnect();
  }, [sendContext, status]);

  useEffect(() => {
    if (!subscribeEvents) {
      return;
    }
    return subscribeEvents((event) => {
      const iframe = iframeRef.current;
      if (
        !iframe ||
        event.extensionId !== tab.extensionId ||
        event.contributionId !== tab.contributionId ||
        event.instanceId !== tab.instanceId ||
        event.channelId !== tab.channelId
      ) {
        return;
      }
      iframe.contentWindow?.postMessage({ type: SPIRIT_EXTENSION_TAB_EVENT, ...event }, "*");
    });
  }, [subscribeEvents, tab]);

  useEffect(() => {
    const iframe = iframeRef.current;
    const identity = { ...tab };
    return () => {
      iframe?.contentWindow?.postMessage({ type: SPIRIT_EXTENSION_TAB_CLOSED, ...identity }, "*");
    };
  }, [attempt, tab.instanceId]);

  return (
    <div
      className="relative min-h-0 min-w-0 flex-1"
      data-extension-tab-instance={tab.instanceId}
      data-extension-tab-state={status}
    >
      {status === "error" ? (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background p-6 text-center text-sm">
          <p className="text-muted-foreground">
            {t("workspace.extensionTabLoadError", { name: contribution.name })}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAttempt((value) => value + 1)}
          >
            {t("common.retry")}
          </Button>
        </div>
      ) : null}
      <iframe
        ref={iframeRef}
        key={attempt}
        title={tab.tabTitle ?? contribution.name}
        sandbox="allow-scripts"
        src={extensionTabPageUrl(tab)}
        className={cn("size-full border-0 bg-background", status === "error" && "invisible")}
        data-extension-tab-active={active}
        onError={() => setStatus("error")}
      />
    </div>
  );
}
