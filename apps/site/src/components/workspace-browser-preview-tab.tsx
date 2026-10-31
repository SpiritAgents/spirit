import { useCallback, useEffect, useRef, useState } from "react";

import { ArrowLeft, ArrowRight, PenTool, RefreshCw } from "lucide-react";

import { BrowserElementPickerOverlay } from "@/components/browser-element-picker-overlay";
import { BrowserHeroPagePreview } from "@/components/browser-hero-page-preview";
import { DesignModeDemoCursor } from "@/components/design-mode-demo-cursor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DesignModeDemoState, BrowserTargetRects } from "@/lib/design-mode-demo-state";
import { hitTestBrowserPickerTargetFromPoint } from "@/lib/design-mode-demo-state";
import { desktopTranslucencyBrowserTintClass } from "@/lib/desktop-translucency-surface";
import { DESIGN_MODE_BROWSER_URL } from "@/lib/workspace-tool-tabs";
import { cn } from "@/lib/utils";

export type WorkspaceBrowserPreviewTabProps = {
  designModeState: DesignModeDemoState;
  onDesignModeStateChange?: (patch: Partial<DesignModeDemoState>) => void;
  onDesignModeUserInteract?: () => void;
  useTranslucency?: boolean;
};

export function WorkspaceBrowserPreviewTab({
  designModeState,
  onDesignModeStateChange,
  onDesignModeUserInteract,
  useTranslucency = false,
}: WorkspaceBrowserPreviewTabProps) {
  const pageSlotRef = useRef<HTMLDivElement>(null);
  const userPausedDemoRef = useRef(false);
  const [targetRects, setTargetRects] = useState<BrowserTargetRects>({});

  const handleTargetRectsChange = useCallback((rects: BrowserTargetRects) => {
    setTargetRects(rects);
  }, []);

  const {
    pickerActive,
    hoverTarget,
    selectedTarget,
    headlineVariant,
    showCursor,
    cursorTransitionMs,
  } = designModeState;
  const cursorTarget = hoverTarget;

  useEffect(() => {
    if (showCursor) {
      userPausedDemoRef.current = false;
    }
  }, [showCursor]);

  const ensureDemoPausedForUser = useCallback(() => {
    if (userPausedDemoRef.current) {
      return;
    }
    userPausedDemoRef.current = true;
    onDesignModeUserInteract?.();
  }, [onDesignModeUserInteract]);

  const handlePickerToggle = useCallback(() => {
    ensureDemoPausedForUser();
    if (pickerActive) {
      onDesignModeStateChange?.({
        pickerActive: false,
        hoverTarget: null,
        selectedTarget: null,
        showCursor: false,
      });
      return;
    }
    onDesignModeStateChange?.({
      pickerActive: true,
      hoverTarget: null,
      selectedTarget: null,
      showCursor: false,
    });
  }, [ensureDemoPausedForUser, onDesignModeStateChange, pickerActive]);

  const handlePagePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!event.isTrusted || !pickerActive) {
        return;
      }
      ensureDemoPausedForUser();
      onDesignModeStateChange?.({ showCursor: false });
    },
    [ensureDemoPausedForUser, onDesignModeStateChange, pickerActive],
  );

  const handlePagePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!pickerActive) {
        return;
      }
      const container = pageSlotRef.current;
      if (!container) {
        return;
      }

      ensureDemoPausedForUser();
      const nextTarget = hitTestBrowserPickerTargetFromPoint(
        event.clientX,
        event.clientY,
        container,
      );
      if (nextTarget === hoverTarget) {
        return;
      }
      onDesignModeStateChange?.({
        hoverTarget: nextTarget,
        showCursor: false,
        selectedTarget: null,
      });
    },
    [ensureDemoPausedForUser, hoverTarget, onDesignModeStateChange, pickerActive],
  );

  const handlePagePointerLeave = useCallback(() => {
    if (!pickerActive || hoverTarget === null) {
      return;
    }
    onDesignModeStateChange?.({ hoverTarget: null });
  }, [hoverTarget, onDesignModeStateChange, pickerActive]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-0.5 border-b border-border/40 px-1.5 py-1.5">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-7 shrink-0"
          aria-label="Back"
          disabled
        >
          <ArrowLeft className="size-3.5" aria-hidden strokeWidth={1.75} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-7 shrink-0"
          aria-label="Forward"
          disabled
        >
          <ArrowRight className="size-3.5" aria-hidden strokeWidth={1.75} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-7 shrink-0"
          aria-label="Reload"
          disabled
        >
          <RefreshCw className="size-3.5" aria-hidden strokeWidth={1.75} />
        </Button>
        <Input
          value={DESIGN_MODE_BROWSER_URL}
          readOnly
          aria-label="Address bar"
          className={cn(
            "h-7 min-w-0 flex-1 border-0 bg-transparent px-2 text-xs shadow-none",
            "focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent",
          )}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={cn("size-7 shrink-0", pickerActive && "bg-accent text-accent-foreground")}
          aria-label="Toggle element picker"
          aria-pressed={pickerActive}
          onClick={handlePickerToggle}
        >
          <PenTool className="size-3.5" aria-hidden strokeWidth={1.75} />
        </Button>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <div
          ref={pageSlotRef}
          className={cn(
            "relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
            desktopTranslucencyBrowserTintClass(useTranslucency),
            pickerActive && "cursor-crosshair",
          )}
          onPointerDown={handlePagePointerDown}
          onPointerMove={handlePagePointerMove}
          onPointerLeave={handlePagePointerLeave}
        >
          <BrowserHeroPagePreview
            headlineVariant={headlineVariant}
            containerRef={pageSlotRef}
            onTargetRectsChange={handleTargetRectsChange}
          />
          <BrowserElementPickerOverlay
            targetRects={targetRects}
            hoverTarget={hoverTarget}
            selectedTarget={selectedTarget}
            visible={pickerActive}
          />
          <DesignModeDemoCursor
            containerRef={pageSlotRef}
            targetRects={targetRects}
            activeTarget={cursorTarget}
            visible={showCursor && pickerActive}
            transitionMs={cursorTransitionMs}
          />
        </div>
      </div>
    </div>
  );
}
