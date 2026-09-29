import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { ActionPickerRow } from "@/components/action-picker-row";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useCommandListWheelHover } from "@/hooks/use-command-list-wheel-hover";
import { useTheme } from "@/hooks/useTheme";
import {
  ACTION_PALETTE_GROUP_LABEL_KEYS,
  buildActionPaletteItemsWithTasks,
  groupActionPaletteRootItems,
  isLocaleOptionAction,
  isThemeOptionAction,
  type ActionPaletteItem,
  type ActionPaletteTaskItem,
  type ActionPaletteView,
} from "@/lib/action-palette";
import {
  changeLanguage,
  getStoredLanguagePreference,
  isLanguagePreference,
  LOCALE_LABEL_KEYS,
} from "@/lib/i18n";
import { DESKTOP_COMMAND_PALETTE_ITEM_CLASS } from "@/lib/desktop-chrome";
import { RADIX_OVERLAY_CLOSE_MS } from "@/lib/overlay-motion";
import { cn } from "@/lib/utils";

type ActionPickerDialogProps = {
  open: boolean;
  onOpenChange(open: boolean): void;
  onSelect(item: ActionPaletteItem): void;
  onSavePatch(patch: { uiLocale: string }): Promise<void>;
  taskItems?: readonly ActionPaletteTaskItem[];
  onRunTask?(taskKey: string): void;
  isItemDisabled?(item: ActionPaletteItem): boolean;
  shouldIncludeItem?(item: ActionPaletteItem): boolean;
};

function actionPaletteItemValue(item: ActionPaletteItem): string {
  return item.id;
}

export function ActionPickerDialog({
  open,
  onOpenChange,
  onSelect,
  onSavePatch,
  taskItems = [],
  onRunTask,
  isItemDisabled,
  shouldIncludeItem,
}: ActionPickerDialogProps) {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const [query, setQuery] = useState("");
  const [view, setView] = useState<ActionPaletteView>("root");
  const [commandValue, setCommandValue] = useState("");
  const [localePreference, setLocalePreference] = useState(getStoredLanguagePreference);
  const commandListWheelHoverRef = useCommandListWheelHover();

  useEffect(() => {
    if (open) {
      setLocalePreference(getStoredLanguagePreference());
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setQuery("");
      setView("root");
      setCommandValue("");
    }, RADIX_OVERLAY_CLOSE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [open]);

  const items = useMemo(
    () =>
      buildActionPaletteItemsWithTasks(query, t, view, taskItems).filter(
        (item) => shouldIncludeItem?.(item) ?? true,
      ),
    [query, shouldIncludeItem, t, taskItems, view],
  );

  const groupedRootItems = useMemo(
    () => (view === "root" ? groupActionPaletteRootItems(items) : []),
    [items, view],
  );

  // cmdk keeps a stale value after view switches (old item id no longer in list),
  // and skips its internal select-first path while value is truthy. Re-bind to first item.
  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    const visibleIds = new Set(items.map((item) => actionPaletteItemValue(item)));
    if (commandValue && visibleIds.has(commandValue)) {
      return;
    }
    const first = items[0];
    setCommandValue(first ? actionPaletteItemValue(first) : "");
  }, [open, view, items, commandValue]);

  const goBackToRoot = () => {
    setView("root");
    setQuery("");
  };

  const closeAndSelect = (item: ActionPaletteItem) => {
    if (isItemDisabled?.(item)) {
      return;
    }
    onOpenChange(false);
    onSelect(item);
  };

  const handleSelect = (item: ActionPaletteItem) => {
    if (isItemDisabled?.(item)) {
      return;
    }
    if (item.kind === "theme-menu") {
      setView("theme");
      setQuery("");
      return;
    }
    if (item.kind === "locale-menu") {
      setView("locale");
      setQuery("");
      return;
    }
    if (item.kind === "task-menu") {
      setView("tasks");
      setQuery("");
      return;
    }
    if (item.kind === "task-option") {
      onOpenChange(false);
      onRunTask?.(item.taskKey);
      return;
    }
    if (isThemeOptionAction(item)) {
      setTheme(item.value);
      return;
    }
    if (isLocaleOptionAction(item)) {
      setLocalePreference(item.value);
      void changeLanguage(item.value);
      void onSavePatch({ uiLocale: item.value });
      return;
    }
    closeAndSelect(item);
  };

  const themeCurrentLabel = t(
    theme === "system"
      ? "settings.themeSystem"
      : theme === "light"
        ? "settings.themeLight"
        : "settings.themeDark",
  );
  const localeCurrentLabel = isLanguagePreference(localePreference)
    ? t(LOCALE_LABEL_KEYS[localePreference])
    : localePreference;

  const renderItem = (item: ActionPaletteItem) => {
    const disabled = isItemDisabled?.(item) ?? false;
    const selected =
      (isThemeOptionAction(item) && item.value === theme) ||
      (isLocaleOptionAction(item) && item.value === localePreference);
    const showCheck = isThemeOptionAction(item) || isLocaleOptionAction(item);

    return (
      <CommandItem
        key={actionPaletteItemValue(item)}
        value={actionPaletteItemValue(item)}
        disabled={disabled}
        data-checked={selected ? true : undefined}
        className={cn(
          DESKTOP_COMMAND_PALETTE_ITEM_CLASS,
          disabled && "pointer-events-none opacity-50",
          showCheck && "[&>svg:last-child]:block",
          showCheck && !selected && "[&>svg:last-child]:opacity-0",
        )}
        onSelect={() => handleSelect(item)}
      >
        <ActionPickerRow
          item={item}
          currentValueLabel={
            item.kind === "theme-menu"
              ? themeCurrentLabel
              : item.kind === "locale-menu"
                ? localeCurrentLabel
                : undefined
          }
        />
      </CommandItem>
    );
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("actionPalette.title")}
      description={t("actionPalette.description")}
      className="sm:max-w-xl"
      onEscapeKeyDown={(event) => {
        if (view === "root") {
          return;
        }
        event.preventDefault();
        goBackToRoot();
      }}
    >
      <Command
        shouldFilter={false}
        aria-label={t("actionPalette.title")}
        value={commandValue}
        onValueChange={setCommandValue}
      >
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder={t("actionPalette.placeholder")}
          showBack={view !== "root"}
          onBack={goBackToRoot}
          backLabel={t("actionPalette.back")}
          onKeyDown={(event) => {
            if (view === "root") {
              return;
            }
            if (event.key !== "Backspace") {
              return;
            }
            if (query.length > 0) {
              return;
            }
            event.preventDefault();
            goBackToRoot();
          }}
        />
        <CommandList
          ref={commandListWheelHoverRef}
          className="max-h-[min(28rem,calc(100dvh-6rem))]"
        >
          {view === "root"
            ? groupedRootItems.map(({ group, items: groupItems }) => (
                <CommandGroup key={group} heading={t(ACTION_PALETTE_GROUP_LABEL_KEYS[group])}>
                  {groupItems.map((item) => renderItem(item))}
                </CommandGroup>
              ))
            : items.map((item) => renderItem(item))}
          {items.length === 0 ? <CommandEmpty>{t("actionPalette.empty")}</CommandEmpty> : null}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
