import assert from "node:assert/strict";
import { test } from "vitest";

import {
  buildCrashLogText,
  buildCrashPageHtml,
  buildIssueFeedbackUrl,
  clearCrashSceneBuffer,
  crashPageDataUrl,
  escapeCrashPageHtml,
  recordCrashLog,
  recordRendererError,
} from "../dist-electron/electron/crash-report.js";

const TEST_FEEDBACK_ENV = {
  version: "0.1.0",
  electronVersion: "43.3.0",
  platform: "darwin",
  arch: "arm64",
  osRelease: "25.0.0",
  packaged: false,
};

test("buildCrashLogText includes trigger, reason, and exit code", () => {
  clearCrashSceneBuffer();
  const text = buildCrashLogText({
    trigger: "render-process-gone",
    reason: "crashed",
    exitCode: 11,
  });
  assert.match(text, /Trigger: render-process-gone/);
  assert.match(text, /Reason: crashed/);
  assert.match(text, /Exit code: 11/);
  assert.match(text, /Time: \d{4}-\d{2}-\d{2}T/);
  assert.match(text, /no renderer errors or recent logs/);
});

test("buildCrashLogText lists renderer errors with stack and recent logs in order", () => {
  clearCrashSceneBuffer();
  recordRendererError({
    kind: "error",
    message: "Uncaught TypeError: boom",
    stack: "TypeError: boom\n    at App (app.tsx:1:1)",
  });
  recordCrashLog("renderer", "Warning: something odd");
  recordCrashLog("main", "render-process-gone reason=crashed exitCode=11");
  const text = buildCrashLogText({ trigger: "render-process-gone", reason: "crashed" });
  const errorsIndex = text.indexOf("=== Renderer errors ===");
  const logsIndex = text.indexOf("=== Recent logs ===");
  assert.ok(errorsIndex > -1 && logsIndex > errorsIndex);
  assert.match(text, /Uncaught TypeError: boom/);
  assert.match(text, /at App \(app\.tsx:1:1\)/);
  assert.match(text, /\[renderer\] Warning: something odd/);
  assert.match(text, /\[main\] render-process-gone reason=crashed exitCode=11/);
});

test("buildCrashLogText omits exit code when absent (unresponsive)", () => {
  clearCrashSceneBuffer();
  const text = buildCrashLogText({ trigger: "unresponsive", reason: "unresponsive" });
  assert.doesNotMatch(text, /Exit code:/);
  assert.match(text, /Trigger: unresponsive/);
});

test("recordCrashLog drops empty entries and truncates long lines", () => {
  clearCrashSceneBuffer();
  recordCrashLog("main", "   \n  ");
  recordCrashLog("main", "x".repeat(1000));
  const text = buildCrashLogText({ trigger: "render-process-gone", reason: "oom" });
  assert.match(text, /x{400,}…/);
  assert.ok(!text.includes("x".repeat(1000)));
});

test("crash page html contains title, description, and escaped log text", () => {
  const html = buildCrashPageHtml(
    {
      title: "Spirit has Crashed",
      description: "The renderer process terminated unexpectedly.",
      lang: "zh-CN",
    },
    "Reason: crashed\n<script>alert(1)</script>",
  );
  assert.match(html, /<h1>Spirit has Crashed<\/h1>/);
  assert.match(html, /The renderer process terminated unexpectedly\./);
  assert.match(html, /<pre>Reason: crashed/);
  assert.match(html, /lang="zh-CN"/);
  assert.match(html, /justify-content: center/);
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<script>"));
});

test("crash page has no external resources or scripts", () => {
  const html = buildCrashPageHtml({ title: "t", description: "d" }, "log");
  assert.ok(!/src=/u.test(html));
  assert.ok(!/href=/u.test(html));
  assert.ok(!/<script/u.test(html));
});

test("crash page renders the feedback button only with both label and url", () => {
  const url = "https://github.com/SpiritAgents/spirit/issues/new?template=bug_report.md";
  const html = buildCrashPageHtml(
    { title: "t", description: "d", reportLabel: "Report on GitHub" },
    "log",
    {},
    { url },
  );
  assert.match(html, /<a class="report-button" href="https:\/\/github\.com\//);
  assert.match(html, /<span>Report on GitHub<\/span>/);
  // Official Invertocat glyph, monochrome via currentColor.
  assert.match(html, /<svg viewBox="0 0 98 96" aria-hidden="true">/);
  assert.match(html, /fill="currentColor"/);

  const withoutLabel = buildCrashPageHtml({ title: "t", description: "d" }, "log", {}, { url });
  assert.ok(!withoutLabel.includes('<a class="report-button"'));
  const withoutUrl = buildCrashPageHtml(
    { title: "t", description: "d", reportLabel: "Report on GitHub" },
    "log",
  );
  assert.ok(!withoutUrl.includes('<a class="report-button"'));
});

test("crash page button mirrors the app default button style", () => {
  const html = buildCrashPageHtml({ title: "t", description: "d" }, "log");
  // src/components/ui/button.tsx: bg-primary text-primary-foreground hover:bg-primary/80,
  // h-8 px-2.5 rounded-lg (var(--radius)) text-sm font-normal.
  assert.match(html, /background: var\(--primary\);/);
  assert.match(html, /color: var\(--primary-foreground\);/);
  assert.match(html, /border-radius: var\(--radius\);/);
  assert.match(html, /font-size: 14px;/);
  assert.match(html, /height: 32px;/);
  const buttonRule = /a\.report-button \{([^}]*)\}/u.exec(html)?.[1] ?? "";
  assert.ok(!/font-weight/u.test(buttonRule), "button must inherit font-normal like ui/button.tsx");
  assert.match(html, /a\.report-button:hover \{/);
  assert.match(html, /background: color-mix\(in srgb, var\(--primary\) 80%, transparent\);/);
});

test("buildIssueFeedbackUrl prefills the bug report template with logs and environment", () => {
  const url = buildIssueFeedbackUrl({
    trigger: "render-process-gone",
    reason: "crashed",
    exitCode: 11,
    logText: "Reason: crashed\nExit code: 11",
    env: TEST_FEEDBACK_ENV,
  });
  assert.ok(url.startsWith("https://github.com/SpiritAgents/spirit/issues/new?"));
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get("template"), "bug_report.md");
  assert.equal(parsed.searchParams.get("title"), "Renderer crash: crashed, exit code 11");
  const body = parsed.searchParams.get("body") ?? "";
  assert.match(body, /## Logs/);
  assert.match(body, /Reason: crashed\nExit code: 11/);
  assert.match(body, /trigger=render-process-gone, reason=crashed, exit code 11/);
  assert.match(body, /OS \/ platform: darwin arm64 \(25\.0\.0\)/);
  assert.match(body, /Spirit version: 0\.1\.0 \(Electron 43\.3\.0\)/);
  assert.match(body, /Install source: pnpm dev/);
  assert.match(body, /## Description/);
  assert.match(body, /## Steps to Reproduce/);
});

test("buildIssueFeedbackUrl caps the embedded log tail", () => {
  const url = buildIssueFeedbackUrl({
    trigger: "unresponsive",
    reason: "unresponsive",
    logText: `head ${"x".repeat(10_000)}`,
    env: TEST_FEEDBACK_ENV,
  });
  const body = new URL(url).searchParams.get("body") ?? "";
  assert.match(body, /\(oldest lines omitted\)/);
  assert.ok(!body.includes("head "));
  assert.ok(body.length < 10_000);
});

test("crash page body follows the translucency appearance", () => {
  const solid = buildCrashPageHtml({ title: "t", description: "d" }, "log");
  assert.match(solid, /background: var\(--background\)/);
  assert.ok(!solid.includes("color-mix(in srgb, var(--background) 70%"));
  const translucent = buildCrashPageHtml({ title: "t", description: "d" }, "log", {
    translucency: true,
  });
  // Same readability tint as LaunchSplash / OOBE (bg-background/70).
  assert.match(
    translucent,
    /background: color-mix\(in srgb, var\(--background\) 70%, transparent\)/,
  );
});

test("crashPageDataUrl is a self-contained encoded data URL", () => {
  const url = crashPageDataUrl({ title: "Spirit 已崩溃", description: "d" }, "line");
  assert.ok(url.startsWith("data:text/html;charset=utf-8,"));
  const decoded = decodeURIComponent(url.slice("data:text/html;charset=utf-8,".length));
  assert.match(decoded, /Spirit 已崩溃/);
  assert.match(decoded, /<pre>line<\/pre>/);
});

test("escapeCrashPageHtml escapes all html metacharacters", () => {
  assert.equal(escapeCrashPageHtml(`a&b<c>d"e`), "a&amp;b&lt;c&gt;d&quot;e");
});
