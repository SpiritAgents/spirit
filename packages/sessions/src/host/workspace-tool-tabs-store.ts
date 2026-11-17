import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  DesktopExtensionListItem,
  DesktopWorkspaceExtensionToolTab,
  DesktopWorkspaceToolTab,
  DesktopWorkspaceToolsSnapshot,
} from "../types.js";
import {
  createInitialWorkspaceToolsState,
  createExtensionWorkspaceToolTab,
  defaultActiveWorkspaceToolTabId,
} from "../lib/workspace-tool-tabs.js";

const STORE_SCHEMA_VERSION = 1;

type WindowRecord = {
  tabs: DesktopWorkspaceToolTab[];
  activeTabId: string;
  revision: number;
  rendererRevision: number;
};

type PersistedTab = DesktopWorkspaceToolTab | Omit<DesktopWorkspaceExtensionToolTab, "channelId">;
type PersistedWindowRecord = {
  tabs: PersistedTab[];
  activeTabId: string;
};
type PersistedStore = {
  schemaVersion: typeof STORE_SCHEMA_VERSION;
  windows: Record<string, PersistedWindowRecord>;
};

export interface WorkspaceToolTabsRestoreContexts {
  workspaceRoots: ReadonlySet<string>;
  sessionKeys: ReadonlySet<string>;
  extensions: readonly DesktopExtensionListItem[];
}

/** Desktop-owned workspace tabs. Renderer and extension calls share these records. */
export class WorkspaceToolTabsStore {
  private loaded = false;
  private restoreReady = false;
  private readonly windows = new Map<string, WindowRecord>();
  private readonly listeners = new Set<
    (windowId: string, snapshot: DesktopWorkspaceToolsSnapshot) => void
  >();
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  getSnapshot(windowId: string): Promise<DesktopWorkspaceToolsSnapshot> {
    return this.enqueue(async () => {
      await this.ensureLoaded();
      const record = await this.ensureWindow(windowId);
      return this.snapshot(windowId, record);
    });
  }

  setSnapshot(input: {
    windowId: string;
    expectedRevision: number;
    tabs: DesktopWorkspaceToolTab[];
    activeTabId: string;
  }): Promise<DesktopWorkspaceToolsSnapshot> {
    return this.enqueue(async () => {
      await this.ensureLoaded();
      assertValidTabs(input.tabs);
      const previous = await this.ensureWindow(input.windowId);
      if (
        previous.revision !== input.expectedRevision &&
        previous.rendererRevision !== previous.revision
      ) {
        // Queued renderer writes may continue only while every newer revision is their own.
        // A host-side open/update must win over an older full-renderer snapshot.
        const snapshot = this.snapshot(input.windowId, previous);
        this.emit(input.windowId, snapshot);
        return snapshot;
      }
      if (
        previous.activeTabId === input.activeTabId &&
        JSON.stringify(previous.tabs) === JSON.stringify(input.tabs)
      ) {
        return this.snapshot(input.windowId, previous);
      }
      const next: WindowRecord = {
        tabs: structuredClone(input.tabs),
        activeTabId: input.activeTabId,
        revision: previous.revision + 1,
        rendererRevision: previous.revision + 1,
      };
      this.windows.set(input.windowId, next);
      await this.persist();
      const snapshot = this.snapshot(input.windowId, next);
      this.emit(input.windowId, snapshot);
      return snapshot;
    });
  }

  openExtensionTab(input: {
    preferInstanceId?: string;
    windowId: string;
    extensionId: string;
    contributionId: string;
    scope: DesktopWorkspaceExtensionToolTab["scope"];
    initialParams?: unknown;
    icon?: DesktopWorkspaceExtensionToolTab["icon"];
    reuse: "new" | "context";
  }): Promise<DesktopWorkspaceExtensionToolTab> {
    return this.enqueue(async () => {
      await this.ensureLoaded();
      const record = await this.ensureWindow(input.windowId);
      if (input.reuse === "context") {
        const candidates = record.tabs.filter(
          (tab): tab is DesktopWorkspaceExtensionToolTab =>
            tab.kind === "extension" &&
            tab.extensionId === input.extensionId &&
            tab.contributionId === input.contributionId &&
            JSON.stringify(tab.scope) === JSON.stringify(input.scope),
        );
        const existing =
          candidates.find((tab) => tab.instanceId === input.preferInstanceId) ??
          candidates.find((tab) => tab.id === record.activeTabId) ??
          candidates[0];
        if (existing) {
          if (record.activeTabId !== existing.id || input.initialParams !== undefined) {
            if (input.initialParams !== undefined) {
              existing.initialParams = structuredClone(input.initialParams);
              existing.navigationRevision = (existing.navigationRevision ?? 0) + 1;
            }
            record.activeTabId = existing.id;
            record.revision += 1;
            await this.persist();
            this.emit(input.windowId, this.snapshot(input.windowId, record));
          }
          return structuredClone(existing);
        }
      }
      const tab = createExtensionWorkspaceToolTab({
        extensionId: input.extensionId,
        contributionId: input.contributionId,
        scope: input.scope,
        ...(input.initialParams === undefined ? {} : { initialParams: input.initialParams }),
        ...(input.icon ? { icon: input.icon } : {}),
      });
      record.tabs = [...record.tabs, tab];
      record.activeTabId = tab.id;
      record.revision += 1;
      await this.persist();
      this.emit(input.windowId, this.snapshot(input.windowId, record));
      return structuredClone(tab);
    });
  }

  focusExtensionTab(input: {
    windowId: string;
    extensionId: string;
    instanceId: string;
  }): Promise<DesktopWorkspaceToolsSnapshot> {
    return this.enqueue(async () => {
      await this.ensureLoaded();
      const record = await this.ensureWindow(input.windowId);
      const tab = requireOwnedExtensionTab(record, input);
      if (record.activeTabId !== tab.id) {
        record.activeTabId = tab.id;
        record.revision += 1;
        await this.persist();
        this.emit(input.windowId, this.snapshot(input.windowId, record));
      }
      return this.snapshot(input.windowId, record);
    });
  }

  closeExtensionTab(input: {
    windowId: string;
    extensionId: string;
    instanceId: string;
  }): Promise<DesktopWorkspaceToolsSnapshot> {
    return this.enqueue(async () => {
      await this.ensureLoaded();
      const record = await this.ensureWindow(input.windowId);
      requireOwnedExtensionTab(record, input);
      record.tabs = record.tabs.filter((tab) => tab.id !== input.instanceId);
      record.revision += 1;
      if (!record.tabs.some((tab) => tab.id === record.activeTabId)) {
        record.activeTabId = defaultActiveWorkspaceToolTabId(record.tabs);
      }
      await this.persist();
      const snapshot = this.snapshot(input.windowId, record);
      this.emit(input.windowId, snapshot);
      return snapshot;
    });
  }

  updateExtensionTab(input: {
    windowId: string;
    extensionId: string;
    instanceId: string;
    patch: {
      title?: string;
      icon?: DesktopWorkspaceExtensionToolTab["icon"];
      dirty?: boolean;
    };
  }): Promise<DesktopWorkspaceExtensionToolTab> {
    return this.enqueue(async () => {
      await this.ensureLoaded();
      const record = await this.ensureWindow(input.windowId);
      requireOwnedExtensionTab(record, input);
      let updated: DesktopWorkspaceExtensionToolTab | undefined;
      record.tabs = record.tabs.map((tab) => {
        if (tab.kind !== "extension" || tab.id !== input.instanceId) {
          return tab;
        }
        updated = {
          ...tab,
          ...(input.patch.title === undefined ? {} : { tabTitle: input.patch.title || undefined }),
          ...(input.patch.icon === undefined ? {} : { icon: input.patch.icon }),
          ...(input.patch.dirty === undefined ? {} : { tabDirty: input.patch.dirty || undefined }),
        };
        return updated;
      });
      if (!updated) {
        throw new Error(`Extension tab not found: ${input.instanceId}`);
      }
      record.revision += 1;
      await this.persist();
      this.emit(input.windowId, this.snapshot(input.windowId, record));
      return structuredClone(updated);
    });
  }

  async markRestoreReady(contexts: WorkspaceToolTabsRestoreContexts): Promise<void> {
    await this.enqueue(async () => {
      await this.ensureLoaded();
      if (this.restoreReady) {
        return;
      }
      const contributions = enabledContributions(contexts.extensions);
      let changed = false;
      for (const record of this.windows.values()) {
        const tabs = record.tabs.filter((tab) => {
          if (tab.kind !== "extension") {
            return true;
          }
          if (!contributions.has(`${tab.extensionId}\0${tab.contributionId}`)) {
            changed = true;
            return false;
          }
          if (
            tab.scope.kind === "workspace" &&
            !contexts.workspaceRoots.has(tab.scope.workspaceRoot)
          ) {
            changed = true;
            return false;
          }
          if (tab.scope.kind === "session" && !contexts.sessionKeys.has(tab.scope.sessionKey)) {
            changed = true;
            return false;
          }
          return true;
        });
        if (tabs.length !== record.tabs.length) {
          record.tabs = tabs;
          record.revision += 1;
          if (!tabs.some((tab) => tab.id === record.activeTabId)) {
            record.activeTabId = defaultActiveWorkspaceToolTabId(tabs);
          }
        }
      }
      this.restoreReady = true;
      if (changed) {
        await this.persist();
      }
      for (const [windowId, record] of this.windows) {
        this.emit(windowId, this.snapshot(windowId, record));
      }
    });
  }

  async reconcileExtensions(extensions: readonly DesktopExtensionListItem[]): Promise<void> {
    await this.enqueue(async () => {
      await this.ensureLoaded();
      if (!this.restoreReady) {
        return;
      }
      const contributions = enabledContributions(extensions);
      for (const [windowId, record] of this.windows) {
        const tabs = record.tabs.filter(
          (tab) =>
            tab.kind !== "extension" ||
            contributions.has(`${tab.extensionId}\0${tab.contributionId}`),
        );
        if (tabs.length === record.tabs.length) {
          continue;
        }
        record.tabs = tabs;
        record.revision += 1;
        if (!tabs.some((tab) => tab.id === record.activeTabId)) {
          record.activeTabId = defaultActiveWorkspaceToolTabId(tabs);
        }
        await this.persist();
        this.emit(windowId, this.snapshot(windowId, record));
      }
    });
  }

  async rebindSessionScope(previousKey: string, nextKey: string): Promise<void> {
    if (!previousKey || previousKey === nextKey) {
      return;
    }
    await this.enqueue(async () => {
      await this.ensureLoaded();
      for (const [windowId, record] of this.windows) {
        let changed = false;
        const tabs = record.tabs.map((tab) => {
          if (
            tab.kind !== "extension" ||
            tab.scope.kind !== "session" ||
            tab.scope.sessionKey !== previousKey
          ) {
            return tab;
          }
          changed = true;
          return { ...tab, scope: { kind: "session" as const, sessionKey: nextKey } };
        });
        if (!changed) {
          continue;
        }
        record.tabs = tabs;
        record.revision += 1;
        await this.persist();
        this.emit(windowId, this.snapshot(windowId, record));
      }
    });
  }

  subscribe(
    listener: (windowId: string, snapshot: DesktopWorkspaceToolsSnapshot) => void,
  ): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(work);
    this.tail = result.catch(() => undefined);
    return result;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) {
      return;
    }
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.loaded = true;
        return;
      }
      throw error;
    }
    const parsed = JSON.parse(raw) as Partial<PersistedStore>;
    if (
      parsed.schemaVersion !== STORE_SCHEMA_VERSION ||
      !parsed.windows ||
      typeof parsed.windows !== "object"
    ) {
      throw new Error("Invalid workspace tool tabs persistence format.");
    }
    for (const [windowId, record] of Object.entries(parsed.windows)) {
      if (!record || !Array.isArray(record.tabs) || typeof record.activeTabId !== "string") {
        throw new Error(`Invalid workspace tool tabs window record: ${windowId}`);
      }
      const restoredTabs = record.tabs.map(restoreTab);
      assertValidTabs(restoredTabs);
      this.windows.set(windowId, {
        tabs: restoredTabs,
        activeTabId: record.activeTabId,
        revision: 0,
        rendererRevision: 0,
      });
    }
    this.loaded = true;
  }

  private async ensureWindow(windowId: string): Promise<WindowRecord> {
    const existing = this.windows.get(windowId);
    if (existing) {
      return existing;
    }
    const initial = createInitialWorkspaceToolsState(true);
    const record: WindowRecord = {
      tabs: initial.tabs,
      activeTabId: initial.activeTabId,
      revision: 0,
      rendererRevision: 0,
    };
    this.windows.set(windowId, record);
    await this.persist();
    return record;
  }

  private snapshot(windowId: string, record: WindowRecord): DesktopWorkspaceToolsSnapshot {
    return {
      windowId,
      tabs: structuredClone(record.tabs),
      activeTabId: record.activeTabId,
      restoreReady: this.restoreReady,
      revision: record.revision,
    };
  }

  private async persist(): Promise<void> {
    const windows: Record<string, PersistedWindowRecord> = {};
    for (const [windowId, record] of this.windows) {
      windows[windowId] = {
        tabs: record.tabs.map(persistTab),
        activeTabId: record.activeTabId,
      };
    }
    const document: PersistedStore = { schemaVersion: STORE_SCHEMA_VERSION, windows };
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    await rename(temporary, this.filePath);
  }

  private emit(windowId: string, snapshot: DesktopWorkspaceToolsSnapshot): void {
    for (const listener of this.listeners) {
      listener(windowId, structuredClone(snapshot));
    }
  }
}

function enabledContributions(extensions: readonly DesktopExtensionListItem[]): Set<string> {
  const result = new Set<string>();
  for (const extension of extensions) {
    if (!extension.enabled) {
      continue;
    }
    for (const tab of extension.desktopTabs ?? []) {
      result.add(`${extension.id}\0${tab.id}`);
    }
  }
  return result;
}

function requireOwnedExtensionTab(
  record: WindowRecord,
  input: { extensionId: string; instanceId: string },
): DesktopWorkspaceExtensionToolTab {
  const tab = record.tabs.find(
    (candidate): candidate is DesktopWorkspaceExtensionToolTab =>
      candidate.kind === "extension" && candidate.instanceId === input.instanceId,
  );
  if (!tab || tab.extensionId !== input.extensionId) {
    throw new Error(`Extension tab not found or not owned by the caller: ${input.instanceId}`);
  }
  return tab;
}

function persistTab(tab: DesktopWorkspaceToolTab): PersistedTab {
  if (tab.kind === "extension") {
    return {
      id: tab.id,
      kind: "extension",
      extensionId: tab.extensionId,
      contributionId: tab.contributionId,
      instanceId: tab.instanceId,
      scope: structuredClone(tab.scope),
      ...(tab.navigationRevision === undefined
        ? {}
        : { navigationRevision: tab.navigationRevision }),
      ...(tab.initialParams === undefined
        ? {}
        : { initialParams: structuredClone(tab.initialParams) }),
    };
  }
  return {
    id: tab.id,
    kind: "built-in",
    builtInKind: tab.builtInKind,
    ...(tab.browserUrl === undefined ? {} : { browserUrl: tab.browserUrl }),
    ...(tab.filesWorkspacePath === undefined ? {} : { filesWorkspacePath: tab.filesWorkspacePath }),
    ...(tab.filesViewMode === undefined ? {} : { filesViewMode: tab.filesViewMode }),
    ...(tab.taskKey === undefined ? {} : { taskKey: tab.taskKey }),
    ...(tab.pinnedTitle === undefined ? {} : { pinnedTitle: tab.pinnedTitle }),
    ...(tab.builtInKind === "task" && tab.tabTitle ? { tabTitle: tab.tabTitle } : {}),
  };
}

function restoreTab(tab: PersistedTab): DesktopWorkspaceToolTab {
  if (tab.kind !== "extension") {
    return persistTab(tab) as DesktopWorkspaceToolTab;
  }
  return createExtensionWorkspaceToolTab({
    extensionId: tab.extensionId,
    contributionId: tab.contributionId,
    instanceId: tab.instanceId,
    scope: tab.scope,
    ...(tab.navigationRevision === undefined ? {} : { navigationRevision: tab.navigationRevision }),
    ...(tab.initialParams === undefined ? {} : { initialParams: tab.initialParams }),
  });
}

function assertValidTabs(tabs: readonly DesktopWorkspaceToolTab[]): void {
  const ids = new Set<string>();
  for (const tab of tabs) {
    if (!tab || typeof tab.id !== "string" || !tab.id || ids.has(tab.id)) {
      throw new Error("Workspace tool tabs require unique non-empty ids.");
    }
    ids.add(tab.id);
    if (tab.kind === "built-in") {
      if (!["files", "terminal", "git", "browser", "task"].includes(tab.builtInKind)) {
        throw new Error(`Invalid built-in workspace tool tab: ${tab.id}`);
      }
      continue;
    }
    if (tab.kind !== "extension") {
      throw new Error("Invalid workspace tool tab kind.");
    }
    assertValidExtensionTab(tab);
  }
}

function assertValidExtensionTab(tab: DesktopWorkspaceExtensionToolTab): void {
  if (
    !tab.extensionId ||
    !tab.contributionId ||
    !tab.instanceId ||
    !tab.channelId ||
    tab.id !== tab.instanceId
  ) {
    throw new Error(`Invalid extension workspace tool tab identity: ${tab.id}`);
  }
  if (tab.scope.kind === "workspace" && !tab.scope.workspaceRoot) {
    throw new Error(`Extension tab ${tab.id} requires a workspace identity.`);
  }
  if (tab.scope.kind === "session" && !tab.scope.sessionKey) {
    throw new Error(`Extension tab ${tab.id} requires a session identity.`);
  }
  if (!["window-shared", "workspace", "session"].includes(tab.scope.kind)) {
    throw new Error(`Invalid extension tab scope: ${tab.id}`);
  }
}
