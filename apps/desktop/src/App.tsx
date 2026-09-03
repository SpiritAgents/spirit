import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { SessionSidebarChromeProvider } from "@/contexts/session-sidebar-chrome-context";
import { ActionPickerDialog } from "@/components/action-picker-dialog";
import { AutomationDetailView } from "@/components/automation-detail-view";
import { AutomationsView } from "@/components/automations-view";
import { ConversationPaneHost } from "@/components/conversation/conversation-pane-host";
import { ConversationSplitRoot } from "@/components/conversation/conversation-split-root";
import { ConversationWorkspaceToolsDock } from "@/components/conversation/conversation-workspace-tools-dock";
import { ConversationSplitProvider } from "@/contexts/conversation-split-context";
import { CreateAutomationDialog } from "@/components/create-automation-dialog";
import { DesktopTitleBar } from "@/components/desktop-title-bar";
import { DesktopLayoutChromeBar } from "@/components/layout/desktop-layout-chrome-bar";
import { LaunchSplash } from "@/components/launch-splash";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import { MarketplaceView } from "@/components/marketplace-view";
import { SessionSidebar } from "@/components/session-sidebar";
import { SessionSidebarShell } from "@/components/session-sidebar-shell";
import { SettingsView } from "@/components/settings-view";
import { WebHostPairingGate } from "@/components/web-host-pairing-gate";
import { WorkspaceCapabilityTrustDialog } from "@/components/workspace-capability-trust-dialog";
import { WorkspaceFilePickerDialog } from "@/components/workspace-file-picker-dialog";
import { WorkspaceMarkdownLinkProvider } from "@/components/workspace-markdown-link-context";
import { useAppSurfaceNavigation } from "@/hooks/useAppSurfaceNavigation";
import { useClickablePointerCursor } from "@/hooks/useClickablePointerCursor";
import { useCompactionUiDemo } from "@/hooks/useCompactionUiDemo";
import { useFontSmoothing } from "@/hooks/useFontSmoothing";
import { useLongConversationListDemo } from "@/hooks/useLongConversationListDemo";
import { useComposerController } from "@/hooks/useComposerController";
import { ConversationSessionFocusComposerBridge } from "@/components/conversation/conversation-session-focus-composer-bridge";
import { ConversationTypingFocusRedirectBridge } from "@/components/conversation/conversation-typing-focus-redirect-bridge";
import type { FocusedPaneComposerControls } from "@/lib/focused-pane-composer-controls";
import { useConversationViewState } from "@/hooks/useConversationViewState";
import type { ConversationAbortShortcutTarget } from "@/lib/conversation-abort-shortcut";
import { useUiLayoutScale } from "@/hooks/useUiLayoutScale";
import { useDesktopKeyboardShortcuts } from "@/hooks/useDesktopKeyboardShortcuts";
import { useDesktopRuntime } from "@/hooks/useDesktopRuntime";
import { useDesktopRuntimeErrorToast } from "@/hooks/use-desktop-runtime-error-toast";
import { useDesktopQuestionErrorToast } from "@/hooks/use-desktop-question-error-toast";
import { useDesktopShellEffects } from "@/hooks/useDesktopShellEffects";
import { useSettledSidebarActivePath } from "@/hooks/use-settled-sidebar-active-path";
import { useFont } from "@/hooks/useFont";
import { useMessageRewind } from "@/hooks/useMessageRewind";
import { useSubagentViewer } from "@/hooks/useSubagentViewer";
import { useThemeSetter } from "@/hooks/useTheme";
import { useGitHubAuthConnected } from "@/hooks/use-github-auth-connected";
import { useWorkspaceToolsController } from "@/hooks/useWorkspaceToolsController";
import {
  desktopTranslucencyTintClass,
  desktopTranslucencyTintInnerClass,
} from "@/lib/desktop-translucency-surface";
import {
  isDarwinElectronShell,
  isElectronChrome,
  isWin32ElectronShell,
  readStoredOnboardingCompleted,
  resolveUseContentTranslucency,
  resolveUseTranslucency,
  syncLaunchSplashChromeToDocument,
  type ShellOverlayPhase,
} from "@/lib/desktop-shell";
import { isMarkdownPath } from "@/lib/file-picker-path";
import {
  isWorkspaceReferenceDirectoryPath,
  normalizeWorkspaceReferenceDirectoryPath,
} from "@spiritagent/host-internal/workspace-file-reference-query";
import { tryHandleDesktopWorkspaceLink } from "@/lib/workspace-navigation-link";
import { tryHandleMarkdownWorkspaceLink } from "@/lib/markdown-workspace-link";
import { applyUiLayoutScaleToDocument, UI_LAYOUT_SCALE_ROOT_ID } from "@/lib/ui-layout-scale";
import {
  resolveLaunchSplashActive,
  resolveOnboardingCompletedKnown,
  resolveOnboardingVisible,
} from "@/lib/onboarding";
import { cn } from "@/lib/utils";

export default function App() {
  const { t, i18n } = useTranslation();
  // Subscribe only to the constant-reference setter: App does not re-render on theme value changes (a full re-render of the invisible app-body measured 40–55ms)
  useThemeSetter();
  const { font, setFont } = useFont();
  const { clickablePointerCursor, setClickablePointerCursor } = useClickablePointerCursor();
  const { fontSmoothing, setFontSmoothing } = useFontSmoothing();
  const uiLayoutScale = useUiLayoutScale();
  const runtime = useDesktopRuntime();
  useDesktopRuntimeErrorToast(runtime.runtimeError);
  useDesktopQuestionErrorToast(runtime.questionError);
  const snapshot = runtime.snapshot;
  /** Decoupled from the Host API `kind`: the shell may be Electron while still going through the Web Host via a Vite proxy (the sidebar would show Localhost Web Host). translucency and `spirit-desktop-native` should still apply to the Electron window. */
  const isElectronShell = isElectronChrome();
  const winElectronChrome = isWin32ElectronShell();
  const darwinElectronChrome = isDarwinElectronShell();
  const desktopTitleBarChrome = winElectronChrome || darwinElectronChrome;
  // Read from disk while the snapshot is not ready, so the settings default cannot
  // wrongly enable transparency/material during the launch overlay
  const translucencySetting = snapshot != null ? runtime.settings.translucency : undefined;
  const useTranslucency = resolveUseTranslucency(translucencySetting);
  const useContentTranslucency = resolveUseContentTranslucency(translucencySetting);

  useDesktopShellEffects({
    isElectronShell,
    darwinElectronChrome,
    useTranslucency,
    extensionCss: snapshot?.extensionCss,
  });

  const compactionDemo = useCompactionUiDemo();
  const longConversationListDemo = useLongConversationListDemo();
  const subagentViewer = useSubagentViewer(runtime.setSubagentViewerTarget);
  const subagentViewActive = subagentViewer.active && Boolean(snapshot?.subagentViewer);
  const sessionMessages = snapshot?.conversation.messages ?? [];
  const sessionNavigationBusy = runtime.busyAction === "session";
  const newSessionBusy = runtime.busyAction === "reset";
  const conversationNavigationPending = sessionNavigationBusy || runtime.layoutNavigationPending;
  const activeFilePath =
    runtime.hostKind === "web"
      ? (runtime.viewingSessionPath ?? snapshot?.activeSession?.filePath ?? null)
      : (snapshot?.activeSession?.filePath ?? null);
  const sidebarActiveFilePath = useSettledSidebarActivePath(
    activeFilePath,
    conversationNavigationPending,
  );
  const composerAutomationApiRef = useRef<FocusedPaneComposerControls | null>(null);
  const beginSideChatRef = useRef<(() => void) | null>(null);
  const registerBeginSideChat = useCallback((handler: (() => void) | null) => {
    beginSideChatRef.current = handler;
  }, []);
  const conversationAbortShortcutTargetRef = useRef<ConversationAbortShortcutTarget>({
    eligible: false,
  });

  // Hook order is intentional — do not reorder without checking cross-hook deps:
  // 1. surfaceNav — session surface routing; handleGenerateAutomation reads composerAutomationApiRef
  // 2. conversation — message list / pending approval state consumed by composer + rewind
  // 3. workspaceTools — independent of composer; safe after conversation
  // 4. composer — needs surfaceNav.isEmptySession + conversation pending flags
  // 5. composerAutomationApiRef effect — bridges composer into surfaceNav (after composer exists)
  // 6. messageRewind — needs composer.messageRewindComposerEnabled
  // 7. keyboard shortcuts — reads refs from surfaceNav / conversation / composer
  const surfaceNav = useAppSurfaceNavigation({
    runtime,
    snapshot,
    sessionMessages,
    subagentViewActive,
    compactionDemoActive: compactionDemo.active,
    longConversationListDemoActive: longConversationListDemo.active,
    sessionNavigationBusy,
    newSessionBusy,
    t,
    composerAutomationApiRef,
  });

  const conversation = useConversationViewState({
    runtime,
    snapshot,
    subagentViewActive,
    subagentViewer,
    compactionDemo,
    longConversationListDemo,
    t,
    language: i18n.language,
    conversationAbortShortcutTargetRef,
  });

  const workspaceTools = useWorkspaceToolsController({
    runtime,
    snapshot,
    activeFilePath,
  });

  const gitHubAuthConnected = useGitHubAuthConnected(
    runtime.getGitHubAuthStatus,
    workspaceTools.prTabEnabled,
  );

  const openIntegrationsSettings = useCallback(() => {
    surfaceNav.handleOpenSettings();
    surfaceNav.setExtensionSettingsId(null);
    surfaceNav.setSettingsTab("integrations");
  }, [surfaceNav]);

  const composer = useComposerController({
    runtime,
    snapshot,
    t,
    isEmptySession: surfaceNav.isEmptySession,
    activeSessionReadOnly: conversation.activeSessionReadOnly,
    compactionDemoActive: compactionDemo.active,
    longConversationListDemoActive: longConversationListDemo.active,
    subagentViewActive,
    pendingApproval: conversation.pendingApproval,
    pendingQuestions: conversation.pendingQuestions,
    conversationInterruptible: conversation.conversationInterruptible,
    handleNewSession: surfaceNav.handleNewSession,
    setActiveSurface: surfaceNav.setActiveSurface,
    setLastNonSettingsSurface: surfaceNav.setLastNonSettingsSurface,
    onBeginSideChat: () => {
      beginSideChatRef.current?.();
    },
  });

  useMessageRewind({
    runtime,
    messages: conversation.messages,
    subagentViewer,
    messageRewindComposerEnabled: composer.messageRewindComposerEnabled,
    activeSessionReadOnly: conversation.activeSessionReadOnly,
  });

  useDesktopKeyboardShortcuts({
    runtime,
    activeSurfaceRef: surfaceNav.activeSurfaceRef,
    conversationAbortShortcutEligibleRef: conversation.conversationAbortShortcutEligibleRef,
    conversationAbortShortcutTargetRef,
    sessionSidebarChromeApiRef: surfaceNav.sessionSidebarChromeApiRef,
    handleNewSession: surfaceNav.handleNewSession,
    handleOpenSettings: surfaceNav.handleOpenSettings,
    handleCloseSettings: surfaceNav.handleCloseSettings,
    setActionPickerOpen: composer.setActionPickerOpen,
    setFilePickerOpen: composer.setFilePickerOpen,
    uiLayoutScaleApi: uiLayoutScale,
  });

  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const [launchSplashPhase, setLaunchSplashPhase] = useState<ShellOverlayPhase>("gone");
  const [onboardingPhase, setOnboardingPhase] = useState<ShellOverlayPhase>("gone");
  // Snapshot is the source of truth once ready. Before that, a sync on-disk read (same pattern as
  // translucency) is the only allowed source: the settings default onboardingCompleted:false must
  // not flash OOBE for returning users, but first-run must not wait for snapshot behind LaunchSplash.
  const onboardingCompletedKnown = resolveOnboardingCompletedKnown({
    snapshotReady: snapshot != null,
    snapshotOnboardingCompleted: runtime.settings.onboardingCompleted,
    storedOnboardingCompleted: snapshot == null ? readStoredOnboardingCompleted() : undefined,
  });
  const onboardingVisible = resolveOnboardingVisible({
    snapshotReady: onboardingCompletedKnown.known,
    onboardingCompleted: onboardingCompletedKnown.completed,
    dismissedThisSession: onboardingDismissed,
  });
  const launchSplashActive = resolveLaunchSplashActive({
    snapshotReady: snapshot != null,
    onboardingVisible,
    hasHostError: Boolean(runtime.hostConnectionError.trim()),
    hasRuntimeError: Boolean(runtime.runtimeError.trim()),
  });
  const pairingGateBlocksLaunchSplash =
    runtime.webHostPairingRequired && runtime.hostKind === "web" && !snapshot;
  /**
   * The child's onPhaseChange writes back only in a layout effect; the parent state initial value is gone.
   * If we only trusted the child phase, the first-frame sync would clear the spirit-launch-splash-active
   * already written by index.html / main, while within the same layout pass notifyLaunchSplashReady may
   * have already shown the window → app-body would show through under translucency.
   * When active/visible is true and the child has not entered leaving yet, treat the overlay as still up (pending counts as running).
   */
  const launchSplashOverlayUp =
    launchSplashPhase === "running" ||
    launchSplashPhase === "leaving" ||
    (launchSplashActive && launchSplashPhase === "gone");
  const onboardingOverlayUp =
    onboardingPhase === "running" ||
    onboardingPhase === "leaving" ||
    (onboardingVisible && onboardingPhase === "gone");
  /**
   * Hide app-body while a fullscreen overlay (LaunchSplash / OOBE) is mounted: visual hiding uses the
   * spirit-launch-splash-active opacity rule in styles.css (keeps rasterization so the whole overlay layer
   * can fade out smoothly on exit); here we only add inert to block focus/pointer/screen readers —
   * not visibility:hidden, which suppresses painting, pushes app-body's first rasterization into the
   * exit window, and turns the exit animation into a hard cut.
   */
  const shellUnderlayHidden =
    launchSplashActive || onboardingVisible || launchSplashOverlayUp || onboardingOverlayUp;
  /**
   * The two fullscreen overlays share the same set of html classes (styles.css hides app-body during an overlay based on them),
   * so they must be derived at this single point: if each component synced on its own, the one whose phase is "gone"
   * would clear the still-running other's class on mount, leaking app-body during the launch overlay
   * (with Blur, the translucent tint would reveal the sidebar content).
   * pending (child phase still gone) maps to running to avoid clearing the class.
   */
  const shellOverlayPhase: ShellOverlayPhase = launchSplashOverlayUp
    ? launchSplashPhase === "leaving"
      ? "leaving"
      : "running"
    : onboardingOverlayUp
      ? onboardingPhase === "leaving"
        ? "leaving"
        : "running"
      : "gone";

  useLayoutEffect(() => {
    syncLaunchSplashChromeToDocument(shellOverlayPhase);
  }, [shellOverlayPhase]);

  const focusComposerEnabled =
    snapshot != null &&
    surfaceNav.activeSurface === "conversation" &&
    !surfaceNav.settingsMode &&
    !sessionNavigationBusy &&
    !runtime.layoutNavigationPending &&
    !newSessionBusy &&
    !shellUnderlayHidden;

  const handleOnboardingDone = useCallback(() => {
    void (async () => {
      await runtime.saveSettingsPatch({ onboardingCompleted: true });
      setOnboardingDismissed(true);
    })();
  }, [runtime.saveSettingsPatch]);

  useLayoutEffect(() => {
    applyUiLayoutScaleToDocument(uiLayoutScale.scale);
  }, [uiLayoutScale.scale]);

  useLayoutEffect(() => {
    if (launchSplashActive && !pairingGateBlocksLaunchSplash) {
      return;
    }
    window.spiritDesktop?.notifyLaunchSplashReady?.();
  }, [launchSplashActive, pairingGateBlocksLaunchSplash]);

  const handleWorkspaceMarkdownLinkClick = useCallback(
    (href: string) => {
      if (
        tryHandleDesktopWorkspaceLink(
          href,
          {
            openPullRequestInPrTab: workspaceTools.openPullRequestInPrTab,
            openBrowserUrlInNewTab: workspaceTools.openBrowserUrlInNewTab,
          },
          {
            hostKind: runtime.hostKind ?? undefined,
            interceptPrInApp: workspaceTools.prTabEnabled && gitHubAuthConnected === true,
          },
        )
      ) {
        return true;
      }
      const workspaceRoot = snapshot?.workspaceRoot ?? "";
      if (!workspaceRoot) {
        return false;
      }
      return tryHandleMarkdownWorkspaceLink(
        href,
        {
          openWorkspaceFileInNewTab: workspaceTools.openWorkspaceFileInNewTab,
          revealWorkspaceDirectory: workspaceTools.revealWorkspaceDirectory,
          statHostTextFile: runtime.statHostTextFile,
        },
        { baseDir: workspaceRoot, workspaceRoot },
      );
    },
    [
      gitHubAuthConnected,
      runtime.hostKind,
      runtime.statHostTextFile,
      snapshot?.workspaceRoot,
      workspaceTools.openBrowserUrlInNewTab,
      workspaceTools.openPullRequestInPrTab,
      workspaceTools.openWorkspaceFileInNewTab,
      workspaceTools.prTabEnabled,
      workspaceTools.revealWorkspaceDirectory,
    ],
  );

  if (runtime.webHostPairingRequired && runtime.hostKind === "web" && !snapshot) {
    return (
      <WebHostPairingGate busy={runtime.busyAction === "bootstrap"} onPair={runtime.pairWebHost} />
    );
  }

  return (
    <WorkspaceMarkdownLinkProvider onLinkClick={handleWorkspaceMarkdownLinkClick}>
      <SessionSidebarChromeProvider apiRef={surfaceNav.sessionSidebarChromeApiRef}>
        <div
          data-spirit-surface="desktop-chrome-root"
          className="flex h-full min-h-0 flex-col text-foreground"
        >
          {winElectronChrome ? (
            <DesktopTitleBar
              useTranslucency={useTranslucency}
              useContentTranslucency={useContentTranslucency}
              onZoomIn={uiLayoutScale.zoomIn}
              onZoomOut={uiLayoutScale.zoomOut}
              onZoomReset={uiLayoutScale.resetScale}
              onOpenSettings={surfaceNav.handleOpenSettings}
            />
          ) : null}
          <div id={UI_LAYOUT_SCALE_ROOT_ID} className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div
              data-spirit-surface="app-shell"
              data-spirit-shell-kind={isElectronShell ? "electron" : "web"}
              data-spirit-mica={useTranslucency ? "true" : "false"}
              data-spirit-content-translucency={useContentTranslucency ? "true" : "false"}
              className={cn(
                "flex h-full min-h-0 flex-col",
                useTranslucency ? "bg-transparent" : "bg-background",
              )}
            >
              <LaunchSplash
                active={launchSplashActive}
                useTranslucency={useTranslucency}
                onPhaseChange={setLaunchSplashPhase}
              />
              <OnboardingWizard
                active={onboardingVisible}
                useTranslucency={useTranslucency}
                settings={runtime.settings}
                onSavePatch={runtime.saveSettingsPatch}
                modelsBusy={runtime.busyAction === "models"}
                modelsPreviewBusy={runtime.busyAction === "modelsPreview"}
                onAddModel={runtime.addModel}
                onAddProviderModels={runtime.addProviderModels}
                onPreviewModels={runtime.previewModels}
                onDone={handleOnboardingDone}
                onPhaseChange={setOnboardingPhase}
              />
              <div
                data-spirit-surface="app-body"
                inert={shellUnderlayHidden}
                className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
              >
                {!desktopTitleBarChrome ? (
                  <div
                    className={cn(
                      "h-px w-full shrink-0",
                      // Non-Electron: shell top separator line
                      useTranslucency
                        ? "bg-black/5 dark:bg-white/10"
                        : "bg-border/30 dark:bg-white/12",
                    )}
                    role="separator"
                    aria-orientation="horizontal"
                  />
                ) : null}
                <div
                  data-spirit-surface="main-frame"
                  className="flex min-h-0 min-w-0 flex-1 overflow-hidden"
                >
                  <ConversationSplitProvider
                    runtime={runtime}
                    snapshot={snapshot}
                    conversationAbortShortcutTargetRef={conversationAbortShortcutTargetRef}
                    registerBeginSideChat={registerBeginSideChat}
                    onEnsureConversationSurface={() => {
                      surfaceNav.setLastNonSettingsSurface("conversation");
                      surfaceNav.setActiveSurface("conversation");
                    }}
                  >
                    <ConversationSessionFocusComposerBridge
                      composerSessionKey={conversation.composerSessionKey}
                      enabled={focusComposerEnabled}
                      composerAutomationApiRef={composerAutomationApiRef}
                    />
                    <ConversationTypingFocusRedirectBridge enabled={focusComposerEnabled} />
                    <SessionSidebarShell
                      useTranslucency={useTranslucency}
                      useContentTranslucency={useContentTranslucency}
                    >
                      <SessionSidebar
                        narrow={false}
                        mode={surfaceNav.settingsMode ? "settings" : "sessions"}
                        userHomeDirectory={snapshot?.userHomeDirectory ?? null}
                        sessions={runtime.sessions}
                        activeFilePath={sidebarActiveFilePath}
                        onNewSession={surfaceNav.handleNewSession}
                        onNewSessionInWorkspace={(workspaceRoot) => {
                          void surfaceNav.handleNewSessionInWorkspace(workspaceRoot);
                        }}
                        onSelectSession={(path) => {
                          surfaceNav.setLastNonSettingsSurface("conversation");
                          surfaceNav.setActiveSurface("conversation");
                          void runtime.openSession(path);
                        }}
                        onOpenMarketplace={() => {
                          surfaceNav.sessionSidebarChromeApiRef.current?.openSidebar();
                          surfaceNav.setLastNonSettingsSurface("marketplace");
                          surfaceNav.setActiveSurface("marketplace");
                        }}
                        onOpenAutomations={() => {
                          surfaceNav.sessionSidebarChromeApiRef.current?.openSidebar();
                          surfaceNav.setLastNonSettingsSurface("automations");
                          surfaceNav.setSelectedAutomationId(null);
                          surfaceNav.setActiveSurface("automations");
                        }}
                        onOpenSettings={surfaceNav.handleOpenSettings}
                        onBackToSessions={surfaceNav.handleCloseSettings}
                        marketplaceActive={surfaceNav.marketplaceMode}
                        automationsActive={surfaceNav.automationsMode}
                        settingsTab={surfaceNav.settingsTab}
                        extensionSettingsId={surfaceNav.extensionSettingsId}
                        extensionSettingsItems={surfaceNav.extensionSettingsItems}
                        onSettingsTabChange={(tab) => {
                          surfaceNav.setExtensionSettingsId(null);
                          surfaceNav.setSettingsTab(tab);
                        }}
                        onExtensionSettingsChange={(id) => surfaceNav.setExtensionSettingsId(id)}
                        translucency={useTranslucency}
                        newSessionBusy={newSessionBusy}
                        sessionNavigationBusy={sessionNavigationBusy}
                        deleteSessionBusy={sessionNavigationBusy}
                        onDeleteSession={(path) => runtime.deleteSession(path)}
                        renameSessionBusy={sessionNavigationBusy}
                        onRenameSession={(path, displayName) =>
                          runtime.renameSession(path, displayName)
                        }
                        deleteWorkspaceBusy={sessionNavigationBusy}
                        onDeleteWorkspace={(workspacePath) =>
                          runtime.deleteWorkspace(workspacePath)
                        }
                        unseenCompletedSessionPaths={runtime.unseenCompletedSessionPaths}
                      />
                    </SessionSidebarShell>

                    {surfaceNav.settingsMode ? (
                      <div
                        data-spirit-surface="settings-shell"
                        className={cn(
                          "flex min-h-0 min-w-0 flex-1 flex-col",
                          desktopTranslucencyTintClass(useContentTranslucency),
                        )}
                      >
                        <DesktopLayoutChromeBar
                          useTranslucency={useTranslucency}
                          showWorkspaceToggle={false}
                        />
                        <SettingsView
                          useTranslucency={useTranslucency}
                          tab={surfaceNav.settingsTab}
                          extensionSettingsId={surfaceNav.extensionSettingsId}
                          font={font}
                          onFontChange={setFont}
                          clickablePointerCursor={clickablePointerCursor}
                          onClickablePointerCursorChange={setClickablePointerCursor}
                          fontSmoothing={fontSmoothing}
                          onFontSmoothingChange={setFontSmoothing}
                          settings={runtime.settings}
                          snapshot={snapshot}
                          apiReady={runtime.apiReady}
                          busyAction={runtime.busyAction}
                          modelsBusy={runtime.busyAction === "models"}
                          modelsPreviewBusy={runtime.busyAction === "modelsPreview"}
                          mcpsBusy={runtime.busyAction === "mcps"}
                          hooksBusy={runtime.busyAction === "hooks"}
                          skillsBusy={runtime.busyAction === "skills"}
                          rulesBusy={runtime.busyAction === "rules"}
                          extensionsBusy={
                            runtime.busyAction === "extensions" ||
                            runtime.busyAction === "extensionsImport"
                          }
                          lspInstallBusy={runtime.lspInstallBusy}
                          isElectronShell={isElectronShell}
                          onSavePatch={runtime.saveSettingsPatch}
                          onInstallLspProvider={runtime.installLspProvider}
                          onResetWebHostPairing={runtime.resetWebHostPairing}
                          onAddModel={runtime.addModel}
                          onAddProviderModels={runtime.addProviderModels}
                          onPreviewModels={runtime.previewModels}
                          onRemoveModel={runtime.removeModel}
                          onRemoveProviderModels={runtime.removeProviderModels}
                          onAddMcpServer={runtime.addMcpServer}
                          onUpdateExtensionSettings={runtime.updateExtensionSettings}
                          onUpdateExtensionSecret={runtime.updateExtensionSecret}
                          onDeleteMcpServer={runtime.deleteMcpServer}
                          onSaveHookEntry={runtime.saveHookEntry}
                          onDeleteHookEntry={runtime.deleteHookEntry}
                          onInspectMcpServer={runtime.inspectMcpServer}
                          onCreateSkill={runtime.createSkill}
                          onCreateRule={runtime.createRule}
                          onStartCompactionUiDemo={() => {
                            longConversationListDemo.stop();
                            surfaceNav.setActiveSurface("conversation");
                            compactionDemo.start();
                          }}
                          onStartLongConversationListDemo={() => {
                            compactionDemo.stop();
                            surfaceNav.setActiveSurface("conversation");
                            longConversationListDemo.start();
                          }}
                          onDeleteSkill={runtime.deleteSkill}
                          onDeleteRule={runtime.deleteRule}
                          onListDreamsOverview={runtime.listDreamsOverview}
                          onGenerateSkillNavigate={() => {
                            surfaceNav.handlePrefillComposerSkillChip("create-skill");
                          }}
                          onGenerateRuleNavigate={() => {
                            surfaceNav.handlePrefillComposerSkillChip("create-rule");
                          }}
                          onGenerateHookNavigate={() => {
                            surfaceNav.handlePrefillComposerSkillChip("create-hook");
                          }}
                          getGitHubAuthStatus={runtime.getGitHubAuthStatus}
                          beginGitHubDeviceLogin={runtime.beginGitHubDeviceLogin}
                          completeGitHubDeviceLogin={runtime.completeGitHubDeviceLogin}
                          cancelGitHubDeviceLogin={runtime.cancelGitHubDeviceLogin}
                          disconnectGitHub={runtime.disconnectGitHub}
                        />
                      </div>
                    ) : surfaceNav.automationsMode ? (
                      <div
                        data-spirit-surface="automations-layout"
                        className={cn(
                          "flex min-h-0 min-w-0 flex-1 flex-col",
                          desktopTranslucencyTintClass(useContentTranslucency),
                        )}
                      >
                        <DesktopLayoutChromeBar
                          useTranslucency={useTranslucency}
                          showWorkspaceToggle={false}
                        />
                        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                          {surfaceNav.automationDetailMode && surfaceNav.selectedAutomationId ? (
                            <AutomationDetailView
                              automationId={surfaceNav.selectedAutomationId}
                              snapshot={snapshot}
                              onBack={() => {
                                surfaceNav.setSelectedAutomationId(null);
                                surfaceNav.setActiveSurface("automations");
                              }}
                              onOpenSession={(path) => {
                                surfaceNav.setLastNonSettingsSurface("conversation");
                                surfaceNav.setActiveSurface("conversation");
                                void runtime.openSession(path);
                              }}
                              getAutomation={runtime.getAutomation}
                              updateAutomation={(id, patch) =>
                                void runtime.updateAutomation(id, patch)
                              }
                              settingsDisabled={
                                !runtime.apiReady || runtime.busyAction === "automation"
                              }
                              githubConnected={gitHubAuthConnected === true}
                              githubAuthChecking={gitHubAuthConnected === null}
                              onOpenIntegrationsSettings={openIntegrationsSettings}
                              listGitHubRepositories={runtime.listGitHubAutomationRepositories}
                              searchGitHubRepositories={runtime.searchGitHubAutomationRepositories}
                              onAddWorkspace={() =>
                                void runtime.pickWorkspaceDirectory?.().then((path) => {
                                  if (path) {
                                    void runtime.rememberWorkspaceRoot(path);
                                  }
                                })
                              }
                            />
                          ) : (
                            <AutomationsView
                              snapshot={snapshot}
                              apiReady={runtime.apiReady}
                              busyAction={runtime.busyAction}
                              githubConnected={gitHubAuthConnected === true}
                              onGenerateAutomation={() =>
                                void surfaceNav.handleGenerateAutomation()
                              }
                              onCreateAutomation={() =>
                                surfaceNav.setCreateAutomationDialogOpen(true)
                              }
                              onOpenAutomation={(automationId) => {
                                surfaceNav.setSelectedAutomationId(automationId);
                                surfaceNav.setActiveSurface("automation-detail");
                              }}
                              onDeleteAutomation={async (automationId) => {
                                await runtime.deleteAutomation(automationId);
                                if (surfaceNav.selectedAutomationId === automationId) {
                                  surfaceNav.setSelectedAutomationId(null);
                                  surfaceNav.setActiveSurface("automations");
                                }
                              }}
                            />
                          )}
                          <CreateAutomationDialog
                            open={surfaceNav.createAutomationDialogOpen}
                            onOpenChange={surfaceNav.setCreateAutomationDialogOpen}
                            snapshot={snapshot}
                            disabled={!runtime.apiReady || runtime.busyAction === "automation"}
                            githubConnected={gitHubAuthConnected === true}
                            githubAuthChecking={gitHubAuthConnected === null}
                            onOpenIntegrationsSettings={openIntegrationsSettings}
                            listGitHubRepositories={runtime.listGitHubAutomationRepositories}
                            searchGitHubRepositories={runtime.searchGitHubAutomationRepositories}
                            onSubmit={(request) => void runtime.createAutomation(request)}
                            onAddWorkspace={() =>
                              void runtime.pickWorkspaceDirectory?.().then((path) => {
                                if (path) {
                                  void runtime.rememberWorkspaceRoot(path);
                                }
                              })
                            }
                          />
                        </div>
                      </div>
                    ) : surfaceNav.marketplaceMode ? (
                      <div
                        data-spirit-surface="marketplace-layout"
                        className={cn(
                          "flex min-h-0 min-w-0 flex-1 flex-col",
                          desktopTranslucencyTintClass(useContentTranslucency),
                        )}
                      >
                        <DesktopLayoutChromeBar
                          useTranslucency={useTranslucency}
                          showWorkspaceToggle={false}
                        />
                        <MarketplaceView
                          useTranslucency={useContentTranslucency}
                          snapshot={snapshot}
                          extensionsBusy={
                            runtime.busyAction === "extensions" ||
                            runtime.busyAction === "extensionsImport"
                          }
                          extensionsInstalling={runtime.busyAction === "extensionsImport"}
                          onImportExtension={runtime.importExtension}
                          onInstallBuiltInExtension={runtime.installBuiltInExtension}
                          onDeleteExtension={runtime.deleteExtension}
                          onSetExtensionEnabled={runtime.setExtensionEnabled}
                        />
                      </div>
                    ) : null}

                    {surfaceNav.preserveConversationSurface ? (
                      <div
                        className={cn(
                          "flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden",
                          desktopTranslucencyTintInnerClass(useContentTranslucency),
                          surfaceNav.settingsMode && "hidden",
                        )}
                        aria-hidden={surfaceNav.settingsMode}
                      >
                        <div className="flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden">
                          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                            <ConversationSplitRoot
                              useTranslucency={useContentTranslucency}
                              renderPane={(pane) => (
                                <ConversationPaneHost
                                  key={pane.paneId}
                                  runtime={runtime}
                                  baseSnapshot={snapshot}
                                  sessionPath={pane.sessionPath}
                                  paneId={pane.paneId}
                                  isFocused={pane.isFocused}
                                  isAnchorPane={pane.isAnchorPane}
                                  isSessionSidebarAnchorPane={pane.isSessionSidebarAnchorPane}
                                  useIsolatedPane={pane.useIsolatedPane}
                                  splitPaneCount={pane.splitPaneCount}
                                  onFocusPane={pane.onFocusPane}
                                  onSideChat={pane.onSideChat}
                                  onSplit={pane.onSplit}
                                  onSplitVertical={pane.onSplitVertical}
                                  onClosePane={pane.onClosePane}
                                  showClosePane={pane.showClosePane}
                                  paneReorderEnabled={pane.paneReorderEnabled}
                                  onPaneDragStart={pane.onPaneDragStart}
                                  onPaneDragLeave={pane.onPaneDragLeave}
                                  onPaneDrop={pane.onPaneDrop}
                                  onSidebarSessionDrop={pane.onSidebarSessionDrop}
                                  paneDropOverlayActive={pane.paneDropOverlayActive}
                                  paneDragSourcePaneId={pane.paneDragSourcePaneId}
                                  sidebarSessionDragActive={pane.sidebarSessionDragActive}
                                  useTranslucency={useContentTranslucency}
                                  subagentViewActive={subagentViewActive}
                                  subagentViewer={subagentViewer}
                                  compactionDemo={compactionDemo}
                                  longConversationListDemo={longConversationListDemo}
                                  hideStaleConversationMessages={
                                    surfaceNav.hideStaleConversationMessages
                                  }
                                  showWorkspaceBindingControls={
                                    surfaceNav.showWorkspaceBindingControls
                                  }
                                  sessionNavigationBusy={sessionNavigationBusy}
                                  newSessionBusy={newSessionBusy}
                                  onNewSession={surfaceNav.handleNewSession}
                                  deleteSessionBusy={sessionNavigationBusy}
                                  onDeleteSession={(path) => runtime.deleteSession(path)}
                                  renameSessionBusy={sessionNavigationBusy}
                                  onRenameSession={(path, displayName) =>
                                    runtime.renameSession(path, displayName)
                                  }
                                  workspaceTools={workspaceTools}
                                  onOpenIntegrationsSettings={openIntegrationsSettings}
                                  onCompactionDemoStop={compactionDemo.stop}
                                  onLongConversationListDemoStop={longConversationListDemo.stop}
                                  t={t}
                                  language={i18n.language}
                                />
                              )}
                            />
                          </div>
                          <ConversationWorkspaceToolsDock
                            useTranslucency={useContentTranslucency}
                            snapshot={snapshot}
                            runtime={runtime}
                            conversation={conversation}
                            composer={composer}
                            workspaceTools={workspaceTools}
                            onOpenIntegrationsSettings={openIntegrationsSettings}
                          />
                        </div>
                      </div>
                    ) : null}
                  </ConversationSplitProvider>
                </div>
              </div>

              <ActionPickerDialog
                open={composer.actionPickerOpen}
                onOpenChange={composer.setActionPickerOpen}
                onSelect={composer.runActionPaletteItem}
                onSavePatch={runtime.saveSettingsPatch}
                isItemDisabled={composer.isActionPaletteItemDisabled}
                shouldIncludeItem={composer.filterActionPaletteItem}
              />

              <WorkspaceFilePickerDialog
                open={composer.filePickerOpen}
                onOpenChange={composer.setFilePickerOpen}
                workspaceRoot={snapshot?.workspaceRoot ?? ""}
                workspaceBinding={snapshot?.workspaceBinding ?? "project"}
                onOpenWorkspaceFile={(relativePath) => {
                  if (isWorkspaceReferenceDirectoryPath(relativePath)) {
                    workspaceTools.revealWorkspaceDirectory(
                      normalizeWorkspaceReferenceDirectoryPath(relativePath),
                    );
                    return;
                  }
                  workspaceTools.openWorkspaceFile(relativePath, {
                    viewMode: isMarkdownPath(relativePath) ? "preview" : "edit",
                  });
                }}
                onOpenExternalFile={(absolutePath) => {
                  workspaceTools.openEditorFile({
                    scope: "external",
                    absolutePath,
                    viewMode: isMarkdownPath(absolutePath) ? "preview" : "edit",
                  });
                }}
                statHostTextFile={runtime.statHostTextFile}
                indexReady={composer.workspaceFileIndex.ready}
                searchWorkspaceFiles={composer.workspaceFileIndex.searchFilesOnly}
              />

              <WorkspaceCapabilityTrustDialog
                pending={snapshot?.pendingWorkspaceCapabilityTrust}
                busy={runtime.busyAction === "workspaceTrust"}
                onReply={(decision) => {
                  void runtime.replyWorkspaceCapabilityTrust(decision);
                }}
              />
            </div>
          </div>
        </div>
      </SessionSidebarChromeProvider>
    </WorkspaceMarkdownLinkProvider>
  );
}
