// Extension detail page backed entirely by local data: installed extension metadata plus
// package documents (README.md / CHANGELOG.md) read from disk.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { ArrowLeft, Sparkles } from "lucide-react";

import { MarkdownMessage } from "@/components/markdown-message";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { instantHoverMotionClass } from "@/lib/desktop-chrome";
import { desktopTranslucencyTintInnerClass } from "@/lib/desktop-translucency-surface";
import { showDesktopErrorToast } from "@/lib/desktop-error-toast";
import { cn } from "@/lib/utils";
import type { DesktopExtensionListItem } from "@/types";

/** Matches the conversation body text for visual continuity */
const MARKETPLACE_READING_W = "max-w-[min(86vw,44rem)]";

type MarketplaceTab = "readme" | "changelog";

type MarketplaceDetailViewProps = {
  item: DesktopExtensionListItem;
  onBack: () => void;
  onReadExtensionDocument: (request: { id: string; fileName: string }) => Promise<string>;
  /** Windows Mica / macOS Vibrancy: the inner layer is transparent to avoid double-tint darkening with marketplace-layout. */
  useTranslucency?: boolean;
};

export function MarketplaceDetailView({
  item,
  onBack,
  onReadExtensionDocument,
  useTranslucency = false,
}: MarketplaceDetailViewProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<MarketplaceTab>("readme");
  const [documentByTab, setDocumentByTab] = useState<Partial<Record<MarketplaceTab, string>>>({});
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    showDesktopErrorToast(localError, "marketplace-detail-local-error");
  }, [localError]);

  useEffect(() => {
    if (documentByTab[activeTab] !== undefined) {
      return;
    }

    const tab = activeTab;
    let cancelled = false;
    setLocalError("");

    void onReadExtensionDocument({
      id: item.id,
      fileName: tab === "readme" ? "README.md" : "CHANGELOG.md",
    })
      .then((content) => {
        if (!cancelled) {
          setDocumentByTab((current) => ({ ...current, [tab]: content }));
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setLocalError(error instanceof Error ? error.message : String(error));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeTab, documentByTab, item.id, onReadExtensionDocument]);

  const activeDocument = documentByTab[activeTab];

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

          {/* Tabs: no full-width top divider, only the current item's bottom edge. */}
          <div className="space-y-4">
            <div className="flex flex-wrap gap-1 pt-0.5">
              {(
                [
                  ["readme", t("marketplace.tabReadme")],
                  ["changelog", t("marketplace.tabChangelog")],
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

            {activeDocument !== undefined ? (
              <div className="rounded-lg border border-border/60 bg-background px-3 py-3">
                {activeDocument ? (
                  <MarkdownMessage content={activeDocument} />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {activeTab === "readme"
                      ? t("marketplace.noReadme")
                      : t("marketplace.noChangelog")}
                  </p>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </ScrollArea>
    </>
  );
}
