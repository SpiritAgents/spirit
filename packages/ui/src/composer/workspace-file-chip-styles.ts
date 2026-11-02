import {
  isWorkspaceReferenceDirectoryPath,
  normalizeWorkspaceReferenceDirectoryPath,
} from "./path-utils.js";
import {
  COMPOSER_INLINE_CHIP_CLASS,
  COMPOSER_INLINE_CHIP_ICON_CLASS,
} from "./composer-inline-chip-styles.js";
import type { WorkspaceExplorerEntryKind } from "./types.js";

/** Workspace @ reference chip (file and directory paths) */
export const WORKSPACE_FILE_CHIP_CLASS = COMPOSER_INLINE_CHIP_CLASS;

export const WORKSPACE_FILE_CHIP_ICON_CLASS = COMPOSER_INLINE_CHIP_ICON_CLASS;

export function isWorkspaceDirectoryChipPath(path: string): boolean {
  return isWorkspaceReferenceDirectoryPath(path.replace(/\\/gu, "/"));
}

export function resolveWorkspaceFileChipPresentation(path: string): {
  chipClass: string;
  iconClass: string;
  iconKind: WorkspaceExplorerEntryKind;
  iconPath: string;
} {
  const normalized = path.replace(/\\/gu, "/");
  const chipClass = WORKSPACE_FILE_CHIP_CLASS;
  const iconClass = WORKSPACE_FILE_CHIP_ICON_CLASS;
  if (isWorkspaceDirectoryChipPath(normalized)) {
    return {
      chipClass,
      iconClass,
      iconKind: "dir",
      iconPath: normalizeWorkspaceReferenceDirectoryPath(normalized),
    };
  }

  return {
    chipClass,
    iconClass,
    iconKind: "file",
    iconPath: normalized,
  };
}
