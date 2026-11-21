/** @vitest-environment jsdom */

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
if (typeof DOMMatrixReadOnly === "undefined") {
  globalThis.DOMMatrixReadOnly = class DOMMatrixReadOnly {
    scale() {
      return this;
    }
  };
}

import "./setup";

import { act, render } from "@testing-library/react";
import { expect, test } from "vitest";

import { DreamGraphCard } from "@/components/dream-graph-card";
import { changeLanguage } from "@/lib/i18n";
import type { DesktopDreamOverviewItem } from "@/types";

const item: DesktopDreamOverviewItem = {
  id: "dream-1",
  title: "Reduce diff noise",
  summary: "Summaries cluster around diff rendering",
  details: "",
  workspaceRoot: "/ws/app",
  updatedAtUnixMs: Date.now(),
} as unknown as DesktopDreamOverviewItem;

async function changeUiLanguage(language: string): Promise<void> {
  await act(async () => {
    // jsdom has no localStorage host here; apply the language directly.
    localStorage.setItem("spirit-desktop-language", language);
    await changeLanguage(language);
  });
}

test("rebuilds graph node labels when the UI language changes", async () => {
  const view = render(
    <DreamGraphCard
      items={[item]}
      workspaceRoot="/ws/app"
      gitBranch={undefined}
      theme="light"
      collectorState="idle"
      dreamEnabled
      debugMode={false}
    />,
  );
  expect(view.container.textContent).toContain(
    "Recent work trends are being accumulated in the current scope",
  );

  await changeUiLanguage("zh-CN");

  expect(view.container.textContent).toContain("当前作用域正在沉淀近期工作动向");

  await changeUiLanguage("en");
  expect(view.container.textContent).toContain(
    "Recent work trends are being accumulated in the current scope",
  );
});
