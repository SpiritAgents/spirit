import {
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Tooltip, TooltipContent } from "@/components/ui/tooltip";
import {
  SessionListGitTooltipPanel,
  type SessionGitTooltipItem,
} from "@/components/session-list-git-tooltip";
import {
  DESKTOP_CHROME_ACTIVE_TEXT,
  DESKTOP_CHROME_MUTED_TEXT,
  DESKTOP_SESSION_TITLE_HOVER_CLASS,
  SESSION_TITLE_RENAME_INPUT_CLASS,
} from "@/lib/desktop-chrome";
import { DESKTOP_SIDEBAR_TEXT_CLASS, FONT_WEIGHT_NORMAL } from "@/lib/desktop-typography";
import { cn } from "@/lib/utils";

type SessionChromeBreadcrumbProps = {
  sessionTitle: string;
  sessionTitleSuffix?: string | null;
  sessionTooltip?: SessionGitTooltipItem | null;
  subagentPromptText?: string | null;
  onExitSubagentViewer?: () => void;
  renaming?: boolean;
  renameValue?: string;
  onRenameValueChange?: (value: string) => void;
  onRenameCommit?: () => void;
  onRenameCancel?: () => void;
  onRenameStart?: () => void;
};

const sessionTitleButtonClass = (interactive: boolean) =>
  cn(
    "electron-no-drag min-w-0 w-full truncate rounded-sm p-0 text-left",
    DESKTOP_SIDEBAR_TEXT_CLASS,
    DESKTOP_CHROME_MUTED_TEXT,
    interactive && cn(DESKTOP_SESSION_TITLE_HOVER_CLASS, "cursor-pointer"),
  );

function SessionChromeTitleTooltip({
  item,
  children,
}: {
  item: SessionGitTooltipItem;
  children: ReactNode;
}) {
  return (
    <Tooltip<SessionGitTooltipItem>
      getItemId={(tooltipItem) => tooltipItem.path}
      delayDuration={300}
      closeDelayMs={120}
      anchorLingerMs={220}
      disableHoverableContent
    >
      <Tooltip.Item item={item}>{children}</Tooltip.Item>
      <TooltipContent side="bottom" sideOffset={6} className="flex flex-col items-start gap-1 py-2">
        {(activeItem) =>
          activeItem ? (
            <SessionListGitTooltipPanel item={activeItem as SessionGitTooltipItem} />
          ) : null
        }
      </TooltipContent>
    </Tooltip>
  );
}

export function SessionChromeBreadcrumb({
  sessionTitle,
  sessionTitleSuffix,
  sessionTooltip,
  subagentPromptText,
  onExitSubagentViewer,
  renaming = false,
  renameValue = "",
  onRenameValueChange,
  onRenameCommit,
  onRenameCancel,
  onRenameStart,
}: SessionChromeBreadcrumbProps) {
  const { t } = useTranslation();
  const renameInputRef = useRef<HTMLInputElement>(null);
  const skipBlurCommitRef = useRef(false);
  const trimmedSessionTitle = sessionTitle.trim();
  const trimmedSessionTitleSuffix = sessionTitleSuffix?.trim() ?? "";
  const trimmedSubagentPromptText = subagentPromptText?.trim() ?? "";
  const titleInteractive = Boolean(onRenameStart);

  useLayoutEffect(() => {
    if (!renaming) {
      return;
    }
    const input = renameInputRef.current;
    if (!input) {
      return;
    }
    const frameId = requestAnimationFrame(() => {
      input.focus({ preventScroll: true });
      input.select();
    });
    return () => cancelAnimationFrame(frameId);
  }, [renaming]);

  if (!trimmedSessionTitle && !renaming) {
    return null;
  }

  const handleRenameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      skipBlurCommitRef.current = true;
      onRenameCommit?.();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onRenameCancel?.();
    }
  };

  const wrapWithTooltip = (node: ReactNode) => {
    if (!sessionTooltip) {
      return node;
    }
    return <SessionChromeTitleTooltip item={sessionTooltip}>{node}</SessionChromeTitleTooltip>;
  };

  const sessionTitleNode = renaming ? (
    <input
      ref={renameInputRef}
      value={renameValue}
      className={cn(SESSION_TITLE_RENAME_INPUT_CLASS, "electron-no-drag w-full")}
      aria-label={t("sidebar.renameSession")}
      onChange={(event) => onRenameValueChange?.(event.target.value)}
      onKeyDown={handleRenameKeyDown}
      onBlur={() => {
        if (!skipBlurCommitRef.current) {
          onRenameCommit?.();
        }
        skipBlurCommitRef.current = false;
      }}
    />
  ) : trimmedSubagentPromptText ? (
    wrapWithTooltip(
      <button
        type="button"
        className={sessionTitleButtonClass(true)}
        onClick={onExitSubagentViewer}
      >
        {trimmedSessionTitle}
      </button>,
    )
  ) : (
    wrapWithTooltip(
      <button
        type="button"
        className={sessionTitleButtonClass(titleInteractive)}
        onDoubleClick={(event: MouseEvent<HTMLButtonElement>) => {
          if (!onRenameStart) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          onRenameStart();
        }}
      >
        {trimmedSessionTitleSuffix ? (
          <span className="inline-flex min-w-0 max-w-full items-baseline gap-1.5">
            <span className="min-w-0 truncate">{trimmedSessionTitle}</span>
            <span className="shrink-0 text-foreground-subtle">{trimmedSessionTitleSuffix}</span>
          </span>
        ) : (
          trimmedSessionTitle
        )}
      </button>,
    )
  );

  return (
    <Breadcrumb className={cn("min-w-0", renaming && !trimmedSubagentPromptText && "flex-1")}>
      <BreadcrumbList className={cn("flex-nowrap gap-1.5 sm:gap-2", DESKTOP_SIDEBAR_TEXT_CLASS)}>
        <BreadcrumbItem
          className={cn(
            "min-w-0",
            renaming && !trimmedSubagentPromptText
              ? "max-w-full flex-1"
              : trimmedSubagentPromptText
                ? "max-w-[min(12rem,30vw)] shrink"
                : "max-w-[min(20rem,40vw)]",
          )}
        >
          {sessionTitleNode}
        </BreadcrumbItem>
        {trimmedSubagentPromptText ? (
          <>
            <BreadcrumbSeparator />
            <BreadcrumbItem className="min-w-0 max-w-[min(20rem,40vw)] flex-1">
              <BreadcrumbPage
                className={cn("min-w-0 truncate", FONT_WEIGHT_NORMAL, DESKTOP_CHROME_ACTIVE_TEXT)}
              >
                {trimmedSubagentPromptText}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </>
        ) : null}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
