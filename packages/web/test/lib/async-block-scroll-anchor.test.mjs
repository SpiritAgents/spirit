import { describe, expect, it } from "vitest";
import {
  createAsyncBlockHeightCache,
  decideVirtualRowScrollAdjustment,
} from "@spiritagent/ui/rendering";
import { estimateConversationRenderItemHeight } from "../../src/lib/conversation-virtual-row-size.js";

describe("AsyncBlockHeightCache", () => {
  it("stores rounded heights, refreshes LRU order on reads, and evicts oldest entries", () => {
    const cache = createAsyncBlockHeightCache(2);
    cache.set("a", 240.4);
    cache.set("b", 380.6);
    expect(cache.get("a")).toBe(240);
    cache.set("c", 190);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(240);
    expect(cache.get("c")).toBe(190);
    cache.set("invalid", 0);
    cache.set("nan", Number.NaN);
    expect(cache.get("invalid")).toBeUndefined();
    expect(cache.get("nan")).toBeUndefined();
  });
});

describe("decideVirtualRowScrollAdjustment", () => {
  it("compensates async block growth above the viewport top even during backward scroll", () => {
    expect(
      decideVirtualRowScrollAdjustment({
        pendingAsyncResize: { compensate: true, expiresAt: 1000 },
        now: 500,
        isFirstMeasure: false,
        itemStart: 400,
        itemEnd: 650,
        scrollOffsetWithAdj: 600,
        scrollDirection: "backward",
      }),
    ).toBe(true);
  });

  it("does not shift scrollTop when an async block top is already visible inside the viewport", () => {
    expect(
      decideVirtualRowScrollAdjustment({
        pendingAsyncResize: { compensate: false, expiresAt: 1000 },
        now: 500,
        isFirstMeasure: false,
        itemStart: 620,
        itemEnd: 820,
        scrollOffsetWithAdj: 600,
        scrollDirection: "backward",
      }),
    ).toBe(false);
  });

  it("preserves default TanStack Virtual policy when no async resize marker is active or when expired", () => {
    // Re-measurement during backward scroll without async marker stays false.
    expect(
      decideVirtualRowScrollAdjustment({
        pendingAsyncResize: undefined,
        now: 500,
        isFirstMeasure: false,
        itemStart: 100,
        itemEnd: 300,
        scrollOffsetWithAdj: 600,
        scrollDirection: "backward",
      }),
    ).toBe(false);

    // Expired async marker falls back to default policy.
    expect(
      decideVirtualRowScrollAdjustment({
        pendingAsyncResize: { compensate: true, expiresAt: 400 },
        now: 500,
        isFirstMeasure: false,
        itemStart: 100,
        itemEnd: 300,
        scrollOffsetWithAdj: 600,
        scrollDirection: "backward",
      }),
    ).toBe(false);

    // First measurement above scroll offset still compensates.
    expect(
      decideVirtualRowScrollAdjustment({
        pendingAsyncResize: undefined,
        now: 500,
        isFirstMeasure: true,
        itemStart: 200,
        itemEnd: 400,
        scrollOffsetWithAdj: 600,
        scrollDirection: "backward",
      }),
    ).toBe(true);
  });
});

describe("estimateConversationRenderItemHeight", () => {
  it("reserves space for inline MCP App tool cards", () => {
    const messages = [
      {
        id: 1,
        role: "assistant",
        content: "",
        tool: {
          toolCallId: "tc-1",
          name: "mcp__demo__dashboard",
          summary: "dashboard",
          status: "completed",
          mcpApp: {
            server: "demo",
            displayName: "Demo",
            toolName: "dashboard",
            resourceUri: "ui://demo/dashboard",
          },
        },
      },
      {
        id: 2,
        role: "assistant",
        content: "",
        tool: {
          toolCallId: "tc-2",
          name: "read_file",
          summary: "read",
          status: "completed",
        },
      },
    ];
    const items = [
      { kind: "message", messageIndex: 0 },
      { kind: "message", messageIndex: 1 },
    ];
    const appHeight = estimateConversationRenderItemHeight(0, items, messages);
    const plainToolHeight = estimateConversationRenderItemHeight(1, items, messages);
    expect(appHeight).toBeGreaterThan(plainToolHeight + 250);
  });
});
