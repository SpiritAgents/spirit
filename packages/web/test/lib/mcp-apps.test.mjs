import { describe, expect, it } from "vitest";

import { buildConversationRenderItems } from "@/lib/conversation-process-groups";
import {
  atomicMoveNode,
  clampMcpAppInlineHeight,
  computeMcpAppDisplayModesAfterTransition,
  formatMcpAppTabTitle,
  selectEvictableMcpAppKeys,
} from "@/lib/mcp-apps/pane-state";
import {
  clampPipRect,
  computeInitialPipRect,
  MCP_APP_PIP_MIN_HEIGHT_PX,
  MCP_APP_PIP_MIN_WIDTH_PX,
  movePipRect,
  pipResizeEdgeCursor,
  readMcpAppPipGeometry,
  resizePipRect,
  writeMcpAppPipGeometry,
} from "@/lib/mcp-apps/pip-geometry";
import {
  buildRestoredMcpAppFullscreenTabs,
  clearMcpAppWindowEntry,
  readMcpAppWindowState,
  setActiveMcpAppFullscreenTabId,
  setMcpAppWindowEntryMode,
} from "@/lib/mcp-apps/window-state";
import {
  buildMcpAppCallToolResult,
  buildMcpAppHostContext,
  collectMcpAppHostStyleVariables,
  extractMcpAppMessageText,
  extractMcpAppModelContext,
  isTrustedMcpAppExternalUrl,
  parseMcpAppToolArguments,
  validateMcpAppExternalUrl,
} from "@/lib/mcp-apps/theme-tokens";

describe("mcp-apps theme tokens and host context", () => {
  it("maps light and dark themes into canonical MCP Apps style variables and host context", () => {
    const darkVars = collectMcpAppHostStyleVariables(true, undefined);
    const lightVars = collectMcpAppHostStyleVariables(false, undefined);

    expect(darkVars["--color-background-primary"]).toBe("#090909");
    expect(lightVars["--color-background-primary"]).toBe("#ffffff");
    expect(darkVars["--color-text-primary"]).toBe("#e4e4e4");
    expect(lightVars["--color-text-primary"]).toBe("#2b2b2b");

    const ctx = buildMcpAppHostContext({
      resolvedDark: true,
      displayMode: "pip",
      locale: "zh-CN",
      hostKind: "electron",
      containerDimensions: { width: 380, height: 280 },
      doc: undefined,
    });
    expect(ctx.theme).toBe("dark");
    expect(ctx.displayMode).toBe("pip");
    expect(ctx.availableDisplayModes).toEqual(["inline", "pip", "fullscreen"]);
    expect(ctx.platform).toBe("desktop");
    expect(ctx.locale).toBe("zh-CN");
    expect(ctx.styles?.variables).toEqual(darkVars);
  });

  it("parses tool arguments and normalizes tool results safely", () => {
    expect(parseMcpAppToolArguments('{"repo":"SpiritAgents/spirit"}')).toEqual({
      repo: "SpiritAgents/spirit",
    });
    expect(parseMcpAppToolArguments("not-json")).toEqual({});
    expect(parseMcpAppToolArguments("[1,2,3]")).toEqual({});

    const structured = buildMcpAppCallToolResult(
      {
        content: [{ type: "text", text: "PR #42" }],
        structuredContent: { number: 42 },
      },
      "fallback",
      false,
    );
    expect(structured.content).toEqual([{ type: "text", text: "PR #42" }]);
    expect(structured.structuredContent).toEqual({ number: 42 });

    const fallback = buildMcpAppCallToolResult(undefined, "raw text", true);
    expect(fallback.content).toEqual([{ type: "text", text: "raw text" }]);
    expect(fallback.isError).toBe(true);
  });

  it("extracts plain text for ui/message and structured payload for ui/update-model-context", () => {
    expect(
      extractMcpAppMessageText([
        { type: "text", text: "Check PR #456" },
        { type: "resource_link", uri: "https://example.com/pr/456", name: "PR 456" },
      ]),
    ).toBe("Check PR #456\n\nPR 456");

    expect(
      extractMcpAppModelContext({
        content: [{ type: "text", text: "Selected branch: feat/mcp-apps" }],
        structuredContent: { branch: "feat/mcp-apps" },
      }),
    ).toEqual({
      text: "Selected branch: feat/mcp-apps",
      structuredContent: { branch: "feat/mcp-apps" },
    });
  });

  it("validates external URLs strictly and classifies trusted vs untrusted origins", () => {
    expect(validateMcpAppExternalUrl("javascript:alert(1)")).toBeNull();
    expect(validateMcpAppExternalUrl("file:///etc/passwd")).toBeNull();
    expect(validateMcpAppExternalUrl("data:text/html,hi")).toBeNull();

    const githubUrl = validateMcpAppExternalUrl(
      "https://github.com/SpiritAgents/spirit/issues/456",
    );
    expect(githubUrl).not.toBeNull();
    expect(isTrustedMcpAppExternalUrl(githubUrl, { extensionId: "spirit.github" })).toBe(true);

    const cspUrl = validateMcpAppExternalUrl("https://app.example.test/view");
    expect(cspUrl).not.toBeNull();
    expect(
      isTrustedMcpAppExternalUrl(cspUrl, {
        csp: { connectDomains: ["https://app.example.test"] },
      }),
    ).toBe(true);
    expect(isTrustedMcpAppExternalUrl(cspUrl, { extensionId: "spirit.github" })).toBe(false);
  });
});

describe("mcp-apps pane state and layout math", () => {
  it("clamps inline heights to safe bounds", () => {
    expect(clampMcpAppInlineHeight(undefined)).toBe(240);
    expect(clampMcpAppInlineHeight(50)).toBe(150);
    expect(clampMcpAppInlineHeight(420.4)).toBe(420);
    expect(clampMcpAppInlineHeight(2000)).toBe(800);
  });

  it("evicts oldest inline instances beyond maxActive while keeping pip and fullscreen exempt", () => {
    const entries = [
      { appKey: "pip-app", displayMode: "pip", lastTouchedAt: 1 },
      { appKey: "fs-app", displayMode: "fullscreen", lastTouchedAt: 2 },
      { appKey: "inline-1", displayMode: "inline", lastTouchedAt: 3 },
      { appKey: "inline-2", displayMode: "inline", lastTouchedAt: 4 },
      { appKey: "inline-3", displayMode: "inline", lastTouchedAt: 5 },
      { appKey: "inline-4", displayMode: "inline", lastTouchedAt: 6 },
      { appKey: "inline-5", displayMode: "inline", lastTouchedAt: 7 },
    ];
    expect(selectEvictableMcpAppKeys(entries, 6)).toEqual(["inline-1"]);
    expect(selectEvictableMcpAppKeys(entries, 4)).toEqual(["inline-1", "inline-2", "inline-3"]);
  });

  it("formats MCP App tab titles from server name and ui:// resource name in Title Case", () => {
    expect(
      formatMcpAppTabTitle({
        server: "github",
        displayName: "GitHub",
        toolName: "get_me",
        resourceUri: "ui://github-mcp-server/get-me",
      }),
    ).toBe("GitHub Get Me");

    expect(
      formatMcpAppTabTitle({
        server: "my-mcp",
        toolName: "open_board",
        resourceUri: "ui://my-mcp/sprint-board.html",
      }),
    ).toBe("My MCP Sprint Board");

    expect(
      formatMcpAppTabTitle({
        server: "github",
        displayName: "GitHub",
        toolName: "issue_write",
        resourceUri: "ui://github-mcp-server/github-issue-write",
      }),
    ).toBe("GitHub Issue Write");
  });

  it("allows multiple concurrent pip windows and multiple concurrent fullscreen tabs", () => {
    const initial = [
      { appKey: "a", displayMode: "pip" },
      { appKey: "b", displayMode: "inline" },
      { appKey: "c", displayMode: "fullscreen" },
    ];
    const promotedPip = computeMcpAppDisplayModesAfterTransition(initial, "b", "pip");
    expect(promotedPip.map((e) => [e.appKey, e.displayMode])).toEqual([
      ["a", "pip"],
      ["b", "pip"],
      ["c", "fullscreen"],
    ]);

    const promotedFs = computeMcpAppDisplayModesAfterTransition(promotedPip, "a", "fullscreen");
    expect(promotedFs.map((e) => [e.appKey, e.displayMode])).toEqual([
      ["a", "fullscreen"],
      ["b", "pip"],
      ["c", "fullscreen"],
    ]);
  });

  it("computes clamped PiP movement, 8-edge resize anchoring, blocked-edge cursors, and global storage", () => {
    const viewport = { width: 1200, height: 800, topInset: 0 };

    const first = computeInitialPipRect(viewport, null, []);
    expect(first).toEqual({ x: 804, y: 384, width: 380, height: 320 });

    const second = computeInitialPipRect(viewport, first, [first]);
    expect(second).toEqual({ x: 780, y: 360, width: 380, height: 320 });

    // Drag clamps safely within viewport margins.
    expect(movePipRect(first, -2000, -2000, viewport)).toEqual({
      x: 8,
      y: 8,
      width: 380,
      height: 320,
    });
    expect(movePipRect(first, 2000, 2000, viewport)).toEqual({
      x: 812,
      y: 472,
      width: 380,
      height: 320,
    });

    // West edge resize anchors the right edge (x + width stays constant) and clamps at minWidth.
    const start = { x: 400, y: 200, width: 380, height: 320 };
    const shrunkW = resizePipRect(start, "w", 500, 0, viewport);
    expect(shrunkW.width).toBe(MCP_APP_PIP_MIN_WIDTH_PX);
    expect(shrunkW.x + shrunkW.width).toBe(start.x + start.width);
    expect(pipResizeEdgeCursor(shrunkW, "w", viewport)).toBe("w-resize");

    // North edge resize anchors the bottom edge (y + height stays constant) and flips cursor when pinned at top.
    const pinnedTop = resizePipRect(start, "n", 0, -500, viewport);
    expect(pinnedTop.y).toBe(8);
    expect(pinnedTop.y + pinnedTop.height).toBe(start.y + start.height);
    expect(pipResizeEdgeCursor(pinnedTop, "n", viewport)).toBe("s-resize");

    // East edge at min width shows e-resize; pinned to right viewport border shows w-resize; middle shows col-resize.
    expect(pipResizeEdgeCursor(start, "e", viewport)).toBe("col-resize");
    const minE = resizePipRect(start, "e", -500, 0, viewport);
    expect(minE.width).toBe(MCP_APP_PIP_MIN_WIDTH_PX);
    expect(pipResizeEdgeCursor(minE, "e", viewport)).toBe("e-resize");
    const maxE = resizePipRect(start, "e", 2000, 0, viewport);
    expect(maxE.x + maxE.width).toBe(viewport.width - 8);
    expect(pipResizeEdgeCursor(maxE, "e", viewport)).toBe("w-resize");

    // South edge at min height shows s-resize; middle shows row-resize; pinned bottom shows n-resize.
    expect(pipResizeEdgeCursor(start, "s", viewport)).toBe("row-resize");
    const minS = resizePipRect(start, "s", 0, -500, viewport);
    expect(minS.height).toBe(MCP_APP_PIP_MIN_HEIGHT_PX);
    expect(pipResizeEdgeCursor(minS, "s", viewport)).toBe("s-resize");
    const maxS = resizePipRect(start, "s", 0, 2000, viewport);
    expect(maxS.y + maxS.height).toBe(viewport.height - 8);
    expect(pipResizeEdgeCursor(maxS, "s", viewport)).toBe("n-resize");

    // Corner cursors.
    expect(pipResizeEdgeCursor(start, "nw", viewport)).toBe("nwse-resize");
    expect(pipResizeEdgeCursor(start, "se", viewport)).toBe("nwse-resize");
    expect(pipResizeEdgeCursor(start, "ne", viewport)).toBe("nesw-resize");
    expect(pipResizeEdgeCursor(start, "sw", viewport)).toBe("nesw-resize");

    // Global storage round-trip + clamp on smaller viewport.
    const bag = new Map();
    const storage = {
      getItem: (k) => bag.get(k) ?? null,
      setItem: (k, v) => {
        bag.set(k, v);
      },
    };
    writeMcpAppPipGeometry({ x: 120.4, y: 80.6, width: 512.2, height: 400.7 }, storage);
    expect(readMcpAppPipGeometry(storage)).toEqual({ x: 120, y: 81, width: 512, height: 401 });
    expect(
      clampPipRect({ x: 900, y: 700, width: 512, height: 401 }, { width: 600, height: 500 }),
    ).toEqual({
      x: 80,
      y: 91,
      width: 512,
      height: 401,
    });
  });

  it("persists and restores fullscreen/pip window state in sessionStorage cleanly", () => {
    const bag = new Map();
    const storage = {
      getItem: (k) => bag.get(k) ?? null,
      setItem: (k, v) => {
        bag.set(k, v);
      },
      removeItem: (k) => {
        bag.delete(k);
      },
    };

    setMcpAppWindowEntryMode(
      {
        entryKey: "sess-1::tc-1",
        appKey: "tc-1",
        sessionKey: "sess-1",
        displayMode: "fullscreen",
        tabTitle: "GitHub Get Me",
        tabSessionKey: "sess-1",
      },
      storage,
    );
    const restored = buildRestoredMcpAppFullscreenTabs(storage);
    expect(restored.tabs).toHaveLength(1);
    expect(restored.tabs[0]).toMatchObject({
      id: "mcp-app:sess-1::tc-1",
      kind: "mcp-app",
      instanceKey: "sess-1::tc-1",
      tabTitle: "GitHub Get Me",
      sessionKey: "sess-1",
    });
    expect(restored.activeTabId).toBe("mcp-app:sess-1::tc-1");

    setActiveMcpAppFullscreenTabId(null, storage);
    expect(buildRestoredMcpAppFullscreenTabs(storage).activeTabId).toBeNull();

    clearMcpAppWindowEntry("sess-1::tc-1", storage);
    expect(readMcpAppWindowState(storage)).toEqual({ entries: {}, activeFullscreenTabId: null });
    expect(bag.size).toBe(0);
  });

  it("moves nodes atomically with moveBefore when connected and falls back to appendChild", () => {
    const calls = [];
    const moved = { parentNode: null, isConnected: true };
    const targetWithMoveBefore = {
      isConnected: true,
      moveBefore(node, ref) {
        calls.push(["moveBefore", node, ref]);
        node.parentNode = targetWithMoveBefore;
      },
      appendChild(node) {
        calls.push(["appendChild", node]);
        node.parentNode = targetWithMoveBefore;
      },
    };

    atomicMoveNode(targetWithMoveBefore, moved);
    expect(calls).toEqual([["moveBefore", moved, null]]);

    // No-op when already in targetParent.
    atomicMoveNode(targetWithMoveBefore, moved);
    expect(calls).toHaveLength(1);

    // Falls back to appendChild when node is not connected yet or browser lacks moveBefore.
    const disconnected = { parentNode: null, isConnected: false };
    atomicMoveNode(targetWithMoveBefore, disconnected);
    expect(calls[1]).toEqual(["appendChild", disconnected]);

    const legacyTarget = {
      isConnected: true,
      appendChild(node) {
        calls.push(["legacyAppendChild", node]);
        node.parentNode = legacyTarget;
      },
    };
    atomicMoveNode(legacyTarget, moved);
    expect(calls[2]).toEqual(["legacyAppendChild", moved]);
  });

  it("keeps MCP App tool messages uncollapsed outside process groups", () => {
    const items = buildConversationRenderItems([
      {
        id: 1,
        role: "assistant",
        content: "",
        tool: {
          toolCallId: "tc-read-1",
          toolName: "read_file",
          phase: "succeeded",
          headline: "Read a.ts",
          detailLines: [],
        },
      },
      {
        id: 2,
        role: "assistant",
        content: "",
        tool: {
          toolCallId: "tc-read-2",
          toolName: "read_file",
          phase: "succeeded",
          headline: "Read b.ts",
          detailLines: [],
        },
      },
      {
        id: 3,
        role: "assistant",
        content: "",
        tool: {
          toolCallId: "tc-app",
          toolName: "mcp__fixture__inspect",
          phase: "succeeded",
          headline: "Inspect Panel",
          detailLines: [],
          mcpApp: {
            server: "fixture",
            displayName: "Inspect Panel",
            toolName: "inspect",
            resourceUri: "ui://fixture/panel",
          },
        },
      },
      {
        id: 4,
        role: "assistant",
        content: "Here is the interactive view.",
      },
    ]);

    expect(items.map((item) => item.kind)).toEqual(["process-group", "message", "message"]);
    expect(items[1]).toEqual({ kind: "message", messageIndex: 2 });
  });
});
