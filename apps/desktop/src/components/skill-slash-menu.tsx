import { useRef } from "react";
import { useTranslation } from "react-i18next";

import { ComposerSuggestionMenuItem } from "@/components/composer-suggestion-menu-item";
import { useComposerSuggestionMenuHighlight } from "@/hooks/useComposerSuggestionMenuHighlight";
import { useComposerSuggestionMenuKeyboardScroll } from "@/hooks/useComposerSuggestionMenuKeyboardScroll";
import {
  DESKTOP_OVERLAY_LIST_ITEM_PRIMARY,
  DESKTOP_OVERLAY_LIST_ITEM_SECONDARY,
} from "@/lib/desktop-chrome";
import { SLASH_SUGGESTION_ICONS } from "@/lib/slash-command-icons";
import type { SkillSlashSuggestion, SkillSlashSuggestionKind } from "@/lib/skill-slash";

type SkillSlashMenuProps = {
  suggestions: SkillSlashSuggestion[];
  selectedIndex: number;
  onApplySuggestion(suggestion: SkillSlashSuggestion): void;
};

function SlashSuggestionIcon({ kind }: { kind: SkillSlashSuggestionKind }) {
  const Icon = SLASH_SUGGESTION_ICONS[kind];
  return <Icon className="mt-0.5 size-3.5 shrink-0 opacity-70" aria-hidden strokeWidth={1.75} />;
}

export function SkillSlashMenu({
  suggestions,
  selectedIndex,
  onApplySuggestion,
}: SkillSlashMenuProps) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const { highlightedIndex, menuPointerHandlers, getItemPointerHandlers } =
    useComposerSuggestionMenuHighlight(selectedIndex, suggestions.length);
  useComposerSuggestionMenuKeyboardScroll(selectedIndex, menuRef, "data-skill-slash-index");

  if (suggestions.length === 0) {
    return <div className="px-2 py-2.5 text-xs text-muted-foreground">{t("app.noMatches")}</div>;
  }

  return (
    <div ref={menuRef} {...menuPointerHandlers}>
      {suggestions.map((suggestion, index) => {
        const description = suggestion.descriptionKey
          ? t(suggestion.descriptionKey)
          : (suggestion.description ?? "");

        return (
          <ComposerSuggestionMenuItem
            key={suggestion.id}
            data-skill-slash-index={index}
            selected={index === highlightedIndex}
            title={`${suggestion.name} — ${description}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onApplySuggestion(suggestion)}
            {...getItemPointerHandlers(index)}
          >
            <div className="flex min-w-0 flex-1 items-start gap-2">
              <SlashSuggestionIcon kind={suggestion.kind} />
              <div className="min-w-0 flex-1">
                <div className={DESKTOP_OVERLAY_LIST_ITEM_PRIMARY} title={suggestion.name}>
                  {suggestion.name}
                </div>
                <div className={DESKTOP_OVERLAY_LIST_ITEM_SECONDARY} title={description}>
                  {description}
                </div>
              </div>
            </div>
          </ComposerSuggestionMenuItem>
        );
      })}
    </div>
  );
}
