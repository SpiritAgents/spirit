/** @vitest-environment jsdom */

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

import "./setup";

import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { HooksSettingsPanel } from "@/components/settings/panels/hooks-settings-panel";

const hooksList = [
  {
    id: "workspace:preToolUse:0",
    scope: "workspace",
    event: "preToolUse",
    index: 0,
    command: "hooks/validate-command.sh --changed",
    configPath: "/demo/workspace/.spirit/hooks.json",
    timeout: 30,
    failClosed: true,
    matcher: "Write|Edit",
  },
  {
    id: "user:preToolUse:1",
    scope: "user",
    event: "preToolUse",
    index: 1,
    command: "hooks/log-command.sh",
    configPath: "/demo/user/.spirit/hooks.json",
    timeout: 10,
  },
];

test("Hooks use real list data, relative paths, normal command text, and real deletion", () => {
  const onDeleteHookEntry = vi.fn();
  render(
    <HooksSettingsPanel
      snapshot={{ hooksList } as never}
      hooksBusy={false}
      apiReady
      workspaceBinding="project"
      onSaveHookEntry={vi.fn()}
      onDeleteHookEntry={onDeleteHookEntry}
    />,
  );

  expect(screen.getAllByText("preToolUse")).toHaveLength(2);
  expect(screen.getByText(".spirit")).toBeTruthy();
  expect(screen.queryByText("User")).toBeNull();
  expect(screen.getByText("hooks/validate-command.sh --changed").className).not.toContain(
    "font-mono",
  );

  fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);
  const dialog = screen.getByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
  expect(onDeleteHookEntry).toHaveBeenCalledWith({
    scope: "workspace",
    event: "preToolUse",
    index: 0,
  });
});

test("Hook creation separates scope from the Spirit-only type", async () => {
  const onSaveHookEntry = vi.fn().mockResolvedValue(undefined);
  render(
    <HooksSettingsPanel
      snapshot={{ hooksList: [] } as never}
      hooksBusy={false}
      apiReady
      workspaceBinding="project"
      onSaveHookEntry={onSaveHookEntry}
      onDeleteHookEntry={vi.fn()}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Add hook" }));
  const dialog = screen.getByRole("dialog");
  const scopeGroup = within(dialog).getByRole("tablist", { name: "Scope" });
  const typeGroup = within(dialog).getByRole("tablist", { name: "Type" });
  expect(within(typeGroup).getAllByRole("tab")).toHaveLength(1);
  expect(within(typeGroup).getByRole("tab", { name: "Spirit" }).getAttribute("aria-selected")).toBe(
    "true",
  );
  expect(within(typeGroup).queryByRole("tab", { name: "Generic" })).toBeNull();

  fireEvent.click(within(scopeGroup).getByRole("tab", { name: "User" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

  await vi.waitFor(() =>
    expect(onSaveHookEntry).toHaveBeenCalledWith({
      scope: "user",
      event: "preToolUse",
      command: "hooks/log-hook.sh",
      timeout: 30,
    }),
  );
});
