import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ListTodo } from "lucide-react";

import { mergeRecentIntoSuggestions } from "@spiritagent/host-internal/workspace-file-reference-query";

import { WorkspaceFilePickerRow } from "@/components/workspace-file-picker-row";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  looksLikeAbsolutePath,
  normalizeAbsolutePathInput,
  toWorkspaceFileReferenceQueryInput,
} from "@/lib/file-picker-path";
import { useCommandListWheelHover } from "@/hooks/use-command-list-wheel-hover";
import {
  DESKTOP_COMMAND_PALETTE_ITEM_CLASS,
  DESKTOP_COMMAND_PALETTE_ITEM_TONE,
} from "@/lib/desktop-chrome";
import { RADIX_OVERLAY_CLOSE_MS } from "@/lib/overlay-motion";
import { WorkspaceFileIcon } from "@/components/workspace-file-icon";
import { cn } from "@/lib/utils";

type WorkspaceFilePickerDialogProps = {
  open: boolean;
  onOpenChange(open: boolean): void;
  workspaceRoot: string;
  workspaceBinding: "project" | "none";
  indexReady: boolean;
  searchWorkspaceFiles(query: string): string[];
  /** Recent-pool file entries in display form (workspace-relative or absolute), MRU-first. */
  recentFiles: readonly string[];
  onOpenWorkspaceFile(relativePath: string): void;
  onOpenExternalFile(absolutePath: string): void;
  onOpenPlan?: () => void;
  onValidateRecentFiles?: () => void;
  statHostTextFile(absolutePath: string): Promise<{ exists: boolean; isFile: boolean }>;
};

export function WorkspaceFilePickerDialog({
  open,
  onOpenChange,
  workspaceRoot,
  workspaceBinding,
  indexReady,
  searchWorkspaceFiles,
  recentFiles,
  onOpenWorkspaceFile,
  onOpenExternalFile,
  onOpenPlan,
  onValidateRecentFiles,
  statHostTextFile,
}: WorkspaceFilePickerDialogProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [absolutePathExists, setAbsolutePathExists] = useState<boolean | null>(null);
  const absoluteStatRequestIdRef = useRef(0);
  const commandListWheelHoverRef = useCommandListWheelHover();

  useEffect(() => {
    if (open) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setQuery("");
      setSuggestions([]);
      setAbsolutePathExists(null);
    }, RADIX_OVERLAY_CLOSE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [open]);

  useEffect(() => {
    if (open) {
      onValidateRecentFiles?.();
    }
  }, [open, onValidateRecentFiles]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const trimmed = query.trim();
    const workspaceSearchEnabled =
      workspaceBinding === "project" && workspaceRoot.trim().length > 0;
    const indexSuggestions =
      workspaceSearchEnabled && indexReady
        ? searchWorkspaceFiles(toWorkspaceFileReferenceQueryInput(trimmed))
        : [];

    setSuggestions(
      mergeRecentIntoSuggestions(
        toWorkspaceFileReferenceQueryInput(trimmed),
        indexSuggestions,
        recentFiles,
      ),
    );
  }, [indexReady, open, query, recentFiles, searchWorkspaceFiles, workspaceBinding, workspaceRoot]);

  const trimmedQuery = query.trim();
  const absolutePathCandidate = looksLikeAbsolutePath(trimmedQuery)
    ? normalizeAbsolutePathInput(trimmedQuery)
    : null;

  useEffect(() => {
    if (!open || !absolutePathCandidate) {
      setAbsolutePathExists(null);
      return;
    }

    const requestId = absoluteStatRequestIdRef.current + 1;
    absoluteStatRequestIdRef.current = requestId;

    void statHostTextFile(absolutePathCandidate)
      .then((result) => {
        if (absoluteStatRequestIdRef.current !== requestId) {
          return;
        }
        setAbsolutePathExists(result.exists && result.isFile);
      })
      .catch(() => {
        if (absoluteStatRequestIdRef.current !== requestId) {
          return;
        }
        setAbsolutePathExists(false);
      });
  }, [absolutePathCandidate, open, statHostTextFile]);

  const closeAndOpenWorkspaceFile = (relativePath: string) => {
    onOpenChange(false);
    onOpenWorkspaceFile(relativePath);
  };

  const closeAndOpenExternalFile = (absolutePath: string) => {
    onOpenChange(false);
    onOpenExternalFile(absolutePath);
  };

  // Pool entries may display as absolute paths (out-of-workspace files); route them
  // to the external-open path, everything else stays a workspace-relative open.
  const closeAndOpenSuggestion = (path: string) => {
    if (looksLikeAbsolutePath(path)) {
      closeAndOpenExternalFile(path);
      return;
    }
    closeAndOpenWorkspaceFile(path);
  };

  const closeAndOpenPlan = () => {
    onOpenChange(false);
    onOpenPlan?.();
  };

  const planNeedle = trimmedQuery.toLowerCase();
  const showPlan = Boolean(onOpenPlan && (planNeedle === "" || "plan".includes(planNeedle)));
  const recentFileKeys = new Set(recentFiles.map((path) => path.toLowerCase()));
  const firstNonRecentIndex = suggestions.findIndex(
    (path) => !recentFileKeys.has(path.toLowerCase()),
  );
  const planInsertIndex = showPlan
    ? firstNonRecentIndex === -1
      ? suggestions.length
      : firstNonRecentIndex
    : -1;

  const showEmpty =
    suggestions.length === 0 &&
    !showPlan &&
    (!absolutePathCandidate || absolutePathExists === false);
  const showAbsolutePathIcon = Boolean(absolutePathCandidate && absolutePathExists !== false);

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("workspace.filePickerTitle")}
      description={t("workspace.filePickerDescription")}
      className="sm:max-w-xl"
    >
      <Command shouldFilter={false} aria-label={t("workspace.filePickerTitle")}>
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder={t("workspace.filePickerPlaceholder")}
        />
        <CommandList
          ref={commandListWheelHoverRef}
          className="max-h-[min(28rem,calc(100dvh-6rem))]"
        >
          {absolutePathCandidate && absolutePathExists !== false && showAbsolutePathIcon ? (
            <CommandItem
              key={`absolute:${absolutePathCandidate}`}
              value={`absolute:${absolutePathCandidate}`}
              className={DESKTOP_COMMAND_PALETTE_ITEM_CLASS}
              onSelect={() => closeAndOpenExternalFile(absolutePathCandidate)}
            >
              <WorkspaceFileIcon
                path={absolutePathCandidate}
                className={cn("text-popover-foreground", DESKTOP_COMMAND_PALETTE_ITEM_TONE)}
              />
              <span
                className={cn(
                  "min-w-0 truncate text-sm text-popover-foreground",
                  DESKTOP_COMMAND_PALETTE_ITEM_TONE,
                )}
              >
                {t("workspace.filePickerOpenAbsolutePath", { path: absolutePathCandidate })}
              </span>
            </CommandItem>
          ) : null}
          {suggestions
            .slice(0, planInsertIndex === -1 ? suggestions.length : planInsertIndex)
            .map((path) => (
              <CommandItem
                key={path}
                value={path}
                className={DESKTOP_COMMAND_PALETTE_ITEM_CLASS}
                onSelect={() => closeAndOpenSuggestion(path)}
              >
                <WorkspaceFilePickerRow path={path} />
              </CommandItem>
            ))}
          {showPlan ? (
            <CommandItem
              key="plan"
              value="plan:"
              className={DESKTOP_COMMAND_PALETTE_ITEM_CLASS}
              onSelect={closeAndOpenPlan}
            >
              <ListTodo
                className={cn(
                  "size-3.5 shrink-0 text-popover-foreground",
                  DESKTOP_COMMAND_PALETTE_ITEM_TONE,
                )}
                aria-hidden
                strokeWidth={1.75}
              />
              <span
                className={cn(
                  "min-w-0 truncate text-sm text-popover-foreground",
                  DESKTOP_COMMAND_PALETTE_ITEM_TONE,
                )}
              >
                Plan
              </span>
            </CommandItem>
          ) : null}
          {planInsertIndex > -1
            ? suggestions.slice(planInsertIndex).map((path) => (
                <CommandItem
                  key={path}
                  value={path}
                  className={DESKTOP_COMMAND_PALETTE_ITEM_CLASS}
                  onSelect={() => closeAndOpenSuggestion(path)}
                >
                  <WorkspaceFilePickerRow path={path} />
                </CommandItem>
              ))
            : null}
          {showEmpty ? (
            <CommandEmpty>
              {!indexReady
                ? t("workspace.filePickerIndexing")
                : absolutePathCandidate && absolutePathExists === false
                  ? t("workspace.filePickerAbsolutePathNotFound")
                  : t("workspace.filePickerEmpty")}
            </CommandEmpty>
          ) : null}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
