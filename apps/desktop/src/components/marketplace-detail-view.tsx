// Extension detail page backed by the marketplace catalog entry (registry data + install state).

import { useTranslation } from "react-i18next";

import { ArrowLeft, Ellipsis, Sparkles, Trash2 } from "lucide-react";

import { MarketplaceContributionGroups } from "@/components/marketplace-contribution-groups";
import { reviewStatusBadgeVariant } from "@/components/marketplace-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { instantHoverMotionClass } from "@/lib/desktop-chrome";
import { desktopTranslucencyTintInnerClass } from "@/lib/desktop-translucency-surface";
import { cn } from "@/lib/utils";
import type { DesktopMarketplaceCatalogEntry } from "@/types";

/** Matches the marketplace entry page content width */
const MARKETPLACE_READING_W = "max-w-4xl";

type MarketplaceDetailViewProps = {
  item: DesktopMarketplaceCatalogEntry;
  onBack: () => void;
  /** True while this item's install or update is in flight. */
  itemActionBusy?: boolean;
  /** HTTP registries cannot serve local-path artifacts: disable install and explain via tooltip. */
  installUnsupported?: boolean;
  onInstall: () => void;
  onUpdate: () => void;
  onToggleEnabled: () => void;
  onRequestUninstall: () => void;
  /** Windows Mica / macOS Vibrancy: the inner layer is transparent to avoid double-tint darkening with marketplace-layout. */
  useTranslucency?: boolean;
};

export function MarketplaceDetailView({
  item,
  onBack,
  itemActionBusy = false,
  installUnsupported = false,
  onInstall,
  onUpdate,
  onToggleEnabled,
  onRequestUninstall,
  useTranslucency = false,
}: MarketplaceDetailViewProps) {
  const { t } = useTranslation();

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
          <div className="flex min-w-0 items-center">
            <div className="flex min-w-0 flex-1 items-center gap-3 pr-3">
              <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border/50 bg-muted text-muted-foreground">
                {item.iconUrl ? (
                  <img src={item.iconUrl} alt="" className="size-full object-cover" aria-hidden />
                ) : (
                  <Sparkles className="size-[18px]" aria-hidden />
                )}
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex min-w-0 items-center gap-x-2">
                  <h2 className="min-w-0 truncate text-base font-normal leading-snug tracking-tight text-foreground">
                    {item.displayName}
                  </h2>
                  <Badge variant="secondary" className="shrink-0 text-[10px] font-normal">
                    {item.version}
                  </Badge>
                  <Badge
                    variant={reviewStatusBadgeVariant(item.reviewStatus)}
                    className="shrink-0 text-[10px] font-normal"
                  >
                    {t(`marketplace.review.${item.reviewStatus}`)}
                  </Badge>
                </div>
                {item.author || item.description ? (
                  <p className="truncate text-sm leading-snug text-muted-foreground">
                    {item.author ? (
                      <span className="text-muted-foreground">{item.author.name}</span>
                    ) : null}
                    {item.author ? <span className="text-muted-foreground/70"> · </span> : null}
                    {item.description}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {item.installed ? (
                <>
                  {/* The installed-state overflow menu sits left of the update button. */}
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
                        <DropdownMenuItem className="gap-2" onSelect={onToggleEnabled}>
                          <span>
                            {item.enabled ? t("marketplace.disable") : t("marketplace.enable")}
                          </span>
                        </DropdownMenuItem>
                      </div>
                      <DropdownMenuSeparator />
                      <div className="p-1">
                        <DropdownMenuItem
                          variant="destructive"
                          className="gap-2"
                          onSelect={onRequestUninstall}
                        >
                          <Trash2 className="size-3.5 shrink-0" aria-hidden />
                          <span>{t("marketplace.uninstall")}</span>
                        </DropdownMenuItem>
                      </div>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  {item.updateAvailable ? (
                    <Button
                      type="button"
                      variant="default"
                      disabled={itemActionBusy}
                      className="shrink-0 self-center"
                      onClick={onUpdate}
                    >
                      {t("marketplace.update")}
                    </Button>
                  ) : null}
                </>
              ) : installUnsupported ? (
                <Tooltip delayDuration={300} disableHoverableContent>
                  <TooltipTrigger>
                    <Button
                      type="button"
                      variant="default"
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
                  variant="default"
                  disabled={itemActionBusy}
                  className="shrink-0 self-center"
                  onClick={onInstall}
                >
                  {t("marketplace.install")}
                </Button>
              )}
            </div>
          </div>

          <MarketplaceContributionGroups item={item} />
        </div>
      </ScrollArea>
    </>
  );
}
