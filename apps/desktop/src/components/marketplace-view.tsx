import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ComponentRef } from "react";
import { useTranslation } from "react-i18next";

import {
  ArrowLeft,
  Blocks,
  ChevronDown,
  Ellipsis,
  Folder,
  Globe,
  LoaderCircle,
  Search,
  Sparkles,
  Store,
  Trash2,
} from "lucide-react";

import { MarketplaceAddSourceDialog } from "@/components/marketplace-add-source-dialog";
import { MarketplaceDetailView } from "@/components/marketplace-detail-view";
import { MarketplaceSourceTab } from "@/components/marketplace-source-tab";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogFooterActions,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyCard } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Toggle } from "@/components/ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { scrollAreaViewport, useStickyHeaderPinned } from "@/hooks/use-sticky-header-pinned";
import {
  DESKTOP_FORM_INPUT_INNER,
  DESKTOP_OVERLAY_LIST_FILTER_INPUT_SHELL,
  instantHoverMotionClass,
} from "@/lib/desktop-chrome";
import { desktopTranslucencyTintInnerClass } from "@/lib/desktop-translucency-surface";
import { DESKTOP_PAGE_TITLE_CLASS } from "@/lib/desktop-typography";
import { fileToBase64 } from "@/lib/file-to-base64";
import { filterVisibleMarketplaceSources } from "@/lib/marketplace-source-visibility";
import { topScrollFadeMaskStyle } from "@/lib/mask-styles";
import { runAfterRadixOverlayClose } from "@/lib/overlay-motion";
import { useScrollTopBandOcclusion } from "@/lib/scroll-top-band-occlusion";
import { cn } from "@/lib/utils";
import type {
  AddMarketplaceSourceRequest,
  DeleteExtensionRequest,
  DesktopMarketplaceCatalogEntry,
  DesktopMarketplaceInstallResult,
  DesktopMarketplaceReviewStatus,
  DesktopMarketplaceSource,
  DesktopMarketplaceUpdateResult,
  ImportExtensionRequest,
  RemoveMarketplaceSourceRequest,
  SetExtensionEnabledRequest,
  UpdateExtensionRequest,
} from "@/types";

/** Matches the automations entry page content width */
const MARKETPLACE_LIST_W = "max-w-4xl";

/** h-8: the whitespace above the title; it scrolls away with the title before the search bar docks */
const MARKETPLACE_HEADER_TOP_GAP_PX = 32;

declare global {
  /** Not yet in TS lib.dom; runtime support is detected via `typeof ScrollTimeline`. */
  class ScrollTimeline extends AnimationTimeline {
    constructor(options?: { source?: Element | null; axis?: "block" | "inline" });
  }
}

export function reviewStatusBadgeVariant(status: DesktopMarketplaceReviewStatus) {
  if (status === "verified") {
    return "secondary" as const;
  }
  if (status === "revoked") {
    return "destructive" as const;
  }
  return "outline" as const;
}

/** Pending review-gate confirmation for an install / update / import action. */
type ReviewGateTarget = {
  extensionId: string;
  displayName: string;
  reviewStatus: DesktopMarketplaceReviewStatus;
  retry: (reviewAcknowledged: true) => Promise<void>;
};

type MarketplaceViewProps = {
  snapshot: {
    marketplaceSources?: DesktopMarketplaceSource[];
    marketplaceCatalogs?: Record<string, DesktopMarketplaceCatalogEntry[]>;
    marketplaceWarnings?: string[];
    extensionsLoading?: boolean;
  } | null;
  extensionsBusy: boolean;
  onImportExtension: (request: ImportExtensionRequest) => Promise<void>;
  onInstallMarketplaceExtension: (request: {
    name: string;
    marketplace?: string;
    reviewAcknowledged?: boolean;
  }) => Promise<DesktopMarketplaceInstallResult>;
  onUpdateExtension: (request: UpdateExtensionRequest) => Promise<DesktopMarketplaceUpdateResult>;
  onAddMarketplaceSource: (request: AddMarketplaceSourceRequest) => Promise<{ sourceId: string }>;
  onRemoveMarketplaceSource: (request: RemoveMarketplaceSourceRequest) => Promise<void>;
  onPickMarketplaceDirectory: () => Promise<string | null>;
  onDeleteExtension: (request: DeleteExtensionRequest) => Promise<void>;
  onSetExtensionEnabled: (request: SetExtensionEnabledRequest) => Promise<void>;
  extensionsInstalling?: boolean;
  /** Windows Mica / macOS Vibrancy: forwarded to the detail view's top bar. */
  useTranslucency?: boolean;
};

export function MarketplaceView({
  snapshot,
  extensionsBusy,
  onImportExtension,
  onInstallMarketplaceExtension,
  onUpdateExtension,
  onAddMarketplaceSource,
  onRemoveMarketplaceSource,
  onPickMarketplaceDirectory,
  onDeleteExtension,
  onSetExtensionEnabled,
  extensionsInstalling = false,
  useTranslucency = false,
}: MarketplaceViewProps) {
  const { t } = useTranslation();
  const [searchText, setSearchText] = useState("");
  // "all" is a UI-level pseudo source: the merged view over every added marketplace.
  const [activeSourceId, setActiveSourceId] = useState("all");
  const [uninstallTarget, setUninstallTarget] = useState<DesktopMarketplaceCatalogEntry | null>(
    null,
  );
  /** null = list; non-null = that extension's detail page */
  const [detailExtensionId, setDetailExtensionId] = useState<string | null>(null);
  const [addSourceOpen, setAddSourceOpen] = useState(false);
  const [reviewGate, setReviewGate] = useState<ReviewGateTarget | null>(null);
  const [removeSourceTarget, setRemoveSourceTarget] = useState<DesktopMarketplaceSource | null>(
    null,
  );
  const [removeSourceDialogOpen, setRemoveSourceDialogOpen] = useState(false);
  /** Install / update in flight for these catalog ids; other rows stay clickable. */
  const [installBusyIds, setInstallBusyIds] = useState<ReadonlySet<string>>(() => new Set());
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [listScrollRoot, setListScrollRoot] = useState<ComponentRef<typeof ScrollArea> | null>(
    null,
  );
  const [headerElement, setHeaderElement] = useState<HTMLDivElement | null>(null);
  const stickySentinelRef = useRef<HTMLDivElement>(null);
  const getListScrollViewport = useCallback(
    () => scrollAreaViewport(listScrollRoot),
    [listScrollRoot],
  );
  // Pin detection via sentinel + IntersectionObserver: the callback runs inside the
  // rendering steps with the latest (compositor-driven) scroll offset, so the pinned
  // styling commits in the same frame as the crossing scroll position (same pattern as
  // the PR changes view). A scroll-event listener would commit one frame late.
  const headerPinned = useStickyHeaderPinned(
    stickySentinelRef,
    getListScrollViewport,
    detailExtensionId === null,
  );
  const [titleElement, setTitleElement] = useState<HTMLDivElement | null>(null);
  const [titleHeight, setTitleHeight] = useState(0);

  // The title block scrolls away with the list, so the dock offset (top gap + title height)
  // is measured rather than hardcoded.
  useLayoutEffect(() => {
    if (!titleElement) {
      setTitleHeight(0);
      return;
    }
    const syncTitleHeight = () => setTitleHeight(titleElement.offsetHeight);
    syncTitleHeight();
    const observer = new ResizeObserver(syncTitleHeight);
    observer.observe(titleElement);
    return () => observer.disconnect();
  }, [titleElement]);

  // The occlusion clip applies only once the search bar is pinned: before that, the title
  // scrolls through the top band and must stay visible. clip-path is compositor-only, so
  // the pin-moment toggle still takes effect in the same frame (see scroll-top-band-occlusion).
  const { occlusionStyle: headerOcclusionStyle, bandHeight: headerHeight } =
    useScrollTopBandOcclusion(listScrollRoot, headerElement, headerPinned);

  // clip-path occludes the header band; the alpha-mask fade below it (onboarding-style)
  // softens content approaching the docked header, animating in/out on pin transitions.
  // The mask band is zero while unpinned so the scrolling title is not faded out.
  const listScrollRootStyle = useMemo(() => {
    return {
      ...headerOcclusionStyle,
      ...topScrollFadeMaskStyle(headerPinned, {
        bandHeightPx: headerPinned ? (headerHeight ?? 0) : 0,
      }),
    };
  }, [headerOcclusionStyle, headerHeight, headerPinned]);

  // The search bar lives outside the ScrollArea so the occlusion mask on the scroll root can
  // clip list content beneath it (the mask clips every DOM descendant of the masked element).
  // Its dock translateY is driven by a WAAPI ScrollTimeline animation running on the
  // compositor, tracking async scrolling frame-perfectly; a JS scroll-event sync always
  // commits one frame after the compositor has already presented the scrolled content, which
  // made the header visibly trail the list. Pixel values are passed straight from JS: an
  // earlier CSS @keyframes + var() attempt resolved the custom property to its fallback
  // inside the keyframes, pinning the header at translateY(0). One element at all times, so
  // input focus survives the pin. The scroll listener below is the single fallback for
  // engines without ScrollTimeline support.
  const headerDockOffset = MARKETPLACE_HEADER_TOP_GAP_PX + titleHeight;
  useLayoutEffect(() => {
    if (detailExtensionId !== null || !headerElement || !listScrollRoot) {
      return;
    }
    const viewport = scrollAreaViewport(listScrollRoot);
    if (!viewport) {
      return;
    }
    const scrollTimelineSupported = typeof ScrollTimeline !== "undefined";
    if (scrollTimelineSupported) {
      // fill: both holds translateY(0) once scrolled past the range; the duration defaults
      // to auto, i.e. the timeline supplies the progress. rangeEnd docks the header once the
      // top gap + title have scrolled away instead of at the end of the list.
      const animation = headerElement.animate(
        [{ transform: `translateY(${headerDockOffset}px)` }, { transform: "translateY(0px)" }],
        { fill: "both", timeline: new ScrollTimeline({ source: viewport }) },
      );
      (animation as Animation & { rangeEnd: string }).rangeEnd = `${headerDockOffset}px`;
      return () => animation.cancel();
    }
    const syncHeaderDock = () => {
      headerElement.style.transform = `translateY(${Math.max(0, headerDockOffset - viewport.scrollTop)}px)`;
    };
    syncHeaderDock();
    viewport.addEventListener("scroll", syncHeaderDock, { passive: true });
    return () => viewport.removeEventListener("scroll", syncHeaderDock);
  }, [detailExtensionId, headerDockOffset, headerElement, listScrollRoot]);

  const sources = useMemo(() => snapshot?.marketplaceSources ?? [], [snapshot?.marketplaceSources]);
  const catalogs = snapshot?.marketplaceCatalogs ?? {};
  // Internal-source tabs hide while their catalog is empty; the All tab shows
  // exactly when any tab shows, so an all-empty marketplace hides the tab bar.
  const visibleSources = filterVisibleMarketplaceSources(sources, catalogs);
  const showAll = visibleSources.length > 0;
  const activeTabVisible =
    activeSourceId === "all"
      ? showAll
      : visibleSources.some((source) => source.id === activeSourceId);
  const resolvedActiveSourceId = activeTabVisible ? activeSourceId : "all";
  // The All view merges every source's catalog and sorts globally by display
  // name (per-source tabs keep the registry's curated order); each entry keeps
  // its <sourceId>/<name> identity.
  const catalog =
    resolvedActiveSourceId === "all"
      ? Object.values(catalogs)
          .flat()
          .sort(
            (left, right) =>
              left.displayName.localeCompare(right.displayName, "zh-CN") ||
              left.id.localeCompare(right.id, "en"),
          )
      : (catalogs[resolvedActiveSourceId] ?? []);
  // HTTP registries cannot serve directory content, so local-path artifacts are
  // listed but not installable there; the CLI surfaces the same rule as an
  // install-time error.
  const isInstallUnsupported = (item: DesktopMarketplaceCatalogEntry) =>
    item.artifactKind === "local" &&
    sources.find((source) => source.id === item.sourceId)?.kind === "http-index";
  const detailItem = detailExtensionId
    ? (catalog.find((item) => item.id === detailExtensionId) ??
      Object.values(catalogs)
        .flat()
        .find((item) => item.id === detailExtensionId))
    : undefined;

  const filteredExtensions = catalog.filter((item) => {
    const query = searchText.trim().toLowerCase();
    if (!query) {
      return true;
    }

    return [
      item.displayName,
      item.description ?? "",
      item.author?.name ?? "",
      item.name,
      ...(item.categories ?? []),
    ]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });

  const listEmpty = filteredExtensions.length === 0;

  const openDetail = (extensionId: string) => {
    setDetailExtensionId(extensionId);
  };

  const closeDetail = () => {
    setDetailExtensionId(null);
  };

  const runInstallAction = useCallback(async (extensionId: string, action: () => Promise<void>) => {
    setInstallBusyIds((prev) => {
      const next = new Set(prev);
      next.add(extensionId);
      return next;
    });
    try {
      await action();
    } finally {
      setInstallBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(extensionId);
        return next;
      });
    }
  }, []);

  const handleToggleEnabled = (item: DesktopMarketplaceCatalogEntry) => {
    void (async () => {
      try {
        await onSetExtensionEnabled({ id: item.id, enabled: !item.enabled });
      } catch {
        /* runtimeError */
      }
    })();
  };

  const installWithReviewGate = useCallback(
    async (item: DesktopMarketplaceCatalogEntry) => {
      const request = {
        name: item.name,
        marketplace: item.sourceName,
      };
      const result = await onInstallMarketplaceExtension(request);
      if (result.status === "review-required") {
        setReviewGate({
          extensionId: result.extensionId,
          displayName: item.displayName,
          reviewStatus: result.reviewStatus,
          retry: async () => {
            await onInstallMarketplaceExtension({ ...request, reviewAcknowledged: true });
          },
        });
      }
    },
    [onInstallMarketplaceExtension],
  );

  const handleInstall = (item: DesktopMarketplaceCatalogEntry) => {
    void runInstallAction(item.id, async () => {
      try {
        await installWithReviewGate(item);
      } catch {
        /* runtimeError */
      }
    });
  };

  const updateWithReviewGate = useCallback(
    async (item: DesktopMarketplaceCatalogEntry) => {
      const result = await onUpdateExtension({ id: item.id });
      if (result.status === "review-required") {
        setReviewGate({
          extensionId: result.extensionId,
          displayName: item.displayName,
          reviewStatus: result.reviewStatus,
          retry: async () => {
            await onUpdateExtension({ id: item.id, reviewAcknowledged: true });
          },
        });
      }
    },
    [onUpdateExtension],
  );

  const handleUpdate = (item: DesktopMarketplaceCatalogEntry) => {
    void runInstallAction(item.id, async () => {
      try {
        await updateWithReviewGate(item);
      } catch {
        /* runtimeError */
      }
    });
  };

  const handleAddFromDisk = () => {
    void (async () => {
      const directory = await onPickMarketplaceDirectory();
      if (!directory) {
        return;
      }
      try {
        const result = await onAddMarketplaceSource({ locator: directory });
        if (result.sourceId) {
          setActiveSourceId(result.sourceId);
        }
      } catch {
        /* runtimeError */
      }
    })();
  };

  const handleAddFromUrl = async (request: AddMarketplaceSourceRequest) => {
    const result = await onAddMarketplaceSource(request);
    if (result.sourceId) {
      setActiveSourceId(result.sourceId);
    }
  };

  const handleRemoveSource = (source: DesktopMarketplaceSource) => {
    setRemoveSourceTarget(source);
    setRemoveSourceDialogOpen(true);
  };

  const dismissRemoveSourceDialog = useCallback(() => {
    setRemoveSourceDialogOpen(false);
    runAfterRadixOverlayClose(() => {
      setRemoveSourceTarget(null);
    });
  }, []);

  return (
    <div
      data-spirit-surface="marketplace-shell"
      className="relative flex min-h-0 min-w-0 flex-1 flex-col text-sm"
    >
      <input
        ref={inputRef}
        type="file"
        accept=".zip,application/zip"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) {
            return;
          }

          void (async () => {
            try {
              const archiveBase64 = await fileToBase64(file);
              await onImportExtension({
                archiveBase64,
                fileName: file.name,
              });
            } catch {
              /* runtimeError */
            }
          })();
        }}
      />

      {detailExtensionId === null ? (
        <>
          <ScrollArea
            ref={setListScrollRoot}
            className="min-h-0 flex-1"
            type="hover"
            scrollHideDelay={450}
            style={listScrollRootStyle}
          >
            <div className={cn("mx-auto w-full px-4 pb-8", MARKETPLACE_LIST_W)}>
              {/* The top gap and title scroll away; the search bar (overlay sibling of the
                  ScrollArea) docks once they are consumed. The placeholder reserves its
                  flow space. */}
              <div className="h-8" aria-hidden />
              <div ref={setTitleElement} className="space-y-1 pb-4">
                <h1 className={cn("flex items-center gap-2", DESKTOP_PAGE_TITLE_CLASS)}>
                  {t("marketplace.title")}
                  {snapshot?.extensionsLoading ? (
                    <LoaderCircle
                      className="size-4 animate-spin text-muted-foreground"
                      aria-label={t("common.loading")}
                    />
                  ) : null}
                </h1>
                <p className="text-sm text-muted-foreground">{t("marketplace.subtitle")}</p>
              </div>
              {/* Pin sentinel: when it scrolls above the viewport top, the search bar is
                  docked (see useStickyHeaderPinned). */}
              <div
                ref={stickySentinelRef}
                className="pointer-events-none h-px w-full -mb-px"
                aria-hidden
              />
              <div aria-hidden style={{ height: headerHeight ?? 0 }} />
              {/* Marketplace domain tabs: below the search box, scroll away with the title,
                  horizontal scroll instead of wrapping. pt-4 mirrors the pre-tabs flow gap
                  between the search bar and the list (the pinned band carries no bottom
                  padding; its fade mask only softens the transition). The row hides
                  entirely when no tab is visible (all sources empty). */}
              {showAll ? (
                <div
                  className="flex items-center gap-1 overflow-x-auto whitespace-nowrap pb-3 pt-4"
                  role="tablist"
                  aria-label={t("marketplace.tabsLabel")}
                >
                  {/* The All tab is pinned first and is the page default; it is a
                      pseudo source, so it carries no per-source context menu. */}
                  <Toggle
                    size="sm"
                    pressed={resolvedActiveSourceId === "all"}
                    onPressedChange={() => setActiveSourceId("all")}
                    aria-label={t("marketplace.tabAll")}
                  >
                    {t("marketplace.tabAll")}
                  </Toggle>
                  {visibleSources.map((source) => (
                    <MarketplaceSourceTab
                      key={source.id}
                      source={source}
                      active={resolvedActiveSourceId === source.id}
                      onSelect={setActiveSourceId}
                      onRemove={handleRemoveSource}
                    />
                  ))}
                </div>
              ) : null}

              {listEmpty ? (
                catalog.length === 0 ? (
                  // With the tab bar hidden the card becomes the first content below
                  // the docked search header, which carries no bottom gap of its
                  // own — like the toggle row, the card brings its own top
                  // whitespace instead.
                  <EmptyCard className={showAll ? undefined : "mt-4"}>
                    {t("marketplace.empty")}
                  </EmptyCard>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("marketplace.noMatches")}</p>
                )
              ) : (
                <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
                  {filteredExtensions.map((item) => (
                    <div
                      key={item.id}
                      className={cn(
                        // Ghost row: no card surface (border/background); hover only lays the
                        // sidebar-style semi-transparent canvas wash (instant, no color fade).
                        "flex w-full items-center rounded-lg hover:bg-canvas-hover",
                        item.installed && !item.enabled && "opacity-55",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => openDetail(item.id)}
                        className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-3 pr-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                      >
                        <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border/50 bg-muted text-muted-foreground">
                          {item.iconUrl ? (
                            <img
                              src={item.iconUrl}
                              alt=""
                              className="size-full object-cover"
                              aria-hidden
                            />
                          ) : (
                            <Sparkles className="size-4" aria-hidden />
                          )}
                        </div>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-normal leading-snug text-foreground">
                            {item.displayName}
                          </span>
                          {item.description ? (
                            <span className="block truncate text-xs leading-snug text-muted-foreground">
                              {item.description}
                            </span>
                          ) : null}
                        </span>
                      </button>
                      <div className="shrink-0 pr-2">
                        {item.installed ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="size-8 shrink-0 self-center"
                                title={t("marketplace.moreActions")}
                              >
                                <Ellipsis className="size-4" aria-hidden />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="min-w-40 p-0">
                              <div className="p-1">
                                <DropdownMenuItem
                                  className="gap-2"
                                  onSelect={() => handleToggleEnabled(item)}
                                >
                                  <span>
                                    {item.enabled
                                      ? t("marketplace.disable")
                                      : t("marketplace.enable")}
                                  </span>
                                </DropdownMenuItem>
                              </div>
                              <DropdownMenuSeparator />
                              <div className="p-1">
                                <DropdownMenuItem
                                  variant="destructive"
                                  className="gap-2"
                                  onSelect={() => setUninstallTarget(item)}
                                >
                                  <Trash2 className="size-3.5 shrink-0" aria-hidden />
                                  <span>{t("marketplace.uninstall")}</span>
                                </DropdownMenuItem>
                              </div>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : isInstallUnsupported(item) ? (
                          <Tooltip delayDuration={300} disableHoverableContent>
                            <TooltipTrigger>
                              <Button
                                type="button"
                                variant="outline"
                                disabled
                                className="shrink-0 self-center"
                              >
                                {t("marketplace.install")}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              {t("marketplace.httpLocalSourceInstallUnsupported")}
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <Button
                            type="button"
                            variant="outline"
                            disabled={installBusyIds.has(item.id)}
                            className="shrink-0 self-center"
                            onClick={() => handleInstall(item)}
                          >
                            {t("marketplace.install")}
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </ScrollArea>
          <div
            ref={setHeaderElement}
            className="absolute inset-x-0 top-0 z-20"
            // Base position below the title; applies only while the dock animation is not
            // running (list not overflowing) or as the pre-effect value. The WAAPI scroll
            // animation overrides it on the compositor; the JS fallback listener overrides
            // it on engines without ScrollTimeline support.
            style={{ transform: `translateY(${headerDockOffset}px)` }}
          >
            <div
              className={cn(
                "mx-auto w-full px-4",
                MARKETPLACE_LIST_W,
                headerPinned && !useTranslucency ? "bg-background" : "bg-transparent",
              )}
            >
              <div className="flex items-center gap-2">
                <div
                  className={cn(
                    "relative min-w-0 flex-1",
                    DESKTOP_OVERLAY_LIST_FILTER_INPUT_SHELL,
                    "rounded-full",
                  )}
                >
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 z-10 size-3.5 -translate-y-1/2 text-muted-foreground"
                    aria-hidden
                  />
                  <Input
                    value={searchText}
                    onChange={(event) => setSearchText(event.target.value)}
                    placeholder={t("marketplace.searchPlaceholder")}
                    className={cn(DESKTOP_FORM_INPUT_INNER, "pl-9 pr-3.5")}
                  />
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      size="sm"
                      className="h-8 shrink-0 gap-1 rounded-full px-3.5"
                      disabled={extensionsInstalling}
                    >
                      {extensionsInstalling ? (
                        <LoaderCircle className="size-4 animate-spin" aria-hidden />
                      ) : null}
                      {t("common.add")}
                      <ChevronDown className="size-3.5 shrink-0" aria-hidden />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-44 p-1">
                    <DropdownMenuItem className="gap-2" onSelect={() => inputRef.current?.click()}>
                      <Blocks className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                      {t("marketplace.importExtension")}
                    </DropdownMenuItem>
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger className="gap-2">
                        <Store className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                        {t("marketplace.addMarketplace")}
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="min-w-44 p-1">
                        <DropdownMenuItem className="gap-2" onSelect={handleAddFromDisk}>
                          <Folder className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                          {t("marketplace.addFromDisk")}
                        </DropdownMenuItem>
                        <DropdownMenuItem className="gap-2" onSelect={() => setAddSourceOpen(true)}>
                          <Globe className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                          {t("marketplace.addFromUrl")}
                        </DropdownMenuItem>
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>
        </>
      ) : detailItem ? (
        <MarketplaceDetailView
          item={detailItem}
          onBack={closeDetail}
          itemActionBusy={installBusyIds.has(detailItem.id)}
          installUnsupported={isInstallUnsupported(detailItem)}
          onInstall={() => handleInstall(detailItem)}
          onUpdate={() => handleUpdate(detailItem)}
          onToggleEnabled={() => handleToggleEnabled(detailItem)}
          onRequestUninstall={() => setUninstallTarget(detailItem)}
          useTranslucency={useTranslucency}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className={cn("shrink-0", desktopTranslucencyTintInnerClass(useTranslucency))}>
            <div className="mx-auto flex items-center px-3 py-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  "-ml-2 h-8 gap-1 text-muted-foreground hover:text-sidebar-foreground",
                  instantHoverMotionClass,
                )}
                onClick={closeDetail}
              >
                <ArrowLeft className="size-4" aria-hidden />
                {t("common.back")}
              </Button>
            </div>
          </div>
          <div className="flex flex-1 items-center justify-center px-6 text-sm text-muted-foreground">
            {t("marketplace.extensionNotFound")}
          </div>
        </div>
      )}

      <MarketplaceAddSourceDialog
        open={addSourceOpen}
        onOpenChange={setAddSourceOpen}
        busy={extensionsBusy}
        onSubmit={handleAddFromUrl}
      />

      <Dialog
        open={reviewGate !== null}
        onOpenChange={(open) => {
          if (!open) {
            setReviewGate(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton>
          <DialogHeader>
            <DialogTitle>{t("marketplace.reviewRequiredTitle")}</DialogTitle>
            <DialogDescription>
              {t(
                reviewGate?.reviewStatus === "revoked"
                  ? "marketplace.reviewRequiredRevoked"
                  : "marketplace.reviewRequiredUnverified",
                { name: reviewGate?.displayName ?? "" },
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogFooterActions>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setReviewGate(null)}
                disabled={extensionsBusy}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={extensionsBusy || !reviewGate}
                onClick={() => {
                  const target = reviewGate;
                  if (!target) {
                    return;
                  }
                  void runInstallAction(target.extensionId, async () => {
                    try {
                      await target.retry(true);
                      setReviewGate(null);
                    } catch {
                      /* runtimeError */
                    }
                  });
                }}
              >
                {extensionsBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                {t("marketplace.reviewRequiredContinue")}
              </Button>
            </DialogFooterActions>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={removeSourceDialogOpen}
        onOpenChange={(open) => {
          if (open) {
            setRemoveSourceDialogOpen(true);
          } else if (!extensionsBusy) {
            dismissRemoveSourceDialog();
          }
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton={!extensionsBusy}>
          <DialogHeader>
            <DialogTitle>{t("marketplace.removeMarketplaceTitle")}</DialogTitle>
            <DialogDescription>
              {t("marketplace.removeMarketplaceConfirm", {
                name: removeSourceTarget?.displayName ?? "",
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogFooterActions>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  if (!extensionsBusy) {
                    dismissRemoveSourceDialog();
                  }
                }}
                disabled={extensionsBusy}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={extensionsBusy || !removeSourceTarget}
                onClick={() => {
                  const target = removeSourceTarget;
                  if (!target) {
                    return;
                  }
                  void (async () => {
                    try {
                      await onRemoveMarketplaceSource({ name: target.name });
                      if (resolvedActiveSourceId === target.id) {
                        setActiveSourceId("built-in");
                      }
                      dismissRemoveSourceDialog();
                    } catch {
                      /* runtimeError */
                    }
                  })();
                }}
              >
                {extensionsBusy ? (
                  <LoaderCircle className="size-4 animate-spin" aria-hidden />
                ) : null}
                {t("marketplace.removeMarketplace")}
              </Button>
            </DialogFooterActions>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={uninstallTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setUninstallTarget(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton>
          <DialogHeader>
            <DialogTitle>{t("marketplace.uninstallExtension")}</DialogTitle>
            <DialogDescription>
              {t(
                uninstallTarget?.sourceId === "built-in"
                  ? "marketplace.uninstallBuiltInConfirm"
                  : uninstallTarget?.sourceId === "personal"
                    ? "marketplace.uninstallPersonalConfirm"
                    : "marketplace.uninstallExtensionConfirm",
                {
                  name: uninstallTarget?.displayName ?? "",
                },
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogFooterActions>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setUninstallTarget(null)}
                disabled={extensionsBusy}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={extensionsBusy || !uninstallTarget}
                onClick={() => {
                  const target = uninstallTarget;
                  if (!target) {
                    return;
                  }
                  void (async () => {
                    try {
                      await onDeleteExtension({ id: target.id });
                      setUninstallTarget(null);
                    } catch {
                      /* runtimeError */
                    }
                  })();
                }}
              >
                {extensionsBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                {t("marketplace.uninstall")}
              </Button>
            </DialogFooterActions>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
