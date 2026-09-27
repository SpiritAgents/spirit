import { Compose } from "@spiritagent/icons/compose";
import { ChevronRight } from "@spiritagent/icons/chevron-right";
import { Languages, Palette, Terminal } from "lucide-react";
import { DynamicIcon, type IconName } from "lucide-react/dynamic";
import { useTranslation } from "react-i18next";

import { DESKTOP_COMMAND_PALETTE_ITEM_TONE } from "@/lib/desktop-chrome";
import { DESKTOP_LIST_ITEM_PRIMARY_CLASS } from "@/lib/desktop-typography";
import { cn } from "@/lib/utils";
import {
  isAppearanceMenuAction,
  isLocaleOptionAction,
  isNewChatAction,
  isSlashActionPaletteItem,
  isTaskMenuAction,
  isTaskOptionAction,
  isThemeOptionAction,
  type ActionPaletteItem,
} from "@/lib/action-palette";
import { SLASH_SUGGESTION_ICONS } from "@/lib/slash-command-icons";
import type { SkillSlashSuggestionKind } from "@/lib/skill-slash";
import { resolveTaskIcon, type TaskIconResolution } from "@/lib/task-icon";

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

const taskOptionIconClass = cn(
  "size-3.5 shrink-0 text-popover-foreground",
  DESKTOP_COMMAND_PALETTE_ITEM_TONE,
);

// DynamicIcon renders its fallback without props, so the tone is baked into the component.
function TaskOptionIconFallback() {
  return <Terminal className={taskOptionIconClass} aria-hidden strokeWidth={1.75} />;
}

function TaskOptionIcon({ resolution }: { resolution: TaskIconResolution }) {
  if (resolution.kind === "lucide") {
    return (
      <DynamicIcon
        name={resolution.name as IconName}
        className={taskOptionIconClass}
        aria-hidden
        strokeWidth={1.75}
        fallback={TaskOptionIconFallback}
      />
    );
  }
  const Icon = resolution.component;
  return <Icon className={taskOptionIconClass} aria-hidden strokeWidth={1.75} />;
}

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

  if (isAppearanceMenuAction(item) || isTaskMenuAction(item)) {
    const Icon =
      item.kind === "theme-menu" ? Palette : item.kind === "locale-menu" ? Languages : Terminal;
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
        <span className={actionPickerMetaClass}>{currentValueLabel}</span>
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

  if (isTaskOptionAction(item)) {
    return (
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
        <TaskOptionIcon resolution={resolveTaskIcon(item.iconId)} />
        <span className={actionPickerPrimaryTitleClass}>{item.label}</span>
        {item.detail?.trim() ? <span className={actionPickerMetaClass}>{item.detail}</span> : null}
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
