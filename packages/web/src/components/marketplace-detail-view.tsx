// Extension detail page backed by the marketplace catalog entry (registry data + install state).
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { ArrowLeft, Sparkles } from "lucide-react";

import { MarketplaceContributionGroups } from "@/components/marketplace-contribution-groups";
import { MarketplaceInstalledExtensionActions } from "@/components/marketplace-installed-extension-actions";
import { MarketplaceInformationSection } from "@/components/marketplace-information-section";
import { reviewStatusBadgeVariant } from "@/components/marketplace-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { instantHoverMotionClass } from "@/lib/desktop-chrome";
import { shouldTriggerEscapeShortcut } from "@/lib/desktop-keyboard-shortcut-eligibility";
import { desktopTranslucencyTintInnerClass } from "@/lib/desktop-translucency-surface";
import { cn } from "@/lib/utils";
import {
  CONVERSATION_GUTTER_X,
  CONVERSATION_MESSAGE_LIST_MAX_W,
} from "@/lib/conversation-layout-constants";
import type { DesktopExtensionAuthorization, DesktopMarketplaceCatalogEntry } from "@/types";

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
  onAuthorize?: (
    item: DesktopMarketplaceCatalogEntry,
    authorization: DesktopExtensionAuthorization,
  ) => void;
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
  onAuthorize,
  useTranslucency = false,
}: MarketplaceDetailViewProps) {
  const { t } = useTranslation();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!shouldTriggerEscapeShortcut(event)) {
        return;
      }
      event.preventDefault();
      onBack();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onBack]);

  return (
    <>
      <div className={cn("shrink-0", desktopTranslucencyTintInnerClass(useTranslucency))}>
        <div
          className={cn(
            "mx-auto flex items-center py-2",
            CONVERSATION_GUTTER_X,
            CONVERSATION_MESSAGE_LIST_MAX_W,
          )}
        >
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              "-ml-2 h-8 gap-1 text-muted-foreground hover:text-chrome-emphasis",
              instantHoverMotionClass,
            )}
            onClick={onBack}
          >
            <ArrowLeft className="size-4" aria-hidden strokeWidth={1.75} />
            {t("common.back")}
          </Button>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1" type="hover" scrollHideDelay={450}>
        <div
          className={cn(
            "mx-auto w-full space-y-6 pb-12 pt-5",
            CONVERSATION_GUTTER_X,
            CONVERSATION_MESSAGE_LIST_MAX_W,
          )}
        >
          {/* Detail top bar: icon and text vertically centered; body compressed to a title row + single-line summary (author merged into the summary prefix) */}
          <div className="flex min-w-0 items-center">
            <div className="flex min-w-0 flex-1 items-center gap-3 pr-3">
              <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border/50 bg-muted text-muted-foreground">
                {item.iconUrl ? (
                  <img src={item.iconUrl} alt="" className="size-full object-cover" aria-hidden />
                ) : (
                  <Sparkles className="size-[18px]" aria-hidden strokeWidth={1.75} />
                )}
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex min-w-0 items-center gap-x-2">
                  <h2 className="min-w-0 truncate text-base font-normal leading-snug tracking-tight text-foreground">
                    {item.displayName}
                  </h2>
                  <Badge
                    variant={reviewStatusBadgeVariant(item.reviewStatus)}
                    className="shrink-0 text-[10px] font-normal"
                  >
                    {t(`marketplace.review.${item.reviewStatus}`)}
                  </Badge>
                </div>
                {item.description ? (
                  <p className="truncate text-sm leading-snug text-muted-foreground">
                    {item.description}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {item.installed ? (
                <>
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
                  <MarketplaceInstalledExtensionActions
                    item={item}
                    authorizationVariant="default"
                    disabled={itemActionBusy}
                    onToggleEnabled={onToggleEnabled}
                    onRequestUninstall={onRequestUninstall}
                    onAuthorize={onAuthorize}
                  />
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
          <MarketplaceInformationSection item={item} />
        </div>
      </ScrollArea>
    </>
  );
}
