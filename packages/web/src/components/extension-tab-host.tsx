import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  extensionTabPageUrl,
  SPIRIT_EXTENSION_TAB_CONTEXT,
  SPIRIT_EXTENSION_TAB_READY,
  SPIRIT_EXTENSION_TAB_READY_REQUEST,
} from "@/lib/extension-tab-frame";
import {
  collectHostDocumentChrome,
  collectHostStylesheetCssText,
} from "@/lib/extension-view-tokens";
import { cn } from "@/lib/utils";
import type { DesktopExtensionDesktopTab, WorkspaceExtensionToolTab } from "@/types";

export function ExtensionTabHost({
  tab,
  contribution,
  active,
}: {
  tab: WorkspaceExtensionToolTab;
  contribution: DesktopExtensionDesktopTab;
  active: boolean;
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
        event.data?.instanceId !== tab.instanceId
      ) {
        return;
      }
      if (event.data.type === SPIRIT_EXTENSION_TAB_READY_REQUEST) {
        sendContext();
        return;
      }
      if (event.data.type === SPIRIT_EXTENSION_TAB_READY) {
        setStatus("ready");
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [attempt, sendContext, tab]);

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
