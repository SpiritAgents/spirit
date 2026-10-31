import { ChevronRight } from "@spiritagent/icons/chevron-right";
import { useEffect, useRef, useState } from "react";
import { FONT_WEIGHT_NORMAL } from "@/lib/typography";

import { PreviewImageGenerationToolCard } from "@/components/preview-image-generation-tool-card";
import { BrowserElementChip } from "@/components/browser-element-chip";
import { MarkdownMessage } from "@/components/markdown-message";
import {
  AnimatedCollapse,
  AnimatedCollapseContent,
  AnimatedCollapseTrigger,
} from "@/components/ui/animated-collapse";
import type { Messages } from "@/i18n/messages";
import { useI18n } from "@/i18n/provider";
import { DESKTOP_ELEVATION_SHADOW_SM } from "@/lib/desktop-translucency-surface";
import { cn } from "@/lib/utils";
import type { ConversationMessageSnapshot, ToolBlockSnapshot } from "@/types/spirit-desktop";

export function conversationMessageDomId(
  message: ConversationMessageSnapshot,
  index: number,
): string {
  const toolPart =
    message.tool?.toolCallId ??
    (message.tool ? `${message.tool.toolName}:${message.tool.phase}` : "");
  return `message-${index}-${message.id}-${message.pending ? "p" : "m"}-${toolPart}`;
}

function ThinkingLabelWithShimmer({ active }: { active: boolean }) {
  const { messages } = useI18n();

  return (
    <span
      className={cn(
        `shrink-0 text-xs ${FONT_WEIGHT_NORMAL} tracking-wide`,
        active ? "spirit-thinking-shimmer-text" : "text-muted-foreground",
      )}
    >
      {active ? messages.desktop.conversation.thinking : messages.desktop.conversation.thought}
    </span>
  );
}

function assistantReasoningLive(message: ConversationMessageSnapshot): boolean {
  return message.pending && Boolean(message.aux?.thinking?.trim()) && !message.content.trim();
}

function AssistantThinkingCollapsible({ message }: { message: ConversationMessageSnapshot }) {
  const thinking = message.aux?.thinking;
  const reasoningLive = assistantReasoningLive(message);
  const autoExpanded = Boolean(thinking) && reasoningLive;
  const [manualOpen, setManualOpen] = useState(false);
  const prevAutoExpandedRef = useRef(autoExpanded);

  useEffect(() => {
    if (prevAutoExpandedRef.current && !autoExpanded) {
      setManualOpen(false);
    }
    prevAutoExpandedRef.current = autoExpanded;
  }, [autoExpanded]);

  if (!thinking) {
    return null;
  }

  const expanded = autoExpanded || manualOpen;
  const interactive = !autoExpanded;

  return (
    <AnimatedCollapse
      open={expanded}
      onOpenChange={(open) => {
        if (!interactive) {
          return;
        }
        setManualOpen(open);
      }}
      className="min-w-0 py-0.5"
    >
      <AnimatedCollapseTrigger
        disabled={!interactive}
        className={cn(
          "group flex w-full min-w-0 items-center gap-1 text-left outline-none",
          interactive
            ? "cursor-pointer focus-visible:ring-2 focus-visible:ring-ring/50"
            : "cursor-default",
        )}
      >
        <ThinkingLabelWithShimmer active={reasoningLive} />
        {interactive ? (
          <ChevronRight
            className={cn(
              "size-3 shrink-0 text-muted-foreground/55 transition-all duration-150",
              "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
              expanded && "rotate-90",
            )}
            aria-hidden
            strokeWidth={1.75}
          />
        ) : null}
      </AnimatedCollapseTrigger>
      <AnimatedCollapseContent className="min-w-0">
        <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-muted-foreground">
          {thinking}
        </pre>
      </AnimatedCollapseContent>
    </AnimatedCollapse>
  );
}

function toolCallPhaseShowsShimmer(phase: ToolBlockSnapshot["phase"]): boolean {
  return phase === "preview" || phase === "pending-approval" || phase === "running";
}

function previewToolHasExpandableContent(tool: ToolBlockSnapshot): boolean {
  return (
    Boolean(tool.outputExcerpt?.trim()) ||
    tool.detailLines.some((line) => line.trim()) ||
    (tool.phase === "preview" && Boolean(tool.argsExcerpt?.trim())) ||
    (tool.phase === "running" && Boolean(tool.argsExcerpt?.trim()))
  );
}

const toolSummaryClass = "text-xs leading-relaxed text-muted-foreground";

const toolCardSecondaryTextClass = "text-muted-foreground/75 dark:text-muted-foreground/65";

const toolCallDetailPreClass =
  "overflow-x-auto whitespace-pre-wrap break-words rounded-md border border-border/20 bg-muted/15 p-2 font-mono text-xs leading-relaxed text-muted-foreground";

function ToolCallSummary({
  headline,
  detail,
  shimmerActive,
}: {
  headline: string;
  detail?: string;
  shimmerActive: boolean;
}) {
  const shimmerClass = shimmerActive
    ? `spirit-thinking-shimmer-text ${FONT_WEIGHT_NORMAL} tracking-wide`
    : toolSummaryClass;

  return (
    <span className="min-w-0 break-words text-xs leading-relaxed">
      <span className={shimmerClass}>{headline}</span>
      {detail ? (
        <>
          {" "}
          <span className={toolCardSecondaryTextClass}>{detail}</span>
        </>
      ) : null}
    </span>
  );
}

function PreviewToolExpandedBody({ tool }: { tool: ToolBlockSnapshot }) {
  const detailLines = tool.detailLines.filter((line) => line.trim().length > 0);
  const showArgsExcerpt =
    Boolean(tool.argsExcerpt?.trim()) &&
    !tool.outputExcerpt?.trim() &&
    (tool.phase === "preview" || tool.phase === "running");

  return (
    <div className="space-y-2">
      {tool.outputExcerpt ? (
        <pre className={toolCallDetailPreClass}>{tool.outputExcerpt}</pre>
      ) : null}
      {detailLines.length > 0 ? (
        <ul className="list-disc space-y-0.5 pl-3.5 text-xs leading-relaxed text-muted-foreground">
          {detailLines.map((line, index) => (
            <li key={`${index}:${line}`}>{line}</li>
          ))}
        </ul>
      ) : null}
      {showArgsExcerpt ? <pre className={toolCallDetailPreClass}>{tool.argsExcerpt}</pre> : null}
    </div>
  );
}

function PreviewToolCallCard({ tool }: { tool: ToolBlockSnapshot }) {
  const shimmerActive = toolCallPhaseShowsShimmer(tool.phase);
  const expandable = previewToolHasExpandableContent(tool);
  const [open, setOpen] = useState(false);
  const prevShimmerRef = useRef(shimmerActive);

  useEffect(() => {
    if (shimmerActive && expandable) {
      setOpen(true);
    } else if (prevShimmerRef.current && !shimmerActive) {
      setOpen(false);
    }
    prevShimmerRef.current = shimmerActive;
  }, [expandable, shimmerActive]);

  if (!expandable) {
    return (
      <div className="min-w-0 py-0.5">
        <p className={shimmerActive ? undefined : toolSummaryClass}>
          <ToolCallSummary
            headline={tool.headline}
            detail={tool.headlineDetail}
            shimmerActive={shimmerActive}
          />
        </p>
      </div>
    );
  }

  return (
    <AnimatedCollapse open={open} onOpenChange={setOpen} className="min-w-0 py-0.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "group flex w-full min-w-0 items-center gap-1 text-left outline-none",
          "cursor-pointer focus-visible:ring-2 focus-visible:ring-ring/50",
        )}
      >
        <span className="min-w-0 overflow-hidden">
          <ToolCallSummary
            headline={tool.headline}
            detail={tool.headlineDetail}
            shimmerActive={shimmerActive}
          />
        </span>
        <ChevronRight
          className={cn(
            "size-3 shrink-0 text-muted-foreground/55 transition-all duration-150",
            "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
            open && "rotate-90",
          )}
          aria-hidden
          strokeWidth={1.75}
        />
      </button>
      <AnimatedCollapseContent className="min-w-0">
        <div className="pt-1.5">
          <PreviewToolExpandedBody tool={tool} />
        </div>
      </AnimatedCollapseContent>
    </AnimatedCollapse>
  );
}

function isStandaloneAssistantAuxMessage(
  message: ConversationMessageSnapshot | undefined,
): boolean {
  return Boolean(
    message &&
    message.role === "assistant" &&
    !message.tool &&
    !message.content.trim() &&
    (message.aux?.thinking?.trim() || message.aux?.compaction?.trim()),
  );
}

export function shouldCompactAfterPreviousMessage(
  previous: ConversationMessageSnapshot | undefined,
  current: ConversationMessageSnapshot,
): boolean {
  return Boolean(
    isStandaloneAssistantAuxMessage(previous) &&
    current.role === "assistant" &&
    !current.tool &&
    current.content.trim(),
  );
}

export function shouldShowThinkingForMessage(
  message: ConversationMessageSnapshot,
  messages: ConversationMessageSnapshot[],
  listIndex: number,
  policy: "always" | "firstTurnOnly",
): boolean {
  if (!message.aux?.thinking?.trim()) {
    return false;
  }
  if (policy === "always") {
    return true;
  }
  const firstThinkingIndex = messages.findIndex(
    (entry) => entry.role === "assistant" && Boolean(entry.aux?.thinking?.trim()),
  );
  return listIndex === firstThinkingIndex;
}

export function PreviewMessageCard({
  message,
  listIndex,
  compactAfterPrevious,
  conversationMessages,
  thinkingPolicy = "always",
}: {
  message: ConversationMessageSnapshot;
  listIndex: number;
  compactAfterPrevious: boolean;
  conversationMessages?: ConversationMessageSnapshot[];
  thinkingPolicy?: "always" | "firstTurnOnly";
}) {
  const { messages } = useI18n();
  const isUser = message.role === "user";
  const userBubble = cn(
    "rounded-2xl rounded-br-md border border-ring/30 bg-background px-3 py-2.5 dark:border-border/50 dark:bg-muted",
    DESKTOP_ELEVATION_SHADOW_SM,
  );

  return (
    <div
      id={conversationMessageDomId(message, listIndex)}
      data-spirit-surface="message-row"
      data-spirit-message-role={message.role}
      data-spirit-message-pending={message.pending ? "true" : "false"}
      className={cn(
        "scroll-mt-4 flex w-full pb-3 last:pb-0",
        compactAfterPrevious && "-mt-4",
        isUser ? "justify-end" : "justify-start",
      )}
    >
      <div
        data-spirit-surface={isUser ? "message-user" : "message-assistant"}
        className={cn("min-w-0 space-y-2", isUser ? "max-w-[min(72%,22rem)]" : "w-full")}
      >
        {!isUser &&
        shouldShowThinkingForMessage(
          message,
          conversationMessages ?? [message],
          listIndex,
          thinkingPolicy,
        ) ? (
          <AssistantThinkingCollapsible message={message} />
        ) : null}
        {!isUser && message.aux?.compaction ? (
          <div className="border-l border-dashed border-muted-foreground/35 py-0.5 pl-2.5">
            <p className={`text-xs ${FONT_WEIGHT_NORMAL} tracking-wide text-muted-foreground`}>
              {messages.desktop.conversation.compaction}
            </p>
            <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-muted-foreground">
              {message.aux.compaction}
            </pre>
          </div>
        ) : null}
        {isUser && (message.browserElements?.length || message.content.trim()) ? (
          <div data-spirit-surface="message-bubble" className={userBubble}>
            <pre className="m-0 whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-foreground">
              {message.browserElements?.map((element) => (
                <BrowserElementChip
                  key={element.id}
                  attachment={{
                    id: element.id,
                    tagName: element.tagName,
                    url: element.url,
                    pageUrl: element.pageUrl,
                  }}
                />
              ))}
              {message.browserElements?.length && message.content.trim() ? " " : null}
              {message.content.trim() ? message.content : null}
            </pre>
          </div>
        ) : null}
        {!isUser && message.content.trim() ? (
          <div data-spirit-surface="message-bubble">
            <MarkdownMessage
              content={message.content}
              streaming={message.pending}
              className="font-sans"
            />
          </div>
        ) : null}
        {!isUser && message.tool ? (
          message.tool.toolName === "generate_image" ||
          message.tool.toolName === "generate_video" ? (
            <PreviewImageGenerationToolCard tool={message.tool} />
          ) : (
            <PreviewToolCallCard tool={message.tool} />
          )
        ) : null}
      </div>
    </div>
  );
}

export function buildRunningTool(
  callId: string,
  copy: Messages["desktop"]["conversation"],
): ToolBlockSnapshot {
  return {
    toolCallId: callId,
    toolName: "read_workspace",
    phase: "running",
    headline: copy.runningToolHeadline,
    headlineDetail: copy.runningToolHeadlineDetail,
    detailLines: [...copy.runningToolDetails],
    argsExcerpt: `{
  "paths": [
    "src/components/hero.tsx",
    "src/components/spirit-desktop-window.tsx"
  ]
}`,
  };
}

export function buildSucceededTool(
  callId: string,
  copy: Messages["desktop"]["conversation"],
): ToolBlockSnapshot {
  return {
    ...buildRunningTool(callId, copy),
    phase: "succeeded",
    headline: copy.runningToolHeadlineSucceeded,
    headlineDetail: copy.runningToolHeadlineDetail,
    outputExcerpt: copy.runningToolOutput,
  };
}
