import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { ArrowLeft, Download, Ellipsis, LoaderCircle, Search, Sparkles, Trash2 } from "lucide-react";

import { MarketplaceDetailView } from "@/components/marketplace-detail-view";
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DESKTOP_ITEM_CARD_HOVER_BORDER,
  DESKTOP_ITEM_CARD_SURFACE,
  DESKTOP_OUTLINE_FILL_UNDERLAY,
  DESKTOP_OVERLAY_LIST_FILTER_INPUT_SHELL,
  instantHoverMotionClass,
} from "@/lib/desktop-chrome";
import { desktopTranslucencyTintInnerClass } from "@/lib/desktop-translucency-surface";
import { FONT_WEIGHT_MEDIUM } from "@/lib/desktop-typography";
import { fileToBase64 } from "@/lib/file-to-base64";
import { cn } from "@/lib/utils";
import type {
  DeleteExtensionRequest,
  DesktopExtensionListItem,
  ImportExtensionRequest,
  InstallBuiltInExtensionRequest,
  SetExtensionEnabledRequest,
} from "@/types";

/** Slightly wider list to accommodate two-column cards */
const MARKETPLACE_LIST_W = "max-w-[min(92vw,52rem)]";

type MarketplaceViewProps = {
  snapshot: {
    marketplaceCatalog?: DesktopExtensionListItem[];
    extensionsLoading?: boolean;
  } | null;
  extensionsBusy: boolean;
  onImportExtension: (request: ImportExtensionRequest) => Promise<void>;
  onInstallBuiltInExtension: (request: InstallBuiltInExtensionRequest) => Promise<void>;
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
  onInstallBuiltInExtension,
  onDeleteExtension,
  onSetExtensionEnabled,
  extensionsInstalling = false,
  useTranslucency = false,
}: MarketplaceViewProps) {
  const { t } = useTranslation();
  const [searchText, setSearchText] = useState("");
  const [uninstallTarget, setUninstallTarget] = useState<DesktopExtensionListItem | null>(null);
  /** null = list; non-null = that extension's detail page */
  const [detailExtensionId, setDetailExtensionId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const catalog = snapshot?.marketplaceCatalog ?? [];
  const detailItem = detailExtensionId
    ? catalog.find((item) => item.id === detailExtensionId)
    : undefined;

  const filteredExtensions = catalog.filter((item) => {
    const query = searchText.trim().toLowerCase();
    if (!query) {
      return true;
    }

    return [item.displayName, item.description ?? "", item.author ?? ""]
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

  const handleToggleEnabled = (item: DesktopExtensionListItem) => {
    void (async () => {
      try {
        await onSetExtensionEnabled({ id: item.id, enabled: !item.enabled });
      } catch {
        /* runtimeError */
      }
    })();
  };

  const handleInstallBuiltIn = (item: DesktopExtensionListItem) => {
    void (async () => {
      try {
        await onInstallBuiltInExtension({ id: item.id });
      } catch {
        /* runtimeError */
      }
    })();
  };

  return (
    <div
      data-spirit-surface="marketplace-shell"
      className="flex min-h-0 min-w-0 flex-1 flex-col text-sm"
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
        <ScrollArea className="min-h-0 flex-1" type="hover" scrollHideDelay={450}>
          <div className={cn("mx-auto w-full px-3 pb-12 pt-6 sm:pt-7", MARKETPLACE_LIST_W)}>
            <div className="flex flex-col items-center gap-6">
              <div className="flex w-full flex-col items-center gap-2">
                <p
                  className={cn(
                    "flex items-center gap-2 text-center text-lg tracking-tight text-foreground",
                    FONT_WEIGHT_MEDIUM,
                  )}
                >
                  {t("marketplace.title")}
                  {snapshot?.extensionsLoading ? (
                    <LoaderCircle
                      className="size-4 animate-spin text-muted-foreground"
                      aria-label={t("common.loading")}
                    />
                  ) : null}
                </p>
                <div className="flex w-full max-w-sm items-center gap-1.5">
                  <div
                    className={cn(
                      "relative min-w-0 flex-1",
                      DESKTOP_OVERLAY_LIST_FILTER_INPUT_SHELL,
                    )}
                  >
                    <Search
                      className="pointer-events-none absolute left-2 top-1/2 z-10 size-3.5 -translate-y-1/2 text-muted-foreground"
                      aria-hidden
                    />
                    <Input
                      value={searchText}
                      onChange={(event) => setSearchText(event.target.value)}
                      placeholder={t("marketplace.searchPlaceholder")}
                      className="h-8 rounded-none border-0 bg-transparent pl-8 text-sm shadow-none focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent"
                    />
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 shrink-0"
                    disabled={extensionsInstalling}
                    onClick={() => inputRef.current?.click()}
                  >
                    {extensionsInstalling ? (
                      <LoaderCircle className="size-4 animate-spin" aria-hidden />
                    ) : null}
                    {t("marketplace.install")}
                  </Button>
                </div>
              </div>

              {listEmpty ? (
                <p className="text-center text-sm text-muted-foreground">
                  {catalog.length === 0
                    ? t("marketplace.noExtensionsInstalled")
                    : t("marketplace.noMatches")}
                </p>
              ) : (
                <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
                  {filteredExtensions.map((item) => (
                    <div
                      key={item.id}
                      className={cn(
                        DESKTOP_ITEM_CARD_SURFACE,
                        "relative isolate flex w-full items-center overflow-hidden",
                        DESKTOP_OUTLINE_FILL_UNDERLAY,
                        DESKTOP_ITEM_CARD_HOVER_BORDER,
                        item.installed && !item.enabled && "opacity-55",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => openDetail(item.id)}
                        className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                      >
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border/50 bg-muted text-muted-foreground">
                          <Sparkles className="size-4" aria-hidden />
                        </div>
                        <span className="min-w-0 flex-1 space-y-1">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className="truncate font-normal text-foreground">
                              {item.displayName}
                            </span>
                          </span>
                          {item.description ? (
                            <span className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                              {item.description}
                            </span>
                          ) : null}
                        </span>
                      </button>
                      <div className="shrink-0 pr-1.5">
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
                            {item.installed ? (
                              <>
                                <div className="p-1">
                                  <DropdownMenuItem
                                    disabled={extensionsBusy}
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
                                    disabled={extensionsBusy}
                                    onSelect={() => setUninstallTarget(item)}
                                  >
                                    <Trash2 className="size-3.5 shrink-0" aria-hidden />
                                    <span>{t("marketplace.uninstall")}</span>
                                  </DropdownMenuItem>
                                </div>
                              </>
                            ) : (
                              <div className="p-1">
                                <DropdownMenuItem
                                  disabled={extensionsBusy}
                                  className="gap-2"
                                  onSelect={() => handleInstallBuiltIn(item)}
                                >
                                  <Download className="size-3.5 shrink-0" aria-hidden />
                                  <span>{t("marketplace.install")}</span>
                                </DropdownMenuItem>
                              </div>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </ScrollArea>
      ) : detailItem ? (
        <MarketplaceDetailView
          item={detailItem}
          onBack={closeDetail}
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
                uninstallTarget?.installSource === "built-in"
                  ? "marketplace.uninstallBuiltInConfirm"
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
