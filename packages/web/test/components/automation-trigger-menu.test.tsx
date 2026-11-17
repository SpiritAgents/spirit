/** @vitest-environment jsdom */

import "./setup";

import { fireEvent, render, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import i18next from "i18next";
import { I18nextProvider } from "react-i18next";
import { resources } from "@spiritagent/i18n";

import { AutomationTriggerMenu } from "@/components/automation-trigger-menu";
import { TooltipProvider } from "@/components/ui/tooltip";
import { OPEN_EXTENSION_DETAILS_EVENT } from "@/lib/extension-navigation";
import type { DesktopExtensionAutomationTrigger } from "@/types";

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ObserverStub);
vi.stubGlobal("IntersectionObserver", ObserverStub);

const contribution: DesktopExtensionAutomationTrigger = {
  kind: "extension:personal/demo/activity",
  extensionId: "personal/demo",
  contributionId: "activity",
  name: "Repository Activity",
  description: "React to activity.",
  configuration: "menu",
  inputSchema: { type: "object" },
  icon: { type: "spirit", name: "globe" },
};

function runtime(overrides = {}) {
  return {
    contributions: [contribution],
    supportsExtensionTriggers: true,
    resolveMenu: vi.fn(async ({ path }: { path: string[] }) => ({
      items:
        path.length === 0
          ? [{ action: "submenu" as const, id: "spirit", label: "Spirit" }]
          : [
              {
                action: "select" as const,
                id: "created",
                label: "Created",
                config: { repository: "spirit", event: "created" },
              },
            ],
    })),
    cancelMenu: vi.fn(async () => {}),
    validate: vi.fn(async ({ kind, config }) => ({ kind, config, label: "Spirit activity" })),
    ...overrides,
  };
}

test("a native nested trigger selection is validated before changing the draft", async () => {
  const onTriggerChange = vi.fn();
  const triggerRuntime = runtime();
  const { getByRole, findByText } = render(
    <TooltipProvider>
      <AutomationTriggerMenu
        trigger={{ kind: "time", schedule: { kind: "hourly" } }}
        onTriggerChange={onTriggerChange}
        runtime={triggerRuntime}
      />
    </TooltipProvider>,
  );
  fireEvent.pointerDown(getByRole("button", { name: /Hourly/ }), { button: 0 });
  fireEvent.click(await findByText("Repository Activity"));
  fireEvent.click(await findByText("Spirit"));
  fireEvent.click(await findByText("Created"));

  await waitFor(() => {
    expect(triggerRuntime.validate).toHaveBeenCalledWith({
      kind: contribution.kind,
      config: { repository: "spirit", event: "created" },
    });
  });
  expect(onTriggerChange).toHaveBeenCalledWith({
    kind: contribution.kind,
    config: { repository: "spirit", event: "created" },
    label: "Spirit activity",
  });
});

test("Desktop-only trigger contributions are hidden when the runtime is unavailable", () => {
  const { getByRole, queryByText } = render(
    <TooltipProvider>
      <AutomationTriggerMenu
        trigger={{ kind: "time", schedule: { kind: "hourly" } }}
        onTriggerChange={() => {}}
        runtime={runtime({ supportsExtensionTriggers: false })}
      />
    </TooltipProvider>,
  );
  fireEvent.pointerDown(getByRole("button", { name: /Hourly/ }), { button: 0 });
  expect(queryByText("Repository Activity")).toBeNull();
});

test.each([
  {
    locale: "en",
    link: "Authorize Repository Activity",
    message: "Authorize Repository Activity to create automations",
  },
  {
    locale: "zh-CN",
    link: "授权 Repository Activity",
    message: "授权 Repository Activity 以创建自动化",
  },
])(
  "an unauthorized trigger explains its navigation in $locale",
  async ({ locale, link, message }) => {
    const localized = i18next.createInstance();
    await localized.init({
      resources,
      lng: locale,
      fallbackLng: "en",
      interpolation: { escapeValue: false },
    });
    const triggerRuntime = runtime({
      contributions: [
        { ...contribution, authorization: { id: "oauth", action: "authorize", configured: false } },
      ],
      invokeExtensionAction: vi.fn(),
    });
    const onTriggerChange = vi.fn();
    const navigate = vi.fn();
    const originalHitTest = document.elementFromPoint;
    window.addEventListener(OPEN_EXTENSION_DETAILS_EVENT, navigate);
    try {
      const { getByRole, findByRole } = render(
        <I18nextProvider i18n={localized}>
          <TooltipProvider>
            <AutomationTriggerMenu
              trigger={{ kind: "time", schedule: { kind: "hourly" } }}
              onTriggerChange={onTriggerChange}
              runtime={triggerRuntime}
            />
          </TooltipProvider>
        </I18nextProvider>,
      );
      fireEvent.pointerDown(getByRole("button"), { button: 0 });
      const row = getByRole("menuitem", { name: contribution.name });
      expect(row.getAttribute("aria-disabled")).toBe("true");
      document.elementFromPoint = vi.fn(() => row);
      fireEvent.pointerMove(row.parentElement!, { pointerType: "mouse", clientX: 20, clientY: 20 });
      fireEvent.pointerOver(row.parentElement!, { pointerType: "mouse", clientX: 20, clientY: 20 });
      await findByRole("tooltip");
      const action = getByRole("button", { name: link });
      expect(action.parentElement?.textContent).toBe(message);
      expect(action.classList.contains("underline")).toBe(true);
      fireEvent.click(action);
      expect(navigate).toHaveBeenCalledOnce();
      expect((navigate.mock.calls[0][0] as CustomEvent).detail).toEqual({
        extensionId: contribution.extensionId,
      });
      expect(triggerRuntime.resolveMenu).not.toHaveBeenCalled();
      expect(triggerRuntime.validate).not.toHaveBeenCalled();
      expect(triggerRuntime.invokeExtensionAction).not.toHaveBeenCalled();
      expect(onTriggerChange).not.toHaveBeenCalled();
    } finally {
      document.elementFromPoint = originalHitTest;
      window.removeEventListener(OPEN_EXTENSION_DETAILS_EVENT, navigate);
    }
  },
);
