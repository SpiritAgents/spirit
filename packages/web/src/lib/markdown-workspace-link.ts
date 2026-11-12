import { isMarkdownPath } from "@/lib/file-picker-path";
import { isMarkdownLocalPathUrl } from "@/lib/markdown-local-url";
import { resolveMarkdownLocalImageFilePath } from "@/lib/markdown-local-image-src";
import { tryResolveWorkspaceRelativePath } from "@/lib/read-file-tool-navigation";
import type { WorkspaceEditorViewMode } from "@/lib/workspace-editor-navigation";

export type MarkdownWorkspaceLinkKind = "file" | "directory";

export type MarkdownWorkspaceLinkTarget = {
  absolutePath: string;
  relativePath: string;
  trailingSlash: boolean;
};

export type MarkdownWorkspaceLinkHandlers = {
  openWorkspaceFileInNewTab: (
    relativePath: string,
    options?: { viewMode?: WorkspaceEditorViewMode },
  ) => void;
  revealWorkspaceDirectory: (relativePath: string) => void;
  statHostTextFile?: (absolutePath: string) => Promise<{ exists: boolean; isFile: boolean }>;
};

function stripHrefToPath(href: string): string {
  const withoutHash = href.split("#")[0] ?? href;
  return withoutHash.split("?")[0] ?? withoutHash;
}

export function resolveMarkdownWorkspaceLink(
  href: string,
  options: { baseDir: string; workspaceRoot: string },
): MarkdownWorkspaceLinkTarget | null {
  if (!isMarkdownLocalPathUrl(href)) {
    return null;
  }
  const pathPart = stripHrefToPath(href.trim());
  if (!pathPart) {
    return null;
  }
  const trailingSlash = pathPart.endsWith("/");
  const absolutePath = resolveMarkdownLocalImageFilePath(
    pathPart,
    options.baseDir,
    options.workspaceRoot,
  );
  if (!absolutePath) {
    return null;
  }
  const relative = tryResolveWorkspaceRelativePath(options.workspaceRoot, absolutePath);
  if (relative === null) {
    return null;
  }
  return {
    absolutePath,
    relativePath: relative === "." ? "" : relative,
    trailingSlash,
  };
}

export function inferMarkdownWorkspaceLinkKind(
  target: Pick<MarkdownWorkspaceLinkTarget, "relativePath" | "trailingSlash">,
  stat?: { exists: boolean; isFile: boolean },
): MarkdownWorkspaceLinkKind {
  if (stat?.exists) {
    return stat.isFile ? "file" : "directory";
  }
  if (target.trailingSlash || target.relativePath === "") {
    return "directory";
  }
  const basename = target.relativePath.split("/").pop() ?? "";
  return basename.includes(".") ? "file" : "directory";
}

async function navigateMarkdownWorkspaceLink(
  target: MarkdownWorkspaceLinkTarget,
  handlers: MarkdownWorkspaceLinkHandlers,
): Promise<void> {
  let stat: { exists: boolean; isFile: boolean } | undefined;
  if (handlers.statHostTextFile) {
    try {
      stat = await handlers.statHostTextFile(target.absolutePath);
    } catch {
      stat = undefined;
    }
  }
  const kind = inferMarkdownWorkspaceLinkKind(target, stat);
  if (kind === "directory") {
    handlers.revealWorkspaceDirectory(target.relativePath);
    return;
  }
  handlers.openWorkspaceFileInNewTab(target.relativePath, {
    viewMode: isMarkdownPath(target.relativePath) ? "preview" : "edit",
  });
}

/** Returns true when href is a workspace-local path; navigation may finish asynchronously. */
export function tryHandleMarkdownWorkspaceLink(
  href: string,
  handlers: MarkdownWorkspaceLinkHandlers,
  options: { baseDir: string; workspaceRoot: string },
): boolean {
  const target = resolveMarkdownWorkspaceLink(href, options);
  if (!target) {
    return false;
  }
  void navigateMarkdownWorkspaceLink(target, handlers);
  return true;
}
