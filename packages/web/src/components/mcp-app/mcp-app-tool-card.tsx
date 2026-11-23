import { ChevronRight } from "@spiritagent/icons/chevron-right";
import { useAsyncBlockScrollAnchor } from "@spiritagent/ui/rendering";
import { Maximize2, Minimize2, PictureInPicture2 } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { useMcpAppPane } from "@/contexts/mcp-app-contexts";
import { AnimatedCollapse, AnimatedCollapseContent } from "@/components/ui/animated-collapse";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DEFAULT_MCP_APP_INLINE_HEIGHT_PX, formatMcpAppTabTitle } from "@/lib/mcp-apps/pane-state";
import { cn } from "@/lib/utils";
import type { ToolBlockSnapshot } from "@/types";

const MCP_APP_HEADER_HEIGHT_PX = 32;
const INLINE_HEADER_BUTTON_CLASS =
  "text-muted-foreground hover:text-muted-foreground aria-expanded:bg-transparent aria-expanded:text-muted-foreground aria-expanded:hover:bg-canvas-hover";

export function McpAppToolCard({ tool }: { tool: ToolBlockSnapshot }) {
  const { t } = useTranslation();
  const fallbackInstanceId = useId();
  const pane = useMcpAppPane();
  const scrollAnchor = useAsyncBlockScrollAnchor();
  const mcpApp = tool.mcpApp;
  const appKey =
    tool.toolCallId ??
    (mcpApp
      ? `${mcpApp.server}:${mcpApp.toolName}:${mcpApp.resourceUri}:${fallbackInstanceId}`
      : `${tool.toolName}:${fallbackInstanceId}`);
  const slotRef = useRef<HTMLDivElement | null>(null);

  const heightBlockKey = mcpApp ? `mcp-app:${appKey}:${mcpApp.resourceUri}` : null;
  const cachedHeightPx =
    heightBlockKey && scrollAnchor ? scrollAnchor.getCachedHeight(heightBlockKey) : undefined;

  const entry = pane?.getEntry(appKey);
  const displayMode = entry?.displayMode ?? "inline";
  const inlineExpanded = entry?.inlineExpanded ?? true;
  const measuredContentHeightPx =
    entry?.inlineHeightPx ??
    (cachedHeightPx !== undefined
      ? Math.max(150, cachedHeightPx - MCP_APP_HEADER_HEIGHT_PX)
      : DEFAULT_MCP_APP_INLINE_HEIGHT_PX);
  const totalInlineHeightPx = measuredContentHeightPx + MCP_APP_HEADER_HEIGHT_PX;

  useEffect(() => {
    if (!pane || !mcpApp) {
      return;
    }
    pane.registerApp({
      appKey,
      tool,
      mcpApp,
      initialHeightPx:
        cachedHeightPx !== undefined
          ? Math.max(150, cachedHeightPx - MCP_APP_HEADER_HEIGHT_PX)
          : undefined,
    });
  }, [appKey, cachedHeightPx, mcpApp, pane, tool]);

  useLayoutEffect(() => {
    if (displayMode === "inline" && inlineExpanded && heightBlockKey && scrollAnchor) {
      scrollAnchor.setCachedHeight(heightBlockKey, totalInlineHeightPx);
    }
  }, [displayMode, heightBlockKey, inlineExpanded, scrollAnchor, totalInlineHeightPx]);

  const handleSlotRef = useCallback(
    (node: HTMLDivElement | null) => {
      slotRef.current = node;
      pane?.setSlotElement(
        appKey,
        node,
        node && scrollAnchor
          ? () => {
              scrollAnchor.notifyAsyncBlockWillResize(node);
            }
          : null,
      );
    },
    [appKey, pane, scrollAnchor],
  );

  if (!mcpApp) {
    return null;
  }

  const appTitle = formatMcpAppTabTitle(mcpApp);

  if (!pane) {
    return (
      <div
        data-spirit-mcp-app-card={appKey}
        className="my-1.5 flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground"
      >
        <span className="truncate font-medium text-foreground">{appTitle}</span>
        <span className="truncate text-[11px]">{mcpApp.server}</span>
      </div>
    );
  }

  if (displayMode !== "inline") {
    return (
      <div
        data-spirit-mcp-app-card={appKey}
        data-spirit-mcp-app-placeholder={displayMode}
        className="my-1.5 flex items-center justify-between gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2.5 text-xs"
      >
        <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
          {displayMode === "pip" ? (
            <PictureInPicture2 className="size-3.5 shrink-0" strokeWidth={1.75} />
          ) : (
            <Maximize2 className="size-3.5 shrink-0" strokeWidth={1.75} />
          )}
          <span className="truncate font-medium text-foreground">{appTitle}</span>
          <span className="truncate">
            {displayMode === "pip" ? t("mcpApp.dockedInPip") : t("mcpApp.viewingInFullscreen")}
          </span>
        </div>
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={() => pane.setDisplayMode(appKey, "inline")}
        >
          <Minimize2 className="mr-1 size-3" strokeWidth={1.75} />
          {t("mcpApp.returnInline")}
        </Button>
      </div>
    );
  }

  return (
    <AnimatedCollapse
      open={inlineExpanded}
      onOpenChange={(next) => pane.setInlineExpanded(appKey, next)}
      className="my-1.5 min-w-0"
    >
      <div
        data-spirit-mcp-app-card={appKey}
        data-spirit-mcp-app-header="inline"
        className="flex h-8 shrink-0 items-center justify-between gap-2 bg-transparent text-muted-foreground"
      >
        <div className="flex min-w-0 items-center">
          <span className="truncate text-[13px] font-normal leading-relaxed text-muted-foreground">
            {appTitle}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className={INLINE_HEADER_BUTTON_CLASS}
                aria-label={t("mcpApp.pictureInPicture")}
                onClick={() => pane.setDisplayMode(appKey, "pip")}
              >
                <PictureInPicture2 className="size-3.5" strokeWidth={1.75} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("mcpApp.pictureInPicture")}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className={INLINE_HEADER_BUTTON_CLASS}
                aria-label={t("mcpApp.fullscreen")}
                onClick={() => pane.setDisplayMode(appKey, "fullscreen")}
              >
                <Maximize2 className="size-3.5" strokeWidth={1.75} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("mcpApp.fullscreen")}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className={INLINE_HEADER_BUTTON_CLASS}
                aria-expanded={inlineExpanded}
                aria-label={inlineExpanded ? t("common.collapse") : t("common.expand")}
                onClick={() => pane.setInlineExpanded(appKey, !inlineExpanded)}
              >
                <ChevronRight
                  className={cn(
                    "size-3.5 transition-transform duration-150",
                    inlineExpanded && "rotate-90",
                  )}
                  aria-hidden
                  strokeWidth={1.75}
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {inlineExpanded ? t("common.collapse") : t("common.expand")}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      <AnimatedCollapseContent keepMounted className="min-w-0">
        <div
          ref={handleSlotRef}
          data-spirit-mcp-app-slot={appKey}
          className="w-full"
          style={{ height: `${measuredContentHeightPx}px` }}
        />
      </AnimatedCollapseContent>
    </AnimatedCollapse>
  );
}
