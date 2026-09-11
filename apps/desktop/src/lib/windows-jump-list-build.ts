import type { SessionListItem } from "../types.js";
import {
  buildJumpListNewSessionLaunchArgs,
  buildJumpListSessionLaunchArgs,
  jumpListSessionFileNameFromPath,
} from "./windows-launch-argv.js";

export const JUMP_LIST_RECENT_LIMIT = 5;
export const TRAY_RECENT_LIMIT = 5;
export const TRAY_MORE_LIMIT = 10;
export const JUMP_LIST_TITLE_MAX = 260;

export type JumpListTaskItem = {
  type: "task";
  title: string;
  program: string;
  args: string;
  iconPath: string;
  iconIndex: number;
};

export type JumpListCategoryBuilt =
  | { type: "custom"; name: string; items: JumpListTaskItem[] }
  | { type: "tasks"; items: JumpListTaskItem[] };

export function pickRecentSessions(
  sessions: readonly SessionListItem[],
  limit: number,
): SessionListItem[] {
  const capped = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
  return [...sessions]
    .sort((left, right) => right.modifiedAtUnixMs - left.modifiedAtUnixMs)
    .slice(0, capped);
}

export function pickRecentSessionsForJumpList(
  sessions: readonly SessionListItem[],
): SessionListItem[] {
  return pickRecentSessions(
    sessions.filter((session) => jumpListSessionFileNameFromPath(session.path) !== null),
    JUMP_LIST_RECENT_LIMIT,
  );
}

export function truncateJumpListTitle(title: string, maxLength = JUMP_LIST_TITLE_MAX): string {
  const trimmed = title.trim();
  // Truncate by code point to avoid splitting emoji and other surrogate pairs in the middle.
  const points = [...trimmed];
  if (points.length <= maxLength) {
    return trimmed;
  }
  if (maxLength <= 1) {
    return "…";
  }
  return `${points.slice(0, maxLength - 1).join("")}…`;
}

export function buildJumpListLaunchArgs(launchArgs: string, devMainScript?: string): string {
  const script = devMainScript?.trim();
  if (script) {
    return `"${script}" ${launchArgs}`;
  }
  return launchArgs;
}

export function buildWindowsJumpListCategories(input: {
  recentLabel: string;
  newAgentLabel: string;
  sessions: readonly SessionListItem[];
  execPath: string;
  iconPath: string;
  devMainScript?: string;
}): JumpListCategoryBuilt[] {
  const devMainScript = input.devMainScript?.trim() || undefined;
  const categories: JumpListCategoryBuilt[] = [];
  const recentSessions = pickRecentSessionsForJumpList(input.sessions);

  if (recentSessions.length > 0) {
    categories.push({
      type: "custom",
      name: input.recentLabel,
      items: recentSessions.flatMap((session) => {
        const fileName = jumpListSessionFileNameFromPath(session.path);
        if (!fileName) {
          return [];
        }
        return [
          {
            type: "task" as const,
            title: truncateJumpListTitle(session.displayName),
            program: input.execPath,
            args: buildJumpListLaunchArgs(buildJumpListSessionLaunchArgs(fileName), devMainScript),
            iconPath: input.iconPath,
            iconIndex: 0,
          },
        ];
      }),
    });
  }

  categories.push({
    type: "tasks",
    items: [
      {
        type: "task",
        title: input.newAgentLabel,
        program: input.execPath,
        args: buildJumpListLaunchArgs(buildJumpListNewSessionLaunchArgs(), devMainScript),
        iconPath: input.iconPath,
        iconIndex: 0,
      },
    ],
  });

  return categories;
}
