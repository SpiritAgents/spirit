/** @vitest-environment jsdom */

import "./setup";

import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

import { McpsSettingsPanel } from "@/components/settings/panels/mcps-settings-panel";
import i18n from "@/lib/i18n";

beforeEach(async () => {
  await i18n.changeLanguage("en");
});

function inspection(toolsCount: number) {
  return {
    name: "workspace-files",
    displayName: "Workspace Files",
    supportsTools: true,
    supportsResources: true,
    supportsPrompts: true,
    toolsCount,
    resourcesCount: 2,
    promptsCount: 3,
  };
}

test("MCP runtime states and deletion use real snapshot and inspection data", async () => {
  const onInspectMcpServer = vi.fn(async (name: string) => {
    if (name === "github") {
      throw new Error("Connection closed before initialization completed.");
    }
    if (name === "offline-tools") {
      throw new Error("");
    }
    return inspection(1);
  });
  const onDeleteMcpServer = vi.fn();
  render(
    <McpsSettingsPanel
      snapshot={
        {
          workspaceBinding: "project",
          mcpServers: [
            { name: "workspace-files", enabled: true, scope: "workspace" },
            { name: "github", enabled: true, scope: "user" },
            { name: "offline-tools", enabled: true, scope: "user" },
            { name: "local-disabled", enabled: false, scope: "user" },
          ],
        } as never
      }
      mcpsBusy={false}
      onAddMcpServer={vi.fn()}
      onDeleteMcpServer={onDeleteMcpServer}
      onInspectMcpServer={onInspectMcpServer}
    />,
  );

  await vi.waitFor(() => {
    expect(screen.getByText("1 tool, 2 resources, and 3 prompts available")).toBeTruthy();
    expect(screen.getByText("Connection closed before initialization completed.")).toBeTruthy();
    expect(screen.getByText("Connection failed")).toBeTruthy();
  });

  expect(screen.queryByText("Active")).toBeNull();
  expect(screen.queryByText("Loading")).toBeNull();
  expect(screen.queryByText("Failed")).toBeNull();
  expect(screen.queryByText("HTTP")).toBeNull();
  expect(screen.queryByText("Stdio")).toBeNull();
  expect(screen.getByText("Workspace Files")).toBeTruthy();
  expect(screen.getByText("GitHub")).toBeTruthy();
  expect(
    screen.getByText("Connection closed before initialization completed.").parentElement?.className,
  ).toContain("opacity-50");
  expect(onInspectMcpServer).not.toHaveBeenCalledWith("local-disabled");

  fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);
  const dialog = screen.getByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
  expect(onDeleteMcpServer).toHaveBeenCalledWith({ name: "workspace-files", scope: "workspace" });
});

test("MCP inspection shows a title-leading spinner while connecting", () => {
  const onInspectMcpServer = vi.fn(() => new Promise(() => {}));
  render(
    <McpsSettingsPanel
      snapshot={
        {
          workspaceBinding: "project",
          mcpServers: [{ name: "remote-search", enabled: true, scope: "workspace" }],
        } as never
      }
      mcpsBusy={false}
      onAddMcpServer={vi.fn()}
      onDeleteMcpServer={vi.fn()}
      onInspectMcpServer={onInspectMcpServer}
    />,
  );

  expect(screen.getByLabelText("Connecting…")).toBeTruthy();
});

test("MCP creation separates scope from the Spirit-only type", async () => {
  const onAddMcpServer = vi.fn().mockResolvedValue(undefined);
  render(
    <McpsSettingsPanel
      snapshot={{ workspaceBinding: "project", mcpServers: [] } as never}
      mcpsBusy={false}
      onAddMcpServer={onAddMcpServer}
      onDeleteMcpServer={vi.fn()}
      onInspectMcpServer={vi.fn()}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Add MCP" }));
  const dialog = screen.getByRole("dialog");
  const scopeGroup = within(dialog).getByRole("tablist", { name: "Scope" });
  const typeGroup = within(dialog).getByRole("tablist", { name: "Type" });
  expect(
    within(scopeGroup).getByRole("tab", { name: "Workspace" }).getAttribute("aria-selected"),
  ).toBe("true");
  expect(within(typeGroup).getAllByRole("tab")).toHaveLength(1);
  expect(within(typeGroup).getByRole("tab", { name: "Spirit" }).getAttribute("aria-selected")).toBe(
    "true",
  );
  expect(within(typeGroup).queryByRole("tab", { name: "Generic" })).toBeNull();

  fireEvent.click(within(scopeGroup).getByRole("tab", { name: "User" }));
  fireEvent.change(within(dialog).getByLabelText("Name"), {
    target: { value: "workspace-files" },
  });
  fireEvent.change(within(dialog).getByLabelText("Command"), {
    target: { value: "spirit-mcp workspace-files" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));

  await vi.waitFor(() =>
    expect(onAddMcpServer).toHaveBeenCalledWith({
      name: "workspace-files",
      scope: "user",
      transportType: "stdio",
      endpoint: "spirit-mcp workspace-files",
      metadata: "",
    }),
  );
});
