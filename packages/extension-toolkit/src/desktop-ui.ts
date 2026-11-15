/** Props for a precompiled Desktop view: `export default function View(props)`. */
export interface SpiritDesktopViewProps {
  params: unknown;
  close: (result?: unknown) => void;
}

export type SpiritDesktopView = (props: SpiritDesktopViewProps) => unknown;

export type SpiritDesktopTabScope = "window-shared" | "workspace" | "session";
export type SpiritDesktopTabIcon =
  | { type: "spirit"; name: string }
  | { type: "file"; path: string }
  | { type: "image"; dataUrl: string };

export interface SpiritDesktopTabOpenRequest {
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
  scope: unknown;
  workspaceRoot: string;
  sessionKey: string;
  visible: boolean;
  theme: {
    htmlClassName: string;
    htmlStyle: string;
    cssText: string;
  };
}

export interface SpiritDesktopTabPageApi {
  ready(): Promise<SpiritDesktopTabPageContext>;
  request(method: string, params?: unknown): Promise<unknown>;
  onEvent(listener: (event: { event: string; params?: unknown }) => void): () => void;
  setChrome(patch: SpiritDesktopTabChromePatch): void;
  onContextChange(listener: (context: SpiritDesktopTabPageContext) => void): () => void;
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
  openExternal(url: string): Promise<void>;
  automationTriggers: SpiritDesktopAutomationTriggerHost;
}

export interface SpiritDesktopActionContext {
  host: SpiritDesktopActionHost;
  actionId: string;
  params?: unknown;
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
    delete(key: string): Promise<void>;
  };
}
