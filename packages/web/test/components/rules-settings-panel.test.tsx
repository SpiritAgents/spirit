/** @vitest-environment jsdom */

import "./setup";

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { RulesSettingsPanel } from "@/components/settings/panels/rules-settings-panel";

test("Rule creation selects scope and type in separate groups", async () => {
  const onCreateRule = vi.fn().mockResolvedValue(undefined);
  render(
    <RulesSettingsPanel
      snapshot={{ workspaceBinding: "project", rulesList: [] } as never}
      rulesBusy={false}
      apiReady={false}
      onCreateRule={onCreateRule}
      onDeleteRule={vi.fn()}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "New Rule" }));
  const dialog = screen.getByRole("dialog");
  const scopeGroup = within(dialog).getByRole("tablist", { name: "Scope" });

  fireEvent.click(within(scopeGroup).getByRole("tab", { name: "Workspace" }));
  const typeGroup = within(dialog).getByRole("tablist", { name: "Type" });
  fireEvent.click(within(typeGroup).getByRole("tab", { name: "Generic" }));
  fireEvent.change(within(dialog).getByLabelText("Content"), {
    target: { value: "Keep commit messages in English." },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));

  await waitFor(() =>
    expect(onCreateRule).toHaveBeenCalledWith({
      rootKind: "workspaceAgents",
      description: "Keep commit messages in English.",
    }),
  );
});
