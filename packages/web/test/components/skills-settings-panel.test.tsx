/** @vitest-environment jsdom */

import "./setup";

import { fireEvent, render, screen, within } from "@testing-library/react";
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
