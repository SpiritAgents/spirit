import {
  parseExtensionComposerAttachment,
  type ExtensionComposerAttachment,
} from "@/lib/extension-composer-attachment";
import { openExtensionDetails } from "@/lib/extension-navigation";
import { extensionTabDisplayName } from "@/lib/extension-tab-contributions";
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
import { collectHostDocumentChrome, collectHostThemeCssText } from "@/lib/extension-view-tokens";
import { EXTENSION_PAGE_ERROR } from "@/lib/extension-page-frame";
import { cn } from "@/lib/utils";
import { useExtensionWebViewBridge } from "@/hooks/useExtensionWebViewBridge";
import type {
  DesktopExtensionDesktopTab,
  DesktopExtensionTabChromePatch,
  DesktopExtensionTabEvent,
  DesktopExtensionWebViewEvent,
  DesktopExtensionWebViewRequest,
  WorkspaceExtensionToolTab,
} from "@/types";

export function ExtensionTabHost({
  tab,
  contribution,
  active,
  workspaceRoot,
  gitSnapshot,
  authorizationConfigured,
  sessionKey,
  onRequest,
  allowComposerAttachments = false,
  onAttachment,
  onChrome,
  subscribeEvents,
  onWebView,
  subscribeWebViewEvents,
}: {
  tab: WorkspaceExtensionToolTab;
  contribution: DesktopExtensionDesktopTab;
  active: boolean;
  allowComposerAttachments?: boolean;
  onAttachment?: (attachment: ExtensionComposerAttachment) => void;
  workspaceRoot?: string;
  gitSnapshot?: { isRepository: boolean; branch?: string; selectedBranch?: string };
  authorizationConfigured?: boolean;
  sessionKey?: string;
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
  onWebView?: (request: DesktopExtensionWebViewRequest) => Promise<unknown>;
  subscribeWebViewEvents?: (callback: (event: DesktopExtensionWebViewEvent) => void) => () => void;
}) {
  const { t, i18n } = useTranslation();
  const [attempt, setAttempt] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const tabInstanceKey = `${tab.instanceId}\u0000${attempt}`;
  const [statusResult, setStatusResult] = useState<{
    key: string;
    status: "loading" | "ready" | "error";
  }>({ key: tabInstanceKey, status: "loading" });
  const status = statusResult.key === tabInstanceKey ? statusResult.status : "loading";
  const setStatus = useCallback(
    (next: "loading" | "ready" | "error") => {
      setStatusResult({ key: tabInstanceKey, status: next });
    },
    [tabInstanceKey],
  );
  const previousAttemptRef = useRef(attempt);
  const closedAttemptRef = useRef<string | null>(null);

  useEffect(() => {
    if (status !== "loading") {
      return;
    }
    const timeout = window.setTimeout(() => setStatus("error"), 10_000);
    return () => window.clearTimeout(timeout);
  }, [setStatus, status]);

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
        navigationRevision: tab.navigationRevision ?? 0,
        scope: tab.scope,
        workspaceRoot: workspaceRoot ?? "",
        workspace: {
          isRepository: gitSnapshot?.isRepository === true,
          branch: gitSnapshot?.selectedBranch?.trim() || gitSnapshot?.branch?.trim() || "",
        },
        authorizationConfigured,
        sessionKey: sessionKey ?? "",
        visible: active,
        locale: i18n.resolvedLanguage ?? i18n.language,
        theme: { ...chrome, cssText: collectHostThemeCssText() },
      },
      "*",
    );
  }, [
    active,
    sessionKey,
    tab,
    workspaceRoot,
    gitSnapshot?.isRepository,
    gitSnapshot?.branch,
    gitSnapshot?.selectedBranch,
    authorizationConfigured,
    i18n.resolvedLanguage,
    i18n.language,
  ]);

  const handleWebViewMessage = useExtensionWebViewBridge({
    tab,
    active,
    attempt,
    iframeRef,
    onWebView,
    subscribeEvents: subscribeWebViewEvents,
  });

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
      if (handleWebViewMessage(event.data)) {
        return;
      }
      if (event.data.type === SPIRIT_EXTENSION_TAB_READY_REQUEST) {
        sendContext();
        return;
      }
      if (event.data.type === EXTENSION_PAGE_ERROR) {
        setStatus("error");
        return;
      }
      if (event.data.type === SPIRIT_EXTENSION_TAB_READY) {
        setStatus("ready");
        return;
      }
      if (event.data.type === SPIRIT_EXTENSION_TAB_REQUEST) {
        const requestId = String(event.data.requestId ?? "");
        if (!requestId) return;
        if (event.data.method === "host.composer.attach") {
          try {
            if (!active || !allowComposerAttachments || !onAttachment)
              throw new Error("This page cannot add Composer attachments.");
            onAttachment(parseExtensionComposerAttachment(event.data.params, tab.id));
            iframe.contentWindow?.postMessage(
              { type: SPIRIT_EXTENSION_TAB_RESULT, ...tab, requestId, ok: true },
              "*",
            );
          } catch (error) {
            iframe.contentWindow?.postMessage(
              {
                type: SPIRIT_EXTENSION_TAB_RESULT,
                ...tab,
                requestId,
                ok: false,
                error: String(error),
              },
              "*",
            );
          }
          return;
        }
        if (event.data.method === "host.openExtensionDetails") {
          openExtensionDetails(tab.extensionId);
          iframe.contentWindow?.postMessage(
            { type: SPIRIT_EXTENSION_TAB_RESULT, ...tab, requestId, ok: true },
            "*",
          );
          return;
        }
        // Workbench resolves remaining Host methods before extension backend dispatch.
        if (!onRequest) return;
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
  }, [
    handleWebViewMessage,
    onRequest,
    onChrome,
    sendContext,
    setStatus,
    tab,
    active,
    allowComposerAttachments,
    onAttachment,
  ]);

  useEffect(() => {
    // A cached page can request context before the host listener attaches.
    previousAttemptRef.current = attempt;
    sendContext();
  }, [attempt, sendContext]);

  useEffect(() => {
    const observer = new MutationObserver(sendContext);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    return () => observer.disconnect();
  }, [sendContext]);

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

  // Value-based deps: the daemon echoes the tab snapshot back with fresh object identities on
  // every sync; depending on `tab` would post a spurious close into the live iframe.
  useEffect(() => {
    const iframe = iframeRef.current;
    const identity = {
      extensionId: tab.extensionId,
      contributionId: tab.contributionId,
      instanceId: tab.instanceId,
      channelId: tab.channelId,
    };
    const closedKey = `${tab.instanceId} ${attempt}`;
    return () => {
      if (closedAttemptRef.current === closedKey) {
        return;
      }
      closedAttemptRef.current = closedKey;
      iframe?.contentWindow?.postMessage({ type: SPIRIT_EXTENSION_TAB_CLOSED, ...identity }, "*");
    };
  }, [attempt, tab.extensionId, tab.contributionId, tab.instanceId, tab.channelId]);

  return (
    <div
      className="relative min-h-0 min-w-0 flex-1"
      data-extension-tab-instance={tab.instanceId}
      data-extension-tab-state={status}
    >
      {status === "error" ? (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background p-6 text-center text-sm">
          <p className="text-muted-foreground">
            {t("workspace.extensionTabLoadError", {
              name: extensionTabDisplayName(contribution),
            })}
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
        title={tab.tabTitle ?? extensionTabDisplayName(contribution)}
        sandbox="allow-scripts"
        src={extensionTabPageUrl(tab)}
        className={cn("size-full border-0 bg-transparent", status === "error" && "invisible")}
        data-extension-tab-active={active}
        onError={() => setStatus("error")}
      />
    </div>
  );
}
