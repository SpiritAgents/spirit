import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import type { TFunction } from "i18next";

import type { SessionSidebarChromeApi } from "@/contexts/session-sidebar-chrome-context";
import type { SettingsSidebarTab } from "@/components/session-sidebar";
import type { useDesktopRuntime } from "@/hooks/useDesktopRuntime";
import { resolveEffectiveEmptySession } from "@/lib/conversation-empty-session";
import {
  resolveSessionNavPending,
  type SessionNavTarget,
} from "@/lib/conversation-navigation-pending";
import { normalizeSessionPathKey } from "@/lib/session-path-kind";
import type { FocusedPaneComposerControls } from "@/lib/focused-pane-composer-controls";
import { sameWorkspacePath } from "@/lib/workspace-display-label";
import type { DesktopSnapshot } from "@/types";

type DesktopRuntime = ReturnType<typeof useDesktopRuntime>;

export type AppSurface =
  | "conversation"
  | "settings"
  | "marketplace"
  | "automations"
  | "automation-detail";

export type NonSettingsSurface = "conversation" | "marketplace" | "automations";

type PendingSessionNav = SessionNavTarget & { fromSurface: AppSurface };

export type UseAppSurfaceNavigationOptions = {
  runtime: DesktopRuntime;
  snapshot: DesktopSnapshot | null;
  sessionMessages: DesktopSnapshot["conversation"]["messages"];
  subagentViewActive: boolean;
  compactionDemoActive: boolean;
  longConversationListDemoActive: boolean;
  approvalPreviewDemoActive: boolean;
  newChatBusy: boolean;
  t: TFunction;
  composerAutomationApiRef?: MutableRefObject<FocusedPaneComposerControls | null>;
};

export function useAppSurfaceNavigation({
  runtime,
  snapshot,
  sessionMessages,
  subagentViewActive,
  compactionDemoActive,
  longConversationListDemoActive,
  approvalPreviewDemoActive,
  newChatBusy,
  t,
  composerAutomationApiRef,
}: UseAppSurfaceNavigationOptions) {
  const [activeSurface, setActiveSurface] = useState<AppSurface>("conversation");
  const activeSurfaceRef = useRef(activeSurface);
  activeSurfaceRef.current = activeSurface;

  const [sessionNavTarget, setSessionNavTarget] = useState<PendingSessionNav | null>(null);
  const sessionNavTargetRef = useRef<PendingSessionNav | null>(null);
  const updateSessionNavTarget = useCallback((next: PendingSessionNav | null) => {
    sessionNavTargetRef.current = next;
    setSessionNavTarget(next);
  }, []);
  const [lastNonSettingsSurface, setLastNonSettingsSurface] =
    useState<NonSettingsSurface>("conversation");
  const [selectedAutomationId, setSelectedAutomationId] = useState<string | null>(null);
  const [createAutomationDialogOpen, setCreateAutomationDialogOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsSidebarTab>("models");
  const [extensionSettingsId, setExtensionSettingsId] = useState<string | null>(null);
  const sessionSidebarChromeApiRef = useRef<SessionSidebarChromeApi | null>(null);

  const sessionNavPending = resolveSessionNavPending({ navTarget: sessionNavTarget, snapshot });

  // The intent is fulfilled once the snapshot shows the target session; clear it
  // so a later foreground change (new chat, delete-and-open-next) is not mistaken
  // for this navigation still being in flight.
  useEffect(() => {
    if (sessionNavTarget && !sessionNavPending) {
      updateSessionNavTarget(null);
    }
  }, [sessionNavTarget, sessionNavPending, updateSessionNavTarget]);

  const settingsMode = activeSurface === "settings";
  const marketplaceMode = activeSurface === "marketplace";
  const automationsMode = activeSurface === "automations" || activeSurface === "automation-detail";
  const automationDetailMode = activeSurface === "automation-detail";
  const preserveConversationSurface =
    activeSurface === "conversation" || (settingsMode && lastNonSettingsSurface === "conversation");

  const isEmptySession = resolveEffectiveEmptySession({
    sessionMessageCount: sessionMessages.length,
    subagentViewActive,
    compactionDemoActive,
    longConversationListDemoActive,
    approvalPreviewDemoActive,
    newChatBusy,
  });

  const handleNewChat = useCallback(() => {
    if (runtime.busyAction === "reset") {
      return;
    }
    updateSessionNavTarget(null);
    setLastNonSettingsSurface("conversation");
    setActiveSurface("conversation");
    void runtime.resetSession();
  }, [runtime, updateSessionNavTarget]);

  const handleNewChatInWorkspace = useCallback(
    async (workspaceRoot: string) => {
      const trimmed = workspaceRoot.trim();
      if (!trimmed) {
        return;
      }

      updateSessionNavTarget(null);
      setLastNonSettingsSurface("conversation");
      setActiveSurface("conversation");

      const currentRoot = snapshot?.workspaceRoot?.trim() ?? "";
      const needsSwitch =
        snapshot?.workspaceBinding !== "project" ||
        !currentRoot ||
        !sameWorkspacePath(currentRoot, trimmed);

      if (needsSwitch) {
        const switched = await runtime.switchWorkspaceRoot(trimmed);
        if (!switched) {
          return;
        }
      }

      await runtime.resetSession();
    },
    [runtime, snapshot?.workspaceBinding, snapshot?.workspaceRoot, updateSessionNavTarget],
  );

  const beginSessionNavigation = useCallback(
    (path: string) => {
      // Re-clicking the foreground session is a plain surface switch: its data
      // is already on screen, so there is nothing to freeze on. Opening it again
      // would also fulfill the intent at birth (navPending is false from the
      // start), which used to eat the intent before openSession resolved and
      // leave the page stuck.
      const activePath = snapshot?.activeSession?.filePath;
      if (activePath && normalizeSessionPathKey(activePath) === normalizeSessionPathKey(path)) {
        setLastNonSettingsSurface("conversation");
        setActiveSurface("conversation");
        return;
      }
      const intent: PendingSessionNav = { path, fromSurface: activeSurfaceRef.current };
      updateSessionNavTarget(intent);
      void runtime.openSession(path).then((opened) => {
        if (sessionNavTargetRef.current !== intent) {
          return; // superseded by a newer navigation intent, which owns the outcome
        }
        if (!opened) {
          updateSessionNavTarget(null);
          return;
        }
        // Freeze navigation: switch only once the target session's snapshot has
        // landed, and only if the user has not headed to another page meanwhile.
        if (activeSurfaceRef.current === intent.fromSurface) {
          setLastNonSettingsSurface("conversation");
          setActiveSurface("conversation");
          return;
        }
        updateSessionNavTarget(null);
      });
    },
    [runtime, snapshot, updateSessionNavTarget],
  );

  const handlePrefillComposerSkillChip = useCallback(
    (skillName: string) => {
      setLastNonSettingsSurface("conversation");
      setActiveSurface("conversation");
      queueMicrotask(() => {
        composerAutomationApiRef?.current?.prefillSkillChip(skillName);
      });
    },
    [composerAutomationApiRef, setActiveSurface, setLastNonSettingsSurface],
  );

  const handleGenerateAutomation = useCallback(async () => {
    updateSessionNavTarget(null);
    setLastNonSettingsSurface("conversation");
    setActiveSurface("conversation");
    const seed = t("automations.generateComposerSeed");
    const resetOk = await runtime.resetSession({ composerSeed: seed });
    if (!resetOk) {
      return;
    }
    const composerApi = composerAutomationApiRef?.current;
    composerApi?.setSlashSelectedIndex(-1);
    queueMicrotask(() => {
      composerApi?.focusComposer();
    });
  }, [composerAutomationApiRef, runtime, t, updateSessionNavTarget]);

  const handleOpenSettings = useCallback(() => {
    sessionSidebarChromeApiRef.current?.openSidebar();
    const current = activeSurfaceRef.current;
    if (current !== "settings") {
      setLastNonSettingsSurface(
        current === "marketplace"
          ? "marketplace"
          : current === "automations" || current === "automation-detail"
            ? "automations"
            : "conversation",
      );
    }
    setActiveSurface("settings");
  }, []);

  const handleCloseSettings = useCallback(() => {
    if (activeSurfaceRef.current !== "settings") {
      return;
    }
    setActiveSurface(lastNonSettingsSurface);
  }, [lastNonSettingsSurface]);

  const extensionSettingsItems = useMemo(
    () =>
      (snapshot?.extensionsList ?? [])
        .filter((item) => item.enabled && item.desktopSettingsPage)
        .map((item) => ({
          id: item.id,
          label: item.desktopSettingsPage?.title ?? item.displayName,
        })),
    [snapshot?.extensionsList],
  );

  return {
    activeSurface,
    setActiveSurface,
    activeSurfaceRef,
    beginSessionNavigation,
    lastNonSettingsSurface,
    setLastNonSettingsSurface,
    selectedAutomationId,
    setSelectedAutomationId,
    createAutomationDialogOpen,
    setCreateAutomationDialogOpen,
    settingsTab,
    setSettingsTab,
    extensionSettingsId,
    setExtensionSettingsId,
    sessionSidebarChromeApiRef,
    settingsMode,
    marketplaceMode,
    automationsMode,
    automationDetailMode,
    preserveConversationSurface,
    isEmptySession,
    handleNewChat,
    handleNewChatInWorkspace,
    handleGenerateAutomation,
    handlePrefillComposerSkillChip,
    handleOpenSettings,
    handleCloseSettings,
    extensionSettingsItems,
  };
}
