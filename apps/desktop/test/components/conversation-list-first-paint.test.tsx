/** @vitest-environment jsdom */

import "./setup";

import { render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import {
  ConversationList,
  type ConversationListProps,
} from "@/components/conversation/conversation-list";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ConversationMessageSnapshot } from "@/types";

vi.mock("@/components/conversation/message-card", () => ({
  MessageCard: ({ message }: { message: ConversationMessageSnapshot }) => (
    <div data-testid="message">{message.content}</div>
  ),
}));
vi.mock("@/components/process-card-collapsible", () => ({
  ProcessCardCollapsible: () => null,
}));
vi.mock("@/components/tool-call/tool-call-collapsible", () => ({
  ToolCallCollapsible: () => null,
}));

const messages: ConversationMessageSnapshot[] = [
  { id: 1, role: "user", content: "Session question", pending: false },
  { id: 2, role: "assistant", content: "Session answer", pending: false },
];
const runtime = {
  readWorkspaceTextFile: vi.fn<ConversationListProps["runtime"]["readWorkspaceTextFile"]>(),
} satisfies Partial<ConversationListProps["runtime"]>;

const listProps = {
  messages,
  conversationRenderItems: messages.map((_, messageIndex) => ({
    kind: "message" as const,
    messageIndex,
  })),
  pinScrollToTail: vi.fn(),
  subagentViewActive: false,
  composerSessionKey: "session",
  conversationListScopeKey: "main",
  conversationListRemountEpoch: 0,
  conversationPendingAuxState: undefined,
  processGroupManualOpen: {},
  processGroupManualOpenKey: (groupId: string) => groupId,
  onProcessGroupManualOpenChange: vi.fn(),
  shouldPlayProcessSealAnimation: () => false,
  workspaceRoot: "",
  runtime: runtime as ConversationListProps["runtime"],
  turnContinue: undefined,
  activeSessionReadOnly: false,
  conversationIsBusy: false,
  continueBusy: false,
  rewindDraft: null,
  onRewindDraftChange: vi.fn(),
  messageRewindComposerEnabled: false,
  rewindRichInputRef: { current: null },
  models: [],
  catalogHints: undefined,
  activeModel: { groupId: "test", name: "test-model" },
  agentMode: "agent",
  onOpenSubagentViewer: undefined,
  onOpenReadFile: undefined,
  onOpenPlan: undefined,
  onStartMessageRewind: vi.fn(),
  onSubmitMessageRewind: vi.fn(),
  onRewindRemoveLocalFileAttachment: vi.fn(),
  onRewindPickLocalFile: vi.fn(),
  onRewindPaste: vi.fn(),
  onRewindDragOver: vi.fn(),
  onRewindDrop: vi.fn(),
  onComposerAgentModeChange: vi.fn(),
  onForkMessage: vi.fn(),
} satisfies ConversationListProps;

function ConversationSurface() {
  return (
    <ScrollArea>
      <ConversationList {...listProps} />
    </ScrollArea>
  );
}

const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");

beforeEach(() => {
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.hasAttribute("data-radix-scroll-area-viewport") ? 600 : 80;
    },
  );
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalScrollTo) {
    Object.defineProperty(HTMLElement.prototype, "scrollTo", originalScrollTo);
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
  }
});

test("mounts message rows before the first animation frame when its viewport mounts together", () => {
  render(<ConversationSurface />);

  expect(screen.getAllByTestId("message").map((row) => row.textContent)).toEqual([
    "Session question",
    "Session answer",
  ]);
});

test("remounting a conversation surface never waits a frame to populate its virtual rows", () => {
  const { rerender } = render(<div>Extensions</div>);

  for (let round = 0; round < 3; round += 1) {
    rerender(<ConversationSurface />);
    expect(screen.getAllByTestId("message")).toHaveLength(2);
    rerender(<div>Extensions</div>);
    expect(screen.queryAllByTestId("message")).toHaveLength(0);
  }
});

test("Strict Mode remounts keep the message rows ready before an animation frame", () => {
  render(
    <StrictMode>
      <ConversationSurface />
    </StrictMode>,
  );

  expect(screen.getAllByTestId("message")).toHaveLength(2);
});
