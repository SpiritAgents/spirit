import { ChevronRight } from "@spiritagent/icons/chevron-right";
import { ChevronDown } from "@spiritagent/icons/chevron-down";
import { useCallback, useEffect, useState } from "react";
import { FONT_WEIGHT_NORMAL } from "@/lib/typography";

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

import { useI18n } from "@/i18n/provider";
import { cn } from "@/lib/utils";
import type {
  PlanSnapshot,
  WorkspaceExplorerEntry,
  WorkspaceExplorerListResult,
} from "@/types/spirit-desktop";

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function fileBasename(path: string): string {
  const normalized = path.replace(/\\/gu, "/");
  const slashIndex = normalized.lastIndexOf("/");
  return slashIndex >= 0 ? normalized.slice(slashIndex + 1) || path : path;
}

export function joinExplorerRel(parent: string, name: string): string {
  return parent === "" ? name : `${parent}/${name}`;
}

export function workspaceExplorerIcon(
  name: string,
  kind: WorkspaceExplorerEntry["kind"],
): LucideIcon {
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

type DirCacheEntry =
  | { status: "loading" }
  | { status: "ready"; entries: WorkspaceExplorerEntry[] }
  | { status: "error"; message: string };

export type WorkspaceFilesPanelProps = {
  workspaceRoot: string;
  listExplorerChildren: (relativePath: string) => Promise<WorkspaceExplorerListResult>;
  plan?: PlanSnapshot;
  selectedEntryKey?: string | null;
  selectedRelativePath?: string | null;
  onOpenPlan?: () => void;
  onOpenFile?: (relativePath: string) => void;
};

export function WorkspaceFilesPanel({
  workspaceRoot,
  listExplorerChildren,
  plan,
  selectedEntryKey = null,
  selectedRelativePath = null,
  onOpenPlan,
  onOpenFile,
}: WorkspaceFilesPanelProps) {
  const { messages } = useI18n();
  const [rootOpen, setRootOpen] = useState(true);
  const [cache, setCache] = useState<Record<string, DirCacheEntry>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const loadDir = useCallback(
    async (relativePath: string) => {
      setCache((current) => ({ ...current, [relativePath]: { status: "loading" } }));
      try {
        const { entries } = await listExplorerChildren(relativePath);
        setCache((current) => ({ ...current, [relativePath]: { status: "ready", entries } }));
      } catch (error) {
        setCache((current) => ({
          ...current,
          [relativePath]: { status: "error", message: describeError(error) },
        }));
      }
    },
    [listExplorerChildren],
  );

  useEffect(() => {
    if (!workspaceRoot.trim()) {
      setCache({});
      setExpanded({});
      return;
    }
    setCache({});
    setExpanded({});
    setRootOpen(true);
    void loadDir("");
  }, [workspaceRoot, loadDir]);

  const onToggleDir = useCallback(
    (dirRel: string) => {
      const nextOpen = !expanded[dirRel];
      setExpanded((state) => ({ ...state, [dirRel]: nextOpen }));
      if (nextOpen) {
        const current = cache[dirRel];
        if (current === undefined || current.status === "error") {
          void loadDir(dirRel);
        }
      }
    },
    [cache, expanded, loadDir],
  );

  if (!workspaceRoot.trim()) {
    return <p className="text-muted-foreground">{messages.desktop.files.noWorkspace}</p>;
  }

  const rootLabel = fileBasename(workspaceRoot.trim()) || workspaceRoot.trim();

  const renderDirBody = (relativePath: string, depth: number) => {
    const state = cache[relativePath];
    if (!state || state.status === "loading") {
      return null;
    }
    if (state.status === "error") {
      return <p className="py-1 pl-1 text-destructive/90">{state.message}</p>;
    }
    return (
      <ul className="list-none space-y-0.5 p-0">
        {state.entries.map((entry) => {
          const childRel = joinExplorerRel(relativePath, entry.name);
          const isDir = entry.kind === "dir";
          const Icon = workspaceExplorerIcon(entry.name, entry.kind);
          const open = isDir && expanded[childRel] === true;

          if (!isDir) {
            const selected = selectedRelativePath === childRel;
            const fileClassName = cn(
              "flex w-full min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-left text-foreground/90",
              onOpenFile && "cursor-pointer hover:bg-foreground/[0.06] dark:hover:bg-foreground/10",
              selected && "bg-foreground/[0.08] dark:bg-foreground/12",
            );
            return (
              <li key={childRel} className="min-w-0">
                {onOpenFile ? (
                  <button
                    type="button"
                    className={fileClassName}
                    style={{ paddingLeft: `${depth * 12 + 4}px` }}
                    aria-current={selected ? "true" : undefined}
                    onClick={() => onOpenFile(childRel)}
                  >
                    <span className="inline-block w-4 shrink-0" aria-hidden />
                    <Icon className="size-3.5 shrink-0 opacity-70" aria-hidden />
                    <span className="min-w-0 truncate">{entry.name}</span>
                  </button>
                ) : (
                  <div className={fileClassName} style={{ paddingLeft: `${depth * 12 + 4}px` }}>
                    <span className="inline-block w-4 shrink-0" aria-hidden />
                    <Icon className="size-3.5 shrink-0 opacity-70" aria-hidden />
                    <span className="min-w-0 truncate text-muted-foreground">{entry.name}</span>
                  </div>
                )}
              </li>
            );
          }

          return (
            <li key={childRel} className="min-w-0">
              <button
                type="button"
                className={cn(
                  "flex w-full min-w-0 items-center gap-1 rounded px-1 py-0.5 text-left",
                  "text-foreground/90 hover:bg-foreground/[0.06] dark:hover:bg-foreground/10",
                )}
                style={{ paddingLeft: `${depth * 12 + 4}px` }}
                aria-expanded={open}
                onClick={() => onToggleDir(childRel)}
              >
                {open ? (
                  <ChevronDown className="size-3.5 shrink-0 opacity-60" aria-hidden />
                ) : (
                  <ChevronRight className="size-3.5 shrink-0 opacity-60" aria-hidden />
                )}
                <Icon className="size-3.5 shrink-0 opacity-70" aria-hidden />
                <span className={`min-w-0 truncate ${FONT_WEIGHT_NORMAL}`}>{entry.name}</span>
              </button>
              {open ? <div className="min-w-0">{renderDirBody(childRel, depth + 1)}</div> : null}
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden text-xs">
      {plan ? (
        <button
          type="button"
          className={cn(
            `mb-1 flex w-full min-w-0 shrink-0 items-center gap-1 rounded px-1 py-1 text-left ${FONT_WEIGHT_NORMAL}`,
            "text-foreground hover:bg-foreground/[0.06] dark:hover:bg-foreground/10",
            onOpenPlan && "cursor-pointer",
            selectedEntryKey === "plan" && "bg-foreground/[0.08] dark:bg-foreground/12",
          )}
          aria-current={selectedEntryKey === "plan" ? "true" : undefined}
          onClick={() => onOpenPlan?.()}
          title={plan.path}
        >
          <ListTodo className="size-3.5 shrink-0 opacity-70" aria-hidden />
          <span className="min-w-0 truncate">{plan.path.split(/[/\\]/u).pop() ?? plan.path}</span>
        </button>
      ) : null}
      <button
        type="button"
        className={cn(
          `mb-1 flex w-full min-w-0 shrink-0 items-center gap-1 rounded px-1 py-1 text-left ${FONT_WEIGHT_NORMAL}`,
          "text-foreground hover:bg-foreground/[0.06] dark:hover:bg-foreground/10",
        )}
        aria-expanded={rootOpen}
        onClick={() => setRootOpen((open) => !open)}
      >
        {rootOpen ? (
          <ChevronDown className="size-3.5 shrink-0 opacity-60" aria-hidden />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 opacity-60" aria-hidden />
        )}
        <Folder className="size-3.5 shrink-0 opacity-70" aria-hidden />
        <span className="min-w-0 truncate">{rootLabel}</span>
      </button>
      {rootOpen ? (
        <div
          className="spirit-scroll min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden pr-0.5"
          role="tree"
          aria-label={messages.desktop.files.fileListAria}
          aria-busy={cache[""]?.status === "loading" ? true : undefined}
        >
          {renderDirBody("", 0)}
        </div>
      ) : null}
    </div>
  );
}
