import {
  Brackets,
  Database,
  File,
  FileCode,
  FileJson,
  FileText,
  Folder,
  Image as ImageIcon,
  ListTodo,
  Settings2,
  Terminal,
  type LucideIcon,
} from "lucide-react";

import { workspaceFileBasename } from "@/lib/file-picker-path";
import type { WorkspaceExplorerEntryKind } from "@/types";

/** Picks an icon by extension / common file name (name-based heuristics, not a theme engine mapping). */
export function workspaceExplorerIcon(name: string, kind: WorkspaceExplorerEntryKind): LucideIcon {
  if (kind === "dir") {
    return Folder;
  }
  const lower = name.toLowerCase();
  if (lower === "dockerfile" || lower.startsWith("dockerfile.")) {
    return FileCode;
  }
  if (
    lower === "package.json" ||
    lower === "package-lock.json" ||
    lower === "pnpm-lock.yaml" ||
    lower === "yarn.lock"
  ) {
    return FileJson;
  }
  if (lower === "cargo.toml" || lower === "cargo.lock" || lower.endsWith(".toml")) {
    return Settings2;
  }
  if (lower === "makefile" || lower === "cmake" || lower.endsWith(".mk")) {
    return Terminal;
  }
  const dot = lower.lastIndexOf(".");
  const ext = dot >= 0 ? lower.slice(dot + 1) : "";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp"].includes(ext)) {
    return ImageIcon;
  }
  if (["md", "mdx"].includes(ext)) {
    return FileText;
  }
  if (["json", "jsonc"].includes(ext)) {
    return FileJson;
  }
  if (["sql"].includes(ext)) {
    return Database;
  }
  if (
    [
      "ts",
      "tsx",
      "mts",
      "cts",
      "js",
      "jsx",
      "mjs",
      "cjs",
      "rs",
      "go",
      "py",
      "java",
      "kt",
      "c",
      "h",
      "cpp",
      "hpp",
      "cs",
      "swift",
      "vue",
      "svelte",
      "rb",
      "php",
      "zig",
    ].includes(ext)
  ) {
    return FileCode;
  }
  if (["html", "htm", "css", "scss", "sass", "less"].includes(ext)) {
    return Brackets;
  }
  return File;
}

export function workspaceExplorerIconForPath(
  path: string,
  kind: WorkspaceExplorerEntryKind = "file",
): LucideIcon {
  return workspaceExplorerIcon(workspaceFileBasename(path), kind);
}

/** Resolves the icon when the files tool tab has a tabTitle; returns undefined when there is no title. */
export function resolveWorkspaceFilesTabIcon(tabTitle: string | undefined): LucideIcon | undefined {
  const title = tabTitle?.trim();
  if (!title) {
    return undefined;
  }
  if (title === "Plan") {
    return ListTodo;
  }
  return workspaceExplorerIcon(title, "file");
}
