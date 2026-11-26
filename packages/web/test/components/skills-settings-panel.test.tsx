/** @vitest-environment jsdom */

import "./setup";

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { SkillsSettingsPanel } from "@/components/settings/panels/skills-settings-panel";

const skillsList = [
  {
    id: "skill-design-review",
    name: "design-review",
    description: "Review **visual hierarchy** and `responsive behavior`.",
    shortLabel: ".agents/skills/design-review/SKILL.md",
    rootKind: "workspaceAgents",
    enabled: true,
    path: "/demo/workspace/.agents/skills/design-review/SKILL.md",
  },
  {
    id: "skill-release-checklist",
    name: "release-checklist",
    description: "Validate **build output** and smoke-test critical flows.",
    shortLabel: ".spirit/skills/release-checklist/SKILL.md",
    rootKind: "workspaceSpirit",
    enabled: false,
    path: "/demo/workspace/.spirit/skills/release-checklist/SKILL.md",
  },
  {
    id: "skill-commit-message",
    name: "commit-message",
    description: "",
    shortLabel: "skills/commit-message/SKILL.md",
    rootKind: "user",
    enabled: true,
    path: "/demo/user/.spirit/skills/commit-message/SKILL.md",
  },
  {
    id: "skill-github",
    name: "github",
    description: "Manage **GitHub** repository workflows.",
    shortLabel: "skills/github/SKILL.md",
    rootKind: "user",
    enabled: false,
    path: "/demo/user/.spirit/skills/github/SKILL.md",
  },
];

test("Skills use real list data, readable titles, stripped paths, and real deletion", () => {
  const onDeleteSkill = vi.fn();
  render(
    <SkillsSettingsPanel
      snapshot={{ workspaceBinding: "project", skillsList } as never}
      skillsBusy={false}
      apiReady={false}
      onCreateSkill={vi.fn()}
      onDeleteSkill={onDeleteSkill}
    />,
  );

  expect(screen.getByText("Design Review")).toBeTruthy();
  expect(screen.getByText("Release Checklist")).toBeTruthy();
  expect(screen.getByText("Commit Message")).toBeTruthy();
  expect(screen.getByText("GitHub")).toBeTruthy();
  expect(screen.getByText(".agents/skills")).toBeTruthy();
  expect(screen.getByText(".spirit/skills")).toBeTruthy();
  expect(screen.queryByText(".agents/skills/design-review")).toBeNull();

  fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);
  const dialog = screen.getByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
  expect(onDeleteSkill).toHaveBeenCalledWith({
    name: "design-review",
    rootKind: "workspaceAgents",
  });
});

test("Skill creation selects scope and type in separate groups", async () => {
  const onCreateSkill = vi.fn().mockResolvedValue(undefined);
  render(
    <SkillsSettingsPanel
      snapshot={{ workspaceBinding: "project", skillsList: [] } as never}
      skillsBusy={false}
      apiReady={false}
      onCreateSkill={onCreateSkill}
      onDeleteSkill={vi.fn()}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "New Skill" }));
  const dialog = screen.getByRole("dialog");
  const scopeGroup = within(dialog).getByRole("tablist", { name: "Scope" });
  const typeGroup = within(dialog).getByRole("tablist", { name: "Type" });
  expect(within(scopeGroup).getByRole("tab", { name: "User" }).getAttribute("aria-selected")).toBe(
    "true",
  );
  expect(within(typeGroup).getByRole("tab", { name: "Spirit" }).getAttribute("aria-selected")).toBe(
    "true",
  );
  expect(within(typeGroup).queryByRole("tab", { name: "Generic" })).toBeNull();

  fireEvent.click(within(scopeGroup).getByRole("tab", { name: "Workspace" }));
  const workspaceTypeGroup = within(dialog).getByRole("tablist", { name: "Type" });
  fireEvent.click(within(workspaceTypeGroup).getByRole("tab", { name: "Generic" }));
  fireEvent.change(within(dialog).getByLabelText("Name"), {
    target: { value: "code-review" },
  });
  fireEvent.change(within(dialog).getByLabelText("Description"), {
    target: { value: "Review code changes" },
  });
  fireEvent.change(within(dialog).getByLabelText("Content"), {
    target: { value: "Check the diff for correctness." },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));

  await waitFor(() =>
    expect(onCreateSkill).toHaveBeenCalledWith({
      name: "code-review",
      rootKind: "workspaceAgents",
      summary: "Review code changes",
      content: "Check the diff for correctness.",
    }),
  );
});
