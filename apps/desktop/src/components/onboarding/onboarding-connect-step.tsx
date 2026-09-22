import { Search } from "@spiritagent/icons/search";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { ProviderConnectDialog } from "@/components/settings/models/provider-connect-dialog";
import {
  ProviderPickerRowButton,
  filterProviderRows,
  localizedProviderRows,
} from "@/components/settings/models/provider-picker-rows";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import {
  DESKTOP_OVERLAY_LIST_FILTER_INPUT,
  DESKTOP_OVERLAY_LIST_FILTER_INPUT_SHELL,
} from "@/lib/desktop-chrome";
import { bottomScrollFadeMaskStyle } from "@/lib/mask-styles";
import { cn } from "@/lib/utils";
import type {
  AddModelRequest,
  AddProviderModelsRequest,
  DesktopModelProvider,
  PreviewModelsRequest,
  PreviewModelsResponse,
} from "@/types";

type OnboardingConnectControlsProps = {
  modelsBusy: boolean;
  modelsPreviewBusy: boolean;
  onAddModel: (request: AddModelRequest) => Promise<void>;
  onAddProviderModels: (request: AddProviderModelsRequest) => Promise<void>;
  onPreviewModels: (request: PreviewModelsRequest) => Promise<PreviewModelsResponse>;
  onBottomFadeChange?: (hasMoreBelow: boolean) => void;
  pinnedBottomFade?: boolean;
  freezeBottomFade?: boolean;
};

/**
 * OOBE connect-providers step content: pinned search at the top + full provider list (the whole
 * page scrolls in a ScrollArea); clicking a row opens the ProviderConnectDialog shared with the
 * settings page; connecting or not does not affect completing the wizard.
 */
export function OnboardingConnectControls({
  modelsBusy,
  modelsPreviewBusy,
  onAddModel,
  onAddProviderModels,
  onPreviewModels,
  onBottomFadeChange,
  pinnedBottomFade,
  freezeBottomFade = false,
}: OnboardingConnectControlsProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [connectDialogOpen, setConnectDialogOpen] = useState(false);
  /** Increments on each connection attempt in this session; used as ProviderConnectDialog's key to remount and reset the form. */
  const [connectTarget, setConnectTarget] = useState<{
    provider: DesktopModelProvider;
    session: number;
  } | null>(null);
  const scrollRootRef = useRef<HTMLDivElement>(null);
  const [hasMoreBelow, setHasMoreBelow] = useState(() => pinnedBottomFade ?? false);

  const filteredProviders = filterProviderRows(
    localizedProviderRows((key, options) => String(t(key, options))),
    query,
  );

  const startConnect = (id: DesktopModelProvider) => {
    setConnectTarget((prev) => ({ provider: id, session: (prev?.session ?? 0) + 1 }));
    setConnectDialogOpen(true);
  };

  useEffect(() => {
    if (freezeBottomFade) {
      return;
    }
    const root = scrollRootRef.current;
    const viewport = root?.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]");
    if (!viewport) {
      return;
    }
    const update = () => {
      const next = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight > 1;
      setHasMoreBelow(next);
      onBottomFadeChange?.(next);
    };
    update();
    viewport.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    if (viewport.firstElementChild) {
      observer.observe(viewport.firstElementChild);
    }
    return () => {
      viewport.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [filteredProviders.length, freezeBottomFade, onBottomFadeChange]);

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col items-center">
      <div className="w-full max-w-md shrink-0 px-2 pb-2">
        <div className={cn(DESKTOP_OVERLAY_LIST_FILTER_INPUT_SHELL, "relative")}>
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
            strokeWidth={1.75}
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("common.search")}
            autoComplete="off"
            className={cn(DESKTOP_OVERLAY_LIST_FILTER_INPUT, "pl-8")}
          />
        </div>
      </div>
      <ScrollArea
        ref={scrollRootRef}
        type="auto"
        className="min-h-0 w-full max-w-md flex-1"
        style={bottomScrollFadeMaskStyle(hasMoreBelow, { animate: !freezeBottomFade })}
      >
        <div className="px-1 pt-2 pb-4">
          {filteredProviders.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              {t("app.noMatches")}
            </p>
          ) : (
            filteredProviders.map((row) => (
              <ProviderPickerRowButton key={row.id} row={row} onSelect={startConnect} />
            ))
          )}
        </div>
      </ScrollArea>

      {connectTarget !== null ? (
        <ProviderConnectDialog
          key={`${connectTarget.provider}-${connectTarget.session}`}
          provider={connectTarget.provider}
          open={connectDialogOpen}
          onOpenChange={setConnectDialogOpen}
          busy={modelsBusy}
          previewBusy={modelsPreviewBusy}
          onAddModel={onAddModel}
          onAddProviderModels={onAddProviderModels}
          onPreviewModels={onPreviewModels}
        />
      ) : null}
    </div>
  );
}
