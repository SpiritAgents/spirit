import { parseGitHubPullRequestUrl } from "@spiritagent/host-internal/github-pull-request-url";

import type { ComposerChipNavigateMeta } from "./composer-chip-navigate-meta.js";
import type { QuoteChipOrigin } from "./message-quote-attachment.js";
import { looksLikeAbsolutePath } from "./file-picker-path.js";
import { tryResolveWorkspaceRelativePath } from "./read-file-tool-navigation.js";
import { skillSlashAlias } from "./skill-slash.js";
import {
  isSideChatPaneProvisionalSessionPath,
  normalizeSessionPathKey,
} from "./session-path-kind.js";
import { isWorkspaceDirectoryChipPath } from "./workspace-file-chip-styles.js";
import {
  findWorkspaceToolTab,
  type WorkspaceToolTab,
  type WorkspaceToolTabKind,
} from "./workspace-tool-tabs.js";
import { findFilesTabWithWorkspacePath } from "./workspace-editor-navigation.js";

export const COMPOSER_CHIP_NAVIGATE_POINTER_THRESHOLD_PX = 4;

export type ComposerChipNavigateTarget =
  | { kind: "skill"; alias: string }
  | { kind: "workspaceFile"; path: string; sourceTabId?: string; isPlan?: boolean }
  | {
      kind: "fileSnippet";
      filePath: string;
      lineStart: number;
      lineEnd: number;
      sourceTabId?: string;
    }
  | { kind: "sessionReference"; transcriptPath: string }
  | { kind: "element"; pageUrl: string; sourceTabId?: string }
  | { kind: "gitCommit"; sourceTabId?: string }
  | { kind: "terminalSnippet"; sourceTabId?: string }
  | { kind: "prDiff"; prUrl: string; sourceTabId?: string }
  | {
      kind: "messageQuote";
      quoteSessionPath?: string;
      quoteMessageId?: number;
      quoteOrigin?: QuoteChipOrigin;
    };

export type ComposerChipNavigateSkill = {
  name: string;
  path?: string;
};

export type ComposerChipNavigateSession = {
  path: string;
  transcriptPath: string;
};

export type ComposerChipNavigateEnv = {
  tabs: readonly WorkspaceToolTab[];
  supportsBrowserTabs: boolean;
  supportsPrTabs: boolean;
  githubConnected: boolean;
  sessions: readonly ComposerChipNavigateSession[];
  skills: readonly ComposerChipNavigateSkill[];
  workspaceRoot: string;
  followSessionPathAlias?: (path: string) => string;
  loadedMessageIdsBySessionPath?: ReadonlyMap<string, ReadonlySet<number>>;
  knownSessionPathKeys?: ReadonlySet<string>;
};

export type ComposerChipNavigateAction =
  | {
      type: "reveal-workspace-path";
      relativePath: string;
      tabId?: string;
      line?: number;
      directory?: boolean;
    }
  | { type: "open-external-file"; absolutePath: string }
  | { type: "open-plan" }
  | { type: "focus-tab"; tabId: string }
  | { type: "open-browser"; url: string; preferTabId?: string }
  | { type: "open-git"; preferTabId?: string }
  | { type: "open-pr"; owner: string; repo: string; number: number; preferTabId?: string }
  | { type: "open-session"; chatPath: string }
  | {
      type: "scroll-quote";
      sessionPath: string;
      messageId: number;
      origin: QuoteChipOrigin;
    };

export type ComposerChipNavigateDecision =
  | { navigable: false }
  | { navigable: true; action: ComposerChipNavigateAction };

export function pointerMovedBeyondChipNavigateThreshold(
  start: { x: number; y: number },
  end: { x: number; y: number },
  thresholdPx = COMPOSER_CHIP_NAVIGATE_POINTER_THRESHOLD_PX,
): boolean {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  return dx * dx + dy * dy >= thresholdPx * thresholdPx;
}

export function trackedTabOfKind(
  tabs: readonly WorkspaceToolTab[],
  sourceTabId: string | undefined,
  kind: WorkspaceToolTabKind,
): WorkspaceToolTab | undefined {
  const trimmed = sourceTabId?.trim();
  if (!trimmed) {
    return undefined;
  }
  const tab = findWorkspaceToolTab(tabs, trimmed);
  return tab?.kind === kind ? tab : undefined;
}

export function resolveSessionChatPathFromTranscript(
  sessions: readonly ComposerChipNavigateSession[],
  transcriptPath: string,
): string | undefined {
  const target = normalizeSessionPathKey(transcriptPath);
  if (!target) {
    return undefined;
  }
  for (const session of sessions) {
    if (normalizeSessionPathKey(session.transcriptPath) === target) {
      return session.path;
    }
  }
  return undefined;
}

function skillPathForAlias(
  skills: readonly ComposerChipNavigateSkill[],
  alias: string,
): string | undefined {
  const normalizedAlias = alias.trim();
  if (!normalizedAlias) {
    return undefined;
  }
  const skill = skills.find((item) => skillSlashAlias(item.name) === normalizedAlias);
  const path = skill?.path?.trim();
  return path || undefined;
}

function workspaceFileAction(
  relativePath: string,
  tabs: readonly WorkspaceToolTab[],
  sourceTabId: string | undefined,
  options?: { line?: number; directory?: boolean },
): ComposerChipNavigateDecision {
  const tracked = trackedTabOfKind(tabs, sourceTabId, "files");
  const samePathTabId = options?.directory
    ? undefined
    : findFilesTabWithWorkspacePath(tabs, relativePath);
  return {
    navigable: true,
    action: {
      type: "reveal-workspace-path",
      relativePath,
      ...(tracked ? { tabId: tracked.id } : samePathTabId ? { tabId: samePathTabId } : {}),
      ...(options?.line && options.line > 0 ? { line: options.line } : {}),
      ...(options?.directory ? { directory: true } : {}),
    },
  };
}

export function resolveComposerChipNavigate(
  target: ComposerChipNavigateTarget,
  env: ComposerChipNavigateEnv,
): ComposerChipNavigateDecision {
  switch (target.kind) {
    case "terminalSnippet": {
      const tab = trackedTabOfKind(env.tabs, target.sourceTabId, "terminal");
      return tab
        ? { navigable: true, action: { type: "focus-tab", tabId: tab.id } }
        : { navigable: false };
    }
    case "gitCommit": {
      const tab = trackedTabOfKind(env.tabs, target.sourceTabId, "git");
      return {
        navigable: true,
        action: { type: "open-git", ...(tab ? { preferTabId: tab.id } : {}) },
      };
    }
    case "element": {
      if (!env.supportsBrowserTabs) {
        return { navigable: false };
      }
      const url = target.pageUrl.trim();
      if (!url) {
        return { navigable: false };
      }
      const tab = trackedTabOfKind(env.tabs, target.sourceTabId, "browser");
      return {
        navigable: true,
        action: { type: "open-browser", url, ...(tab ? { preferTabId: tab.id } : {}) },
      };
    }
    case "prDiff": {
      if (!env.supportsPrTabs || !env.githubConnected) {
        return { navigable: false };
      }
      const parsed = parseGitHubPullRequestUrl(target.prUrl);
      if (!parsed) {
        return { navigable: false };
      }
      const tab = trackedTabOfKind(env.tabs, target.sourceTabId, "pr");
      return {
        navigable: true,
        action: {
          type: "open-pr",
          owner: parsed.owner,
          repo: parsed.repo,
          number: parsed.number,
          ...(tab ? { preferTabId: tab.id } : {}),
        },
      };
    }
    case "sessionReference": {
      const chatPath = resolveSessionChatPathFromTranscript(env.sessions, target.transcriptPath);
      return chatPath
        ? { navigable: true, action: { type: "open-session", chatPath } }
        : { navigable: false };
    }
    case "skill": {
      const skillPath = skillPathForAlias(env.skills, target.alias);
      if (!skillPath) {
        return { navigable: false };
      }
      if (!looksLikeAbsolutePath(skillPath)) {
        return workspaceFileAction(skillPath, env.tabs, undefined);
      }
      const relative = tryResolveWorkspaceRelativePath(env.workspaceRoot, skillPath);
      if (relative) {
        return workspaceFileAction(relative, env.tabs, undefined);
      }
      return { navigable: true, action: { type: "open-external-file", absolutePath: skillPath } };
    }
    case "workspaceFile": {
      const path = target.path.trim();
      if (!path) {
        return { navigable: false };
      }
      // Plan identity travels with the chip (segment isPlan / navigate meta); it never
      // depends on which session currently owns the foreground plan file.
      if (target.isPlan === true) {
        return { navigable: true, action: { type: "open-plan" } };
      }
      return workspaceFileAction(path, env.tabs, target.sourceTabId, {
        directory: isWorkspaceDirectoryChipPath(path),
      });
    }
    case "fileSnippet": {
      const path = target.filePath.trim();
      if (!path) {
        return { navigable: false };
      }
      return workspaceFileAction(path, env.tabs, target.sourceTabId, {
        line: target.lineStart,
      });
    }
    case "messageQuote": {
      const rawPath = target.quoteSessionPath?.trim();
      const messageId = target.quoteMessageId;
      if (!rawPath || typeof messageId !== "number" || !Number.isFinite(messageId)) {
        return { navigable: false };
      }
      const sessionPath = env.followSessionPathAlias?.(rawPath) ?? rawPath;
      const pathKey = normalizeSessionPathKey(sessionPath);
      const canReopenClosedSideChat =
        target.quoteOrigin === "side-chat" || isSideChatPaneProvisionalSessionPath(sessionPath);
      if (
        !canReopenClosedSideChat &&
        env.knownSessionPathKeys &&
        env.knownSessionPathKeys.size > 0 &&
        !env.knownSessionPathKeys.has(pathKey)
      ) {
        return { navigable: false };
      }
      const loadedIds = env.loadedMessageIdsBySessionPath?.get(pathKey);
      if (loadedIds && !loadedIds.has(messageId)) {
        return { navigable: false };
      }
      return {
        navigable: true,
        action: {
          type: "scroll-quote",
          sessionPath,
          messageId,
          origin: target.quoteOrigin === "side-chat" ? "side-chat" : "session",
        },
      };
    }
    default: {
      const _exhaustive: never = target;
      return _exhaustive;
    }
  }
}

export function composerChipNavigateTargetFromMeta(
  kind: ComposerChipNavigateTarget["kind"],
  meta: ComposerChipNavigateMeta | undefined,
): Pick<
  ComposerChipNavigateMeta,
  "sourceTabId" | "isPlan" | "quoteSessionPath" | "quoteMessageId" | "quoteOrigin"
> {
  if (!meta || meta.kind !== kind) {
    return {};
  }
  return {
    ...(meta.sourceTabId ? { sourceTabId: meta.sourceTabId } : {}),
    ...(meta.isPlan === true ? { isPlan: true } : {}),
    ...(meta.quoteSessionPath ? { quoteSessionPath: meta.quoteSessionPath } : {}),
    ...(meta.quoteMessageId !== undefined ? { quoteMessageId: meta.quoteMessageId } : {}),
    ...(meta.quoteOrigin ? { quoteOrigin: meta.quoteOrigin } : {}),
  };
}
