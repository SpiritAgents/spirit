import { workspaceFileBasename } from "./file-picker-path.js";
import { workspaceDirectoryIconClassName } from "./workspace-directory-icon.js";
import { workspaceExplorerIcon } from "./workspace-explorer-icon.js";
import {
  WORKSPACE_FILE_ICON_CHIP_CLASS,
  WORKSPACE_FILE_ICON_CHIP_SIZE_PX,
  WORKSPACE_FILE_ICON_LIST_CLASS,
  type WorkspaceFileIconColorMode,
} from "../composer/index.js";
import { cn } from "../cn.js";
type WorkspaceExplorerEntryKind = "file" | "dir";

export type { WorkspaceFileIconColorMode } from "../composer/index.js";

export type WorkspaceFileIconProps = {
  name?: string;
  path?: string;
  kind?: WorkspaceExplorerEntryKind;
  size?: number;
  className?: string;
  colorMode?: WorkspaceFileIconColorMode;
};

export function workspaceFileIconClassName(
  colorMode: WorkspaceFileIconColorMode,
  className?: string,
): string {
  if (colorMode === "inherit") {
    return cn(WORKSPACE_FILE_ICON_CHIP_CLASS, className);
  }
  return cn(WORKSPACE_FILE_ICON_LIST_CLASS, className);
}

export function WorkspaceFileIcon({
  name,
  path,
  kind = "file",
  size = WORKSPACE_FILE_ICON_CHIP_SIZE_PX,
  className,
  colorMode = "list",
}: WorkspaceFileIconProps) {
  const resolvedName = name ?? (path ? workspaceFileBasename(path) : "");
  if (!resolvedName) {
    return null;
  }

  if (kind === "dir") {
    const Folder = workspaceExplorerIcon(resolvedName, "dir");
    return (
      <Folder
        className={workspaceDirectoryIconClassName(colorMode, className)}
        aria-hidden
        strokeWidth={1.75}
      />
    );
  }

  const Icon = workspaceExplorerIcon(resolvedName, kind);
  const iconClassName = workspaceFileIconClassName(colorMode, className);

  if (colorMode === "inherit") {
    return <Icon size={size} className={iconClassName} aria-hidden strokeWidth={1.75} />;
  }

  return <Icon className={iconClassName} aria-hidden strokeWidth={1.75} />;
}
