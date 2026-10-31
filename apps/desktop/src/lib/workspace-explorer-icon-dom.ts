import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { workspaceFileBasename } from "@/lib/file-picker-path";
import { renderWorkspaceDirectoryIconMarkup } from "@/lib/workspace-directory-icon";
import { workspaceExplorerIcon } from "@/lib/workspace-explorer-icon";
import {
  WORKSPACE_FILE_ICON_LIST_CLASS,
  type WorkspaceFileIconColorMode,
} from "@/lib/workspace-file-icon-sizes";
import type { WorkspaceExplorerEntryKind } from "@/types";

export type AppendWorkspaceFileIconOptions = {
  colorMode?: WorkspaceFileIconColorMode;
};

/** contenteditable chip / DOM: injects Lucide file/directory icons, same source as the React WorkspaceFileIcon. */
export function appendWorkspaceFileIcon(
  parent: HTMLElement,
  doc: Document,
  path: string,
  attrs: { size: number; className: string },
  kind: WorkspaceExplorerEntryKind = "file",
  options: AppendWorkspaceFileIconOptions = {},
): void {
  const { colorMode = "list" } = options;

  if (kind === "dir") {
    const template = doc.createElement("template");
    template.innerHTML = renderWorkspaceDirectoryIconMarkup(attrs.className, colorMode);
    const svg = template.content.firstElementChild;
    if (svg) {
      parent.appendChild(doc.importNode(svg, true));
    }
    return;
  }

  const Icon = workspaceExplorerIcon(workspaceFileBasename(path), kind);
  const className =
    colorMode === "inherit"
      ? attrs.className
      : [WORKSPACE_FILE_ICON_LIST_CLASS, attrs.className].filter(Boolean).join(" ");

  const template = doc.createElement("template");
  template.innerHTML = renderToStaticMarkup(
    createElement(Icon, {
      strokeWidth: 1.75,
      ...(colorMode === "inherit" ? { size: attrs.size } : {}),
      className: className || undefined,
      "aria-hidden": true,
    }),
  ).trim();
  const svg = template.content.firstElementChild;
  if (svg) {
    parent.appendChild(doc.importNode(svg, true));
  }
}
