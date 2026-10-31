import { GitCommitHorizontal } from "lucide-react";
import { FONT_WEIGHT_NORMAL } from "@/lib/typography";

import { ScrollArea } from "@/components/ui/scroll-area";
import { useI18n } from "@/i18n/provider";
import { workspaceExplorerIconForPath } from "@/lib/workspace-explorer-icon";
import { cn } from "@/lib/utils";

const PREVIEW_CHANGED_FILES = [
  { path: "src/components/hero.tsx", code: " M" },
  { path: "src/components/spirit-desktop-window.tsx", code: " M" },
  { path: "src/i18n/messages.ts", code: " M" },
] as const;

const PREVIEW_COMMITS = [
  { hash: "318f710", summary: "Add more top spacing below the fixed nav in hero." },
  { hash: "9773eab", summary: "Refresh landing nav layout and secondary actions." },
  { hash: "61eed95", summary: "Rework hero copy and scoped static mesh backgrounds." },
] as const;

function statusCodeClass(code: string): string {
  if (code.includes("?")) {
    return "text-muted-foreground";
  }
  if (code.includes("D")) {
    return "text-destructive";
  }
  if (code.includes("A")) {
    return "text-emerald-600 dark:text-emerald-400";
  }
  return "text-amber-600 dark:text-amber-400";
}

function splitChangePath(path: string): { fileName: string; dirLabel: string } {
  const normalized = path.replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  if (slash < 0) {
    return { fileName: normalized, dirLabel: "" };
  }
  return {
    fileName: normalized.slice(slash + 1),
    dirLabel: `${normalized.slice(0, slash)}/`,
  };
}

function previewNoop(): void {
  return undefined;
}

export function WorkspaceGitPreviewTab({ branch = "main" }: { branch?: string }) {
  const { messages } = useI18n();
  const copy = messages.desktop.tools;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="mb-2 flex shrink-0 items-center justify-between gap-2 px-0.5">
        <p className={`truncate text-xs ${FONT_WEIGHT_NORMAL} text-foreground/90`}>{branch}</p>
        <button
          type="button"
          className={`shrink-0 rounded-md px-2 py-1 text-[11px] ${FONT_WEIGHT_NORMAL} text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground dark:hover:bg-foreground/10`}
          onClick={previewNoop}
        >
          {copy.gitRefresh}
        </button>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden">
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="mb-1 flex shrink-0 items-center justify-between gap-2 px-0.5">
            <h3 className={`text-[11px] ${FONT_WEIGHT_NORMAL} tracking-wide text-muted-foreground`}>
              {copy.gitChangesHeading}
            </h3>
            <button
              type="button"
              className={`rounded-md px-2 py-1 text-[11px] ${FONT_WEIGHT_NORMAL} text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground dark:hover:bg-foreground/10`}
              onClick={previewNoop}
            >
              {copy.gitStageAll}
            </button>
          </div>
          <ScrollArea className="min-h-0 flex-1" type="hover" scrollHideDelay={450}>
            <ul className="min-w-0 space-y-0.5 pb-1">
              {PREVIEW_CHANGED_FILES.map((change) => {
                const { fileName, dirLabel } = splitChangePath(change.path);
                const Icon = workspaceExplorerIconForPath(change.path);
                return (
                  <li key={change.path} className="min-w-0">
                    <button
                      type="button"
                      className={cn(
                        "flex w-full min-w-0 cursor-pointer items-center gap-1.5 px-2 py-1 text-left text-xs",
                        "hover:bg-muted/30",
                      )}
                      title={change.path}
                      onClick={previewNoop}
                    >
                      <Icon
                        className="size-3.5 shrink-0 opacity-70"
                        aria-hidden
                        strokeWidth={1.75}
                      />
                      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
                        <span className="shrink-0 truncate text-foreground/90">{fileName}</span>
                        {dirLabel ? (
                          <span className="min-w-0 truncate text-[10px] text-muted-foreground">
                            {dirLabel}
                          </span>
                        ) : null}
                      </div>
                      <span
                        className={cn(
                          `ml-1 shrink-0 font-mono text-[10px] ${FONT_WEIGHT_NORMAL} tabular-nums`,
                          statusCodeClass(change.code),
                        )}
                      >
                        {change.code.trim() || "·"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </ScrollArea>
        </section>

        <section className="flex min-h-0 flex-[1.1] flex-col overflow-hidden border-t border-border/40 pt-2">
          <h3
            className={`mb-1 shrink-0 px-0.5 text-[11px] ${FONT_WEIGHT_NORMAL} tracking-wide text-muted-foreground`}
          >
            {copy.gitHistoryHeading}
          </h3>
          <ScrollArea className="min-h-0 flex-1" type="hover" scrollHideDelay={450}>
            <ul className="min-w-0 space-y-0.5 pb-1">
              {PREVIEW_COMMITS.map((commit) => (
                <li key={commit.hash} className="min-w-0">
                  <button
                    type="button"
                    className={cn(
                      "flex w-full min-w-0 cursor-pointer items-start gap-2 px-2 py-1.5 text-left text-xs",
                      "hover:bg-muted/30",
                    )}
                    onClick={previewNoop}
                  >
                    <GitCommitHorizontal
                      className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/70"
                      aria-hidden
                      strokeWidth={1.75}
                    />
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate ${FONT_WEIGHT_NORMAL} text-foreground/90`}>
                        {commit.summary}
                      </span>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {commit.hash}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </ScrollArea>
        </section>
      </div>
    </div>
  );
}
