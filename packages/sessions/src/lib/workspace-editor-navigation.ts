import {
  addWorkspaceToolTab,
  findWorkspaceToolTab,
  focusFirstTabOfKind,
  type WorkspaceToolTab,
} from "@/lib/workspace-tool-tabs";
import { normalizeWorkspaceEntryRel } from "@/lib/workspace-entry-path-sync";

export type WorkspaceEditorViewMode = "edit" | "preview";

export type EditorFileRevealLocation = {
  line: number;
  column?: number;
};

export type EditorFileTarget =
  | {
      scope: "workspace";
      relativePath: string;
      viewMode: WorkspaceEditorViewMode;
      reveal?: EditorFileRevealLocation;
    }
  | {
      scope: "external";
      absolutePath: string;
      viewMode: WorkspaceEditorViewMode;
      reveal?: EditorFileRevealLocation;
    };

export type WorkspaceFileRevealRequest = {
  relativePath: string;
  viewMode: WorkspaceEditorViewMode;
};

export type ResolveWorkspaceFilesTabResult = {
  tabs: WorkspaceToolTab[];
  activeTabId: string;
  filesTabId: string;
};

/** Pick active files tab, else first files tab, else create one. */
export function resolveWorkspaceFilesTab(
  tabs: readonly WorkspaceToolTab[],
  activeTabId: string,
): ResolveWorkspaceFilesTabResult {
  const activeTab = findWorkspaceToolTab(tabs, activeTabId);
  if (activeTab?.kind === "files") {
    return { tabs: [...tabs], activeTabId, filesTabId: activeTabId };
  }

  const firstFilesId = focusFirstTabOfKind(tabs, "files");
  if (firstFilesId) {
    return { tabs: [...tabs], activeTabId: firstFilesId, filesTabId: firstFilesId };
  }

  const added = addWorkspaceToolTab(tabs, "files");
  return {
    tabs: added.tabs,
    activeTabId: added.activeId,
    filesTabId: added.activeId,
  };
}

export type OpenEditorFileNavigationInput = {
  tabs: readonly WorkspaceToolTab[];
  activeTabId: string;
  target: EditorFileTarget;
};

export type OpenEditorFileNavigationResult = ResolveWorkspaceFilesTabResult & {
  reveal: EditorFileTarget;
};

export function buildOpenEditorFileNavigation(
  input: OpenEditorFileNavigationInput,
): OpenEditorFileNavigationResult {
  const resolved = resolveWorkspaceFilesTab(input.tabs, input.activeTabId);
  return {
    ...resolved,
    reveal: input.target,
  };
}

/** Creates and focuses a new files tab; used when opening another file from the file tree while the current tab has unsaved files. */
export function buildOpenEditorFileInNewTabNavigation(
  input: OpenEditorFileNavigationInput,
): OpenEditorFileNavigationResult {
  const added = addWorkspaceToolTab(input.tabs, "files");
  return {
    tabs: added.tabs,
    activeTabId: added.activeId,
    filesTabId: added.activeId,
    reveal: input.target,
  };
}

/** Finds the id of the files tab that already has the given workspace file path open. */
export function findFilesTabWithWorkspacePath(
  tabs: readonly WorkspaceToolTab[],
  relativePath: string,
): string | undefined {
  const normalized = normalizeWorkspaceEntryRel(relativePath);
  return tabs.find((tab) => tab.kind === "files" && tab.filesWorkspacePath === normalized)?.id;
}

export type OpenWorkspaceFileNavigationInput = {
  tabs: readonly WorkspaceToolTab[];
  activeTabId: string;
  request: WorkspaceFileRevealRequest;
};

export type OpenWorkspaceFileNavigationResult = OpenEditorFileNavigationResult;

export function buildOpenWorkspaceFileNavigation(
  input: OpenWorkspaceFileNavigationInput,
): OpenWorkspaceFileNavigationResult {
  return buildOpenEditorFileNavigation({
    tabs: input.tabs,
    activeTabId: input.activeTabId,
    target: {
      scope: "workspace",
      relativePath: input.request.relativePath,
      viewMode: input.request.viewMode,
    },
  });
}
