import { Compose } from "@spiritagent/icons/compose";
import { ChevronRight } from "@spiritagent/icons/chevron-right";
import { Languages, Palette } from "lucide-react";
import { useTranslation } from "react-i18next";

import { DESKTOP_COMMAND_PALETTE_ITEM_TONE } from "@/lib/desktop-chrome";
import { DESKTOP_LIST_ITEM_PRIMARY_CLASS } from "@/lib/desktop-typography";
import { cn } from "@/lib/utils";
import {
  isAppearanceMenuAction,
  isLocaleOptionAction,
  isNewChatAction,
  isSlashActionPaletteItem,
  isThemeOptionAction,
  type ActionPaletteItem,
} from "@/lib/action-palette";
import { SLASH_SUGGESTION_ICONS } from "@/lib/slash-command-icons";
import type { SkillSlashSuggestionKind } from "@/lib/skill-slash";

type ActionPickerRowProps = {
  item: ActionPaletteItem;
  currentValueLabel?: string;
};

function SlashCommandIcon({ kind }: { kind: SkillSlashSuggestionKind }) {
  const Icon = SLASH_SUGGESTION_ICONS[kind];
  return (
    <Icon
      className={cn("size-3.5 shrink-0 text-popover-foreground", DESKTOP_COMMAND_PALETTE_ITEM_TONE)}
      aria-hidden
      strokeWidth={1.75}
    />
  );
}

const actionPickerPrimaryTitleClass = cn(
  "shrink-0 whitespace-nowrap leading-6",
  DESKTOP_COMMAND_PALETTE_ITEM_TONE,
  DESKTOP_LIST_ITEM_PRIMARY_CLASS,
  "text-popover-foreground",
);

const actionPickerMetaClass = cn(
  "ml-auto min-w-0 truncate text-xs text-muted-foreground",
  DESKTOP_COMMAND_PALETTE_ITEM_TONE,
);

export function ActionPickerRow({ item, currentValueLabel }: ActionPickerRowProps) {
  const { t } = useTranslation();

  if (isNewChatAction(item)) {
    return (
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
        <Compose
          className={cn(
            "size-3.5 shrink-0 text-popover-foreground",
            DESKTOP_COMMAND_PALETTE_ITEM_TONE,
          )}
          aria-hidden
          strokeWidth={1.75}
        />
        <span className={actionPickerPrimaryTitleClass}>{t(item.labelKey)}</span>
      </div>
    );
  }

  if (isAppearanceMenuAction(item)) {
    const Icon = item.kind === "theme-menu" ? Palette : Languages;
    return (
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
        <Icon
          className={cn(
            "size-3.5 shrink-0 text-popover-foreground",
            DESKTOP_COMMAND_PALETTE_ITEM_TONE,
          )}
          aria-hidden
          strokeWidth={1.75}
        />
        <span className={actionPickerPrimaryTitleClass}>{t(item.labelKey)}</span>
        {currentValueLabel ? (
          <span className={actionPickerMetaClass}>{currentValueLabel}</span>
        ) : null}
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 text-popover-foreground",
            DESKTOP_COMMAND_PALETTE_ITEM_TONE,
          )}
          aria-hidden
          strokeWidth={1.75}
        />
      </div>
    );
  }

  if (isThemeOptionAction(item) || isLocaleOptionAction(item)) {
    return (
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
        <span className={actionPickerPrimaryTitleClass}>{t(item.labelKey)}</span>
      </div>
    );
  }

  if (!isSlashActionPaletteItem(item)) {
    return null;
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
      <SlashCommandIcon kind={item.kind} />
      <span className={actionPickerPrimaryTitleClass}>{item.paletteName ?? item.name}</span>
    </div>
  );
}
