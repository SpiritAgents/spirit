/** @vitest-environment jsdom */

import "./setup";

import { act, render } from "@testing-library/react";
import { StrictMode, useRef } from "react";
import { describe, expect, test, vi } from "vitest";

import {
  useConversationSessionFocusComposer,
  type UseConversationSessionFocusComposerOptions,
} from "@/hooks/useConversationSessionFocusComposer";

async function flushScheduledFocus(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => {
      queueMicrotask(() => resolve());
    });
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  });
}

function FocusProbe(props: UseConversationSessionFocusComposerOptions) {
  useConversationSessionFocusComposer(props);
  return null;
}

describe("useConversationSessionFocusComposer", () => {
  test("focuses when the conversation surface is entered", async () => {
    const focusComposer = vi.fn();
    render(
      <StrictMode>
        <FocusProbe
          composerSessionKey="session-a"
          focusComposer={focusComposer}
          surfaceActive
          ready
        />
      </StrictMode>,
    );

    await flushScheduledFocus();

    expect(focusComposer).toHaveBeenCalled();
  });

  test("does not focus again when in-page navigation settles on the same session", async () => {
    const focusComposer = vi.fn();
    const props = {
      composerSessionKey: "session-a",
      focusComposer,
      surfaceActive: true,
      ready: true,
    };
    const { rerender } = render(
      <StrictMode>
        <FocusProbe {...props} />
      </StrictMode>,
    );
    await flushScheduledFocus();
    focusComposer.mockClear();

    rerender(
      <StrictMode>
        <FocusProbe {...props} ready={false} />
      </StrictMode>,
    );
    await flushScheduledFocus();
    rerender(
      <StrictMode>
        <FocusProbe {...props} ready />
      </StrictMode>,
    );
    await flushScheduledFocus();

    expect(focusComposer).not.toHaveBeenCalled();
  });

  test("focuses again when the same session returns from another surface", async () => {
    const focusComposer = vi.fn();
    const props = {
      composerSessionKey: "session-a",
      focusComposer,
      surfaceActive: true,
      ready: true,
    };
    const { rerender } = render(
      <StrictMode>
        <FocusProbe {...props} />
      </StrictMode>,
    );
    await flushScheduledFocus();
    focusComposer.mockClear();

    rerender(
      <StrictMode>
        <FocusProbe {...props} surfaceActive={false} />
      </StrictMode>,
    );
    await flushScheduledFocus();
    expect(focusComposer).not.toHaveBeenCalled();

    rerender(
      <StrictMode>
        <FocusProbe {...props} surfaceActive />
      </StrictMode>,
    );
    await flushScheduledFocus();

    expect(focusComposer).toHaveBeenCalled();
  });

  test("focuses the pane that is current when the surface is re-entered", async () => {
    const left = vi.fn();
    const right = vi.fn();
    function SplitProbe({
      surfaceActive,
      focusedPane,
    }: {
      surfaceActive: boolean;
      focusedPane: "left" | "right";
    }) {
      const focusedPaneRef = useRef(focusedPane);
      focusedPaneRef.current = focusedPane;
      useConversationSessionFocusComposer({
        composerSessionKey: "session-a",
        surfaceActive,
        ready: true,
        focusComposer: () => {
          if (focusedPaneRef.current === "left") {
            left();
            return;
          }
          right();
        },
      });
      return null;
    }

    const { rerender } = render(
      <StrictMode>
        <SplitProbe surfaceActive focusedPane="left" />
      </StrictMode>,
    );
    await flushScheduledFocus();
    expect(left).toHaveBeenCalled();
    left.mockClear();

    rerender(
      <StrictMode>
        <SplitProbe surfaceActive={false} focusedPane="right" />
      </StrictMode>,
    );
    await flushScheduledFocus();
    rerender(
      <StrictMode>
        <SplitProbe surfaceActive focusedPane="right" />
      </StrictMode>,
    );
    await flushScheduledFocus();

    expect(right).toHaveBeenCalled();
    expect(left).not.toHaveBeenCalled();
  });

  test("focuses when the composer session changes without leaving the page", async () => {
    const focusComposer = vi.fn();
    const props = {
      composerSessionKey: "session-a",
      focusComposer,
      surfaceActive: true,
      ready: true,
    };
    const { rerender } = render(
      <StrictMode>
        <FocusProbe {...props} />
      </StrictMode>,
    );
    await flushScheduledFocus();
    focusComposer.mockClear();

    rerender(
      <StrictMode>
        <FocusProbe {...props} composerSessionKey="session-b" />
      </StrictMode>,
    );
    await flushScheduledFocus();

    expect(focusComposer).toHaveBeenCalled();
  });
});
