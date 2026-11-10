/** @vitest-environment jsdom */

import "./setup";

import { fireEvent, render } from "@testing-library/react";
import { FileText } from "lucide-react";
import { describe, expect, test, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { WorkspaceToolTabChip } from "@/components/workspace-tool-tab-chip";

describe("WorkspaceToolTabChip", () => {
  test("selecting a tab and closing it remain separate actions", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const { getByRole } = render(
      <WorkspaceToolTabChip
        tab={{ id: "file-tab", kind: "files", tabTitle: "notes.md" }}
        icon={FileText}
        label="Files"
        selected={false}
        onSelect={onSelect}
        onClose={onClose}
      />,
    );
    const tab = getByRole("tab", { name: "notes.md" });
    expect(tab.getAttribute("aria-selected")).toBe("false");
    expect(tab.getAttribute("aria-controls")).toBe("workspace-tool-panel-file-tab");
    fireEvent.click(tab);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("file-tab");

    onSelect.mockClear();
    const close = getByRole("button", { name: "Close Files tab" });
    expect(tab.contains(close)).toBe(false);
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledExactlyOnceWith("file-tab");
    expect(onSelect).not.toHaveBeenCalled();
  });

  test("an active icon-only tab keeps its label and can be selected again", () => {
    const onSelect = vi.fn();
    const { getByRole, queryByRole } = render(
      <TooltipProvider>
        <WorkspaceToolTabChip
          tab={{ id: "empty-files", kind: "files" }}
          icon={FileText}
          label="Files"
          selected
          onSelect={onSelect}
          onClose={vi.fn()}
        />
      </TooltipProvider>,
    );
    const tab = getByRole("tab", { name: "Files" });
    expect(tab.getAttribute("aria-selected")).toBe("true");
    expect(tab.tabIndex).toBe(0);
    expect(queryByRole("button", { name: "Close Files tab" })).toBeNull();
    fireEvent.click(tab);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("empty-files");
    expect(tab.getAttribute("aria-selected")).toBe("true");
  });

  test("icon-only and titled tabs share the chrome icon-button hover size", () => {
    const { getByRole, rerender } = render(
      <TooltipProvider>
        <WorkspaceToolTabChip
          tab={{ id: "empty-files", kind: "files" }}
          icon={FileText}
          label="Files"
          selected={false}
          onSelect={vi.fn()}
          onClose={vi.fn()}
        />
      </TooltipProvider>,
    );
    const iconOnlyChip = getByRole("tab", { name: "Files" }).closest(
      "[data-slot='workspace-tool-tab-chip']",
    );
    expect(iconOnlyChip?.className.split(/\s+/)).toContain("size-7");

    rerender(
      <WorkspaceToolTabChip
        tab={{ id: "file-tab", kind: "files", tabTitle: "notes.md" }}
        icon={FileText}
        label="Files"
        selected={false}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const titledChip = getByRole("tab", { name: "notes.md" }).closest(
      "[data-slot='workspace-tool-tab-chip']",
    );
    const titledClasses = titledChip?.className.split(/\s+/) ?? [];
    expect(titledClasses).toEqual(expect.arrayContaining(["h-7"]));
    expect(titledClasses).not.toContain("h-8");
  });
});
