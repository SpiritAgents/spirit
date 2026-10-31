import { ChevronDown } from "@spiritagent/icons/chevron-down";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "@/lib/desktop-preview-i18n";
import { FONT_WEIGHT_NORMAL } from "@/lib/typography";

import {
  FilteredOverlayMenu,
  FilteredOverlayMenuTrigger,
} from "@/components/ui/filtered-overlay-menu";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NoTranslate } from "@/components/no-translate";
import {
  DESKTOP_OVERLAY_LIST_GROUP_LABEL,
  DESKTOP_OVERLAY_LIST_ITEM_PRIMARY,
  DESKTOP_OVERLAY_LIST_SUB_TRIGGER,
  instantHoverMotionClass,
} from "@/lib/desktop-chrome";
import { isMacDesktopPlatform, modSlashShortcutKbdKeys } from "@/lib/desktop-shell";
import {
  notifyModelPickerFocused,
  registerModelPicker,
  unregisterModelPicker,
} from "@/lib/model-picker-shortcut-bridge";
import {
  buildModelCatalogDisplayTitleMap,
  modelDisplayTitleFromMap,
} from "@/lib/model-catalog-detail";
import { configuredModelEffort, modelEffortLabel } from "@/lib/reasoning-effort";
import { groupModelsForPicker } from "@/lib/model-picker-groups";
import type {
  DesktopModelCatalogHint,
  DesktopModelEffortSelection,
  ModelProfileSnapshot,
} from "@/types/spirit-desktop";
import { cn } from "@/lib/utils";

const MODEL_PICKER_TOOLTIP_SHOW_DELAY_MS = 300;

function ModelPickerShortcutKbd() {
  const keys = modSlashShortcutKbdKeys();

  return (
    <KbdGroup>
      {isMacDesktopPlatform() ? (
        keys.map((key) => <Kbd key={key}>{key}</Kbd>)
      ) : (
        <>
          <Kbd>Ctrl</Kbd>
          <span>+</span>
          <Kbd>/</Kbd>
        </>
      )}
    </KbdGroup>
  );
}

function ModelPickerRow({
  displayTitle,
  isActive,
  onSelectModel,
}: {
  displayTitle: string;
  isActive: boolean;
  onSelectModel: () => void;
}) {
  return (
    <div
      role="menuitem"
      tabIndex={-1}
      className={cn(
        DESKTOP_OVERLAY_LIST_SUB_TRIGGER,
        "cursor-pointer outline-none focus:bg-accent focus:text-accent-foreground",
        isActive && "bg-accent/40",
      )}
      onClick={onSelectModel}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelectModel();
        }
      }}
    >
      <span className={cn(DESKTOP_OVERLAY_LIST_ITEM_PRIMARY, "min-w-0 truncate")}>
        <NoTranslate>{displayTitle}</NoTranslate>
      </span>
    </div>
  );
}

export type ModelPickerMenuProps = {
  models: ModelProfileSnapshot[];
  catalogHints?: DesktopModelCatalogHint[];
  activeModelName: string;
  activeReasoningEffort?: DesktopModelEffortSelection;
  disabled?: boolean;
  open?: boolean;
  onOpenChange?(open: boolean): void;
  onModelSelect(name: string): void;
  triggerClassName?: string;
};

export function ModelPickerMenu({
  models,
  catalogHints,
  activeModelName,
  activeReasoningEffort,
  disabled,
  open: openProp,
  onOpenChange,
  onModelSelect,
  triggerClassName,
}: ModelPickerMenuProps) {
  const { t } = useTranslation();
  const [internalOpen, setInternalOpen] = useState(false);
  const [modelFilter, setModelFilter] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const registrationIdRef = useRef<string | null>(null);
  const reactId = useId();

  const isControlled = openProp !== undefined;
  const modelMenuOpen = isControlled ? openProp : internalOpen;
  const suppressTooltip = modelMenuOpen || disabled;
  const setModelMenuOpen = useCallback(
    (next: boolean) => {
      if (!isControlled) {
        setInternalOpen(next);
      }
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange],
  );

  const activeModelProfile = models.find((model) => model.name === activeModelName);
  const displayTitleByModelName = useMemo(
    () => buildModelCatalogDisplayTitleMap(models, catalogHints),
    [catalogHints, models],
  );
  const modelGroups = useMemo(
    () => groupModelsForPicker(models, catalogHints),
    [catalogHints, models],
  );
  const filteredModelGroups = useMemo(() => {
    const query = modelFilter.trim().toLowerCase();
    if (!query) {
      return modelGroups;
    }
    return modelGroups
      .map((group) => ({
        ...group,
        items: group.items.filter((model) => {
          const title = modelDisplayTitleFromMap(model.name, displayTitleByModelName).toLowerCase();
          return title.includes(query) || model.name.toLowerCase().includes(query);
        }),
      }))
      .filter((group) => group.items.length > 0);
  }, [displayTitleByModelName, modelFilter, modelGroups]);

  const activeModelSummary = activeModelProfile
    ? formatModelPickerLabel(
        modelDisplayTitleFromMap(activeModelProfile.name, displayTitleByModelName),
        activeReasoningEffort ??
          configuredModelEffort(activeModelProfile) ??
          (activeModelProfile.effortSemantics === "output" ? "default" : "medium"),
      )
    : activeModelName;

  useEffect(() => {
    const id = registerModelPicker({
      open: () => setModelMenuOpen(true),
      getRoot: () => rootRef.current,
    });
    registrationIdRef.current = id;
    return () => {
      unregisterModelPicker(id);
      registrationIdRef.current = null;
    };
  }, [setModelMenuOpen]);

  const handleTriggerFocus = useCallback(() => {
    const id = registrationIdRef.current;
    if (id) {
      notifyModelPickerFocused(id);
    }
  }, []);

  if (models.length === 0) {
    return <span className="px-1 text-xs text-muted-foreground">{t("app.noModelsAvailable")}</span>;
  }

  return (
    <div ref={rootRef} data-model-picker-root data-model-picker-id={reactId} className="min-w-0">
      <FilteredOverlayMenu
        variant="filtered-list"
        open={modelMenuOpen}
        onOpenChange={(open) => {
          setModelMenuOpen(open);
          if (!open) {
            setModelFilter("");
          }
        }}
        filterValue={modelFilter}
        onFilterChange={setModelFilter}
        filterPlaceholder={t("app.filterModels")}
        trigger={
          <Tooltip
            open={suppressTooltip ? false : undefined}
            delayDuration={MODEL_PICKER_TOOLTIP_SHOW_DELAY_MS}
          >
            <TooltipTrigger asChild>
              <FilteredOverlayMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={t("app.selectModel")}
                  disabled={disabled}
                  onFocus={handleTriggerFocus}
                  className={cn(
                    `inline-flex h-7 min-w-0 max-w-full items-center gap-0.5 rounded-md border-0 bg-transparent px-1 text-left text-xs ${FONT_WEIGHT_NORMAL} text-muted-foreground outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50`,
                    instantHoverMotionClass,
                    triggerClassName,
                  )}
                >
                  <span className="min-w-0 truncate" title={activeModelSummary}>
                    <NoTranslate>{activeModelSummary}</NoTranslate>
                  </span>
                  <ChevronDown
                    className="size-3 shrink-0 text-muted-foreground/80"
                    aria-hidden
                    strokeWidth={1.75}
                  />
                </button>
              </FilteredOverlayMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={4}>
              {t("app.selectModel")} <ModelPickerShortcutKbd />
            </TooltipContent>
          </Tooltip>
        }
      >
        {filteredModelGroups.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-muted-foreground">
            {t("app.noMatches")}
          </p>
        ) : (
          filteredModelGroups.map((group) => (
            <div key={group.provider} className="mb-2 last:mb-0">
              <div className={DESKTOP_OVERLAY_LIST_GROUP_LABEL}>
                <NoTranslate>
                  {t(group.labelKey, { defaultValue: group.fallbackLabel })}
                </NoTranslate>
              </div>
              {group.items.map((model) => {
                const displayTitle = modelDisplayTitleFromMap(model.name, displayTitleByModelName);
                return (
                  <ModelPickerRow
                    key={`${group.provider}:${model.name}`}
                    displayTitle={displayTitle}
                    isActive={activeModelProfile?.name === model.name}
                    onSelectModel={() => {
                      onModelSelect(model.name);
                      setModelFilter("");
                      setModelMenuOpen(false);
                    }}
                  />
                );
              })}
            </div>
          ))
        )}
      </FilteredOverlayMenu>
    </div>
  );
}

function formatModelPickerLabel(name: string, effort: DesktopModelEffortSelection): string {
  return `${name} · ${modelEffortLabel(effort)}`;
}
