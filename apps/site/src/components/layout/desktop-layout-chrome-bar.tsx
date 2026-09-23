import { Plus } from "@spiritagent/icons/plus";
import { SidebarLeft } from "@spiritagent/icons/sidebar-left";
import { SidebarLeftCollapsed } from "@spiritagent/icons/sidebar-left-collapsed";
import { SidebarRight } from "@spiritagent/icons/sidebar-right";
import { SidebarRightCollapsed } from "@spiritagent/icons/sidebar-right-collapsed";

import { useTranslation } from "@/lib/desktop-preview-i18n";
import {
  NewChatShortcutKbd,
  SessionSidebarShortcutKbd,
  WorkspaceToolsShortcutKbd,
} from "@/components/layout/desktop-shortcut-kbds";
import { SessionChromeBreadcrumb } from "@/components/session-chrome-breadcrumb";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSessionSidebarChrome } from "@/contexts/session-sidebar-chrome-context";
import {
  DESKTOP_CHROME_TOGGLE_ICON_BTN,
  DESKTOP_SHELL_LAYOUT_TRANSITION,
} from "@/lib/desktop-chrome";
import { desktopTranslucencyTintClass } from "@/lib/desktop-translucency-surface";
import { cn } from "@/lib/utils";

export function DesktopLayoutChromeBar({
  useTranslucency,
  baseToneClassName,
  showWorkspaceToggle,
  workspaceToolsOpen = false,
  onToggleWorkspaceTools,
  sessionTitle,
  subagentPromptText,
  onExitSubagentViewer,
  onNewChat,
  newChatBusy = false,
}: {
  useTranslucency: boolean;
  baseToneClassName?: string;
  showWorkspaceToggle: boolean;
  workspaceToolsOpen?: boolean;
  onToggleWorkspaceTools?: () => void;
  sessionTitle?: string | null;
  subagentPromptText?: string | null;
  onExitSubagentViewer?: () => void;
  onNewChat?: () => void;
  newChatBusy?: boolean;
}) {
  const { t } = useTranslation();
  const { open: sessionSidebarOpen, toggle: onToggleSessionSidebar } = useSessionSidebarChrome();
  const showTrailingActions = showWorkspaceToggle;
  const trimmedSessionTitle = sessionTitle?.trim() ?? "";
  return (
    <div
      role="toolbar"
      aria-label={t("app.sidebarAndTools")}
      data-spirit-surface="layout-chrome"
      data-session-sidebar-open={sessionSidebarOpen ? "true" : "false"}
      className={cn(
        "flex h-8 shrink-0 items-center gap-2 px-1.5",
        showTrailingActions ? "justify-between" : "justify-start",
        useTranslucency
          ? desktopTranslucencyTintClass(useTranslucency)
          : (baseToneClassName ?? "bg-background dark:bg-[#0a0a0a]"),
      )}
    >
      <div className="flex min-w-0 items-center">
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn(DESKTOP_CHROME_TOGGLE_ICON_BTN, "mr-1")}
              onClick={onToggleSessionSidebar}
              aria-label={sessionSidebarOpen ? t("app.hideSidebar") : t("app.showSidebar")}
              aria-expanded={sessionSidebarOpen}
              {...(sessionSidebarOpen ? { "aria-controls": "session-sidebar-panel" } : {})}
            >
              {sessionSidebarOpen ? (
                <SidebarLeft className="size-3.5" aria-hidden strokeWidth={1.75} />
              ) : (
                <SidebarLeftCollapsed className="size-3.5" aria-hidden strokeWidth={1.75} />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>
            {sessionSidebarOpen ? t("app.hideSidebar") : t("app.showSidebar")}{" "}
            <SessionSidebarShortcutKbd />
          </TooltipContent>
        </Tooltip>
        {onNewChat ? (
          <div
            className={cn(
              "shrink-0 overflow-hidden",
              DESKTOP_SHELL_LAYOUT_TRANSITION,
              sessionSidebarOpen
                ? "pointer-events-none mr-0 w-0 opacity-0"
                : "mr-1 w-7 opacity-100",
            )}
            aria-hidden={sessionSidebarOpen}
          >
            <Tooltip delayDuration={300}>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={DESKTOP_CHROME_TOGGLE_ICON_BTN}
                  onClick={onNewChat}
                  disabled={newChatBusy}
                  tabIndex={sessionSidebarOpen ? -1 : undefined}
                  aria-label={t("sidebar.newChat")}
                >
                  <Plus className="size-3.5" aria-hidden strokeWidth={1.75} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={4}>
                {t("sidebar.newChat")} <NewChatShortcutKbd />
              </TooltipContent>
            </Tooltip>
          </div>
        ) : null}
        {trimmedSessionTitle ? (
          <SessionChromeBreadcrumb
            sessionTitle={trimmedSessionTitle}
            subagentPromptText={subagentPromptText}
            onExitSubagentViewer={onExitSubagentViewer}
          />
        ) : null}
      </div>
      {showTrailingActions ? (
        <div className="flex items-center gap-1">
          {showWorkspaceToggle ? (
            <Tooltip delayDuration={300}>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={DESKTOP_CHROME_TOGGLE_ICON_BTN}
                  onClick={() => onToggleWorkspaceTools?.()}
                  aria-label={workspaceToolsOpen ? t("app.collapseTools") : t("app.expandTools")}
                  aria-expanded={workspaceToolsOpen}
                  {...(workspaceToolsOpen ? { "aria-controls": "workspace-tools-panel" } : {})}
                >
                  {workspaceToolsOpen ? (
                    <SidebarRight className="size-3.5" aria-hidden strokeWidth={1.75} />
                  ) : (
                    <SidebarRightCollapsed className="size-3.5" aria-hidden strokeWidth={1.75} />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={4}>
                {workspaceToolsOpen ? t("app.collapseTools") : t("app.expandTools")}{" "}
                <WorkspaceToolsShortcutKbd />
              </TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
