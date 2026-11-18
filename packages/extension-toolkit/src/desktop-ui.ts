export type SpiritDesktopTabScope = "window-shared" | "workspace" | "session";
export type SpiritDesktopTabIcon =
  | { type: "spirit"; name: string }
  | { type: "file"; path: string; monochrome?: boolean }
  | { type: "image"; dataUrl: string; monochrome?: boolean };

export interface SpiritDesktopTabOpenRequest {
  preferInstanceId?: string;
  contributionId: string;
  scope?:
    | { kind: "window-shared" }
    | { kind: "workspace"; workspaceRoot?: string }
    | { kind: "session"; sessionKey?: string };
  initialParams?: unknown;
  reuse: "new" | "context";
  windowId?: string;
}

export interface SpiritDesktopTabInstance {
  id: string;
  kind: "extension";
  extensionId: string;
  contributionId: string;
  instanceId: string;
  channelId: string;
  scope: unknown;
  initialParams?: unknown;
  tabTitle?: string;
  tabDirty?: boolean;
}

export interface SpiritDesktopTabChromePatch {
  title?: string;
  icon?: SpiritDesktopTabIcon;
  dirty?: boolean;
}

export interface SpiritDesktopTabsHost {
  open(request: SpiritDesktopTabOpenRequest): Promise<SpiritDesktopTabInstance>;
  focus(instanceId: string): Promise<void>;
  close(instanceId: string): Promise<void>;
  update(instanceId: string, patch: SpiritDesktopTabChromePatch): Promise<void>;
  emit(instanceId: string, event: string, params?: unknown): void;
}

export interface SpiritDesktopWebViewState {
  viewId: string;
  url: string;
  title: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  error?: string;
}

export interface SpiritDesktopWebViewsHost {
  navigate(viewId: string, url: string): Promise<SpiritDesktopWebViewState>;
  getState(viewId: string): Promise<SpiritDesktopWebViewState>;
  capture(viewId: string): Promise<string>;
  executeScript(viewId: string, code: string): Promise<unknown>;
}

export interface SpiritDesktopTabPageContext {
  extensionId: string;
  contributionId: string;
  instanceId: string;
  channelId: string;
  initialParams?: unknown;
  navigationRevision?: number;
  scope: unknown;
  workspaceRoot: string;
  workspace: { isRepository: boolean; branch: string };
  authorizationConfigured?: boolean;
  sessionKey: string;
  visible: boolean;
  locale: string;
  theme: {
    htmlClassName: string;
    htmlStyle: string;
    cssText: string;
  };
}

export interface SpiritDesktopViewPageContext {
  extensionId: string;
  contributionId: string;
  instanceId: string;
  channelId: string;
  params?: unknown;
  visible: boolean;
  locale: string;
  theme: SpiritDesktopTabPageContext["theme"];
}

/** Common document bridge; bundle application dependencies with the extension page. */
export interface SpiritDesktopPageApi<TContext = SpiritDesktopTabPageContext> {
  ready(): Promise<TContext>;
  /** Call after the application has committed its first render. */
  mounted(): void;
  fail(error: unknown): void;
  openExternal(url: string): Promise<void>;
  openExtensionDetails(): Promise<void>;
  /** Inserts a chip into the owning conversation; never sends a message. Tabs only. */
  addAttachment(attachment: SpiritComposerAttachment): Promise<void>;
  request(method: string, params?: unknown): Promise<unknown>;
  onEvent(listener: (event: { event: string; params?: unknown }) => void): () => void;
  onContextChange(listener: (context: TContext) => void): () => void;
}

export type SpiritComposerAttachment =
  | {
      kind: "prDiff";
      prUrl: string;
      filename: string;
      lineStart: number;
      lineEnd: number;
      diffText: string;
      status: "open" | "closed" | "merged" | "draft";
    }
  | {
      kind: "fileSnippet";
      filePath: string;
      lineStart: number;
      lineEnd: number;
      selectedText: string;
    }
  | {
      kind: "terminalSnippet";
      terminalName: string;
      lineStart: number;
      lineEnd: number;
      selectedText: string;
    };
export interface SpiritDesktopTabPageApi extends SpiritDesktopPageApi {
  setChrome(patch: SpiritDesktopTabChromePatch): void;
}

export interface SpiritDesktopViewPageApi extends SpiritDesktopPageApi<SpiritDesktopViewPageContext> {
  close(result?: unknown): void;
}

export interface SpiritDesktopWebViewPageApi {
  viewId: string;
  navigate(url: string): Promise<SpiritDesktopWebViewState>;
  getState(): Promise<SpiritDesktopWebViewState>;
  capture(): Promise<string>;
  executeScript(code: string): Promise<unknown>;
  destroy(): Promise<void>;
  onEvent(listener: (state: SpiritDesktopWebViewState) => void): () => void;
}

export interface SpiritDesktopWebViewsPageApi {
  create(region: Element, options?: { url?: string }): Promise<SpiritDesktopWebViewPageApi>;
}

export interface SpiritDesktopViewSession {
  readonly requestId: string;
  readonly result: Promise<unknown>;
  update(params: unknown): void;
  close(result?: unknown): void;
}

export interface SpiritDesktopViewHost {
  open(viewId: string, params?: unknown): Promise<SpiritDesktopViewSession>;
}

export interface SpiritDesktopAutomationTriggerHost {
  update(
    contributionId: string,
    patch: { name?: string; icon?: SpiritDesktopTabIcon },
  ): Promise<void>;
}

export interface SpiritDesktopActionHost {
  ui: SpiritDesktopViewHost;
  tabs: SpiritDesktopTabsHost;
  openExternal(url: string): Promise<void>;
  automationTriggers: SpiritDesktopAutomationTriggerHost;
}

export interface SpiritExtensionContext {
  extension: {
    id: string;
    name: string;
    version: string;
    directoryPath: string;
    manifestPath: string;
    main: string;
  };
  host: SpiritDesktopActionHost;
  /** Aborted when this activated extension is disabled, removed, or replaced. */
  signal: AbortSignal;
  log(message: string): void;
  settings: {
    get(key: string): Promise<string | number | boolean | null | undefined>;
    getAll(): Promise<Record<string, string | number | boolean | null>>;
    set(key: string, value: string | number | boolean | null): Promise<void>;
    setAll(
      values: Record<string, string | number | boolean | null>,
    ): Promise<Record<string, string | number | boolean | null>>;
  };
  secrets: {
    get(key: string): Promise<string | undefined>;
    has(key: string): Promise<boolean>;
    set(key: string, value: string): Promise<void>;
    /** Atomically reads and writes a declared Secret across extension-host processes. */
    update(
      key: string,
      updater: (current: string | undefined) => string | undefined | Promise<string | undefined>,
    ): Promise<string | undefined>;
    delete(key: string): Promise<void>;
  };
}

export interface SpiritDesktopActionContext extends SpiritExtensionContext {
  actionId: string;
  params?: unknown;
}

export interface SpiritDesktopPageRequestContext extends SpiritExtensionContext {
  contributionId: string;
  instanceId: string;
  method: string;
  params?: unknown;
  /** Resolved by the host from the live page, never supplied by the iframe. */
  context: { workspaceRoot: string; sessionKey: string; branch: string };
}

export interface SpiritDesktopOpenLinkContext extends SpiritExtensionContext {
  actionId: string;
  url: string;
  sourceTabId?: string;
}
