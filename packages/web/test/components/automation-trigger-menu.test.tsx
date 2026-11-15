/** @vitest-environment jsdom */

import "./setup";

import { fireEvent, render, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { AutomationTriggerMenu } from "@/components/automation-trigger-menu";
import { TooltipProvider } from "@/components/ui/tooltip";
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
        githubConnected={false}
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
        githubConnected={false}
        onTriggerChange={() => {}}
        runtime={runtime({ supportsExtensionTriggers: false })}
      />
    </TooltipProvider>,
  );
  fireEvent.pointerDown(getByRole("button", { name: /Hourly/ }), { button: 0 });
  expect(queryByText("Repository Activity")).toBeNull();
});
