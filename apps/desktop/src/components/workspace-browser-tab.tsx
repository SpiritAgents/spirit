import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { resizeCursor, useDragResizeCursor } from "@spiritagent/ui/resize-cursor";

import { ArrowLeft, ArrowRight, PenTool, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { normalizeBrowserUrl, toLocalHostUrl } from "@/lib/browser-url";
import { BROWSER_NEW_TAB_SENTINEL, isBrowserNewTabUrl } from "@/lib/workspace-tool-tabs";
import type { BrowserElementAttachment } from "@/lib/browser-element-attachment";
import { truncateOuterHtml } from "@/lib/browser-element-attachment";
import {
  buildPickerInjectScript,
  PICKER_INJECT_CSS,
  type PickerMarqueeResult,
} from "@/lib/browser-element-picker";
import { desktopTranslucencyBrowserTintClass } from "@/lib/desktop-translucency-surface";
import { useWorkspaceToolsShellHorizontalDivider } from "@/lib/use-workspace-tools-shell-horizontal-divider";
import { BROWSER_NAV_SHELL_DIVIDER_ATTR } from "@/lib/workspace-tools-panel-edge";
import {
  attachBrowserNavigationPolicy,
  attachBrowserPageEventListeners,
  bindDevtoolsHost,
  BROWSER_WEBVIEW_WEBPREFERENCES,
  browserWebviewPartition,
  captureWebviewPngBase64,
  closeEmbeddedDevtools,
  executeWebviewScript,
  insertWebviewCss,
  openEmbeddedDevtools,
  removeWebviewCss,
  waitForWebviewDomReady,
} from "@/lib/workspace-browser-webview";
import { cn } from "@/lib/utils";

export type WorkspaceBrowserTabProps = {
  browserTabId: string;
  browserUrl: string | undefined;
  onBrowserUrlChange(url: string): void;
  /** Off-site / new-window links: opens in a new browser tab in the workspace */
  onOpenUrlInNewTab?: (url: string) => void;
  /** Notifies the parent when the current page title changes; undefined when switching to a new tab */
  onTitleChange?: (title: string | undefined) => void;
  /** Callback after the user selects an element */
  onElementPicked?: (attachment: BrowserElementAttachment) => void;
  /** True for the Electron desktop host; false for the Web Host */
  browserTabEnabled?: boolean;
  /** Whether the current browser tool tab is the active page in the right workspace */
  isActive?: boolean;
  /** Windows Mica / macOS Vibrancy: the page slot uses a slightly more opaque semi-transparent base color. */
  useTranslucency?: boolean;
};

type LocalListeningEndpoint = {
  port: number;
  address?: string;
  processName?: string;
  url?: string;
  title?: string;
};

/** Width of the drag bar between DevTools and the page (px) */
const DEVTOOLS_SPLITTER_WIDTH_PX = 4;
const DEVTOOLS_MIN_WIDTH_PX = 200;
const DEFAULT_DEVTOOLS_WIDTH_PX = 320;
const DEVTOOLS_WIDTH_STORAGE_KEY = "spirit-desktop-browser-devtools-width";

function isElectronDesktop(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  if (window.spiritDesktop) {
    return true;
  }
  return typeof navigator !== "undefined" && /\bElectron\//.test(navigator.userAgent);
}

function canUseEmbeddedBrowser(): boolean {
  return isElectronDesktop();
}

function readStoredDevtoolsWidthPx(): number {
  try {
    const raw = localStorage.getItem(DEVTOOLS_WIDTH_STORAGE_KEY);
    const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
    if (Number.isFinite(parsed) && parsed >= DEVTOOLS_MIN_WIDTH_PX) {
      return parsed;
    }
  } catch {
    // ignore
  }
  return DEFAULT_DEVTOOLS_WIDTH_PX;
}

function writeStoredDevtoolsWidthPx(widthPx: number): void {
  try {
    localStorage.setItem(DEVTOOLS_WIDTH_STORAGE_KEY, String(Math.round(widthPx)));
  } catch {
    // ignore
  }
}

function clampDevtoolsWidthPx(totalWidth: number, widthPx: number): number {
  const maxDevtools = Math.max(
    DEVTOOLS_MIN_WIDTH_PX,
    totalWidth - DEVTOOLS_MIN_WIDTH_PX - DEVTOOLS_SPLITTER_WIDTH_PX,
  );
  return Math.max(DEVTOOLS_MIN_WIDTH_PX, Math.min(maxDevtools, Math.round(widthPx)));
}

function BrowserNewTabPage({ onNavigate }: { onNavigate(url: string): void }) {
  const { t } = useTranslation();
  const [endpoints, setEndpoints] = useState<LocalListeningEndpoint[]>([]);
  const [scanning, setScanning] = useState(false);

  const addEndpoint = useCallback((item: LocalListeningEndpoint) => {
    setEndpoints((prev) => {
      if (prev.some((e) => e.port === item.port)) return prev;
      return [...prev, item].sort((a, b) => a.port - b.port);
    });
  }, []);

  useEffect(() => {
    const bridge = window.spiritDesktop;
    if (!bridge) return;

    void bridge.listLocalListeningEndpoints().then((items) => {
      setEndpoints((prev) => {
        const merged = [...prev];
        for (const item of items) {
          if (!merged.some((e) => e.port === item.port)) merged.push(item);
        }
        merged.sort((a, b) => a.port - b.port);
        return merged;
      });
    });

    if (!bridge.subscribeLocalListeners) return;
    const unsubscribe = bridge.subscribeLocalListeners({
      onFound: addEndpoint,
      onDone: () => setScanning(false),
    });

    return unsubscribe;
  }, [addEndpoint]);

  const handleRefresh = useCallback(() => {
    const bridge = window.spiritDesktop;
    if (!bridge?.scanLocalListeners) return;
    setEndpoints([]);
    setScanning(true);
    bridge.scanLocalListeners();
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-normal text-foreground">{t("workspace.browserNewTabTitle")}</h3>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="electron-no-drag h-7 gap-1 px-2 text-xs"
          disabled={scanning}
          onClick={handleRefresh}
        >
          <RefreshCw
            className={cn("size-3.5", scanning && "animate-spin")}
            aria-hidden
            strokeWidth={1.75}
          />
          {t("workspace.browserRefreshPorts")}
        </Button>
      </div>
      {endpoints.length === 0 && scanning ? (
        <p className="text-muted-foreground">{t("workspace.browserScanningPorts")}</p>
      ) : endpoints.length === 0 ? (
        <p className="text-muted-foreground">{t("workspace.browserNoLocalPorts")}</p>
      ) : (
        <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto">
          {endpoints.map((item) => {
            const url = item.url ?? toLocalHostUrl(item.port);
            const subtitle = [item.address, item.processName].filter(Boolean).join(" · ");
            const displayTitle = item.title || url;
            const displaySubtitle = item.title ? url : subtitle;
            return (
              <li key={`${item.port}-${url}`}>
                <button
                  type="button"
                  className={cn(
                    "electron-no-drag w-full rounded-md border border-border/50 px-2.5 py-2 text-left",
                    "hover:bg-canvas-hover",
                  )}
                  onClick={() => onNavigate(url)}
                >
                  <span className="block truncate font-normal text-foreground">{displayTitle}</span>
                  {displaySubtitle ? (
                    <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                      {displaySubtitle}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function WorkspaceBrowserTab({
  browserTabId,
  browserUrl,
  onBrowserUrlChange,
  onOpenUrlInNewTab,
  onTitleChange,
  onElementPicked,
  browserTabEnabled = false,
  isActive = false,
  useTranslucency = false,
}: WorkspaceBrowserTabProps) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const navBarRef = useRef<HTMLDivElement | null>(null);
  const pageSlotRef = useRef<HTMLDivElement | null>(null);
  const pageWebviewRef = useRef<SpiritWebviewTag | null>(null);
  const devtoolsWebviewRef = useRef<SpiritWebviewTag | null>(null);
  const guestWebContentsIdRef = useRef<number | null>(null);
  const devtoolsBoundRef = useRef(false);
  const showNewTab = isBrowserNewTabUrl(browserUrl);
  const [addressDraft, setAddressDraft] = useState("");
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [lastVisitedUrl, setLastVisitedUrl] = useState<string | undefined>(undefined);
  const [isPickerActive, setIsPickerActive] = useState(false);
  const [devtoolsOpen, setDevtoolsOpen] = useState(false);
  const [devtoolsWidthPx, setDevtoolsWidthPx] = useState(readStoredDevtoolsWidthPx);
  const [pageSlotWidthPx, setPageSlotWidthPx] = useState(0);
  const devtoolsDragCursor = useDragResizeCursor();
  const devtoolsDragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const [currentPageUrl, setCurrentPageUrl] = useState<string | undefined>(browserUrl);
  const onElementPickedRef = useRef(onElementPicked);
  useLayoutEffect(() => {
    onElementPickedRef.current = onElementPicked;
  });
  const canEmbed = browserTabEnabled && canUseEmbeddedBrowser();
  const onTitleChangeRef = useRef(onTitleChange);
  useLayoutEffect(() => {
    onTitleChangeRef.current = onTitleChange;
  });
  const prevBrowserUrlRef = useRef(browserUrl);
  const onOpenUrlInNewTabRef = useRef(onOpenUrlInNewTab);
  useLayoutEffect(() => {
    onOpenUrlInNewTabRef.current = onOpenUrlInNewTab;
  });

  const pageEmbeddable = isActive && !showNewTab && canEmbed;

  const toggleDevtools = useCallback(() => {
    setDevtoolsOpen((open) => !open);
  }, []);

  useEffect(() => {
    const prevUrl = prevBrowserUrlRef.current;
    prevBrowserUrlRef.current = browserUrl;
    if (showNewTab) {
      setAddressDraft("");
      const prevWasRealUrl = prevUrl && !isBrowserNewTabUrl(prevUrl);
      if (prevWasRealUrl) {
        onTitleChangeRef.current?.(undefined);
      }
      return;
    }
    setAddressDraft(browserUrl ?? "");
    setCurrentPageUrl(browserUrl);
    if (browserUrl) {
      setLastVisitedUrl(browserUrl);
    }
  }, [browserUrl, showNewTab]);

  useEffect(() => {
    const wv = pageWebviewRef.current;
    if (!wv || !canEmbed || showNewTab) {
      return;
    }

    let cancelled = false;
    let detachListeners: (() => void) | undefined;
    let f12Registered = false;

    void (async () => {
      await waitForWebviewDomReady(wv);
      if (cancelled) {
        return;
      }

      const detachNav = attachBrowserNavigationPolicy(wv, (url) => {
        onOpenUrlInNewTabRef.current?.(url);
      });
      const detachPage = attachBrowserPageEventListeners(wv, {
        onUrl: (url) => {
          setAddressDraft(url);
          setCurrentPageUrl(url);
        },
        onTitle: (title) => {
          onTitleChangeRef.current?.(title || undefined);
        },
        onNavState: (back, forward) => {
          setCanGoBack(back);
          setCanGoForward(forward);
        },
      });
      const guestWebContentsId = wv.getWebContentsId();
      const bridge = window.spiritDesktop;

      detachListeners = () => {
        detachNav();
        detachPage();
        if (f12Registered) {
          void bridge?.unregisterBrowserGuestF12(guestWebContentsId);
        }
        guestWebContentsIdRef.current = null;
      };

      if (cancelled) {
        detachListeners();
        detachListeners = undefined;
        return;
      }

      if (bridge?.registerBrowserGuestF12) {
        await bridge.registerBrowserGuestF12(browserTabId, guestWebContentsId);
        f12Registered = true;
      }

      if (cancelled) {
        detachListeners();
        detachListeners = undefined;
        return;
      }

      guestWebContentsIdRef.current = guestWebContentsId;
    })();

    return () => {
      cancelled = true;
      detachListeners?.();
    };
  }, [browserTabId, canEmbed, showNewTab]);

  useEffect(() => {
    const bridge = window.spiritDesktop;
    if (!bridge?.subscribeBrowserGuestF12) {
      return;
    }
    return bridge.subscribeBrowserGuestF12((payload) => {
      if (payload.tabId !== browserTabId) {
        return;
      }
      toggleDevtools();
    });
  }, [browserTabId, toggleDevtools]);

  useEffect(() => {
    if (!devtoolsOpen) {
      return;
    }

    const pageWv = pageWebviewRef.current;
    const devtoolsWv = devtoolsWebviewRef.current;
    if (!pageWv || !devtoolsWv) {
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        if (!devtoolsBoundRef.current) {
          await bindDevtoolsHost(pageWv, devtoolsWv);
          devtoolsBoundRef.current = true;
        }
        if (cancelled) {
          return;
        }
        await openEmbeddedDevtools(pageWv, devtoolsWv);
      } catch {
        // On bind/open failure the user retries with F12
      }
    })();

    return () => {
      cancelled = true;
      devtoolsBoundRef.current = false;
      const guestId = guestWebContentsIdRef.current;
      if (guestId != null) {
        closeEmbeddedDevtools(guestId);
      }
    };
  }, [devtoolsOpen]);

  useEffect(() => {
    const slot = pageSlotRef.current;
    if (!slot || !devtoolsOpen) {
      return;
    }

    const clampWidth = () => {
      const totalWidth = Math.round(slot.getBoundingClientRect().width);
      setPageSlotWidthPx(totalWidth);
      if (totalWidth < 1) {
        return;
      }
      const clamped = clampDevtoolsWidthPx(totalWidth, devtoolsWidthPx);
      if (clamped !== devtoolsWidthPx) {
        setDevtoolsWidthPx(clamped);
        writeStoredDevtoolsWidthPx(clamped);
      }
    };

    const resizeObserver = new ResizeObserver(clampWidth);
    resizeObserver.observe(slot);
    clampWidth();

    return () => {
      resizeObserver.disconnect();
    };
  }, [devtoolsOpen, devtoolsWidthPx]);

  const submitAddress = useCallback(() => {
    const normalized = normalizeBrowserUrl(addressDraft);
    if (!normalized) {
      return;
    }
    onBrowserUrlChange(normalized);
  }, [addressDraft, onBrowserUrlChange]);

  const exitPicker = useCallback(() => {
    setIsPickerActive(false);
  }, []);

  useEffect(() => {
    if (isPickerActive) exitPicker();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browserUrl]);

  useEffect(() => {
    const wv = pageWebviewRef.current;
    if (!isPickerActive || showNewTab || !canEmbed || !pageEmbeddable || !wv) {
      return;
    }

    let cssKey: string | undefined;
    void waitForWebviewDomReady(wv).then(async () => {
      try {
        await executeWebviewScript(wv, buildPickerInjectScript());
        const key = await insertWebviewCss(wv, PICKER_INJECT_CSS);
        cssKey = typeof key === "string" ? key : undefined;
      } catch (err) {
        console.warn("[picker] inject failed:", err);
      }
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") exitPicker();
    };
    window.addEventListener("keydown", handleKeyDown, true);

    let frameId = 0;
    let cancelled = false;
    let syncInFlight = false;

    const tick = () => {
      if (cancelled) return;
      frameId = requestAnimationFrame(tick);
      if (syncInFlight) return;

      syncInFlight = true;
      void (async () => {
        try {
          const done = await executeWebviewScript(wv, "window.__spiritPickerDone || false");
          if (done) {
            const result = await executeWebviewScript(wv, "window.__spiritPickerResult");
            await executeWebviewScript(
              wv,
              "if(window.__spiritPickerCleanup){window.__spiritPickerCleanup();window.__spiritPickerCleanup=null;}window.__spiritPickerDone=false;",
            );
            const r = result as PickerMarqueeResult | null;
            if (r && r.tagName && r.outerHTML && !cancelled) {
              try {
                const base64 = await captureWebviewPngBase64(wv, {
                  x: r.x,
                  y: r.y,
                  width: Math.max(r.width, 1),
                  height: Math.max(r.height, 1),
                });
                if (!cancelled) {
                  onElementPickedRef.current?.({
                    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
                    tagName: r.tagName.toLowerCase(),
                    outerHtml: truncateOuterHtml(r.outerHTML),
                    screenshotDataUrl: `data:image/png;base64,${base64}`,
                    pageUrl: currentPageUrl || browserUrl || "",
                  });
                }
              } catch (err) {
                console.warn("[picker] capturePage failed:", err);
              }
              exitPicker();
              return;
            }
          }
        } catch (err) {
          console.warn("[picker] tick failed:", err);
        } finally {
          syncInFlight = false;
        }
      })();
    };

    frameId = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      cancelAnimationFrame(frameId);
      window.removeEventListener("keydown", handleKeyDown, true);
      void executeWebviewScript(
        wv,
        "if(window.__spiritPickerCleanup){window.__spiritPickerCleanup();window.__spiritPickerCleanup=null;}window.__spiritPickerDone=false;",
      );
      if (cssKey) {
        void removeWebviewCss(wv, cssKey);
      }
    };
  }, [
    browserUrl,
    canEmbed,
    currentPageUrl,
    exitPicker,
    isPickerActive,
    pageEmbeddable,
    showNewTab,
  ]);

  const handleGoBack = useCallback(() => {
    const wv = pageWebviewRef.current;
    if (canGoBack && wv) {
      wv.goBack();
      return;
    }
    onBrowserUrlChange(BROWSER_NEW_TAB_SENTINEL);
  }, [canGoBack, onBrowserUrlChange]);

  const handleGoForward = useCallback(() => {
    if (showNewTab && lastVisitedUrl) {
      onBrowserUrlChange(lastVisitedUrl);
      return;
    }
    pageWebviewRef.current?.goForward();
  }, [lastVisitedUrl, onBrowserUrlChange, showNewTab]);

  const handleReload = useCallback(() => {
    if (showNewTab) {
      return;
    }
    pageWebviewRef.current?.reload();
  }, [showNewTab]);

  const applyDevtoolsWidth = useCallback((nextWidthPx: number) => {
    const slot = pageSlotRef.current;
    const totalWidth = slot ? Math.round(slot.getBoundingClientRect().width) : 0;
    const clamped =
      totalWidth > 0
        ? clampDevtoolsWidthPx(totalWidth, nextWidthPx)
        : Math.max(DEVTOOLS_MIN_WIDTH_PX, Math.round(nextWidthPx));
    setDevtoolsWidthPx(clamped);
    writeStoredDevtoolsWidthPx(clamped);
    return clamped;
  }, []);

  const maxDevtoolsWidthPx = Math.max(
    DEVTOOLS_MIN_WIDTH_PX,
    pageSlotWidthPx - DEVTOOLS_MIN_WIDTH_PX - DEVTOOLS_SPLITTER_WIDTH_PX,
  );

  const onDevtoolsResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      devtoolsDragRef.current = { startX: event.clientX, startWidth: devtoolsWidthPx };
      devtoolsDragCursor.start(
        resizeCursor(devtoolsWidthPx, DEVTOOLS_MIN_WIDTH_PX, maxDevtoolsWidthPx, "left"),
      );
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [devtoolsDragCursor, devtoolsWidthPx, maxDevtoolsWidthPx],
  );

  const onDevtoolsResizePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = devtoolsDragRef.current;
      if (!drag) {
        return;
      }
      const delta = drag.startX - event.clientX;
      const next = applyDevtoolsWidth(drag.startWidth + delta);
      const totalWidth = pageSlotRef.current?.getBoundingClientRect().width ?? 0;
      const max = Math.max(
        DEVTOOLS_MIN_WIDTH_PX,
        totalWidth - DEVTOOLS_MIN_WIDTH_PX - DEVTOOLS_SPLITTER_WIDTH_PX,
      );
      devtoolsDragCursor.update(resizeCursor(next, DEVTOOLS_MIN_WIDTH_PX, max, "left"));
    },
    [applyDevtoolsWidth, devtoolsDragCursor],
  );

  const endDevtoolsResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      devtoolsDragCursor.end();
      devtoolsDragRef.current = null;
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // Already released or no capture
      }
    },
    [devtoolsDragCursor],
  );

  useEffect(() => {
    if (!devtoolsOpen) {
      devtoolsDragCursor.end();
      devtoolsDragRef.current = null;
    }
  }, [devtoolsDragCursor, devtoolsOpen]);

  useEffect(() => {
    if (!isActive || showNewTab || !canEmbed) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "F12") {
        return;
      }
      const root = rootRef.current;
      const active = document.activeElement;
      const contained = Boolean(root && active && root.contains(active));
      if (!root || !active || !contained) {
        return;
      }
      event.preventDefault();
      toggleDevtools();
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [canEmbed, isActive, showNewTab, toggleDevtools]);

  const navDisabled = showNewTab;
  const pageWebviewRight = devtoolsOpen ? devtoolsWidthPx + DEVTOOLS_SPLITTER_WIDTH_PX : 0;

  useWorkspaceToolsShellHorizontalDivider(
    navBarRef,
    {
      enabled: canEmbed,
      edge: "bottom",
      dividerAttr: BROWSER_NAV_SHELL_DIVIDER_ATTR,
    },
    [showNewTab],
  );

  if (!canEmbed) {
    return (
      <div className="p-3 text-muted-foreground">
        <p>{t("workspace.browserElectronOnly")}</p>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div
        ref={navBarRef}
        className="electron-no-drag flex shrink-0 items-center gap-0.5 px-1.5 py-1.5"
      >
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-7 shrink-0"
          aria-label={t("workspace.browserBack")}
          disabled={navDisabled}
          onClick={handleGoBack}
        >
          <ArrowLeft className="size-3.5" aria-hidden strokeWidth={1.75} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-7 shrink-0"
          aria-label={t("workspace.browserForward")}
          disabled={showNewTab ? !lastVisitedUrl : !canGoForward}
          onClick={handleGoForward}
        >
          <ArrowRight className="size-3.5" aria-hidden strokeWidth={1.75} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-7 shrink-0"
          aria-label={t("workspace.browserReload")}
          disabled={navDisabled}
          onClick={handleReload}
        >
          <RefreshCw className="size-3.5" aria-hidden strokeWidth={1.75} />
        </Button>
        <Input
          value={addressDraft}
          aria-label={t("workspace.browserAddressBar")}
          placeholder={t("workspace.browserAddressBarPlaceholder")}
          className={cn(
            "h-7 min-w-0 flex-1 border-0 bg-transparent px-2 text-xs shadow-none",
            "focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent",
          )}
          onChange={(event) => setAddressDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submitAddress();
            }
          }}
        />
        {!showNewTab && onElementPicked ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={cn("size-7 shrink-0", isPickerActive && "bg-accent text-accent-foreground")}
            aria-label={t("workspace.browserPickerToggle")}
            aria-pressed={isPickerActive}
            onClick={() => setIsPickerActive((v) => !v)}
          >
            <PenTool className="size-3.5" aria-hidden strokeWidth={1.75} />
          </Button>
        ) : null}
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {showNewTab ? (
          <BrowserNewTabPage onNavigate={onBrowserUrlChange} />
        ) : (
          <div
            ref={pageSlotRef}
            className={cn(
              "relative min-h-0 min-w-0 flex-1",
              desktopTranslucencyBrowserTintClass(useTranslucency),
              isPickerActive && "cursor-crosshair",
            )}
          >
            <webview
              ref={pageWebviewRef}
              src={!showNewTab && browserUrl && canEmbed ? browserUrl : "about:blank"}
              partition={browserWebviewPartition(browserTabId)}
              className={cn(
                "electron-no-drag absolute inset-y-0 left-0",
                !pageEmbeddable && "hidden",
              )}
              style={{ right: pageWebviewRight }}
              webpreferences={BROWSER_WEBVIEW_WEBPREFERENCES}
            />
            {devtoolsOpen ? (
              <>
                {/* A webview without src creates no guest and fires neither did-attach nor dom-ready;
                    mount about:blank first to create the guest; after bind, the DevTools frontend takes over */}
                <webview
                  ref={devtoolsWebviewRef}
                  src="about:blank"
                  className={cn(
                    "electron-no-drag absolute top-0 bottom-0 right-0",
                    !pageEmbeddable && "hidden",
                  )}
                  style={{ width: devtoolsWidthPx }}
                  webpreferences={BROWSER_WEBVIEW_WEBPREFERENCES}
                />
                <div
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={t("workspace.browserResizeDevtoolsWidth")}
                  className={cn(
                    "electron-no-drag group absolute top-0 bottom-0 z-20 w-1 touch-none select-none",
                    "before:absolute before:inset-y-0 before:-left-1 before:w-3 before:content-['']",
                  )}
                  style={{
                    right: devtoolsWidthPx,
                    cursor: resizeCursor(
                      devtoolsWidthPx,
                      DEVTOOLS_MIN_WIDTH_PX,
                      maxDevtoolsWidthPx,
                      "left",
                    ),
                  }}
                  onPointerDown={onDevtoolsResizePointerDown}
                  onPointerMove={onDevtoolsResizePointerMove}
                  onPointerUp={endDevtoolsResize}
                  onPointerCancel={endDevtoolsResize}
                >
                  <div
                    className="pointer-events-none absolute inset-y-0 right-0 w-px bg-border/40 transition-colors group-hover:bg-border/55"
                    aria-hidden
                  />
                </div>
              </>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
