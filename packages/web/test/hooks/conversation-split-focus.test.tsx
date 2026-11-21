/** @vitest-environment jsdom */

import "../components/setup";

import { act, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, test, vi } from "vitest";

import {
  ConversationSplitProvider,
  useConversationSplit,
} from "@/contexts/conversation-split-context";
import type { DesktopRuntime, DesktopSnapshot } from "@/types";

type Split = ReturnType<typeof useConversationSplit>;

function mockRuntime(): DesktopRuntime {
  return {
    apiReady: true,
    setVisiblePaneSessions: vi.fn(async () => {}),
    setLayoutNavigationPending: vi.fn(async () => {}),
    focusPaneSession: vi.fn(async () => {}),
    syncSplitPaneSessions: vi.fn(async () => {}),
    beginSplitPaneSession: vi.fn(async () => ({ sessionPath: "/ws/new.md" })),
    reapplySessionPathAliases: vi.fn(async () => {}),
    switchWorkspaceRoot: vi.fn(async () => ({ status: "skipped" })),
    beginSideChatPaneSession: vi.fn(async () => ({ filePath: "/ws/side.md", overruled: [] })),
    forkSessionIntoSideChat: vi.fn(async () => ({ filePath: "/ws/forked.md", overruled: [] })),
    deleteSession: vi.fn(async () => {}),
    closeSplitPaneSession: vi.fn(async () => {}),
    openSession: vi.fn(async () => {}),
  } as unknown as DesktopRuntime;
}

function snapshotFor(activePath: string): DesktopSnapshot {
  return {
    activeSession: { filePath: activePath },
    conversation: { messages: [] },
  } as unknown as DesktopSnapshot;
}

function Capture({ outRef }: { outRef: { current: Split | null } }) {
  const split = useConversationSplit();
  useEffect(() => {
    outRef.current = split;
  });
  return null;
}

function paneIds(split: Split): string[] {
  const leaves: string[] = [];
  const walk = (node: NonNullable<Split["layout"]>) => {
    if (node.kind === "leaf") {
      leaves.push(node.paneId);
      return;
    }
    walk(node.first);
    walk(node.second);
  };
  if (split.layout) walk(split.layout);
  return leaves;
}

describe("conversation split focus", () => {
  test("clicking another pane moves focus immediately", async () => {
    const ref: { current: Split | null } = { current: null };
    render(
      <ConversationSplitProvider runtime={mockRuntime()} snapshot={snapshotFor("/ws/a.md")}>
        <Capture outRef={ref} />
      </ConversationSplitProvider>,
    );
    await waitFor(() => expect(ref.current?.layout?.kind).toBe("leaf"));

    const firstPane = ref.current!.layout;
    if (firstPane?.kind !== "leaf") throw new Error("expected a single pane");
    await act(async () => {
      await ref.current!.splitPane(firstPane.paneId);
    });
    await waitFor(() => expect(paneIds(ref.current!).length).toBe(2));

    const [paneA, paneB] = paneIds(ref.current!) as [string, string];
    expect(ref.current!.focusedPaneId).toBe(paneA);
    await act(async () => {
      ref.current!.focusPane(paneB, "/ws/b.md");
    });

    expect(ref.current!.focusedPaneId).toBe(paneB);
  });

  test("layout identity is stable across rerenders with a fresh runtime", async () => {
    const ref: { current: Split | null } = { current: null };
    const view = render(
      <ConversationSplitProvider runtime={mockRuntime()} snapshot={snapshotFor("/ws/a.md")}>
        <Capture outRef={ref} />
      </ConversationSplitProvider>,
    );
    await waitFor(() => expect(ref.current?.layout).not.toBeNull());
    const before = ref.current!.layout;

    view.rerender(
      <ConversationSplitProvider runtime={mockRuntime()} snapshot={snapshotFor("/ws/a.md")}>
        <Capture outRef={ref} />
      </ConversationSplitProvider>,
    );

    await waitFor(() => expect(ref.current?.layout).not.toBeNull());
    expect(ref.current!.layout).toBe(before);
  });
});
