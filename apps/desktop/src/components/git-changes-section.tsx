import { LoaderCircle } from "@spiritagent/icons/loader-circle";
import type { CSSProperties } from "react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";

import { GitChangesActions } from "@/components/git-changes-actions";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  formatGitChangeStatusLabel,
  gitChangeStatusClassName,
  gitChangeStatusTitle,
} from "@/lib/git-change-status-display";
import { useWorkspaceToolsShellHorizontalDivider } from "@/lib/use-workspace-tools-shell-horizontal-divider";
import { DESKTOP_SHELL_SECTION_HEADER_MIN_HEIGHT_CLASS } from "@/lib/desktop-chrome";
import { GIT_CHANGES_HEADER_SHELL_DIVIDER_ATTR } from "@/lib/workspace-tools-panel-edge";
import { WorkspaceFileIcon } from "@/components/workspace-file-icon";
import { cn } from "@/lib/utils";
import type {
  DesktopGitSnapshot,
  GitWorkingTreeChange,
  GitWorkingTreeSnapshot,
  SubmitGitChipRequest,
} from "@/types";

export type GitChangesSectionProps = {
  gitSnapshot?: DesktopGitSnapshot;
  workingTree: GitWorkingTreeSnapshot | null;
  loading: boolean;
  error?: string;
  hasChanges?: boolean;
  needsPush?: boolean;
  canMerge?: boolean;
  gitBusy?: boolean;
  mergeFlashMerged?: boolean;
  pushDisabledTitle?: string;
  onGitChip: (request: SubmitGitChipRequest) => Promise<boolean>;
  onOpenChangedFile?: (relativePath: string) => void;
  className?: string;
  style?: CSSProperties;
};

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

function ChangeRow({
  change,
  onOpen,
}: {
  change: GitWorkingTreeChange;
  onOpen?: (relativePath: string) => void;
}) {
  const { fileName, dirLabel } = splitChangePath(change.path);
  const statusLabel = formatGitChangeStatusLabel(change.code);
  const clickable = Boolean(onOpen);

  return (
    <li className="min-w-0">
      <button
        type="button"
        disabled={!clickable}
        className={cn(
          "flex w-full min-w-0 items-center gap-1.5 px-2 py-1 text-left text-xs",
          clickable && "cursor-pointer hover:bg-canvas-hover",
        )}
        title={change.path}
        onClick={() => onOpen?.(change.path)}
      >
        <WorkspaceFileIcon name={fileName} />
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
          <span className="shrink-0 truncate text-foreground/90">{fileName}</span>
          {dirLabel ? (
            <span className="min-w-0 truncate text-[10px] text-muted-foreground">{dirLabel}</span>
          ) : null}
        </div>
        <span
          className={cn(
            "ml-1 shrink-0 text-[10px] font-normal tabular-nums",
            gitChangeStatusClassName(change.code),
          )}
          title={gitChangeStatusTitle(change.code)}
        >
          {statusLabel}
        </span>
      </button>
    </li>
  );
}

export function GitChangesSection({
  gitSnapshot,
  workingTree,
  loading,
  error,
  hasChanges = false,
  needsPush = false,
  canMerge = false,
  gitBusy = false,
  mergeFlashMerged = false,
  pushDisabledTitle,
  onGitChip,
  onOpenChangedFile,
  className,
  style,
}: GitChangesSectionProps) {
  const { t } = useTranslation();
  const headerRef = useRef<HTMLDivElement>(null);
  const isRepository = gitSnapshot?.isRepository === true && workingTree?.isRepository !== false;
  const changes = workingTree?.changes ?? [];
  const branchLabel = gitSnapshot?.branch ?? gitSnapshot?.worktreeBranch;

  useWorkspaceToolsShellHorizontalDivider(
    headerRef,
    {
      enabled: true,
      edge: "bottom",
      dividerAttr: GIT_CHANGES_HEADER_SHELL_DIVIDER_ATTR,
    },
    [branchLabel, changes.length, loading, error],
  );

  return (
    <section className={cn("flex min-h-0 flex-col", className)} style={style}>
      <div
        ref={headerRef}
        className={cn(
          "flex shrink-0 items-center justify-between gap-2 px-2 py-1.5",
          DESKTOP_SHELL_SECTION_HEADER_MIN_HEIGHT_CLASS,
        )}
      >
        <div className="flex min-w-0 items-center gap-1">
          <h3 className="m-0 shrink-0 text-xs font-normal leading-none text-foreground">
            {t("workspace.git.changes")}
          </h3>
          {branchLabel ? (
            <span
              className="max-w-[7rem] truncate text-xs font-normal leading-none text-muted-foreground"
              title={branchLabel}
            >
              {branchLabel}
            </span>
          ) : null}
        </div>
        <GitChangesActions
          isRepository={isRepository}
          hasChanges={hasChanges}
          needsPush={needsPush}
          canMerge={canMerge}
          gitBusy={gitBusy}
          mergeFlashMerged={mergeFlashMerged}
          pushDisabledTitle={pushDisabledTitle}
          onGitChip={onGitChip}
        />
      </div>
      <div className="relative min-h-0 flex-1">
        {loading ? (
          <div className="flex items-center justify-center gap-2 p-4 text-xs text-muted-foreground">
            <LoaderCircle className="size-3.5 animate-spin" aria-hidden strokeWidth={1.75} />
            {t("workspace.git.loadingChanges")}
          </div>
        ) : null}
        {!loading && !isRepository ? (
          <p className="p-3 text-xs text-muted-foreground">{t("workspace.git.noRepo")}</p>
        ) : null}
        {!loading && isRepository && error ? (
          <p className="p-3 text-xs text-destructive">{error}</p>
        ) : null}
        {!loading && isRepository && !error && changes.length === 0 ? (
          <p className="p-3 text-xs text-muted-foreground">{t("workspace.git.noChanges")}</p>
        ) : null}
        {!loading && isRepository && !error && changes.length > 0 ? (
          <ScrollArea className="h-full min-h-0">
            <ul className="py-1">
              {changes.map((change) => (
                <ChangeRow
                  key={`${change.code}:${change.path}`}
                  change={change}
                  onOpen={onOpenChangedFile}
                />
              ))}
            </ul>
          </ScrollArea>
        ) : null}
      </div>
    </section>
  );
}
