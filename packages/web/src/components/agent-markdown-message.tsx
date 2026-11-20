import { createContext, memo, useContext, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Block, parseMarkdownIntoBlocks, type BlockProps } from "streamdown";
import type { Pluggable } from "unified";

import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import type { MarkdownTone } from "@/lib/markdown-message-components";
import {
  SpiritStreamdownMarkdown,
  type SpiritStreamdownMarkdownProps,
} from "@/components/spirit-streamdown-markdown";

/** Char-level + zero stagger: each stream delta animates in parallel (not serial / per-paragraph batch). */
const streamingAnimateOptions = {
  animation: "slideUp" as const,
  duration: 160,
  easing: "cubic-bezier(0.22, 1, 0.36, 1)",
  sep: "char" as const,
  stagger: 0,
};

function isAnimateRehypePlugin(entry: Pluggable): boolean {
  const fn = Array.isArray(entry) ? entry[0] : entry;
  return typeof fn === "function" && (fn.name ?? "").startsWith("rehypeAnimate");
}

type StreamBlockAnimateContextValue = {
  lastBlockIndex: number;
};

const StreamBlockAnimateContext = createContext<StreamBlockAnimateContextValue>({
  lastBlockIndex: 0,
});

/**
 * Block calls getLastRenderCharCount() then setPrevContentLength(result). In practice get()
 * often returns 0 (Strict Mode / multi-instance), so every character re-animates. Return our
 * committed string length instead and drain the real counter.
 */
export type StreamBlockCache = { content: string; blocks: string[] };

const FOOTNOTE_SYNTAX = /\[\^/;

/**
 * Streaming content only appends at the tail: reuse the previously completed non-tail blocks and
 * only re-parse the text after the previous tail block's start, avoiding a second full marked
 * lexer pass per delta (Streamdown already parsed once internally for rendering; this is only for
 * animation bookkeeping).
 *
 * When footnote syntax ([^…]) is present, streamdown's parseMarkdownIntoBlocks returns the whole
 * document as a single block (regardless of the prefix); in that case fall back to full parsing to
 * stay consistent with its internal block splitting.
 */
export function parseStreamBlocksIncrementally(
  cache: StreamBlockCache | null,
  content: string,
): StreamBlockCache {
  if (cache && cache.content === content) {
    return cache;
  }
  if (
    cache &&
    cache.blocks.length > 1 &&
    content.length > cache.content.length &&
    content.startsWith(cache.content) &&
    !FOOTNOTE_SYNTAX.test(content)
  ) {
    const tailBlock = cache.blocks[cache.blocks.length - 1]!;
    const tailStart = cache.content.length - tailBlock.length;
    // marked's token.raw coverage for some structures may be non-contiguous (joined blocks ≠ the
    // original text); when the tail block does not line up with the end, abandon the incremental
    // path and fall back to full parsing.
    if (tailStart >= 0 && cache.content.slice(tailStart) === tailBlock) {
      return {
        content,
        blocks: [
          ...cache.blocks.slice(0, -1),
          ...parseMarkdownIntoBlocks(content.slice(tailStart)),
        ],
      };
    }
  }
  return { content, blocks: parseMarkdownIntoBlocks(content) };
}

function StreamingAnimateBlock(props: BlockProps) {
  const { index, content, animatePlugin, rehypePlugins, ...rest } = props;
  const { lastBlockIndex } = useContext(StreamBlockAnimateContext);
  const isTailBlock = index === lastBlockIndex;
  const committedCharCountRef = useRef(0);
  useLayoutEffect(() => {
    if (isTailBlock) {
      // Streamdown may render its previous block array for one commit after the outer children
      // change. Commit only what this Block actually rendered, or the next delta is marked old.
      committedCharCountRef.current = content.length;
    }
  }, [content, isTailBlock]);

  const blockRehypePlugins = useMemo(() => {
    if (isTailBlock || !rehypePlugins) return rehypePlugins;
    return rehypePlugins.filter((entry) => !isAnimateRehypePlugin(entry));
  }, [isTailBlock, rehypePlugins]);

  const blockPlugin = useMemo(() => {
    if (!isTailBlock || !animatePlugin) return null;
    return {
      ...animatePlugin,
      getLastRenderCharCount() {
        animatePlugin.getLastRenderCharCount();
        return committedCharCountRef.current;
      },
      setPrevContentLength(length: number) {
        animatePlugin.setPrevContentLength(length);
      },
    };
  }, [animatePlugin, isTailBlock]);

  return (
    <Block
      {...rest}
      index={index}
      content={content}
      rehypePlugins={blockRehypePlugins}
      animatePlugin={blockPlugin}
    />
  );
}

export type AgentMarkdownMessageProps = Pick<
  SpiritStreamdownMarkdownProps,
  | "content"
  | "className"
  | "tone"
  | "size"
  | "allowHtml"
  | "readManagedImagePreviewDataUrl"
  | "readManagedVideoPreviewUrl"
  | "readLocalImagePreviewDataUrl"
  | "readLocalVideoPreviewUrl"
  | "localImageBaseDir"
  | "localImageAllowedRootDir"
> & {
  streaming?: boolean;
};

function AgentMarkdownMessageImpl({
  content,
  streaming = false,
  className,
  tone = "default",
  size = "default",
  allowHtml = false,
  readManagedImagePreviewDataUrl,
  readManagedVideoPreviewUrl,
  readLocalImagePreviewDataUrl,
  readLocalVideoPreviewUrl,
  localImageBaseDir,
  localImageAllowedRootDir,
}: AgentMarkdownMessageProps) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const motionActive = streaming && !prefersReducedMotion;

  const [streamBlocksCache, setStreamBlocksCache] = useState<StreamBlockCache | null>(null);
  const nextStreamBlocksCache = useMemo(
    () => (motionActive ? parseStreamBlocksIncrementally(streamBlocksCache, content) : null),
    [content, motionActive, streamBlocksCache],
  );
  if (nextStreamBlocksCache !== streamBlocksCache) {
    setStreamBlocksCache(nextStreamBlocksCache);
  }
  const streamBlocks = nextStreamBlocksCache?.blocks ?? [];

  const lastBlockIndex = Math.max(0, streamBlocks.length - 1);

  const streamBlockAnimateContext = useMemo(() => ({ lastBlockIndex }), [lastBlockIndex]);

  return (
    <StreamBlockAnimateContext.Provider value={streamBlockAnimateContext}>
      <SpiritStreamdownMarkdown
        content={content}
        streaming={streaming}
        className={className}
        tone={tone}
        size={size}
        allowHtml={allowHtml}
        readManagedImagePreviewDataUrl={readManagedImagePreviewDataUrl}
        readManagedVideoPreviewUrl={readManagedVideoPreviewUrl}
        readLocalImagePreviewDataUrl={readLocalImagePreviewDataUrl}
        readLocalVideoPreviewUrl={readLocalVideoPreviewUrl}
        localImageBaseDir={localImageBaseDir}
        localImageAllowedRootDir={localImageAllowedRootDir}
        BlockComponent={motionActive ? StreamingAnimateBlock : undefined}
        isAnimating={motionActive}
        animated={motionActive ? streamingAnimateOptions : false}
      />
    </StreamBlockAnimateContext.Provider>
  );
}

/**
 * Markdown rendering is a pure function of props (content string + stable callbacks); during
 * multi-turn streaming, each poll re-renders the entire conversation list, and re-running
 * streamdown + shiki highlighting for unchanged messages is extremely expensive. A shallow props
 * comparison to skip them is enough.
 */
export const AgentMarkdownMessage = memo(AgentMarkdownMessageImpl);

export type { MarkdownTone };
