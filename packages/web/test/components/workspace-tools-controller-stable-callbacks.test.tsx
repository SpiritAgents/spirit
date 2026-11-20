/** @vitest-environment jsdom */

import "./setup";

import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, test, vi } from "vitest";

import { WorkspaceToolsChromeProvider } from "@/contexts/workspace-tools-chrome-context";
import {
  useWorkspaceToolsController,
  type UseWorkspaceToolsControllerOptions,
} from "@/hooks/useWorkspaceToolsController";

function Wrapper({ children }: { children: ReactNode }) {
  return <WorkspaceToolsChromeProvider>{children}</WorkspaceToolsChromeProvider>;
}

test("workspace callbacks consumed by Markdown stay stable across snapshot renders", () => {
  const openExtensionLink = vi.fn(async () => false);
  const runtime = {
    hostKind: "electron",
    apiReady: false,
    openExtensionLink,
    statHostTextFile: vi.fn(),
    getWorkspaceToolTabs: vi.fn(),
    subscribeWorkspaceToolTabsUpdates: vi.fn(() => () => {}),
    syncWorkspaceToolTabs: vi.fn(),
  } as unknown as UseWorkspaceToolsControllerOptions["runtime"];
  const initialProps = {
    runtime,
    snapshot: null,
    activeFilePath: null,
  } satisfies UseWorkspaceToolsControllerOptions;
  const { result, rerender } = renderHook(
    (props: UseWorkspaceToolsControllerOptions) => useWorkspaceToolsController(props),
    { wrapper: Wrapper, initialProps },
  );
  const initialOpenWorkspaceUrl = result.current.openWorkspaceUrl;
  const initialOpenWorkspaceFileInNewTab = result.current.openWorkspaceFileInNewTab;

  rerender({ ...initialProps, runtime: { ...runtime } });

  expect(result.current.openWorkspaceUrl).toBe(initialOpenWorkspaceUrl);
  expect(result.current.openWorkspaceFileInNewTab).toBe(initialOpenWorkspaceFileInNewTab);
});
