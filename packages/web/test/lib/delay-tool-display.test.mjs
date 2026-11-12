import { afterEach, expect, test, vi } from "vitest";
import { delayDisplaySeconds, durationText } from "../../src/lib/delay-tool-display.ts";
import {
  getToolCallSummaryParts,
  toolHasExpandableContent,
} from "../../src/lib/tool-call-display.ts";
import i18n from "../../src/lib/i18n.ts";

afterEach(() => vi.restoreAllMocks());

test("formats real duration parts with localized numbers, units, hours, and days", () => {
  expect(durationText(252, "en")).toBe("4m 12s");
  expect(durationText(252, "zh-CN")).toBe("4 分钟 12 秒");
  expect(durationText(90_061, "en")).toBe("1d 1h 1m 1s");
  expect(durationText(0, "en")).toBe("0s");
  for (const locale of ["de", "es", "fr", "ja", "ko", "pt-BR", "ru", "zh-TW"]) {
    expect(durationText(252, locale)).not.toContain("undefined");
    expect(durationText(252, locale)).toMatch(/4.+12/);
  }
});

test("uses NumberFormat units when DurationFormat is unavailable", () => {
  const descriptor = Object.getOwnPropertyDescriptor(Intl, "DurationFormat");
  Object.defineProperty(Intl, "DurationFormat", { configurable: true, value: undefined });
  try {
    expect(durationText(252, "en")).toBe("4m 12s");
    expect(durationText(252, "zh-CN")).toBe("4 分钟 12 秒");
  } finally {
    Object.defineProperty(Intl, "DurationFormat", descriptor);
  }
});

test("uses host deadlines, actual elapsed duration, and no unbounded task counter", () => {
  const tool = {
    toolName: "delay",
    phase: "running",
    argsExcerpt: '{"seconds":252}',
    delay: { startedAtUnixMs: 1000, deadlineUnixMs: 253000 },
  };
  expect(delayDisplaySeconds(tool, 1000)).toBe(252);
  expect(delayDisplaySeconds(tool, 193100)).toBe(60);
  expect(delayDisplaySeconds(tool, 300000)).toBe(1);
  expect(
    delayDisplaySeconds({ ...tool, phase: "succeeded", delay: { ...tool.delay, elapsedMs: 1200 } }),
  ).toBe(1);
  expect(
    delayDisplaySeconds({
      ...tool,
      argsExcerpt: '{"task_id":"task_1"}',
      delay: { startedAtUnixMs: 1000, taskId: "task_1" },
    }),
  ).toBeUndefined();
});

test("keeps every delay phase unexpandable and distinguishes preview, running, and completion", async () => {
  await i18n.changeLanguage("en");
  const tool = {
    toolName: "delay",
    phase: "preview",
    headline: "delay",
    detailLines: [],
    argsExcerpt: '{"seconds":252}',
    outputExcerpt: '{"status":"running"}',
  };
  expect(getToolCallSummaryParts(tool).headline).toBe("Delay");
  expect(getToolCallSummaryParts({ ...tool, phase: "running" }).headline).toBe("Delaying");
  for (const phase of ["preview", "running", "succeeded", "failed"]) {
    expect(toolHasExpandableContent({ ...tool, phase })).toBe(false);
  }
  expect(
    getToolCallSummaryParts({
      ...tool,
      phase: "succeeded",
      delay: { taskId: "task_1", taskKind: "shell", elapsedMs: 1200, startedAtUnixMs: 0 },
    }).headline,
  ).toBe("Waited for Shell to Finish");
});
