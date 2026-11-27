import { SidebarLeft } from "@spiritagent/icons/sidebar-left";
import { SidebarLeftCollapsed } from "@spiritagent/icons/sidebar-left-collapsed";
import { useTranslation } from "react-i18next";

import { ThreadSidebarShortcutKbd } from "@/components/layout/desktop-shortcut-kbds";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useThreadSidebarChrome } from "@/contexts/thread-sidebar-chrome-context";
import { DESKTOP_CHROME_TOGGLE_ICON_BTN } from "@/lib/desktop-chrome";
import { isMacDesktopPlatform } from "@/lib/desktop-shell";
import { cn } from "@/lib/utils";

export function ThreadSidebarToggleButton({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { open: threadSidebarOpen, toggle: onToggleThreadSidebar } = useThreadSidebarChrome();
  const tooltipAlign = threadSidebarOpen || isMacDesktopPlatform() ? "center" : "start";

  return (
    <Tooltip delayDuration={300} disableHoverableContent>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(DESKTOP_CHROME_TOGGLE_ICON_BTN, className)}
          onClick={onToggleThreadSidebar}
          aria-label={threadSidebarOpen ? t("app.hideSidebar") : t("app.showSidebar")}
          aria-expanded={threadSidebarOpen}
          {...(threadSidebarOpen ? { "aria-controls": "thread-sidebar-panel" } : {})}
        >
          {threadSidebarOpen ? (
            <SidebarLeft className="size-3.5" aria-hidden strokeWidth={1.75} />
          ) : (
            <SidebarLeftCollapsed className="size-3.5" aria-hidden strokeWidth={1.75} />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" align={tooltipAlign} sideOffset={4}>
        {threadSidebarOpen ? t("app.hideSidebar") : t("app.showSidebar")}{" "}
        <ThreadSidebarShortcutKbd />
      </TooltipContent>
    </Tooltip>
  );
}
