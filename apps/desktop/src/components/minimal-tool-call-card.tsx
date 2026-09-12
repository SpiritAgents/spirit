import { useEffect, useMemo, useRef, useState } from "react";

import { ChevronRight, Square } from "lucide-react";
import { useTranslation } from "react-i18next";

import { EditFileLineDeltaBadge } from "@/components/edit-file-line-delta-badge";
import { FileToolLspDiagnosticsBadge } from "@/components/file-tool-lsp-diagnostics-badge";
import {
  FileToolLspDiagnosticsHover,
  FileToolLspDiagnosticsHoverTrigger,
} from "@/components/file-tool-lsp-diagnostics-hover";
import { ShellToolCommandHighlight } from "@/components/shell-tool-command-highlight";
import { ShellToolXtermOutput } from "@/components/shell-tool-xterm-output";
import { ToolCallDiffView } from "@/components/tool-call-diff-view";
import { useToolCallDiffHost } from "@/components/tool-call-diff-host-context";
import { useCollapsibleChildMount } from "@/hooks/use-collapsible-child-mount";
import { Button } from "@/components/ui/button";
import { AnimatedCollapse, AnimatedCollapseContent } from "@/components/ui/animated-collapse";
import { ScrollArea } from "@/components/ui/scroll-area";
import { resolveToolLineDeltaForDisplay } from "@/lib/edit-file-line-delta";
import {
  type FileToolDiffSource,
  isFileDiffTool,
  resolveFileToolDiffSource,
  resolvePlanRelativePath,
} from "@/lib/file-tool-diff-source";
import {
  genericExpandableDetailLines,
  getToolCallSummaryParts,
  isResponsesBuiltInToolCard,
  shellToolExpandableDetailLines,
  toolCallPhaseShowsShimmer,
  toolHasExpandableContent,
  type ShellToolSummaryParts,
} from "@/lib/tool-call-display";
import { parseShellToolResult, resolveShellToolExpandedCommand } from "@/lib/shell-tool-display";
import {
  clickableToolCardTriggerClass,
  shouldShowLspDiagnosticsOnToolCard,
  toolCardFailedStatusClass,
  toolCardFileNameDetailClass,
  toolCardSecondaryTextClass,
} from "@/lib/file-tool-lsp-diagnostics-display";
import { instantHoverMotionClass } from "@/lib/desktop-chrome";
import { resolveFileDiffToolEditorTarget } from "@/lib/file-tool-navigation";
import { resolveReadFileTargetFromTool } from "@/lib/read-file-tool-navigation";
import { cn } from "@/lib/utils";
import type { EditorFileTarget } from "@/lib/workspace-editor-navigation";
import type { ToolBlockSnapshot } from "@/types";

const summaryClass = "text-xs leading-relaxed text-muted-foreground";

const toolCallDetailScrollAreaClass =
  "w-full min-w-0 rounded-md border border-border/20 bg-muted/15 pr-2 [&>[data-radix-scroll-area-viewport]]:max-h-96 [&>[data-radix-scroll-area-viewport]]:overscroll-contain";

const toolCallDetailPreClass =
  "whitespace-pre-wrap break-words p-2 font-mono text-xs leading-relaxed text-muted-foreground";

function ToolCallDetailScrollPre({ children }: { children: string }) {
  return (
    <ScrollArea
      type="hover"
      scrollHideDelay={450}
      className={toolCallDetailScrollAreaClass}
      onWheel={(event) => {
        event.stopPropagation();
      }}
    >
      <pre data-spirit-selectable="text" className={toolCallDetailPreClass}>
        {children}
      </pre>
    </ScrollArea>
  );
}

export type ToolSummaryDetailTone = "default" | "shell-command";

export type ToolSummaryStatusSuffixTone = "filename-detail" | "failed-status";

const statusSuffixToneClass: Record<ToolSummaryStatusSuffixTone, string> = {
  "filename-detail": toolCardFileNameDetailClass,
  "failed-status": toolCardFailedStatusClass,
};

/**
 * Short tool-card summary grayscale: primary 100% + secondary {@link toolCardSecondaryTextClass};
 * shell commands additionally keep the lighter {@link toolCardFileNameDetailClass}.
 */
const summaryDetailToneClass: Record<ToolSummaryDetailTone, string> = {
  default: toolCardSecondaryTextClass,
  "shell-command": toolCardFileNameDetailClass,
};

export type ToolSummaryResultDetailTone = "default" | "failed";

/** Result segment (e.g. diagnostics outcome) sits below detail in the grayscale hierarchy. */
const summaryResultDetailToneClass: Record<ToolSummaryResultDetailTone, string> = {
  default: toolCardFileNameDetailClass,
  failed: toolCardFailedStatusClass,
};

function ToolCallSummaryRow({
  tool,
  headline,
  detail,
  resultDetail,
  resultDetailTone,
  shellSummary,
  shimmerActive = false,
  detailTone = "default",
  hideLineDelta = false,
  hideLspBadge = false,
}: {
  tool: ToolBlockSnapshot;
  headline: string;
  detail?: string;
  resultDetail?: string;
  resultDetailTone?: ToolSummaryResultDetailTone;
  shellSummary?: ShellToolSummaryParts;
  shimmerActive?: boolean;
  detailTone?: ToolSummaryDetailTone;
  hideLineDelta?: boolean;
  hideLspBadge?: boolean;
}) {
  const { t } = useTranslation("settings");
  const editLineDelta = useMemo(
    () => resolveToolLineDeltaForDisplay(tool),
    [tool.phase, tool.toolName, tool.editLineDelta, tool.argsExcerpt],
  );
  const statusSuffix = tool.phase === "failed" ? t("failed") : undefined;
  const statusSuffixTone: ToolSummaryStatusSuffixTone | undefined = statusSuffix
    ? shellSummary
      ? "failed-status"
      : "filename-detail"
    : undefined;

  const truncateSummary = detailTone === "shell-command";

  return (
    <span
      className={cn(
        "inline-flex min-w-0 max-w-full items-center gap-2",
        !truncateSummary && "flex-wrap items-baseline",
      )}
    >
      <span className={cn("min-w-0", truncateSummary ? "flex-1 overflow-hidden" : undefined)}>
        <MinimalToolSummary
          headline={headline}
          detail={detail}
          resultDetail={resultDetail}
          resultDetailTone={resultDetailTone}
          shellSummary={shellSummary}
          shimmerActive={shimmerActive}
          detailTone={detailTone}
          statusSuffix={statusSuffix}
          statusSuffixTone={statusSuffixTone}
        />
      </span>
      {editLineDelta && !hideLineDelta ? (
        <span className="shrink-0">
          <EditFileLineDeltaBadge delta={editLineDelta} />
        </span>
      ) : null}
      {!hideLspBadge && shouldShowLspDiagnosticsOnToolCard(tool) ? (
        <span className="shrink-0">
          <FileToolLspDiagnosticsBadge diagnostics={tool.lspWriteDiagnostics} />
        </span>
      ) : null}
    </span>
  );
}

export function MinimalToolSummary({
  headline,
  detail,
  resultDetail,
  resultDetailTone = "default",
  shellSummary,
  shimmerActive = false,
  detailTone = "default",
  statusSuffix,
  statusSuffixTone = "filename-detail",
}: {
  headline: string;
  detail?: string;
  resultDetail?: string;
  resultDetailTone?: ToolSummaryResultDetailTone;
  shellSummary?: ShellToolSummaryParts;
  shimmerActive?: boolean;
  detailTone?: ToolSummaryDetailTone;
  statusSuffix?: string;
  statusSuffixTone?: ToolSummaryStatusSuffixTone;
}) {
  const shimmerClass = shimmerActive
    ? "spirit-thinking-shimmer-text font-normal tracking-wide"
    : summaryClass;
  const truncateSummary = detailTone === "shell-command";

  return (
    <span
      className={cn(
        "min-w-0 text-xs leading-relaxed",
        truncateSummary ? cn("block truncate", toolCardFileNameDetailClass) : "break-words",
      )}
    >
      {shellSummary ? (
        <>
          <span className={shimmerClass}>{shellSummary.verb}</span>{" "}
          <span className={toolCardSecondaryTextClass}>{shellSummary.reason}</span>
        </>
      ) : (
        <span className={shimmerClass}>{headline}</span>
      )}
      {detail ? (
        <>
          {" "}
          <span className={summaryDetailToneClass[detailTone]}>{detail}</span>
        </>
      ) : null}
      {resultDetail ? (
        <>
          {" "}
          <span className={summaryResultDetailToneClass[resultDetailTone]}>{resultDetail}</span>
        </>
      ) : null}
      {statusSuffix ? (
        <>
          {" "}
          <span className={statusSuffixToneClass[statusSuffixTone]}>{statusSuffix}</span>
        </>
      ) : null}
    </span>
  );
}

function ResponsesBuiltInToolExpandedBody({
  tool,
  shimmerActive,
}: {
  tool: ToolBlockSnapshot;
  shimmerActive: boolean;
}) {
  const input = tool.argsExcerpt?.trim() ?? "";
  const output = tool.outputExcerpt?.trim() ?? "";

  return (
    <div className="space-y-3">
      {input ? (
        <div className="space-y-1">
          <p className="text-[10px] font-normal tracking-wide text-muted-foreground/70">Input</p>
          <ToolCallDetailScrollPre>{input}</ToolCallDetailScrollPre>
        </div>
      ) : null}
      {output ? (
        <div className="space-y-1">
          <p className="text-[10px] font-normal tracking-wide text-muted-foreground/70">Output</p>
          <ToolCallDetailScrollPre>{output}</ToolCallDetailScrollPre>
        </div>
      ) : shimmerActive ? (
        <p className="text-xs leading-relaxed text-muted-foreground/70 spirit-thinking-shimmer-text">
          Waiting for output…
        </p>
      ) : null}
    </div>
  );
}

function GenericToolExpandedBody({ tool }: { tool: ToolBlockSnapshot }) {
  const detailLines = genericExpandableDetailLines(tool);
  const showArgsExcerpt =
    tool.phase === "preview" && Boolean(tool.argsExcerpt?.trim()) && !tool.outputExcerpt?.trim();

  return (
    <div className="space-y-2">
      {tool.outputExcerpt ? (
        <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md border border-border/20 bg-muted/15 p-2 font-mono text-xs leading-relaxed text-muted-foreground">
          {tool.outputExcerpt}
        </pre>
      ) : null}
      {detailLines.length > 0 ? (
        <ul className="list-disc space-y-0.5 pl-3.5 text-xs leading-relaxed text-muted-foreground">
          {detailLines.map((line, index) => (
            <li key={`${index}:${line}`}>{line}</li>
          ))}
        </ul>
      ) : null}
      {showArgsExcerpt ? (
        <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md border border-border/20 bg-muted/15 p-2 font-mono text-xs leading-relaxed text-muted-foreground">
          {tool.argsExcerpt}
        </pre>
      ) : null}
    </div>
  );
}

function FileToolDiffExpandedBody({ tool, open }: { tool: ToolBlockSnapshot; open: boolean }) {
  const { t } = useTranslation();
  const diffHost = useToolCallDiffHost();
  const readWorkspaceTextFile = diffHost?.readWorkspaceTextFile;
  const diffMounted = useCollapsibleChildMount(open);
  const cachedDiffRef = useRef<FileToolDiffSource | null>(null);
  const [planBaselineText, setPlanBaselineText] = useState<string | undefined>();

  const planRelativePath = useMemo(() => {
    if (!open || tool.toolName !== "create_plan") {
      return undefined;
    }
    return resolvePlanRelativePath(tool, open ? tool.streamingArgumentsJson : undefined);
  }, [
    open,
    tool.toolName,
    tool.phase,
    tool.argsExcerpt,
    open ? tool.streamingArgumentsJson : undefined,
  ]);

  useEffect(() => {
    if (!open || !planRelativePath || !readWorkspaceTextFile) {
      setPlanBaselineText(undefined);
      return;
    }
    let cancelled = false;
    void readWorkspaceTextFile(planRelativePath, { optional: true })
      .then((result) => {
        if (!cancelled) {
          setPlanBaselineText(result.text);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPlanBaselineText(undefined);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [readWorkspaceTextFile, open, planRelativePath]);

  const diffResult = useMemo(
    () =>
      resolveFileToolDiffSource(tool, {
        open,
        workspaceRoot: diffHost?.workspaceRoot,
        planBaselineText,
      }),
    [
      open,
      tool.toolCallId,
      tool.toolName,
      tool.phase,
      tool.argsExcerpt,
      tool.deleteFileBaselineText,
      tool.fileToolDiffArgumentsJson,
      open ? tool.streamingArgumentsJson : undefined,
      diffHost?.workspaceRoot,
      planBaselineText,
    ],
  );

  if (diffResult && typeof diffResult === "object") {
    cachedDiffRef.current = diffResult;
  }

  const displayDiff =
    diffResult && typeof diffResult === "object"
      ? diffResult
      : diffMounted
        ? cachedDiffRef.current
        : null;

  if (!diffMounted) {
    return null;
  }

  if (diffResult === "truncated") {
    return (
      <div className="space-y-2">
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t("tool.diffArgsTruncated")}
        </p>
        <GenericToolExpandedBody tool={tool} />
      </div>
    );
  }

  if (diffResult === "too-large") {
    return (
      <p className="text-xs leading-relaxed text-muted-foreground">{t("tool.diffFileTooLarge")}</p>
    );
  }

  if (displayDiff) {
    return (
      <ToolCallDiffView
        relativePath={displayDiff.relativePath}
        languageId={displayDiff.languageId}
        original={displayDiff.original}
        modified={displayDiff.modified}
        followTail={open && tool.phase === "preview"}
      />
    );
  }

  return <GenericToolExpandedBody tool={tool} />;
}

function ShellToolExpandedBody({
  tool,
  command,
  onAbortShell,
}: {
  tool: ToolBlockSnapshot;
  command: string | undefined;
  onAbortShell?: (toolCallId: string) => void;
}) {
  const { t } = useTranslation();
  const followTail = tool.phase === "running";
  const shellOutput = useMemo(() => {
    const parsed = parseShellToolResult(tool.outputExcerpt);
    if (parsed) {
      return { text: parsed.output, truncated: parsed.truncated === true };
    }
    const raw = tool.outputExcerpt?.trim();
    return raw ? { text: raw, truncated: false } : null;
  }, [tool.outputExcerpt]);
  const detailLines = shellToolExpandableDetailLines(tool, command);
  const showArgsExcerpt = !command && Boolean(tool.argsExcerpt?.trim());

  const commandLine = command?.trim();
  const toolCallId = tool.toolCallId?.trim() ?? "";
  const showTerminateButton =
    tool.phase === "running" && toolCallId.length > 0 && Boolean(onAbortShell);
  const showShellPanel = Boolean(commandLine || shellOutput);

  return (
    <div className="space-y-2">
      {showShellPanel ? (
        <div className="space-y-1">
          <div className="overflow-hidden rounded-md border border-border/20 bg-muted/15 p-2 text-xs leading-relaxed text-muted-foreground">
            {commandLine ? (
              <div className="flex items-start gap-2">
                <ShellToolCommandHighlight command={commandLine} />
                {showTerminateButton ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className={cn(
                      "size-7 shrink-0 rounded-full p-0 shadow-none [&_svg]:size-3",
                      instantHoverMotionClass,
                    )}
                    title={t("tool.shellTerminate")}
                    aria-label={t("tool.shellTerminate")}
                    onClick={(event) => {
                      event.stopPropagation();
                      onAbortShell?.(toolCallId);
                    }}
                  >
                    <Square className="size-3" strokeWidth={2.4} aria-hidden />
                  </Button>
                ) : null}
              </div>
            ) : null}
            {shellOutput ? (
              <div className={commandLine ? "mt-2" : undefined}>
                {shellOutput.text.length > 0 ? (
                  <ShellToolXtermOutput text={shellOutput.text} followTail={followTail} />
                ) : (
                  <p className="text-muted-foreground/70">{t("tool.shellOutputEmpty")}</p>
                )}
              </div>
            ) : null}
          </div>
          {shellOutput?.truncated ? (
            <p className="text-xs leading-relaxed text-muted-foreground/70">
              {t("tool.shellOutputTruncated")}
            </p>
          ) : null}
        </div>
      ) : null}
      {detailLines.length > 0 ? (
        <ul className="list-disc space-y-0.5 pl-3.5 text-xs leading-relaxed text-muted-foreground">
          {detailLines.map((line, index) => (
            <li key={`${index}:${line}`}>{line}</li>
          ))}
        </ul>
      ) : null}
      {showArgsExcerpt ? (
        <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md border border-border/20 bg-muted/15 p-2 font-mono text-xs leading-relaxed text-muted-foreground">
          {tool.argsExcerpt}
        </pre>
      ) : null}
    </div>
  );
}

export function MinimalToolCallCard({
  tool,
  workspaceRoot = "",
  onOpenSubagentViewer,
  onOpenReadFile,
  onOpenPlan,
  onAbortShell,
}: {
  tool: ToolBlockSnapshot;
  workspaceRoot?: string;
  onOpenSubagentViewer?: (toolCallId: string) => void;
  onOpenReadFile?: (target: EditorFileTarget) => void;
  onOpenPlan?: () => void;
  onAbortShell?: (toolCallId: string) => void;
}) {
  const summary = getToolCallSummaryParts(tool);
  const shimmerActive = toolCallPhaseShowsShimmer(tool.phase);
  const isShell = tool.toolName === "shell";
  const isSubagent = tool.toolName === "subagent";
  const subagentToolCallId = tool.toolCallId?.trim() ?? "";
  const canOpenSubagentViewer = Boolean(isSubagent && onOpenSubagentViewer && subagentToolCallId);
  const readFileTarget = useMemo(
    () =>
      tool.toolName === "read_file" ? resolveReadFileTargetFromTool(tool, workspaceRoot) : null,
    [tool, workspaceRoot],
  );
  const canOpenReadFile = Boolean(readFileTarget && onOpenReadFile);
  const isFileDiffNavTool =
    tool.toolName === "create_file" ||
    tool.toolName === "edit_file" ||
    tool.toolName === "create_plan";
  const fileDiffEditorTarget = useMemo(
    () =>
      tool.toolName === "create_file" || tool.toolName === "edit_file"
        ? resolveFileDiffToolEditorTarget(tool, workspaceRoot)
        : null,
    [tool, workspaceRoot],
  );
  const canOpenFileDiffNav = Boolean(
    !shimmerActive &&
    isFileDiffNavTool &&
    ((tool.toolName === "create_plan" && onOpenPlan) || (fileDiffEditorTarget && onOpenReadFile)),
  );
  const editLineDelta = useMemo(
    () => resolveToolLineDeltaForDisplay(tool),
    [tool.phase, tool.toolName, tool.editLineDelta, tool.argsExcerpt],
  );
  const isFileDiff = isFileDiffTool(tool.toolName);
  const isResponsesBuiltIn = isResponsesBuiltInToolCard(tool.toolName);
  const shellCommand = useMemo(
    () => (isShell ? resolveShellToolExpandedCommand(tool) : undefined),
    [isShell, tool.argsExcerpt, tool.detailLines, tool.headlineDetail],
  );
  const expandable = toolHasExpandableContent(tool);
  const [open, setOpen] = useState(false);
  const showLspHover = shouldShowLspDiagnosticsOnToolCard(tool);
  const lspHoverItemId = tool.toolCallId ?? tool.toolName;
  const lspDiagnostics = showLspHover ? tool.lspWriteDiagnostics : undefined;

  const summaryRow = (
    <ToolCallSummaryRow
      tool={tool}
      headline={summary.headline}
      detail={summary.detail}
      resultDetail={summary.resultDetail}
      resultDetailTone={summary.resultDetailTone}
      shellSummary={summary.shellSummary}
      shimmerActive={shimmerActive}
      detailTone={isShell ? "shell-command" : "default"}
      hideLineDelta={canOpenFileDiffNav}
      hideLspBadge={canOpenFileDiffNav}
    />
  );

  const fileDiffNavLspBadge =
    canOpenFileDiffNav && shouldShowLspDiagnosticsOnToolCard(tool) ? (
      <span className="shrink-0">
        <FileToolLspDiagnosticsBadge diagnostics={tool.lspWriteDiagnostics} />
      </span>
    ) : null;

  const toggleFileDiffExpand = (event?: { stopPropagation: () => void }) => {
    event?.stopPropagation();
    setOpen((value) => !value);
  };

  const expandChevronButton = (
    <button
      type="button"
      aria-expanded={open}
      aria-label={open ? "Collapse tool details" : "Expand tool details"}
      onClick={(event) => toggleFileDiffExpand(event)}
      className={cn(
        "shrink-0 outline-none",
        "cursor-pointer focus-visible:ring-2 focus-visible:ring-ring/50",
      )}
    >
      <ChevronRight
        className={cn(
          "size-3 text-muted-foreground/55 transition-all duration-150",
          "opacity-0 group-hover:opacity-100 group-has-[:focus-visible]:opacity-100",
          open && "rotate-90",
        )}
        aria-hidden
      />
    </button>
  );

  if (!expandable) {
    const plainSummaryClass = cn(
      shimmerActive ? undefined : summaryClass,
      isShell && "min-w-0 overflow-hidden",
    );
    const plainCard =
      canOpenSubagentViewer || canOpenReadFile ? (
        <button
          type="button"
          onClick={() => {
            if (canOpenSubagentViewer) {
              onOpenSubagentViewer?.(subagentToolCallId);
              return;
            }
            if (readFileTarget) {
              onOpenReadFile?.(readFileTarget);
            }
          }}
          className={cn(
            "w-full min-w-0 overflow-hidden text-left outline-none",
            "cursor-pointer focus-visible:ring-2 focus-visible:ring-ring/50",
            clickableToolCardTriggerClass,
          )}
        >
          <p className={plainSummaryClass}>{summaryRow}</p>
        </button>
      ) : (
        <p className={plainSummaryClass}>{summaryRow}</p>
      );
    if (!lspDiagnostics) {
      return plainCard;
    }
    return (
      <FileToolLspDiagnosticsHover itemId={lspHoverItemId} diagnostics={lspDiagnostics}>
        <FileToolLspDiagnosticsHoverTrigger itemId={lspHoverItemId} diagnostics={lspDiagnostics}>
          {plainCard}
        </FileToolLspDiagnosticsHoverTrigger>
      </FileToolLspDiagnosticsHover>
    );
  }

  const expandedBody = (
    <div className="pt-1.5">
      {isShell ? (
        <ShellToolExpandedBody tool={tool} command={shellCommand} onAbortShell={onAbortShell} />
      ) : isFileDiff ? (
        <FileToolDiffExpandedBody tool={tool} open={open} />
      ) : isResponsesBuiltIn ? (
        <ResponsesBuiltInToolExpandedBody tool={tool} shimmerActive={shimmerActive} />
      ) : (
        <GenericToolExpandedBody tool={tool} />
      )}
    </div>
  );

  const collapsibleTriggerButton = canOpenSubagentViewer ? (
    <div className="group inline-flex max-w-full min-w-0 items-center gap-1">
      <button
        type="button"
        onClick={() => onOpenSubagentViewer?.(subagentToolCallId)}
        className={cn(
          "min-w-0 overflow-hidden text-left outline-none",
          "cursor-pointer focus-visible:ring-2 focus-visible:ring-ring/50",
          clickableToolCardTriggerClass,
        )}
      >
        {summaryRow}
      </button>
      <button
        type="button"
        aria-expanded={open}
        aria-label={open ? "Collapse tool details" : "Expand tool details"}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        className={cn(
          "shrink-0 outline-none",
          "cursor-pointer focus-visible:ring-2 focus-visible:ring-ring/50",
        )}
      >
        <ChevronRight
          className={cn(
            "size-3 text-muted-foreground/55 transition-all duration-150",
            "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
            open && "rotate-90",
          )}
          aria-hidden
        />
      </button>
    </div>
  ) : canOpenFileDiffNav ? (
    <div className="group flex w-full min-w-0 items-center gap-1">
      <button
        type="button"
        onClick={() => {
          if (tool.toolName === "create_plan") {
            onOpenPlan?.();
            return;
          }
          if (fileDiffEditorTarget) {
            onOpenReadFile?.(fileDiffEditorTarget);
          }
        }}
        className={cn(
          "min-w-0 overflow-hidden text-left outline-none",
          "cursor-pointer focus-visible:ring-2 focus-visible:ring-ring/50",
          clickableToolCardTriggerClass,
        )}
      >
        {summaryRow}
      </button>
      {fileDiffNavLspBadge}
      {editLineDelta ? (
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? "Collapse tool details" : "Expand tool details"}
          onClick={(event) => toggleFileDiffExpand(event)}
          className={cn(
            "shrink-0 outline-none",
            "cursor-pointer focus-visible:ring-2 focus-visible:ring-ring/50",
          )}
        >
          <EditFileLineDeltaBadge delta={editLineDelta} />
        </button>
      ) : null}
      {expandChevronButton}
    </div>
  ) : (
    <button
      type="button"
      aria-expanded={open}
      onClick={() => setOpen((value) => !value)}
      className={cn(
        "group flex w-full min-w-0 items-center gap-1 text-left outline-none",
        "cursor-pointer focus-visible:ring-2 focus-visible:ring-ring/50",
      )}
    >
      <span className="min-w-0 overflow-hidden">{summaryRow}</span>
      <ChevronRight
        className={cn(
          "size-3 shrink-0 text-muted-foreground/55 transition-all duration-150",
          "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
          open && "rotate-90",
        )}
        aria-hidden
      />
    </button>
  );

  const collapsibleInner = (
    <AnimatedCollapse open={open} onOpenChange={setOpen} className="min-w-0">
      {lspDiagnostics ? (
        <FileToolLspDiagnosticsHoverTrigger itemId={lspHoverItemId} diagnostics={lspDiagnostics}>
          {collapsibleTriggerButton}
        </FileToolLspDiagnosticsHoverTrigger>
      ) : (
        collapsibleTriggerButton
      )}
      <AnimatedCollapseContent className="min-w-0">{expandedBody}</AnimatedCollapseContent>
    </AnimatedCollapse>
  );

  if (!lspDiagnostics) {
    return collapsibleInner;
  }

  return (
    <FileToolLspDiagnosticsHover itemId={lspHoverItemId} diagnostics={lspDiagnostics}>
      {collapsibleInner}
    </FileToolLspDiagnosticsHover>
  );
}
