import { SidebarLeft } from "@spiritagent/icons/sidebar-left";
import { SidebarLeftCollapsed } from "@spiritagent/icons/sidebar-left-collapsed";
import { useTranslation } from "react-i18next";

import { SessionSidebarShortcutKbd } from "@/components/layout/desktop-shortcut-kbds";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSessionSidebarChrome } from "@/contexts/session-sidebar-chrome-context";
import { DESKTOP_CHROME_TOGGLE_ICON_BTN } from "@/lib/desktop-chrome";
import { isMacDesktopPlatform } from "@/lib/desktop-shell";
import { cn } from "@/lib/utils";

export function SessionSidebarToggleButton({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { open: sessionSidebarOpen, toggle: onToggleSessionSidebar } = useSessionSidebarChrome();
  const tooltipAlign = sessionSidebarOpen || isMacDesktopPlatform() ? "center" : "start";

  return (
    <Tooltip delayDuration={300} disableHoverableContent>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(DESKTOP_CHROME_TOGGLE_ICON_BTN, className)}
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
      <TooltipContent side="top" align={tooltipAlign} sideOffset={4}>
        {sessionSidebarOpen ? t("app.hideSidebar") : t("app.showSidebar")}{" "}
        <SessionSidebarShortcutKbd />
      </TooltipContent>
    </Tooltip>
  );
}
