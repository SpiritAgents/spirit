// Extension detail page backed entirely by local data: installed extension metadata.

import { useTranslation } from "react-i18next";

import { ArrowLeft, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { instantHoverMotionClass } from "@/lib/desktop-chrome";
import { desktopTranslucencyTintInnerClass } from "@/lib/desktop-translucency-surface";
import { cn } from "@/lib/utils";
import type { DesktopExtensionListItem } from "@/types";

/** Matches the conversation body text for visual continuity */
const MARKETPLACE_READING_W = "max-w-[min(86vw,44rem)]";

type MarketplaceDetailViewProps = {
  item: DesktopExtensionListItem;
  onBack: () => void;
  /** Windows Mica / macOS Vibrancy: the inner layer is transparent to avoid double-tint darkening with marketplace-layout. */
  useTranslucency?: boolean;
};

export function MarketplaceDetailView({
  item,
  onBack,
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
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-md border border-border/50 bg-muted text-muted-foreground">
              <Sparkles className="size-[18px]" aria-hidden />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <h2 className="text-base font-normal leading-snug tracking-tight text-foreground">
                  {item.displayName}
                </h2>
                <Badge variant="secondary" className="text-[10px] font-normal">
                  {item.version}
                </Badge>
              </div>
              {item.author || item.description ? (
                <p className="text-sm leading-snug text-muted-foreground line-clamp-2">
                  {item.author ? (
                    <span className="text-muted-foreground">{item.author}</span>
                  ) : null}
                  {item.author ? <span className="text-muted-foreground/70"> · </span> : null}
                  {item.description}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </ScrollArea>
    </>
  );
}
