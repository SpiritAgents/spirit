/** @vitest-environment jsdom */

import "./setup";

import { render, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";

vi.mock("@/components/workspace-monaco-editor", () => ({
  WorkspaceMonacoEditor: (props: { initialText: string }) => (
    <pre data-testid="monaco">{props.initialText}</pre>
  ),
}));
vi.mock("@/components/workspace-files-panel", () => ({
  WorkspaceFilesPanel: () => <div />,
}));
vi.mock("@/components/workspace-file-selection-menu", () => ({
  FileDomSelectionMenu: () => null,
  FileMonacoSelectionMenu: () => null,
}));
vi.mock("@/components/markdown-message", () => ({
  MarkdownMessage: (props: { content: string }) => <div data-testid="md">{props.content}</div>,
}));
vi.mock("@/hooks/useHostApi", () => ({ useHostApi: () => ({ api: null }) }));

import { WorkspaceFilesTab } from "@/components/workspace-files-tab";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const baseProps = {
  workspaceRoot: "/ws",
  plan: { exists: true, content: "# plan", path: "/ws/.plan.md" },
  listExplorerChildren: async () => [],
  readWorkspaceTextFile: async (p: string) => ({ text: `content of ${p}` }),
  writeWorkspaceTextFile: async () => {},
  readHostTextFile: async (p: string) => ({ text: `content of ${p}` }),
  writeHostTextFile: async () => {},
} as never;

test("file reveal request present at mount opens the file (new tab / restored tab)", async () => {
  const onTitleChange = vi.fn();
  const { findByTestId } = render(
    <TooltipProvider>
      <WorkspaceFilesTab
        {...(baseProps as object)}
        {...({} as never)}
        autoRevealFileNonce={1}
        fileRevealEnabled
        fileRevealPath="src/a.ts"
        onTitleChange={onTitleChange}
      />
    </TooltipProvider>,
  );
  await waitFor(() => expect(onTitleChange).toHaveBeenCalledWith("a.ts"));
  expect((await findByTestId("monaco")).textContent).toBe("content of src/a.ts");
});

test("plan reveal request present at mount opens the plan", async () => {
  const onTitleChange = vi.fn();
  render(
    <TooltipProvider>
      <WorkspaceFilesTab
        {...(baseProps as object)}
        {...({} as never)}
        autoRevealPlanNonce={1}
        planRevealEnabled
        onTitleChange={onTitleChange}
      />
    </TooltipProvider>,
  );
  await waitFor(() => expect(onTitleChange).toHaveBeenCalledWith("Plan"));
});
