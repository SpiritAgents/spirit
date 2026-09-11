/** Matches the sidebar pagination default in session-sidebar.tsx. */
export const SIDEBAR_SESSION_PAGE_SIZE = 10;

export type SidebarVisibleSessionGroup<T> = {
  id: string;
  sessions: readonly T[];
};

export type ListVisibleSidebarSessionsInput<T> = {
  workspaceGroups: readonly SidebarVisibleSessionGroup<T>[];
  unboundSessions: readonly T[];
  workspaceSectionExpanded: boolean;
  noWorkspaceSectionExpanded: boolean;
  /** Existing sidebar semantics: `[id] !== false` means the group is expanded. */
  collapsedWorkspaceIds: Record<string, boolean>;
  visibleCountByWorkspaceGroupId: Record<string, number>;
  unboundVisibleCount: number;
  pageSize?: number;
};

/**
 * Flatten currently rendered sidebar sessions top-to-bottom.
 * Collapsed sections/groups and not-yet-loaded pages are omitted.
 */
export function listVisibleSidebarSessions<T>(input: ListVisibleSidebarSessionsInput<T>): T[] {
  const pageSize = input.pageSize ?? SIDEBAR_SESSION_PAGE_SIZE;
  const visible: T[] = [];

  if (input.workspaceSectionExpanded) {
    for (const group of input.workspaceGroups) {
      if (input.collapsedWorkspaceIds[group.id] === false) {
        continue;
      }
      const visibleCount = input.visibleCountByWorkspaceGroupId[group.id] ?? pageSize;
      visible.push(...group.sessions.slice(0, visibleCount));
    }
  }

  if (input.noWorkspaceSectionExpanded) {
    visible.push(...input.unboundSessions.slice(0, input.unboundVisibleCount));
  }

  return visible;
}
