import { joinWorkspaceAbsolutePath } from "@/lib/workspace-entry-path-sync";
import { normalizeSlashPath } from "@spiritagent/ui/composer";

export const SPIRIT_WORKSPACE_ENTRY_MIME = "application/spirit-workspace-entry";

export function isComposerFileDropAccepted(dataTransfer: DataTransfer): boolean {
  const types = Array.from(dataTransfer.types);
  return types.includes("Files") || types.includes(SPIRIT_WORKSPACE_ENTRY_MIME);
}

/** Match dropEffect to drag source effectAllowed so the browser allows drop. */
export function resolveComposerDropEffect(dataTransfer: DataTransfer): "copy" | "move" | "link" {
  const allowed = dataTransfer.effectAllowed;
  if (allowed === "all" || allowed === "uninitialized") {
    return "copy";
  }
  if (allowed === "move" || allowed === "linkMove") {
    return "move";
  }
  if (allowed === "copy" || allowed === "copyMove" || allowed === "copyLink") {
    return "copy";
  }
  if (allowed === "link") {
    return "link";
  }
  return "copy";
}

export type ResolveComposerDropPathsOptions = {
  workspaceRoot: string;
  getPathForFile: (file: File) => string | null;
};

export function resolveComposerDropAbsolutePaths(
  event: Pick<DragEvent, "dataTransfer">,
  options: ResolveComposerDropPathsOptions,
): string[] {
  const dataTransfer = event.dataTransfer;
  if (!dataTransfer) {
    return [];
  }

  const { workspaceRoot, getPathForFile } = options;
  const paths: string[] = [];
  const seen = new Set<string>();

  const pushUniquePath = (value: string) => {
    const key = normalizeSlashPath(value);
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);
    paths.push(value);
  };

  const spiritRaw = dataTransfer.getData(SPIRIT_WORKSPACE_ENTRY_MIME);
  if (spiritRaw) {
    try {
      const payload = JSON.parse(spiritRaw) as { relativePath?: string; kind?: string };
      if (payload.kind === "file" && payload.relativePath && workspaceRoot.trim()) {
        pushUniquePath(joinWorkspaceAbsolutePath(workspaceRoot, payload.relativePath));
      }
    } catch {
      // An invalid payload is treated the same as an empty drop: silently ignored
    }
    return paths;
  }

  for (const file of Array.from(dataTransfer.files)) {
    const absolutePath = getPathForFile(file);
    if (absolutePath) {
      pushUniquePath(absolutePath);
    }
  }

  return paths;
}
