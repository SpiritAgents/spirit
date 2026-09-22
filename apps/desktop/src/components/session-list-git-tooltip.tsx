import type { ReactNode } from "react";
import { GitBranch } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Tooltip, TooltipContent, useOptionalTooltipContext } from "@/components/ui/tooltip";
import { resolveSessionWorkLocation } from "@/lib/workspace-grouping";
import { WORK_LOCATION_ICONS } from "@/components/work-location-menu";
import type { SessionListItem } from "@/types";

export type SessionGitTooltipItem = {
  path: string;
  gitBranch: string;
  workspaceRoot: string;
};

export function sessionGitTooltipItemFromSession(
  session: Pick<SessionListItem, "path" | "gitBranch" | "workspaceRoot">,
): SessionGitTooltipItem | null {
  const gitBranch = session.gitBranch?.trim();
  if (!gitBranch) {
    return null;
  }
  return {
    path: session.path,
    gitBranch,
    workspaceRoot: session.workspaceRoot,
  };
}

export function sessionGitTooltipItemFromChromeSession(input: {
  path: string;
  gitBranch?: string;
  workspaceRoot: string;
}): SessionGitTooltipItem | null {
  const gitBranch = input.gitBranch?.trim();
  if (!gitBranch) {
    return null;
  }
  return {
    path: input.path,
    gitBranch,
    workspaceRoot: input.workspaceRoot,
  };
}

type SessionListGitTooltipProps = {
  children: ReactNode;
  delayDuration?: number;
  closeDelayMs?: number;
  anchorLingerMs?: number;
};

function SessionListGitTooltipRoot({
  children,
  delayDuration = 300,
  closeDelayMs = 120,
  anchorLingerMs = 220,
}: SessionListGitTooltipProps) {
  return (
    <Tooltip<SessionGitTooltipItem>
      getItemId={(item) => item.path}
      delayDuration={delayDuration}
      closeDelayMs={closeDelayMs}
      anchorLingerMs={anchorLingerMs}
      disableHoverableContent
    >
      {children}
      <TooltipContent side="right" sideOffset={8} className="flex flex-col items-start gap-1 py-2">
        {(item) =>
          item ? <SessionListGitTooltipPanel item={item as SessionGitTooltipItem} /> : null
        }
      </TooltipContent>
    </Tooltip>
  );
}

type SessionListGitTooltipRowProps = {
  session: Pick<SessionListItem, "path" | "gitBranch" | "workspaceRoot">;
  children: ReactNode;
};

function SessionListGitTooltipRow({ session, children }: SessionListGitTooltipRowProps) {
  return <Tooltip.Item item={sessionGitTooltipItemFromSession(session)}>{children}</Tooltip.Item>;
}

function SessionListGitTooltipPanel({ item }: { item: SessionGitTooltipItem }) {
  const { t } = useTranslation();
  const workLocation = resolveSessionWorkLocation(item.workspaceRoot);
  const LocationIcon = WORK_LOCATION_ICONS[workLocation];
  const locationLabel =
    workLocation === "worktree"
      ? t("composer.workLocationWorktree")
      : t("composer.workLocationLocal");

  return (
    <>
      <div className="flex min-w-0 max-w-full items-center gap-1.5">
        <GitBranch
          className="size-3.5 shrink-0 text-muted-foreground/80"
          aria-hidden
          strokeWidth={1.75}
        />
        <span className="min-w-0 truncate">{item.gitBranch}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <LocationIcon
          className="size-3.5 shrink-0 text-muted-foreground/80"
          aria-hidden
          strokeWidth={1.75}
        />
        <span>{locationLabel}</span>
      </div>
    </>
  );
}

export { SessionListGitTooltipPanel };

export const SessionListGitTooltip = Object.assign(SessionListGitTooltipRoot, {
  Zone: Tooltip.Zone,
  Row: SessionListGitTooltipRow,
});

export { useOptionalTooltipContext as useOptionalSessionListGitTooltipContext };
