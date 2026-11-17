import type {
  DesktopExtensionTabChromePatch,
  DesktopExtensionTabOpenRequest,
  DesktopWorkspaceExtensionToolTab,
} from "../types.js";
import i18n from "../lib/i18n-host.js";
import type { DesktopExtensionWebViews } from "./extension-web-view-contracts.js";

export interface DesktopExtensionMessageBoxRequest {
  title: string;
  message: string;
  detail?: string;
  buttons?: string[];
  cancelId?: number;
  defaultId?: number;
  noLink?: boolean;
  type?: "none" | "info" | "error" | "question" | "warning";
}

export interface DesktopExtensionViewSession {
  readonly requestId: string;
  readonly result: Promise<unknown>;
  update(params: unknown): void;
  close(result?: unknown): void;
}

export interface DesktopExtensionHostUi {
  open(viewId: string, params?: unknown): Promise<DesktopExtensionViewSession>;
}

export interface DesktopExtensionHostAutomationTriggers {
  update(
    contributionId: string,
    patch: {
      name?: string;
      icon?: import("@spiritagent/api/types").DesktopExtensionDesktopTabRuntimeIcon;
    },
  ): Promise<void>;
}

export interface DesktopExtensionHostTabs {
  open(request: DesktopExtensionTabOpenRequest): Promise<DesktopWorkspaceExtensionToolTab>;
  focus(instanceId: string): Promise<void>;
  close(instanceId: string): Promise<void>;
  update(instanceId: string, patch: DesktopExtensionTabChromePatch): Promise<void>;
  emit(instanceId: string, event: string, params?: unknown): void;
}

export interface DesktopExtensionHostAdapter {
  /** Set on extension-bound adapters; the extension manager preserves per-request window binding. */
  readonly boundExtensionId?: string;
  showMessageBox(request: DesktopExtensionMessageBoxRequest): Promise<void>;
  openExternal(url: string): Promise<void>;
  ui: DesktopExtensionHostUi;
  automationTriggers: DesktopExtensionHostAutomationTriggers;
  tabs: DesktopExtensionHostTabs;
  webViews: DesktopExtensionWebViews;
  forExtension(extensionId: string, windowId?: string): DesktopExtensionHostAdapter;
}

let desktopExtensionHostAdapter: DesktopExtensionHostAdapter | undefined;

export function setDesktopExtensionHostAdapter(
  adapter: DesktopExtensionHostAdapter | undefined,
): void {
  desktopExtensionHostAdapter = adapter;
}

export function getDesktopExtensionHostAdapter(): DesktopExtensionHostAdapter | undefined {
  return desktopExtensionHostAdapter;
}

export function requireDesktopExtensionHostAdapter(): DesktopExtensionHostAdapter {
  if (!desktopExtensionHostAdapter) {
    throw new Error(i18n.t("error.extensionHostNotAvailable"));
  }
  return desktopExtensionHostAdapter;
}
