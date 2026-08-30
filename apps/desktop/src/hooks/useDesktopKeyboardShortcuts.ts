import { useEffect, type MutableRefObject } from "react";

import type { SessionSidebarChromeApi } from "@/contexts/session-sidebar-chrome-context";
import { useWorkspaceToolsChromeActions } from "@/contexts/workspace-tools-chrome-context";
import type { useDesktopRuntime } from "@/hooks/useDesktopRuntime";
import { resolveModelPickerToOpen } from "@/lib/model-picker-shortcut-bridge";
import {
  desktopShellPlatform,
  isModAltShortcutPressed,
  isModShortcutPressed,
} from "@/lib/desktop-shell";
import {
  isEditableShortcutTarget,
  resolveModCommaSettingsShortcutAction,
  resolveModBackslashSplitShortcutAction,
  resolveModPShortcutAction,
  resolveModTNewToolTabShortcutAction,
  shouldTriggerConversationAbortShortcut,
  shouldTriggerSettingsEscapeShortcut,
} from "@/lib/desktop-keyboard-shortcut-eligibility";
import { triggerWorkspaceNewToolTabShortcut } from "@/lib/workspace-new-tool-tab-shortcut-bridge";
import { triggerSplitPaneShortcut } from "@/lib/split-pane-shortcut-bridge";
import { resolveUiLayoutZoomShortcutAction } from "@/lib/ui-layout-scale";
import type { AppSurface } from "@/hooks/useAppSurfaceNavigation";
import type { ConversationAbortShortcutTargetRef } from "@/lib/conversation-abort-shortcut";

type DesktopRuntime = ReturnType<typeof useDesktopRuntime>;

export type UiLayoutScaleShortcutApi = {
  zoomIn: () => void;
  zoomOut: () => void;
  resetScale: () => void;
};

function applyUiLayoutZoomAction(
  action: "in" | "out" | "reset",
  api: UiLayoutScaleShortcutApi,
): void {
  if (action === "in") {
    api.zoomIn();
    return;
  }
  if (action === "out") {
    api.zoomOut();
    return;
  }
  api.resetScale();
}

export type UseDesktopKeyboardShortcutsOptions = {
  runtime: DesktopRuntime;
  activeSurfaceRef: MutableRefObject<AppSurface>;
  conversationAbortShortcutEligibleRef: MutableRefObject<boolean>;
  conversationAbortShortcutTargetRef?: ConversationAbortShortcutTargetRef;
  sessionSidebarChromeApiRef: MutableRefObject<SessionSidebarChromeApi | null>;
  handleNewSession: () => void;
  handleOpenSettings: () => void;
  handleCloseSettings: () => void;
  setActionPickerOpen: (open: boolean) => void;
  setFilePickerOpen: (open: boolean) => void;
  uiLayoutScaleApi: UiLayoutScaleShortcutApi;
};

export function useDesktopKeyboardShortcuts({
  runtime,
  activeSurfaceRef,
  conversationAbortShortcutEligibleRef,
  conversationAbortShortcutTargetRef,
  sessionSidebarChromeApiRef,
  handleNewSession,
  handleOpenSettings,
  handleCloseSettings,
  setActionPickerOpen,
  setFilePickerOpen,
  uiLayoutScaleApi,
}: UseDesktopKeyboardShortcutsOptions) {
  const { setOpen: setWorkspaceToolsOpen } = useWorkspaceToolsChromeActions();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }
      if (!isModShortcutPressed(event) || event.key !== "/") {
        return;
      }
      const picker = resolveModelPickerToOpen();
      if (!picker) {
        return;
      }
      event.preventDefault();
      picker.open();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Cmd+B must run in capture: Lexical's $handleKeyDown preventDefaults exact
  // Mod+B (bold) on the editor root before any window bubble listener can toggle.
  // Other host shortcuts stay on bubble so inner surfaces can veto via preventDefault.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }
      if (event.altKey) {
        return;
      }
      if (!isModShortcutPressed(event) || event.key.toLowerCase() !== "b") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      sessionSidebarChromeApiRef.current?.toggle();
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [sessionSidebarChromeApiRef]);

  // Cmd+Opt+B is not stolen by Lexical (isBold requires an exact modifier match).
  // Capture here is pairing with Cmd+B, not a necessity for the same bug.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }
      if (!isModAltShortcutPressed(event)) {
        return;
      }
      if (event.code !== "KeyB") {
        return;
      }
      if (activeSurfaceRef.current !== "conversation") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setWorkspaceToolsOpen((current) => !current);
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [activeSurfaceRef, setWorkspaceToolsOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = resolveModTNewToolTabShortcutAction(
        {
          defaultPrevented: event.defaultPrevented,
          key: event.key,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
          modPressed: isModShortcutPressed(event),
        },
        { activeSurface: activeSurfaceRef.current },
      );
      if (!action) {
        return;
      }
      if (!triggerWorkspaceNewToolTabShortcut()) {
        return;
      }
      event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeSurfaceRef]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = resolveModBackslashSplitShortcutAction(
        {
          defaultPrevented: event.defaultPrevented,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
          code: event.code,
          target: event.target,
          modPressed: isModShortcutPressed(event),
        },
        { activeSurface: activeSurfaceRef.current },
      );
      if (!action) {
        return;
      }
      const direction = action === "split-down" ? "vertical" : "horizontal";
      if (!triggerSplitPaneShortcut(direction)) {
        return;
      }
      event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeSurfaceRef]);

  // Physical Ctrl+C — abort the in-flight turn; composer may still have draft text.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        !shouldTriggerConversationAbortShortcut(event, {
          activeSurface: activeSurfaceRef.current,
          conversationAbortShortcutEligible:
            conversationAbortShortcutTargetRef?.current.eligible ??
            conversationAbortShortcutEligibleRef.current,
        })
      ) {
        return;
      }
      event.preventDefault();
      const sessionPath = conversationAbortShortcutTargetRef?.current.sessionPath?.trim();
      void runtime.abortConversation(sessionPath ? { sessionPath } : undefined);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    activeSurfaceRef,
    conversationAbortShortcutEligibleRef,
    conversationAbortShortcutTargetRef,
    runtime.abortConversation,
  ]);

  // Cmd/Ctrl+N — global new session (macOS menu accelerator handles this; skip here).
  useEffect(() => {
    if (desktopShellPlatform() === "darwin") {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }
      if (!isModShortcutPressed(event) || event.key.toLowerCase() !== "n") {
        return;
      }
      if (isEditableShortcutTarget(event.target as HTMLElement | null)) {
        return;
      }
      event.preventDefault();
      handleNewSession();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleNewSession]);

  useEffect(() => {
    const bridge = window.spiritDesktop;
    if (!bridge?.subscribeNewSession) {
      return;
    }
    return bridge.subscribeNewSession(handleNewSession);
  }, [handleNewSession]);

  // Cmd/Ctrl+, — open settings (macOS menu accelerator handles this; skip here).
  useEffect(() => {
    if (desktopShellPlatform() === "darwin") {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const action = resolveModCommaSettingsShortcutAction(
        {
          defaultPrevented: event.defaultPrevented,
          key: event.key,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
          modPressed: isModShortcutPressed(event),
          target: event.target,
        },
        { activeSurface: activeSurfaceRef.current },
      );
      if (!action) {
        return;
      }
      event.preventDefault();
      handleOpenSettings();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeSurfaceRef, handleOpenSettings]);

  useEffect(() => {
    const bridge = window.spiritDesktop;
    if (!bridge?.subscribeOpenSettings) {
      return;
    }
    return bridge.subscribeOpenSettings(handleOpenSettings);
  }, [handleOpenSettings]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        !shouldTriggerSettingsEscapeShortcut(event, {
          activeSurface: activeSurfaceRef.current,
        })
      ) {
        return;
      }
      event.preventDefault();
      handleCloseSettings();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeSurfaceRef, handleCloseSettings]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = resolveModPShortcutAction({
        defaultPrevented: event.defaultPrevented,
        key: event.key,
        shiftKey: event.shiftKey,
        modPressed: isModShortcutPressed(event),
      });
      if (!action) {
        return;
      }
      event.preventDefault();
      if (action === "action-picker") {
        setActionPickerOpen(true);
        return;
      }
      setFilePickerOpen(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setActionPickerOpen, setFilePickerOpen]);

  // Cmd/Ctrl+= / - / 0 — UI layout zoom (macOS menu accelerator handles this; skip here).
  useEffect(() => {
    if (desktopShellPlatform() === "darwin") {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        document.querySelector('[data-spirit-surface="workspace-image-preview"]')?.contains(target)
      ) {
        return;
      }
      const action = resolveUiLayoutZoomShortcutAction({
        defaultPrevented: event.defaultPrevented,
        modPressed: isModShortcutPressed(event),
        altKey: event.altKey,
        key: event.key,
      });
      if (!action) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      applyUiLayoutZoomAction(action, uiLayoutScaleApi);
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [uiLayoutScaleApi.zoomIn, uiLayoutScaleApi.zoomOut, uiLayoutScaleApi.resetScale]);

  useEffect(() => {
    const bridge = window.spiritDesktop;
    if (!bridge?.subscribeUiLayoutZoom) {
      return;
    }
    return bridge.subscribeUiLayoutZoom((action) => {
      applyUiLayoutZoomAction(action, uiLayoutScaleApi);
    });
  }, [uiLayoutScaleApi.zoomIn, uiLayoutScaleApi.zoomOut, uiLayoutScaleApi.resetScale]);
}
