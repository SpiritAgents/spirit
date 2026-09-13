/**
 * Renderer crash scene capture and crash page rendering.
 *
 * The module is intentionally free of Electron imports so it stays unit-testable
 * and cannot itself fail inside a degraded main process; all wiring lives in main.ts.
 */

export type CrashPageTrigger = "render-process-gone" | "unresponsive";

export interface CrashSceneDetails {
  trigger: CrashPageTrigger;
  /** Electron RenderProcessGoneDetails.reason (crashed / oom / …) or "unresponsive". */
  reason: string;
  exitCode?: number;
}

export interface RendererErrorReport {
  kind: "error" | "unhandledrejection";
  message: string;
  stack?: string;
}

interface CrashLogEntry {
  time: string;
  source: "main" | "renderer";
  text: string;
}

const RECENT_LOG_MAX_ENTRIES = 60;
const RENDERER_ERROR_MAX_ENTRIES = 5;
/** Per-entry caps keep the in-memory buffer and the data: URL crash page small. */
const LOG_ENTRY_MAX_CHARS = 500;
const RENDERER_ERROR_MAX_CHARS = 2000;

const recentLogs: CrashLogEntry[] = [];
const rendererErrors: Array<CrashLogEntry & { stack?: string }> = [];

function utcNowIso(): string {
  return new Date().toISOString();
}

function truncateEntry(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  return `${trimmed.slice(0, max - 1)}…`;
}

export function recordCrashLog(source: "main" | "renderer", text: string): void {
  const entry = truncateEntry(text.replace(/\s+$/u, ""), LOG_ENTRY_MAX_CHARS);
  if (!entry) {
    return;
  }
  recentLogs.push({ time: utcNowIso(), source, text: entry });
  if (recentLogs.length > RECENT_LOG_MAX_ENTRIES) {
    recentLogs.splice(0, recentLogs.length - RECENT_LOG_MAX_ENTRIES);
  }
}

export function recordRendererError(report: RendererErrorReport): void {
  const message = truncateEntry(String(report.message ?? ""), LOG_ENTRY_MAX_CHARS);
  const stack = truncateEntry(String(report.stack ?? ""), RENDERER_ERROR_MAX_CHARS);
  if (!message && !stack) {
    return;
  }
  const label = report.kind === "unhandledrejection" ? "unhandledrejection" : "error";
  rendererErrors.push({
    time: utcNowIso(),
    source: "renderer",
    text: `[${label}] ${message}`,
    ...(stack ? { stack } : {}),
  });
  if (rendererErrors.length > RENDERER_ERROR_MAX_ENTRIES) {
    rendererErrors.splice(0, rendererErrors.length - RENDERER_ERROR_MAX_ENTRIES);
  }
}

/** Test-only: reset captured state between cases. */
export function clearCrashSceneBuffer(): void {
  recentLogs.length = 0;
  rendererErrors.length = 0;
}

let stderrCaptureInstalled = false;

/**
 * Tee process.stderr into the ring buffer. console.error and Electron-internal
 * errors (e.g. "Error sending from webFrameMain") both end up on stderr, so a
 * single hook captures post-crash spam and pre-crash warnings alike.
 */
export function installMainStderrCapture(): void {
  if (stderrCaptureInstalled) {
    return;
  }
  stderrCaptureInstalled = true;
  const original = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: unknown, ...rest: unknown[]) => {
    try {
      const text = typeof chunk === "string" ? chunk : undefined;
      if (text) {
        for (const line of text.split("\n")) {
          recordCrashLog("main", line);
        }
      }
    } catch {
      // Never let capture break the original write path.
    }
    return (original as (...args: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof process.stderr.write;
}

export function buildCrashLogText(details: CrashSceneDetails): string {
  const lines: string[] = [`Trigger: ${details.trigger}`, `Reason: ${details.reason}`];
  if (typeof details.exitCode === "number") {
    lines.push(`Exit code: ${details.exitCode}`);
  }
  lines.push(`Time: ${utcNowIso()}`);

  if (rendererErrors.length > 0) {
    lines.push("", "=== Renderer errors ===");
    for (const entry of rendererErrors) {
      lines.push(`[${entry.time}] ${entry.text}`);
      if (entry.stack) {
        lines.push(entry.stack);
      }
    }
  }

  if (recentLogs.length > 0) {
    lines.push("", "=== Recent logs ===");
    for (const entry of recentLogs) {
      lines.push(`[${entry.time}] [${entry.source}] ${entry.text}`);
    }
  }

  if (rendererErrors.length === 0 && recentLogs.length === 0) {
    lines.push("", "(no renderer errors or recent logs were captured before the crash)");
  }

  return lines.join("\n");
}

export function escapeCrashPageHtml(text: string): string {
  return text
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

export interface CrashPageCopy {
  title: string;
  description: string;
  /** Label of the feedback button (e.g. "Report on GitHub"); the button renders only when feedback is provided too. */
  reportLabel?: string;
  /** BCP-47 tag of the UI locale; used for the page's lang attribute. */
  lang?: string;
}

export interface CrashPageAppearance {
  /**
   * Native window translucent material (Win Mica / macOS Vibrancy) is active. The page then
   * tints with `bg-background/70` — the same readability mask as LaunchSplash / OOBE
   * (DESKTOP_TRANSLUCENCY_CONTENT_TINT_CLASS) — instead of a solid background.
   */
  translucency?: boolean;
}

/** Feedback button target: a fully prefilled issue-creation URL, opened in the external browser. */
export interface CrashPageFeedback {
  url: string;
}

export interface CrashFeedbackEnvironment {
  version: string;
  electronVersion: string;
  platform: string;
  arch: string;
  osRelease: string;
  packaged: boolean;
}

const ISSUE_FEEDBACK_REPO_URL = "https://github.com/SpiritAgents/spirit";
/** The body rides in the issue URL; keep the whole URL comfortably below browser/GitHub length limits. */
const ISSUE_FEEDBACK_MAX_LOG_CHARS = 3_000;

/**
 * Prefilled bug-report URL for the crash page feedback button: logs and environment are filled
 * in from the crash scene; description/steps stay as the template placeholders for the user.
 */
export function buildIssueFeedbackUrl(input: {
  trigger: string;
  reason: string;
  exitCode?: number;
  logText: string;
  env: CrashFeedbackEnvironment;
}): string {
  const exitSuffix = typeof input.exitCode === "number" ? `, exit code ${input.exitCode}` : "";
  const title = `Renderer crash: ${input.reason}${exitSuffix}`;
  const truncatedLog =
    input.logText.length > ISSUE_FEEDBACK_MAX_LOG_CHARS
      ? `(oldest lines omitted)\n…\n${input.logText.slice(-ISSUE_FEEDBACK_MAX_LOG_CHARS)}`
      : input.logText;
  const body = `## Description

<!-- What were you doing when this happened? -->

## Steps to Reproduce

1.
2.
3.

## Expected Behavior



## Actual Behavior

The renderer process terminated unexpectedly (trigger=${input.trigger}, reason=${input.reason}${exitSuffix}).

## Logs

\`\`\`text
${truncatedLog}
\`\`\`

## Environment

- OS / platform: ${input.env.platform} ${input.env.arch} (${input.env.osRelease})
- Spirit version: ${input.env.version} (Electron ${input.env.electronVersion})
- Install source: ${input.env.packaged ? "packaged build" : "pnpm dev"}

## Additional Context

Reported from the in-app crash page.
`;
  const params = new URLSearchParams({
    template: "bug_report.md",
    title,
    body,
  });
  return `${ISSUE_FEEDBACK_REPO_URL}/issues/new?${params.toString()}`;
}

/**
 * Official GitHub Invertocat glyph (brand.github.com SVG asset), single-color via currentColor
 * so it follows the button foreground in both light and dark mode.
 */
const GITHUB_INVERTOCAT_SVG = `<svg viewBox="0 0 98 96" aria-hidden="true"><path fill="currentColor" d="M41.4395 69.3848C28.8066 67.8535 19.9062 58.7617 19.9062 46.9902C19.9062 42.2051 21.6289 37.0371 24.5 33.5918C23.2559 30.4336 23.4473 23.7344 24.8828 20.959C28.7109 20.4805 33.8789 22.4902 36.9414 25.2656C40.5781 24.1172 44.4062 23.543 49.0957 23.543C53.7852 23.543 57.6133 24.1172 61.0586 25.1699C64.0254 22.4902 69.2891 20.4805 73.1172 20.959C74.457 23.543 74.6484 30.2422 73.4043 33.4961C76.4668 37.1328 78.0937 42.0137 78.0937 46.9902C78.0937 58.7617 69.1934 67.6621 56.3691 69.2891C59.623 71.3945 61.8242 75.9883 61.8242 81.252L61.8242 91.2051C61.8242 94.0762 64.2168 95.7031 67.0879 94.5547C84.4102 87.9512 98 70.6289 98 49.1914C98 22.1074 75.9883 6.69539e-07 48.9043 4.309e-07C21.8203 1.92261e-07 -1.9479e-07 22.1074 -4.3343e-07 49.1914C-6.20631e-07 70.4375 13.4941 88.0469 31.6777 94.6504C34.2617 95.6074 36.75 93.8848 36.75 91.3008L36.75 83.6445C35.4102 84.2188 33.6875 84.6016 32.1562 84.6016C25.8398 84.6016 22.1074 81.1563 19.4277 74.7441C18.375 72.1602 17.2266 70.6289 15.0254 70.3418C13.877 70.2461 13.4941 69.7676 13.4941 69.1934C13.4941 68.0449 15.4082 67.1836 17.3223 67.1836C20.0977 67.1836 22.4902 68.9063 24.9785 72.4473C26.8926 75.2227 28.9023 76.4668 31.2949 76.4668C33.6875 76.4668 35.2187 75.6055 37.4199 73.4043C39.0469 71.7773 40.291 70.3418 41.4395 69.3848Z"/></svg>`;

/**
 * Fully self-contained crash page: inline CSS only, no scripts, no external
 * resources, so it renders even while the session's renderer is gone.
 */
export function buildCrashPageHtml(
  copy: CrashPageCopy,
  logText: string,
  appearance: CrashPageAppearance = {},
  feedback?: CrashPageFeedback,
): string {
  const title = escapeCrashPageHtml(copy.title);
  const description = escapeCrashPageHtml(copy.description);
  const log = escapeCrashPageHtml(logText);
  const lang = escapeCrashPageHtml(copy.lang ?? "en");
  const bodyBackground = appearance.translucency
    ? "color-mix(in srgb, var(--background) 70%, transparent)"
    : "var(--background)";
  const reportButton =
    feedback && copy.reportLabel
      ? `<a class="report-button" href="${escapeCrashPageHtml(feedback.url)}">${GITHUB_INVERTOCAT_SVG}<span>${escapeCrashPageHtml(copy.reportLabel)}</span></a>`
      : "";
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  /* Theme tokens mirror src/styles.css; themeSource makes prefers-color-scheme follow the in-app light/dark setting. */
  :root {
    color-scheme: light dark;
    --background: oklch(1 0 0);
    --foreground: #2b2b2b;
    --muted-foreground: oklch(0.556 0 0);
    --card: oklch(1 0 0);
    --border: oklch(0.922 0 0);
    --primary: oklch(0.205 0 0);
    --primary-foreground: oklch(0.985 0 0);
    --radius: 0.625rem;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --background: #000000;
      --foreground: #e4e4e4;
      --muted-foreground: #a1a1a1;
      --card: #090909;
      --border: #272727;
      --primary: #ffffff;
      --primary-foreground: #000000;
      --radius: 0.5rem;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 48px 32px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    background: ${bodyBackground};
    color: var(--foreground);
  }
  h1 {
    margin: 0;
    /* Matches the doodle ("Let's build."): text-3xl + font-medium + tracking-tight. */
    font-size: 30px;
    font-weight: 500;
    letter-spacing: -0.025em;
    text-align: center;
  }
  p.description {
    margin: 0;
    max-width: 640px;
    text-align: center;
    font-size: 14px;
    line-height: 1.6;
    color: var(--muted-foreground);
  }
  pre {
    margin: 24px 0 0;
    padding: 16px;
    width: 100%;
    max-width: 860px;
    max-height: 50vh;
    overflow: auto;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--card);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12px;
    line-height: 1.55;
    white-space: pre-wrap;
    word-break: break-word;
  }
  /* Default button from src/components/ui/button.tsx: bg-primary text-primary-foreground hover:bg-primary/80, h-8 px-2.5 rounded-lg (var(--radius)) text-sm font-normal. */
  a.report-button {
    margin-top: 16px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 32px;
    padding: 0 10px;
    border-radius: var(--radius);
    background: var(--primary);
    color: var(--primary-foreground);
    font-size: 14px;
    text-decoration: none;
    cursor: pointer;
    transition: background-color 120ms ease;
  }
  a.report-button:hover {
    background: color-mix(in srgb, var(--primary) 80%, transparent);
  }
  a.report-button:active {
    background: color-mix(in srgb, var(--primary) 70%, transparent);
  }
  a.report-button svg {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
  }
</style>
</head>
<body>
<h1>${title}</h1>
<p class="description">${description}</p>
<pre>${log}</pre>
${reportButton}
</body>
</html>`;
}

export function crashPageDataUrl(
  copy: CrashPageCopy,
  logText: string,
  appearance: CrashPageAppearance = {},
  feedback?: CrashPageFeedback,
): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(buildCrashPageHtml(copy, logText, appearance, feedback))}`;
}
