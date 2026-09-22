import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Folder } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  WORKSPACE_FILE_ICON_CHIP_CLASS,
  type WorkspaceFileIconColorMode,
} from "@/lib/workspace-file-icon-sizes";

/** Matches the Lucide icons in the slash / @ dropdowns (see skill-slash-menu). */
export const WORKSPACE_DIRECTORY_LIST_ICON_CLASS = "size-3.5 shrink-0 opacity-70";

/** Chip inherit directory icon; matches other composer chip icons. */
export const WORKSPACE_DIRECTORY_CHIP_ICON_CLASS = WORKSPACE_FILE_ICON_CHIP_CLASS;

export function workspaceDirectoryIconClassName(
  colorMode: WorkspaceFileIconColorMode,
  className?: string,
): string {
  if (colorMode === "inherit") {
    return cn(WORKSPACE_DIRECTORY_CHIP_ICON_CLASS, className);
  }
  return cn(WORKSPACE_DIRECTORY_LIST_ICON_CLASS, className);
}

export function renderWorkspaceDirectoryIconMarkup(
  className: string,
  colorMode: WorkspaceFileIconColorMode,
): string {
  return renderToStaticMarkup(
    createElement(Folder, {
      className: workspaceDirectoryIconClassName(colorMode, className),
      "aria-hidden": true,
      strokeWidth: 1.75,
    }),
  ).trim();
}
