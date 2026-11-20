import { TooltipItem, useTooltipTriggerProps } from "@/components/ui/tooltip";
import { RovingFocusItem } from "@/components/ui/roving-focus-group";
import { modelSettingsRowAriaLabel } from "@spiritagent/ui/model-picker";
import { cn } from "@/lib/utils";
import type { SettingsModelProfile } from "./model-defaults";
import { modelRefKey, settingsModelRef } from "./model-defaults";
import { DESKTOP_LIST_ITEM_PRIMARY_CLASS } from "@/lib/desktop-typography";

export function ModelSettingsRowButton({
  model,
  displayTitle,
  defaultActionLabel,
  disabled,
  isHighlighted = false,
  showNativeTitle = true,
  onPointerEnter,
  onDefaultAction,
}: {
  model: SettingsModelProfile;
  displayTitle: string;
  defaultActionLabel: string;
  disabled: boolean;
  isHighlighted?: boolean;
  /** Suppresses the browser title when Tooltip details exist, so it does not cover the detail overlay. */
  showNativeTitle?: boolean;
  onPointerEnter?: () => void;
  onDefaultAction: () => void;
}) {
  const rowAriaLabel = modelSettingsRowAriaLabel(defaultActionLabel, model.name, displayTitle);

  return (
    <RovingFocusItem asChild tabStopId={modelRefKey(settingsModelRef(model))} focusable={!disabled}>
      <button
        type="button"
        className={cn(
          "flex w-full appearance-none flex-col gap-3 bg-transparent px-4 py-3 text-left outline-none enabled:cursor-pointer enabled:hover:bg-canvas-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-5",
          isHighlighted && "bg-muted/30",
        )}
        disabled={disabled}
        title={showNativeTitle ? rowAriaLabel : undefined}
        aria-label={rowAriaLabel}
        onPointerEnter={onPointerEnter}
        onClick={onDefaultAction}
      >
        <div className="min-w-0 flex-1">
          <span className={DESKTOP_LIST_ITEM_PRIMARY_CLASS}>{displayTitle}</span>
        </div>
      </button>
    </RovingFocusItem>
  );
}

export function ModelSettingsRowWithHover({
  model,
  displayTitle,
  defaultActionLabel,
  disabled,
  onDefaultAction,
}: {
  model: SettingsModelProfile;
  displayTitle: string;
  defaultActionLabel: string;
  disabled: boolean;
  onDefaultAction: () => void;
}) {
  const { onPointerEnter, isHighlighted } = useTooltipTriggerProps(model);

  return (
    <TooltipItem item={model}>
      <ModelSettingsRowButton
        model={model}
        displayTitle={displayTitle}
        defaultActionLabel={defaultActionLabel}
        disabled={disabled}
        isHighlighted={isHighlighted}
        showNativeTitle={false}
        onPointerEnter={onPointerEnter}
        onDefaultAction={onDefaultAction}
      />
    </TooltipItem>
  );
}
