// Extension detail page retained for a future user-defined extension marketplace.
// It is intentionally not wired into MarketplaceView: the online registry it fetched
// from has been removed, and extension cards no longer navigate here.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import i18n from "@/lib/i18n";
import { ArrowLeft, ArrowLeftRight, Download, LoaderCircle, Sparkles } from "lucide-react";

import { MarkdownMessage } from "@/components/markdown-message";
import { Badge } from "@/components/ui/badge";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { instantHoverMotionClass } from "@/lib/desktop-chrome";
import { desktopTranslucencyTintInnerClass } from "@/lib/desktop-translucency-surface";
import { showDesktopErrorToast } from "@/lib/desktop-error-toast";
import { cn } from "@/lib/utils";
import type {
  DesktopExtensionListItem,
  DesktopMarketplaceCatalogItem,
  DesktopMarketplaceDetail,
  DesktopMarketplacePreparedInstall,
} from "@/types";

/** Matches the conversation body text for visual continuity */
const MARKETPLACE_READING_W = "max-w-[min(86vw,44rem)]";

type MarketplaceTab = "readme" | "changelog" | "versions";

type PendingInstall = {
  extensionId: string;
  version: string;
  displayName: string;
  reviewStatus: DesktopMarketplacePreparedInstall["reviewStatus"];
};

function reviewStatusBadgeVariant(status: DesktopMarketplaceCatalogItem["defaultReviewStatus"]) {
  if (status === "verified") {
    return "secondary" as const;
  }
  if (status === "revoked") {
    return "destructive" as const;
  }
  return "outline" as const;
}

function reviewStatusLabel(status: DesktopMarketplaceCatalogItem["defaultReviewStatus"]) {
  if (status === "verified") {
    return i18n.t("marketplace.verified");
  }
  if (status === "revoked") {
    return i18n.t("marketplace.revoked");
  }
  return i18n.t("marketplace.unverified");
}

function installedExtensionForCatalog(
  catalog: DesktopMarketplaceCatalogItem,
  installed: DesktopExtensionListItem[],
): DesktopExtensionListItem | undefined {
  return installed.find(
    (item) => item.id === catalog.extensionId || item.id === catalog.packageName,
  );
}

function installedBadgeLabel(installed: DesktopExtensionListItem, targetVersion: string) {
  if (installed.version === targetVersion) {
    return i18n.t("marketplace.installedVersion", { version: installed.version });
  }
  return i18n.t("marketplace.updateAvailable", {
    current: installed.version,
    target: targetVersion,
  });
}

type MarketplaceDetailViewProps = {
  catalogItem: DesktopMarketplaceCatalogItem;
  installedExtensions: DesktopExtensionListItem[];
  busy: boolean;
  onBack: () => void;
  onGetMarketplaceExtensionDetail: (extensionId: string) => Promise<DesktopMarketplaceDetail>;
  onGetMarketplaceExtensionReadme: (extensionId: string) => Promise<string>;
  onPrepareMarketplaceExtensionInstall: (request: {
    extensionId: string;
    version?: string;
  }) => Promise<DesktopMarketplacePreparedInstall>;
  onInstallMarketplaceExtension: (request: {
    extensionId: string;
    version?: string;
    reviewAcknowledged?: boolean;
  }) => Promise<void>;
  /** Windows Mica / macOS Vibrancy: the inner layer is transparent to avoid double-tint darkening with marketplace-layout. */
  useTranslucency?: boolean;
};

export function MarketplaceDetailView({
  catalogItem,
  installedExtensions,
  busy,
  onBack,
  onGetMarketplaceExtensionDetail,
  onGetMarketplaceExtensionReadme,
  onPrepareMarketplaceExtensionInstall,
  onInstallMarketplaceExtension,
  useTranslucency = false,
}: MarketplaceDetailViewProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<MarketplaceTab>("readme");
  const [detail, setDetail] = useState<DesktopMarketplaceDetail | null>(null);
  const [readme, setReadme] = useState<string | undefined>(undefined);
  const [localError, setLocalError] = useState("");
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [loadingReadme, setLoadingReadme] = useState(false);
  const [pendingInstall, setPendingInstall] = useState<PendingInstall | null>(null);

  const installedItem = installedExtensionForCatalog(catalogItem, installedExtensions);
  /** Catalog-recommended / registry-latest default version (no "selected version" state; this is the only top-bar install target) */
  const latestVersion = detail?.defaultVersion ?? catalogItem.defaultVersion;
  /** Top-bar primary button: only compares "catalog default latest vs locally installed version"; there is no separate selected-version state */
  const headerPrimaryDisabled =
    busy ||
    !latestVersion ||
    (installedItem !== undefined && installedItem.version === latestVersion);
  const headerPrimaryTitle = !latestVersion
    ? undefined
    : installedItem
      ? installedItem.version === latestVersion
        ? t("marketplace.alreadyLatest")
        : t("marketplace.goToVersionList")
      : t("marketplace.installVersion", { version: latestVersion });

  useEffect(() => {
    showDesktopErrorToast(localError, "marketplace-detail-local-error");
  }, [localError]);

  useEffect(() => {
    if (detail) {
      return;
    }

    let cancelled = false;
    setLoadingDetail(true);
    setLocalError("");

    void onGetMarketplaceExtensionDetail(catalogItem.extensionId)
      .then((next) => {
        if (!cancelled) {
          setDetail(next);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setLocalError(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingDetail(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [detail, catalogItem.extensionId, onGetMarketplaceExtensionDetail]);

  useEffect(() => {
    if (activeTab !== "readme" || readme !== undefined) {
      return;
    }

    let cancelled = false;
    setLoadingReadme(true);
    setLocalError("");

    void onGetMarketplaceExtensionReadme(catalogItem.extensionId)
      .then((next) => {
        if (!cancelled) {
          setReadme(next);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setLocalError(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingReadme(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeTab, catalogItem.extensionId, onGetMarketplaceExtensionReadme, readme]);

  const prepareInstall = async (request: {
    extensionId: string;
    version?: string;
  }): Promise<DesktopMarketplacePreparedInstall | null> => {
    try {
      const prepared = await onPrepareMarketplaceExtensionInstall(request);
      if (!prepared.supportsCurrentHost) {
        setLocalError(
          t("marketplace.extensionNotSupported", {
            name: prepared.displayName,
            version: prepared.version,
          }),
        );
        return null;
      }
      setPendingInstall(null);
      setLocalError("");
      return prepared;
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
      return null;
    }
  };

  const installSelectedVersion = async (
    reviewAcknowledged: boolean,
    payload: { extensionId: string; version: string },
  ) => {
    const { extensionId, version } = payload;
    if (!extensionId || !version) {
      return;
    }

    try {
      await onInstallMarketplaceExtension({
        extensionId,
        version,
        ...(reviewAcknowledged ? { reviewAcknowledged: true } : {}),
      });
      setPendingInstall(null);
      setLocalError("");
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    }
  };

  const requestInstallLatest = async () => {
    if (!latestVersion) {
      return;
    }
    const prepared = await prepareInstall({
      extensionId: catalogItem.extensionId,
      version: latestVersion,
    });
    if (!prepared) {
      return;
    }
    if (prepared.reviewStatus !== "verified") {
      setPendingInstall({
        extensionId: prepared.extensionId,
        version: prepared.version,
        displayName: prepared.displayName,
        reviewStatus: prepared.reviewStatus,
      });
      return;
    }
    await installSelectedVersion(false, {
      extensionId: prepared.extensionId,
      version: prepared.version,
    });
  };

  const handleHeaderPrimaryClick = () => {
    if (!latestVersion || busy) {
      return;
    }
    if (installedItem) {
      setActiveTab("versions");
      return;
    }
    void requestInstallLatest();
  };

  const requestInstallVersion = async (version: string) => {
    const prepared = await prepareInstall({
      extensionId: catalogItem.extensionId,
      version,
    });
    if (!prepared) {
      return;
    }
    if (prepared.reviewStatus !== "verified") {
      setPendingInstall({
        extensionId: prepared.extensionId,
        version: prepared.version,
        displayName: prepared.displayName,
        reviewStatus: prepared.reviewStatus,
      });
      return;
    }
    await installSelectedVersion(false, {
      extensionId: prepared.extensionId,
      version: prepared.version,
    });
  };

  return (
    <>
      <div className={cn("shrink-0", desktopTranslucencyTintInnerClass(useTranslucency))}>
        <div className={cn("mx-auto flex items-center px-3 py-2", MARKETPLACE_READING_W)}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              "-ml-2 h-8 gap-1 text-muted-foreground hover:text-sidebar-foreground",
              instantHoverMotionClass,
            )}
            onClick={onBack}
          >
            <ArrowLeft className="size-4" aria-hidden />
            {t("common.back")}
          </Button>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1" type="hover" scrollHideDelay={450}>
        <div className={cn("mx-auto w-full space-y-4 px-3 pb-12 pt-5", MARKETPLACE_READING_W)}>
          {/* Detail top bar: icon and text vertically centered; body compressed to a title row + single-line summary (author merged into the summary prefix) */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              {catalogItem.iconUrl ? (
                <img
                  src={catalogItem.iconUrl}
                  alt=""
                  className="size-11 shrink-0 rounded-md border border-border/50 bg-muted object-cover"
                />
              ) : (
                <div className="flex size-11 shrink-0 items-center justify-center rounded-md border border-border/50 bg-muted text-muted-foreground">
                  <Sparkles className="size-[18px]" aria-hidden />
                </div>
              )}
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <h2 className="text-base font-normal leading-snug tracking-tight text-foreground">
                    {catalogItem.displayName}
                  </h2>
                  <Badge variant="outline" className="text-[10px] font-normal">
                    {catalogItem.defaultChannel}
                  </Badge>
                  <Badge
                    variant={reviewStatusBadgeVariant(catalogItem.defaultReviewStatus)}
                    className="text-[10px]"
                  >
                    {reviewStatusLabel(catalogItem.defaultReviewStatus)}
                  </Badge>
                  {installedItem ? (
                    <Badge variant="secondary" className="max-w-full truncate text-[10px]">
                      {installedBadgeLabel(installedItem, catalogItem.defaultVersion)}
                    </Badge>
                  ) : null}
                </div>
                <p className="text-sm leading-snug text-muted-foreground line-clamp-2">
                  {catalogItem.author ? (
                    <span className="text-muted-foreground">{catalogItem.author}</span>
                  ) : null}
                  {catalogItem.author ? (
                    <span className="text-muted-foreground/70"> · </span>
                  ) : null}
                  {catalogItem.description}
                </p>
              </div>
            </div>

            <div className="flex shrink-0 flex-col gap-2 sm:w-52 sm:items-end sm:self-center">
              <Button
                type="button"
                size="sm"
                className="w-full sm:w-auto"
                title={headerPrimaryTitle}
                disabled={headerPrimaryDisabled}
                onClick={handleHeaderPrimaryClick}
              >
                {busy ? (
                  <LoaderCircle className="size-4 animate-spin" aria-hidden />
                ) : installedItem ? (
                  <ArrowLeftRight className="size-4" aria-hidden />
                ) : (
                  <Download className="size-4" aria-hidden />
                )}
                {installedItem ? t("marketplace.switch") : t("marketplace.install")}
              </Button>
            </div>
          </div>

          {/* Tabs: no full-width top divider, only the current item's bottom edge */}
          <div className="space-y-4">
            <div className="flex flex-wrap gap-1 pt-0.5">
              {(
                [
                  ["readme", t("marketplace.tabReadme")],
                  ["changelog", t("marketplace.tabChangelog")],
                  ["versions", t("marketplace.tabVersions")],
                ] as const
              ).map(([tabId, label]) => (
                <button
                  key={tabId}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tabId}
                  className={cn(
                    "rounded-md px-3 py-2 text-sm",
                    activeTab === tabId
                      ? "font-normal text-foreground underline decoration-foreground/80 underline-offset-[10px]"
                      : "text-muted-foreground hover:bg-canvas-hover hover:text-sidebar-foreground",
                  )}
                  onClick={() => setActiveTab(tabId)}
                >
                  {label}
                </button>
              ))}
            </div>

            {activeTab === "readme" ? (
              <div className="rounded-lg border border-border/60 bg-background px-3 py-3">
                {loadingReadme ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <LoaderCircle className="size-4 animate-spin" aria-hidden />
                    {t("common.loading")}
                  </div>
                ) : readme ? (
                  <MarkdownMessage content={readme} />
                ) : (
                  <p className="text-sm text-muted-foreground">{t("marketplace.noReadme")}</p>
                )}
              </div>
            ) : null}

            {activeTab === "changelog" ? (
              <div className="space-y-2">
                {detail?.versions.some((version) => version.changelog) ? (
                  detail.versions.map((version) =>
                    version.changelog ? (
                      <div
                        key={version.version}
                        className="rounded-lg border border-border/60 bg-background px-3 py-3"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs text-foreground">{version.version}</span>
                          <Badge variant="outline" className="text-[10px]">
                            {version.channel}
                          </Badge>
                        </div>
                        <p className="mt-2 text-sm leading-relaxed text-foreground">
                          {version.changelog.summary}
                        </p>
                        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                          {version.changelog.body}
                        </p>
                      </div>
                    ) : null,
                  )
                ) : (
                  <p className="text-sm text-muted-foreground">{t("marketplace.noChangelog")}</p>
                )}
              </div>
            ) : null}

            {activeTab === "versions" ? (
              <div className="space-y-2">
                {loadingDetail && !detail ? (
                  <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
                    <LoaderCircle className="size-4 animate-spin" aria-hidden />
                    {t("marketplace.loadingVersions")}
                  </div>
                ) : detail ? (
                  detail.versions.map((version) => {
                    const desktopSupported = version.supportedHosts.includes("desktop");
                    const installedHere = installedItem?.version === version.version;
                    return (
                      <div
                        key={version.version}
                        className="rounded-lg border border-border/60 bg-background px-3 py-3"
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0 flex-1 space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs text-foreground">{version.version}</span>
                              <Badge variant="outline" className="text-[10px]">
                                {version.channel}
                              </Badge>
                              <div className="flex flex-wrap gap-1">
                                {version.supportedHosts.map((host) => (
                                  <Badge
                                    key={host}
                                    variant="outline"
                                    className="text-[10px] font-normal"
                                  >
                                    {host}
                                  </Badge>
                                ))}
                              </div>
                              {installedHere ? (
                                <Badge variant="secondary" className="text-[10px]">
                                  {t("marketplace.installed")}
                                </Badge>
                              ) : null}
                              {!desktopSupported ? (
                                <Badge variant="destructive" className="text-[10px]">
                                  {t("marketplace.unsupportedDesktop")}
                                </Badge>
                              ) : null}
                            </div>
                            {version.description ? (
                              <p className="text-sm leading-relaxed text-muted-foreground">
                                {version.description}
                              </p>
                            ) : null}
                          </div>
                          <div className="flex shrink-0 items-center justify-end sm:pl-2">
                            <Button
                              type="button"
                              size="sm"
                              className="h-8 text-xs"
                              title={
                                installedHere
                                  ? t("marketplace.currentVersionInUse")
                                  : t("marketplace.switchToVersion", {
                                      version: version.version,
                                    })
                              }
                              disabled={busy || !desktopSupported || installedHere}
                              onClick={() => {
                                void requestInstallVersion(version.version);
                              }}
                            >
                              {t("marketplace.switch")}
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </ScrollArea>

      <Dialog
        open={pendingInstall !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingInstall(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg" showCloseButton>
          <DialogHeader>
            <DialogTitle>{t("marketplace.confirmSwitchUnverified")}</DialogTitle>
            <DialogDescription>
              {pendingInstall
                ? pendingInstall.reviewStatus === "revoked"
                  ? t("marketplace.revokedExtensionWarning", {
                      name: pendingInstall.displayName,
                      version: pendingInstall.version,
                    })
                  : t("marketplace.unverifiedExtensionWarning", {
                      name: pendingInstall.displayName,
                      version: pendingInstall.version,
                    })
                : t("marketplace.notVerifiedStatus")}
            </DialogDescription>
          </DialogHeader>

          <div
            className={cn(
              "rounded-md px-3 py-2 text-xs leading-relaxed",
              pendingInstall?.reviewStatus === "revoked"
                ? "border border-destructive/35 bg-destructive/10 text-destructive"
                : "border border-border bg-muted/40 text-foreground",
            )}
          >
            {t("marketplace.switchAdvice")}
          </div>

          <DialogFooter>
            <DialogFooterActions>
              <Button
                type="button"
                variant="outline"
                onClick={() => setPendingInstall(null)}
                disabled={busy}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  if (!pendingInstall) {
                    return;
                  }
                  void installSelectedVersion(true, {
                    extensionId: pendingInstall.extensionId,
                    version: pendingInstall.version,
                  });
                }}
                disabled={busy}
              >
                {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
                {t("marketplace.continueSwitch")}
              </Button>
            </DialogFooterActions>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
