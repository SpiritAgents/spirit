import {
  isWorkspaceReferenceDirectoryPath,
  normalizeWorkspaceReferenceDirectoryPath,
} from "@spiritagent/host-internal/workspace-file-reference-query";
import {
  DESKTOP_COMMAND_PALETTE_ITEM_TONE,
  DESKTOP_OVERLAY_LIST_ITEM_PRIMARY,
  DESKTOP_OVERLAY_LIST_ITEM_SECONDARY,
} from "@/lib/desktop-chrome";
import { workspaceFileBasename } from "@/lib/file-picker-path";
import { WorkspaceFileIcon } from "@/components/workspace-file-icon";
import { DESKTOP_LIST_ITEM_PRIMARY_CLASS } from "@/lib/desktop-typography";
import { cn } from "@/lib/utils";

type WorkspaceFilePickerRowProps = {
  path: string;
  tone?: "popover" | "menu";
  layout?: "inline" | "stacked";
};

export function WorkspaceFilePickerRow({
  path,
  tone = "popover",
  layout = "inline",
}: WorkspaceFilePickerRowProps) {
  const isDirectory = isWorkspaceReferenceDirectoryPath(path);
  const displayPath = isDirectory ? normalizeWorkspaceReferenceDirectoryPath(path) : path;
  const iconKind = isDirectory ? "dir" : "file";
  const basename = workspaceFileBasename(displayPath);
  // For files/directories directly under the workspace root, the relative path equals the
  // basename, so the gray path text carries no extra information
  const showRelativePath = basename !== displayPath;

  if (layout === "stacked") {
    return (
      <div className="flex min-w-0 flex-1 items-start gap-2">
        <WorkspaceFileIcon path={displayPath} kind={iconKind} className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className={DESKTOP_OVERLAY_LIST_ITEM_PRIMARY} title={basename}>
            {basename}
          </div>
          {showRelativePath ? (
            <div className={DESKTOP_OVERLAY_LIST_ITEM_SECONDARY} title={displayPath}>
              {displayPath}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
      <WorkspaceFileIcon
        path={displayPath}
        kind={iconKind}
        className={cn("text-popover-foreground", DESKTOP_COMMAND_PALETTE_ITEM_TONE)}
      />
      <span
        className={cn(
          "shrink-0 whitespace-nowrap leading-6",
          DESKTOP_COMMAND_PALETTE_ITEM_TONE,
          DESKTOP_LIST_ITEM_PRIMARY_CLASS,
          tone === "menu" ? "text-foreground" : "text-popover-foreground",
        )}
      >
        {basename}
      </span>
      {showRelativePath ? (
        <span className="min-w-0 flex-1 truncate text-xs leading-6 text-muted-foreground">
          {displayPath}
        </span>
      ) : null}
    </div>
  );
}
