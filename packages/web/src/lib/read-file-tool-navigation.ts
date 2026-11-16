import { isMarkdownPath, looksLikeAbsolutePath } from "@/lib/file-picker-path";
import { parseReadFilePathFromToolSnapshot } from "@/lib/read-file-skill-display";
import { normalizeWorkspaceEntryRel } from "@/lib/workspace-entry-path-sync";
import type { EditorFileTarget } from "@/lib/workspace-editor-navigation";
import type { ToolBlockSnapshot } from "@/types";

import { tryResolveWorkspaceRelativePath } from "@spiritagent/ui/rendering/path-within-root";
export { tryResolveWorkspaceRelativePath } from "@spiritagent/ui/rendering/path-within-root";

function viewModeForPath(path: string): EditorFileTarget["viewMode"] {
  return isMarkdownPath(path) ? "preview" : "edit";
}

export function resolveReadFileEditorTarget(
  rawPath: string,
  workspaceRoot: string,
): EditorFileTarget | null {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    return null;
  }

  if (!looksLikeAbsolutePath(trimmed)) {
    const relativePath = normalizeWorkspaceEntryRel(trimmed);
    return {
      scope: "workspace",
      relativePath,
      viewMode: viewModeForPath(relativePath),
    };
  }

  const relativePath = tryResolveWorkspaceRelativePath(workspaceRoot, trimmed);
  if (relativePath) {
    return {
      scope: "workspace",
      relativePath,
      viewMode: viewModeForPath(relativePath),
    };
  }

  return {
    scope: "external",
    absolutePath: trimmed,
    viewMode: viewModeForPath(trimmed),
  };
}

export function resolveReadFileTargetFromTool(
  tool: Pick<ToolBlockSnapshot, "argsExcerpt" | "headline" | "detailLines">,
  workspaceRoot: string,
): EditorFileTarget | null {
  const rawPath = parseReadFilePathFromToolSnapshot(tool);
  if (!rawPath.trim()) {
    return null;
  }
  return resolveReadFileEditorTarget(rawPath, workspaceRoot);
}
