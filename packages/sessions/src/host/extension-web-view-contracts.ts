import type { DesktopExtensionWebViewState } from "../types.js";

export interface DesktopExtensionWebViews {
  navigate(viewId: string, url: string): Promise<DesktopExtensionWebViewState>;
  getState(viewId: string): Promise<DesktopExtensionWebViewState>;
  capture(viewId: string): Promise<string>;
  executeScript(viewId: string, code: string): Promise<unknown>;
}

export interface DesktopExtensionWebViewOwner {
  extensionId: string;
  contributionId: string;
  instanceId: string;
  channelId: string;
  capabilities: ReadonlySet<string>;
}
