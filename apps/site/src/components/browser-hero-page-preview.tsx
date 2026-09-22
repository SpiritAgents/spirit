import { useCallback, useLayoutEffect, useRef } from "react";
import { FONT_WEIGHT_MEDIUM, FONT_WEIGHT_NORMAL } from "@/lib/typography";

import { Download } from "lucide-react";

import { BrowserNestedHeroWindow } from "@/components/browser-nested-hero-window";
import { GitHubMark } from "@/components/github-mark";
import { NoTranslate } from "@/components/no-translate";
import { useI18n } from "@/i18n/provider";
import type { BrowserPickerTarget, BrowserTargetRects } from "@/lib/design-mode-demo-state";
import { SPIRIT_GITHUB_REPO_URL } from "@/lib/github-links";
import { cn } from "@/lib/utils";

type BrowserHeroPagePreviewProps = {
  headlineVariant: "original" | "improved";
  containerRef?: React.RefObject<HTMLElement | null>;
  onTargetRectsChange?: (rects: BrowserTargetRects) => void;
};

export function BrowserHeroPagePreview({
  headlineVariant,
  containerRef,
  onTargetRectsChange,
}: BrowserHeroPagePreviewProps) {
  const { messages } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const headlineRef = useRef<HTMLHeadingElement>(null);
  const taglineRef = useRef<HTMLParagraphElement>(null);
  const ctaRef = useRef<HTMLDivElement>(null);

  const originalLines = messages.hero.headline.split("\n");
  const improvedLines = messages.desktop.conversation.designDemo.improvedHeadline.split("\n");
  const showOriginal = headlineVariant === "original";
  const showImproved = headlineVariant === "improved";

  const reportRects = useCallback(() => {
    const boundsRoot = containerRef?.current ?? rootRef.current;
    if (!boundsRoot || !onTargetRectsChange) {
      return;
    }

    const rootRect = boundsRoot.getBoundingClientRect();
    const toLocal = (element: HTMLElement | null): DOMRect | undefined => {
      if (!element) {
        return undefined;
      }
      const rect = element.getBoundingClientRect();
      return new DOMRect(
        rect.left - rootRect.left,
        rect.top - rootRect.top,
        rect.width,
        rect.height,
      );
    };

    onTargetRectsChange({
      headline: toLocal(headlineRef.current),
      tagline: toLocal(taglineRef.current),
      cta: toLocal(ctaRef.current),
    });
  }, [containerRef, onTargetRectsChange]);

  useLayoutEffect(() => {
    reportRects();
    const root = rootRef.current;
    if (!root) {
      return;
    }
    const observer = new ResizeObserver(() => reportRects());
    observer.observe(root);
    return () => observer.disconnect();
  }, [headlineVariant, reportRects]);

  return (
    <div
      ref={rootRef}
      className="relative flex h-full min-h-0 flex-col bg-background text-foreground"
    >
      <header className="flex shrink-0 items-center justify-between border-b border-border/40 px-4 py-2.5">
        <span className={`text-xs ${FONT_WEIGHT_NORMAL} tracking-tight`}>
          <NoTranslate>{messages.common.brand}</NoTranslate>
        </span>
        <nav
          className="hidden items-center gap-3 text-[10px] text-chrome-secondary-label sm:flex"
          aria-hidden
        >
          <span>{messages.hero.nav.features}</span>
          <span>{messages.hero.nav.resources}</span>
        </nav>
        <div className="flex items-center gap-2">
          <a
            href={SPIRIT_GITHUB_REPO_URL}
            className="hidden text-chrome-label transition-colors hover:text-chrome-emphasis sm:inline-flex"
            aria-label={messages.hero.nav.github}
            tabIndex={-1}
          >
            <GitHubMark className="size-4" />
          </a>
          <span
            className={`rounded-full bg-primary px-2.5 py-1 text-[10px] ${FONT_WEIGHT_NORMAL} text-primary-foreground`}
          >
            {messages.common.download}
          </span>
        </div>
      </header>

      <div className="shrink-0 px-4 py-6 sm:px-5 sm:py-8">
        <div className="relative">
          <h1
            ref={headlineRef}
            data-design-target="headline"
            className={`relative text-[1.35rem] leading-[1.04] ${FONT_WEIGHT_MEDIUM} tracking-[-0.04em] sm:text-[1.65rem]`}
          >
            <span
              className={cn(
                "block transition-opacity duration-500 motion-reduce:transition-none",
                showOriginal ? "opacity-100" : "opacity-0",
                showImproved && "absolute inset-x-0 top-0",
              )}
              aria-hidden={!showOriginal}
            >
              {originalLines.map((line, index) => (
                <span key={`orig-${index}`} className="block">
                  {line}
                </span>
              ))}
            </span>
            <span
              className={cn(
                "block transition-opacity duration-500 motion-reduce:transition-none",
                showImproved ? "opacity-100" : "opacity-0",
                !showImproved && "absolute inset-x-0 top-0",
              )}
              aria-hidden={!showImproved}
            >
              {improvedLines.map((line, index) => (
                <span key={`imp-${index}`} className="block">
                  {line}
                </span>
              ))}
            </span>
          </h1>
        </div>

        <p
          ref={taglineRef}
          data-design-target="tagline"
          className="mt-3 max-w-[92%] text-[0.72rem] leading-snug text-muted-foreground sm:text-[0.8rem]"
        >
          {messages.hero.tagline}
        </p>

        <div ref={ctaRef} data-design-target="cta" className="mt-4">
          <span
            className={`inline-flex h-7 items-center gap-1 rounded-full bg-primary px-3 text-[11px] ${FONT_WEIGHT_NORMAL} text-primary-foreground`}
          >
            <Download className="size-3" aria-hidden strokeWidth={1.75} />
            {messages.common.download}
          </span>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-4 pb-4 sm:px-5 sm:pb-5">
        <BrowserNestedHeroWindow />
      </div>
    </div>
  );
}

export type { BrowserPickerTarget };
