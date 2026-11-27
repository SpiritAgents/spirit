import type { RefObject } from "react";
import { useTranslation } from "react-i18next";

import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSectionItems,
  type ContextMenuSectionItem,
} from "@/components/ui/context-menu";
import type { GitCommitRecord } from "@/types";

export type WorkspaceGitCommitContextMenuContentProps = {
  commit: GitCommitRecord | null;
  commitRef: RefObject<GitCommitRecord | null>;
  onAddToThread?: (commit: GitCommitRecord) => void;
  addToThreadDisabled?: boolean;
};

/** Content of the panel-level single ContextMenu (aligned with the thread-sidebar list capture pattern). */
export function WorkspaceGitCommitContextMenuContent({
  commit,
  commitRef,
  onAddToThread,
  addToThreadDisabled = false,
}: WorkspaceGitCommitContextMenuContentProps) {
  const { t } = useTranslation();

  if (!onAddToThread) {
    return null;
  }

  const menuItems: ContextMenuSectionItem[] = [
    {
      section: "session",
      item: (
        <ContextMenuItem
          disabled={addToThreadDisabled}
          onSelect={() => {
            const resolved = commitRef.current ?? commit;
            if (resolved) {
              onAddToThread(resolved);
            }
          }}
        >
          {t("workspace.addCommitToThread")}
        </ContextMenuItem>
      ),
    },
  ];

  return (
    <ContextMenuContent aria-label={t("workspace.git.commitActions")}>
      <ContextMenuSectionItems items={menuItems} />
    </ContextMenuContent>
  );
}
