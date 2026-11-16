import type { ReactNode } from "react";

import { DESKTOP_LIST_ITEM_PRIMARY_CLASS } from "@/lib/desktop-typography";
import { workspaceFileDirname } from "@/lib/file-picker-path";

export function SettingsListItemHeading({
  title,
  path,
  directoryLabel,
  leading,
}: {
  title: string;
  path: string;
  directoryLabel?: string;
  leading?: ReactNode;
}) {
  const directory = directoryLabel ?? workspaceFileDirname(path);

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      {leading}
      <span className={DESKTOP_LIST_ITEM_PRIMARY_CLASS}>{title}</span>
      {directory ? (
        <span
          className="min-w-0 flex-1 truncate text-[10px] leading-5 text-muted-foreground"
          title={path}
        >
          {directory}
        </span>
      ) : null}
    </div>
  );
}
