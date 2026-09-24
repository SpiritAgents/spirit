import { ChevronLeft } from "@spiritagent/icons/chevron-left";
import { ChevronRight } from "@spiritagent/icons/chevron-right";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { MessageCircle } from "lucide-react";

import { ComposerSuggestionMenuItem } from "@/components/composer-suggestion-menu-item";
import { useComposerSuggestionMenuHighlight } from "@/hooks/useComposerSuggestionMenuHighlight";
import { useComposerSuggestionMenuKeyboardScroll } from "@/hooks/useComposerSuggestionMenuKeyboardScroll";
import { WorkspaceFilePickerRow } from "@/components/workspace-file-picker-row";
import { DESKTOP_OVERLAY_LIST_ITEM_PRIMARY } from "@/lib/desktop-chrome";
import type { AtReferenceMenuItem } from "@/lib/composer-at-reference-demo";
import { cn } from "@/lib/utils";

type WorkspaceFileReferenceMenuProps = {
  items: AtReferenceMenuItem[];
  selectedIndex: number;
  onApplyFile(path: string): void;
  onApplySession(session: { path: string; title: string }): void;
  onOpenSessions(): void;
  onBack(): void;
};

export function WorkspaceFileReferenceMenu({
  items,
  selectedIndex,
  onApplyFile,
  onApplySession,
  onOpenSessions,
  onBack,
}: WorkspaceFileReferenceMenuProps) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const { highlightedIndex, menuPointerHandlers, getItemPointerHandlers } =
    useComposerSuggestionMenuHighlight(selectedIndex, items.length);
  useComposerSuggestionMenuKeyboardScroll(
    selectedIndex,
    menuRef,
    "data-workspace-file-reference-index",
  );

  if (items.length === 0) {
    return <div className="px-2 py-2.5 text-xs text-muted-foreground">{t("app.noMatches")}</div>;
  }

  return (
    <div ref={menuRef} {...menuPointerHandlers}>
      {items.map((item, index) => {
        if (item.kind === "back") {
          return (
            <ComposerSuggestionMenuItem
              key="back"
              data-workspace-file-reference-index={index}
              selected={index === highlightedIndex}
              title={t("composer.atReference.back")}
              onMouseDown={(event) => event.preventDefault()}
              onClick={onBack}
              {...getItemPointerHandlers(index)}
            >
              <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                <ChevronLeft className="size-3.5 shrink-0" aria-hidden strokeWidth={1.75} />
                <span className={cn("min-w-0 truncate", DESKTOP_OVERLAY_LIST_ITEM_PRIMARY)}>
                  {t("composer.atReference.back")}
                </span>
              </div>
            </ComposerSuggestionMenuItem>
          );
        }
        if (item.kind === "file") {
          return (
            <ComposerSuggestionMenuItem
              key={`file:${item.path}`}
              data-workspace-file-reference-index={index}
              selected={index === highlightedIndex}
              title={item.path}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onApplyFile(item.path)}
              {...getItemPointerHandlers(index)}
            >
              <WorkspaceFilePickerRow path={item.path} tone="menu" layout="stacked" />
            </ComposerSuggestionMenuItem>
          );
        }
        if (item.kind === "sessions-entry") {
          return (
            <ComposerSuggestionMenuItem
              key="sessions-entry"
              data-workspace-file-reference-index={index}
              selected={index === highlightedIndex}
              title={t("composer.atReference.chats")}
              onMouseDown={(event) => event.preventDefault()}
              onClick={onOpenSessions}
              {...getItemPointerHandlers(index)}
            >
              <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                <MessageCircle className="size-3.5 shrink-0" aria-hidden strokeWidth={1.75} />
                <span className={cn("min-w-0 truncate", DESKTOP_OVERLAY_LIST_ITEM_PRIMARY)}>
                  {t("composer.atReference.chats")}
                </span>
                <ChevronRight
                  className="ml-auto size-3.5 shrink-0"
                  aria-hidden
                  strokeWidth={1.75}
                />
              </div>
            </ComposerSuggestionMenuItem>
          );
        }
        return (
          <ComposerSuggestionMenuItem
            key={`session:${item.path}`}
            data-workspace-file-reference-index={index}
            selected={index === highlightedIndex}
            title={item.title}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onApplySession({ path: item.path, title: item.title })}
            {...getItemPointerHandlers(index)}
          >
            <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
              <MessageCircle className="size-3.5 shrink-0" aria-hidden strokeWidth={1.75} />
              <span className={cn("min-w-0 truncate", DESKTOP_OVERLAY_LIST_ITEM_PRIMARY)}>
                {item.title}
              </span>
            </div>
          </ComposerSuggestionMenuItem>
        );
      })}
    </div>
  );
}
