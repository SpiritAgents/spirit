import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { product } from "@spiritagent/product";

import { useI18n } from "@/i18n/provider";
import { cn } from "@/lib/utils";

/** Terminal ANSI cyan — follows the dual-theme --terminal-ansi-cyan CSS variable. */
const CLI_ACCENT_CLASS = "text-(--terminal-ansi-cyan)";

/**
 * Inline mono — site `pre { font-family: var(--font-sans) }` overrides Tailwind `font-mono`.
 */
const CLI_MONO_STYLE = {
  fontFamily:
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  fontVariantLigatures: "none",
} as const;

/** Exact SPIRIT block logo from apps/cli `SPIRIT_LOGO_LINES`. */
const SPIRIT_LOGO_LINES = [
  " ███████╗██████╗ ██╗██████╗ ██╗████████╗",
  " ██╔════╝██╔══██╗██║██╔══██╗██║╚══██╔══╝",
  " ███████╗██████╔╝██║██████╔╝██║   ██║   ",
  " ╚════██║██╔═══╝ ██║██╔══██╗██║   ██║   ",
  " ███████║██║     ██║██║  ██║██║   ██║   ",
  " ╚══════╝╚═╝     ╚═╝╚═╝  ╚═╝╚═╝   ╚═╝   ",
] as const;

const LOGO_INNER_WIDTH = Math.max(
  ...SPIRIT_LOGO_LINES.map((line) => line.length),
  ` ${product.name} `.length,
);

function buildCliTitledBox(title: string, bodyLines: string[], innerWidth: number): string {
  const titleWidth = title.length;
  const top =
    titleWidth >= innerWidth
      ? `┌${"─".repeat(innerWidth)}┐`
      : `┌${title}${"─".repeat(innerWidth - titleWidth)}┐`;

  const middle = bodyLines.map((line) => {
    const clipped = line.length > innerWidth ? line.slice(0, innerWidth) : line;
    return `│${clipped.padEnd(innerWidth, " ")}│`;
  });

  const bottom = `└${"─".repeat(innerWidth)}┘`;
  return [top, ...middle, bottom].join("\n");
}

function buildCliLogoBanner(title: string): string {
  return buildCliTitledBox(title, [...SPIRIT_LOGO_LINES], LOGO_INNER_WIDTH);
}

/** Agent input as pure monospace lines (█ caret is one cell — no em-width spans). */
function buildCliAgentInputLines(
  typed: string,
  innerWidth: number,
): { top: string; body: string; bottom: string } {
  const caret = "█";
  const maxTyped = Math.max(0, innerWidth - caret.length);
  const typedVisible = typed.length > maxTyped ? typed.slice(0, maxTyped) : typed;
  const pad = Math.max(0, innerWidth - typedVisible.length - caret.length);

  return {
    top:
      "Agent".length >= innerWidth
        ? `┌${"─".repeat(innerWidth)}┐`
        : `┌Agent${"─".repeat(innerWidth - "Agent".length)}┐`,
    body: `│${typedVisible}${caret}${" ".repeat(pad)}│`,
    bottom: `└${"─".repeat(innerWidth)}┘`,
  };
}

type DownloadCliTerminalPreviewProps = {
  className?: string;
};

function CliMessage({ role, text }: { role: "user" | "assistant"; text: string }) {
  const lines = text.split("\n");
  return (
    <div className="space-y-0">
      {lines.map((line, index) => (
        <div key={`${role}-${index}`} className="whitespace-pre">
          <span
            translate="no"
            className={cn(
              index === 0 ? "" : "pl-[1.2em]",
              role === "assistant" && index === 0
                ? `font-bold ${CLI_ACCENT_CLASS}`
                : "text-foreground/55",
            )}
          >
            {index === 0 ? ">\u00a0" : "  "}
          </span>
          <span translate="yes" className="text-foreground/55">
            {line}
          </span>
        </div>
      ))}
    </div>
  );
}

type ScaledCliColumnProps = {
  scale: number;
  children: ReactNode;
  className?: string;
};

/** Scale a natural-width CLI column and collapse layout to the scaled box size. */
function ScaledCliColumn({ scale, children, className }: ScaledCliColumnProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) {
      return;
    }
    const sync = () => {
      setBox({
        width: content.scrollWidth * scale,
        height: content.scrollHeight * scale,
      });
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(content);
    return () => observer.disconnect();
  }, [scale]);

  return (
    <div
      className={cn("overflow-hidden", className)}
      style={box.height > 0 ? { width: box.width, height: box.height } : undefined}
    >
      <div
        ref={contentRef}
        className="origin-top-left"
        style={{
          ...CLI_MONO_STYLE,
          width: "max-content",
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * One CLI column at natural glyph size, then uniformly scaled to the preview shell.
 * Shell is w-[128%] of the trio cell → outer overflow provides the right-edge crop.
 * Flex pins the Agent input to the bottom of the shell.
 * Like a real CLI, the input box always spans the shell's full width: when the shell
 * is wider than the fixed logo column, the input reflows to fill it (logo never does).
 */
export function DownloadCliTerminalPreview({ className }: DownloadCliTerminalPreviewProps) {
  const { messages } = useI18n();
  const copy = messages.download;
  const logoBanner = useMemo(() => buildCliLogoBanner(copy.cliLogoTitle), [copy.cliLogoTitle]);

  const shellRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [inputInnerWidth, setInputInnerWidth] = useState(LOGO_INNER_WIDTH);
  const inputLines = useMemo(
    () => buildCliAgentInputLines("Awesome!", inputInnerWidth),
    [inputInnerWidth],
  );

  useLayoutEffect(() => {
    const shell = shellRef.current;
    const input = inputRef.current;
    const measure = measureRef.current;
    if (!shell || !input || !measure) {
      return;
    }

    const sync = () => {
      const shellWidth = shell.clientWidth;
      const naturalWidth = measure.scrollWidth;
      if (shellWidth <= 0 || naturalWidth <= 0) {
        return;
      }
      setScale(Math.min(1, shellWidth / naturalWidth));

      // Logo probe spans LOGO_INNER_WIDTH + 2 border cells → per-cell width; reflow
      // the input to the padding-box width of its row, floored to whole cells.
      const cellWidth = naturalWidth / (LOGO_INNER_WIDTH + 2);
      const { paddingLeft, paddingRight } = window.getComputedStyle(input);
      const contentWidth = input.clientWidth - parseFloat(paddingLeft) - parseFloat(paddingRight);
      const fitInnerWidth = Math.floor(contentWidth / cellWidth) - 2;
      setInputInnerWidth(Math.max(LOGO_INNER_WIDTH, fitInnerWidth));
    };

    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(shell);
    observer.observe(input);
    observer.observe(measure);
    return () => observer.disconnect();
  }, [logoBanner]);

  return (
    <div
      ref={shellRef}
      className={cn(
        "notranslate flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-foreground/12 bg-background shadow-[0_18px_48px_-12px_rgba(0,0,0,0.18)] dark:border-white/12 dark:bg-[#0a0a0a] dark:shadow-[0_18px_48px_rgba(0,0,0,0.55)]",
        className,
      )}
      translate="no"
      aria-hidden
      style={CLI_MONO_STYLE}
    >
      {/* Hidden natural-width probe — drives the shared scale (logo column width). */}
      <div
        ref={measureRef}
        className="pointer-events-none absolute top-0 left-0 -z-10 text-[10px] leading-none whitespace-pre opacity-0"
        style={CLI_MONO_STYLE}
        aria-hidden
        translate="no"
      >
        {logoBanner}
      </div>

      {/* History: top-aligned, fills leftover height; overflow clips (bottom crop of history). */}
      <div className="min-h-0 flex-1 overflow-hidden px-2.5 pt-2.5">
        <ScaledCliColumn scale={scale}>
          <pre
            translate="no"
            className={cn(
              "m-0 text-[10px] leading-none tracking-normal whitespace-pre",
              CLI_ACCENT_CLASS,
            )}
            style={CLI_MONO_STYLE}
          >
            {logoBanner}
          </pre>
          <div className="mt-2 space-y-2 text-[10px] leading-[1.35]">
            <CliMessage role="user" text={copy.cliUserMessage} />
            <CliMessage role="assistant" text={copy.cliAssistantMessage} />
            <CliMessage role="user" text={copy.cliUserFollowUp} />
            <CliMessage role="assistant" text={copy.cliAssistantFollowUp} />
          </div>
        </ScaledCliColumn>
      </div>

      {/* Input: pinned to CLI bottom; reflows to the shell's full width like a real CLI. */}
      <div ref={inputRef} className="shrink-0 overflow-hidden px-2.5 pt-1.5 pb-2">
        <ScaledCliColumn scale={scale}>
          <pre
            translate="no"
            className="m-0 text-[10px] leading-none tracking-normal whitespace-pre text-foreground/55"
            style={CLI_MONO_STYLE}
          >
            {inputLines.top}
            {"\n"}
            <span className="text-foreground">│</span>
            <span translate="yes" className="text-foreground">
              {inputLines.body.slice(1, inputLines.body.indexOf("█"))}
            </span>
            <span className="animate-pulse text-foreground">█</span>
            <span className="text-foreground">
              {inputLines.body.slice(inputLines.body.indexOf("█") + 1)}
            </span>
            {"\n"}
            {inputLines.bottom}
          </pre>
          <div translate="yes" className="mt-1 text-[8px] whitespace-pre text-foreground/35">
            {copy.cliFooter}
          </div>
        </ScaledCliColumn>
      </div>
    </div>
  );
}
