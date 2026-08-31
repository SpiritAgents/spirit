import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";

import { ChipLabel } from "@/components/composer-lexical/chips/chip-shell";
import { useConversationSplit } from "@/contexts/conversation-split-context";
import { useGitHubAuthConnected } from "@/hooks/use-github-auth-connected";
import type { useDesktopRuntime } from "@/hooks/useDesktopRuntime";
import type { useWorkspaceToolsController } from "@/hooks/useWorkspaceToolsController";
import {
  resolveComposerChipNavigate,
  type ComposerChipNavigateTarget,
} from "@/lib/composer-chip-navigation";
import { collectSplitLayoutLeaves, findLeafBySessionPath } from "@/lib/conversation-split-layout";
import { isMarkdownPath } from "@/lib/file-picker-path";
import { followSessionPathAlias } from "@/lib/session-path-alias";
import { normalizeSessionPathKey } from "@/lib/session-path-kind";
import type { DesktopSnapshot } from "@/types";

type DesktopRuntime = ReturnType<typeof useDesktopRuntime>;
type WorkspaceTools = ReturnType<typeof useWorkspaceToolsController>;

type ComposerChipNavigateContextValue = {
  isNavigable: (target: ComposerChipNavigateTarget) => boolean;
  navigate: (target: ComposerChipNavigateTarget) => void;
};

const ComposerChipNavigateContext = createContext<ComposerChipNavigateContextValue>({
  isNavigable: () => false,
  navigate: () => {},
});

export function useComposerChipNavigate(): ComposerChipNavigateContextValue {
  return useContext(ComposerChipNavigateContext);
}

export function NavigableChipLabel({
  target,
  children,
}: {
  target: ComposerChipNavigateTarget;
  children: ReactNode;
}) {
  const { isNavigable, navigate } = useComposerChipNavigate();
  const navigable = isNavigable(target);
  return (
    <ChipLabel navigable={navigable} onNavigate={navigable ? () => navigate(target) : undefined}>
      {children}
    </ChipLabel>
  );
}

export function ComposerChipNavigateProvider({
  runtime,
  snapshot,
  baseSnapshot,
  workspaceTools,
  paneId,
  paneSessionPath,
  children,
}: {
  runtime: DesktopRuntime;
  snapshot: DesktopSnapshot | null;
  baseSnapshot?: DesktopSnapshot | null;
  workspaceTools: WorkspaceTools;
  paneId?: string;
  paneSessionPath?: string;
  children: ReactNode;
}) {
  const split = useConversationSplit();
  const githubConnected =
    useGitHubAuthConnected(runtime.getGitHubAuthStatus, workspaceTools.prTabEnabled) === true;
  const sourceSnapshot = baseSnapshot ?? snapshot;

  const env = useMemo(() => {
    const loadedMessageIdsBySessionPath = new Map<string, Set<number>>();
    const addMessages = (
      sessionPath: string | undefined,
      messages: { id: number }[] | undefined,
    ) => {
      const key = sessionPath ? normalizeSessionPathKey(sessionPath) : "";
      if (!key || !messages) {
        return;
      }
      const ids = loadedMessageIdsBySessionPath.get(key) ?? new Set<number>();
      for (const message of messages) {
        ids.add(message.id);
      }
      loadedMessageIdsBySessionPath.set(key, ids);
    };
    addMessages(snapshot?.activeSession?.filePath, snapshot?.conversation.messages);
    addMessages(sourceSnapshot?.activeSession?.filePath, sourceSnapshot?.conversation.messages);
    for (const [path, slice] of Object.entries(sourceSnapshot?.paneSessions ?? {})) {
      addMessages(path, slice.conversation.messages);
    }
    addMessages(paneSessionPath, snapshot?.conversation.messages);

    const knownSessionPathKeys = new Set<string>();
    for (const session of runtime.sessions) {
      knownSessionPathKeys.add(normalizeSessionPathKey(session.path));
    }
    if (split.layout) {
      for (const leaf of collectSplitLayoutLeaves(split.layout)) {
        knownSessionPathKeys.add(normalizeSessionPathKey(leaf.sessionPath));
      }
    }
    for (const key of loadedMessageIdsBySessionPath.keys()) {
      knownSessionPathKeys.add(key);
    }

    return {
      tabs: workspaceTools.workspaceToolTabs,
      supportsBrowserTabs: workspaceTools.browserTabEnabled,
      supportsPrTabs: workspaceTools.prTabEnabled,
      githubConnected,
      sessions: runtime.sessions.map((session) => ({
        path: session.path,
        transcriptPath: session.transcriptPath,
      })),
      skills: [
        ...(snapshot?.skillsList ?? sourceSnapshot?.skillsList ?? []),
        ...(snapshot?.extensionSkills ?? sourceSnapshot?.extensionSkills ?? []),
      ].map((skill) => ({
        name: skill.name,
        path: skill.path,
      })),
      workspaceRoot: snapshot?.workspaceRoot ?? sourceSnapshot?.workspaceRoot ?? "",
      followSessionPathAlias,
      loadedMessageIdsBySessionPath,
      knownSessionPathKeys,
    };
  }, [
    githubConnected,
    paneSessionPath,
    runtime.sessions,
    snapshot?.activeSession?.filePath,
    snapshot?.conversation.messages,
    snapshot?.skillsList,
    snapshot?.extensionSkills,
    snapshot?.workspaceRoot,
    sourceSnapshot?.activeSession?.filePath,
    sourceSnapshot?.conversation.messages,
    sourceSnapshot?.paneSessions,
    sourceSnapshot?.skillsList,
    sourceSnapshot?.extensionSkills,
    sourceSnapshot?.workspaceRoot,
    split.layout,
    workspaceTools.browserTabEnabled,
    workspaceTools.prTabEnabled,
    workspaceTools.workspaceToolTabs,
  ]);

  const isNavigable = useCallback(
    (target: ComposerChipNavigateTarget) => resolveComposerChipNavigate(target, env).navigable,
    [env],
  );

  const navigate = useCallback(
    (target: ComposerChipNavigateTarget) => {
      const decision = resolveComposerChipNavigate(target, env);
      if (!decision.navigable) {
        return;
      }
      const action = decision.action;
      switch (action.type) {
        case "focus-tab":
          workspaceTools.focusWorkspaceToolTab(action.tabId);
          return;
        case "reveal-workspace-path": {
          if (action.directory) {
            if (action.tabId) {
              workspaceTools.revealWorkspaceDirectoryOnTab(action.tabId, action.relativePath);
            } else {
              workspaceTools.revealWorkspaceDirectory(action.relativePath);
            }
            return;
          }
          const reveal = action.line ? { line: action.line } : undefined;
          const viewMode = isMarkdownPath(action.relativePath) && !reveal ? "preview" : "edit";
          if (action.tabId) {
            workspaceTools.openWorkspaceFileOnTab(action.tabId, action.relativePath, {
              viewMode,
              reveal,
            });
            return;
          }
          workspaceTools.openWorkspaceFile(action.relativePath, { viewMode, reveal });
          return;
        }
        case "open-external-file":
          workspaceTools.openEditorFile({
            scope: "external",
            absolutePath: action.absolutePath,
            viewMode: isMarkdownPath(action.absolutePath) ? "preview" : "edit",
          });
          return;
        case "open-browser":
          workspaceTools.focusOrOpenBrowserUrl(action.url, action.preferTabId);
          return;
        case "open-git":
          workspaceTools.openGitTab(action.preferTabId);
          return;
        case "open-pr":
          workspaceTools.openPullRequestInPrTab(
            { owner: action.owner, repo: action.repo, number: action.number },
            action.preferTabId,
          );
          return;
        case "open-session": {
          const leaf = split.layout
            ? findLeafBySessionPath(split.layout, action.chatPath)
            : undefined;
          if (leaf) {
            split.focusPane(leaf.paneId, leaf.sessionPath);
            return;
          }
          void runtime.openSession(action.chatPath);
          return;
        }
        case "scroll-quote": {
          const currentKey = paneSessionPath ? normalizeSessionPathKey(paneSessionPath) : "";
          const targetKey = normalizeSessionPathKey(action.sessionPath);
          const leaf = split.layout
            ? findLeafBySessionPath(split.layout, action.sessionPath)
            : undefined;
          if (currentKey && currentKey === targetKey) {
            split.requestQuoteScroll({
              sessionPath: action.sessionPath,
              messageId: action.messageId,
              behavior: "smooth",
            });
            return;
          }
          if (leaf) {
            split.focusPane(leaf.paneId, leaf.sessionPath);
            split.requestQuoteScroll({
              sessionPath: action.sessionPath,
              messageId: action.messageId,
              behavior: "smooth",
            });
            return;
          }
          split.requestQuoteScroll({
            sessionPath: action.sessionPath,
            messageId: action.messageId,
            behavior: "auto",
          });
          if (action.origin === "side-chat" && paneId) {
            void split.openStoredSessionInSplitPane(paneId, action.sessionPath, "horizontal", {
              asSideChat: true,
            });
            return;
          }
          void runtime.openSession(action.sessionPath);
          return;
        }
        default: {
          const _exhaustive: never = action;
          return _exhaustive;
        }
      }
    },
    [env, paneId, paneSessionPath, runtime, split, workspaceTools],
  );

  const value = useMemo(() => ({ isNavigable, navigate }), [isNavigable, navigate]);

  return (
    <ComposerChipNavigateContext.Provider value={value}>
      {children}
    </ComposerChipNavigateContext.Provider>
  );
}
