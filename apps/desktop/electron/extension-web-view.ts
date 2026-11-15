import { randomUUID } from "node:crypto";

import { BrowserWindow, WebContentsView, type WebContents } from "electron";

import type {
  DesktopExtensionWebViewBounds,
  DesktopExtensionWebViewEvent,
  DesktopExtensionWebViewRequest,
  DesktopExtensionWebViewState,
} from "../src/types.js";
import type { DesktopExtensionWebViewOwner } from "@spiritagent/sessions/host/extension-web-view-contracts";

type WebViewRecord = {
  owner: DesktopExtensionWebViewOwner;
  windowId: string;
  host: WebContents;
  view: WebContentsView;
  state: DesktopExtensionWebViewState;
};

export function isExtensionWebViewUrlAllowed(value: string): boolean {
  if (value === "about:blank") {
    return true;
  }
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function scaleExtensionWebViewBounds(
  bounds: DesktopExtensionWebViewBounds,
  zoomFactor: number,
): DesktopExtensionWebViewBounds {
  const zoom = Number.isFinite(zoomFactor) && zoomFactor > 0 ? zoomFactor : 1;
  return {
    x: Math.round(bounds.x * zoom),
    y: Math.round(bounds.y * zoom),
    width: Math.max(0, Math.round(bounds.width * zoom)),
    height: Math.max(0, Math.round(bounds.height * zoom)),
  };
}

export class ExtensionWebViewManager {
  private readonly records = new Map<string, WebViewRecord>();

  constructor(
    private readonly deps: {
      resolveOwner: (input: {
        extensionId: string;
        instanceId: string;
        windowId: string;
      }) => Promise<DesktopExtensionWebViewOwner | null>;
      publish: (event: DesktopExtensionWebViewEvent) => void;
    },
  ) {}

  async handleRenderer(
    sender: WebContents,
    request: DesktopExtensionWebViewRequest,
    windowId: string,
  ): Promise<unknown> {
    if (request.operation === "create") {
      return this.create(sender, request, windowId);
    }
    if (request.operation === "bounds") {
      const record = this.requireRendererRecord(sender, request.viewId, "desktop-webview-display");
      record.view.setBounds(scaleExtensionWebViewBounds(request.bounds, sender.zoomFactor));
      record.view.setVisible(
        request.visible && request.bounds.width > 0 && request.bounds.height > 0,
      );
      return this.getState(record);
    }
    if (request.operation === "destroy") {
      this.destroy(request.viewId, sender);
      return undefined;
    }
    if (request.operation === "navigate") {
      const record = this.requireRendererRecord(sender, request.viewId, "desktop-webview-control");
      return this.navigate(record, request.url);
    }
    if (request.operation === "getState") {
      return this.getState(
        this.requireRendererRecord(sender, request.viewId, "desktop-webview-control"),
      );
    }
    if (request.operation === "capture") {
      return this.capture(
        this.requireRendererRecord(sender, request.viewId, "desktop-webview-control"),
      );
    }
    const record = this.requireRendererRecord(sender, request.viewId, "desktop-webview-script");
    return this.executeScript(record, request.code);
  }

  async navigateBackend(
    extensionId: string,
    viewId: string,
    url: string,
  ): Promise<DesktopExtensionWebViewState> {
    return this.navigate(
      this.requireBackendRecord(extensionId, viewId, "desktop-webview-control"),
      url,
    );
  }

  async getStateBackend(
    extensionId: string,
    viewId: string,
  ): Promise<DesktopExtensionWebViewState> {
    return this.getState(this.requireBackendRecord(extensionId, viewId, "desktop-webview-control"));
  }

  async captureBackend(extensionId: string, viewId: string): Promise<string> {
    return this.capture(this.requireBackendRecord(extensionId, viewId, "desktop-webview-control"));
  }

  async executeScriptBackend(extensionId: string, viewId: string, code: string): Promise<unknown> {
    return this.executeScript(
      this.requireBackendRecord(extensionId, viewId, "desktop-webview-script"),
      code,
    );
  }

  disposeAllForWebContents(host: WebContents): void {
    for (const record of this.records.values()) {
      if (record.host.id === host.id) {
        this.destroyRecord(record);
      }
    }
  }

  private async create(
    sender: WebContents,
    request: Extract<DesktopExtensionWebViewRequest, { operation: "create" }>,
    windowId: string,
  ): Promise<DesktopExtensionWebViewState> {
    const owner = await this.deps.resolveOwner({
      extensionId: request.extensionId,
      instanceId: request.instanceId,
      windowId,
    });
    if (!owner || owner.contributionId !== request.contributionId) {
      throw new Error("Extension web view identity does not match a live tab.");
    }
    requireExtensionWebViewCapability(owner, "desktop-webview-display");
    const url = normalizeUrl(request.url);
    const ownerWindow = BrowserWindow.fromWebContents(sender);
    if (!ownerWindow) {
      throw new Error("The extension web view has no owning BrowserWindow.");
    }
    const viewId = randomUUID();
    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: false,
        partition: `extension-webview-${viewId}`,
      },
    });
    const record: WebViewRecord = {
      owner,
      windowId,
      host: sender,
      view,
      state: {
        viewId,
        url,
        title: "",
        isLoading: true,
        canGoBack: false,
        canGoForward: false,
      },
    };
    this.records.set(viewId, record);
    view.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
      callback(false),
    );
    view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    view.webContents.on("will-navigate", (event) => {
      if (!isExtensionWebViewUrlAllowed(event.url)) {
        event.preventDefault();
      }
    });
    const publish = () => this.publishState(record);
    view.webContents.on("did-start-loading", publish);
    view.webContents.on("did-stop-loading", publish);
    view.webContents.on("did-navigate", publish);
    view.webContents.on("did-navigate-in-page", publish);
    view.webContents.on("page-title-updated", publish);
    view.webContents.on("did-fail-load", (_event, _code, description) => {
      record.state.error = description;
      record.state.isLoading = false;
      publish();
    });
    view.webContents.once("destroyed", () => {
      this.records.delete(viewId);
    });
    ownerWindow.contentView.addChildView(view);
    view.setBounds(scaleExtensionWebViewBounds(request.bounds, sender.zoomFactor));
    view.setVisible(request.visible && request.bounds.width > 0 && request.bounds.height > 0);
    try {
      await view.webContents.loadURL(url);
    } catch (error) {
      record.state.error = error instanceof Error ? error.message : String(error);
      record.state.isLoading = false;
    }
    this.refreshState(record);
    this.publishState(record);
    return this.getState(record);
  }

  private async navigate(
    record: WebViewRecord,
    rawUrl: string,
  ): Promise<DesktopExtensionWebViewState> {
    const url = normalizeUrl(rawUrl);
    record.state.error = undefined;
    record.state.isLoading = true;
    this.publishState(record);
    try {
      await record.view.webContents.loadURL(url);
    } catch (error) {
      record.state.error = error instanceof Error ? error.message : String(error);
      record.state.isLoading = false;
    }
    this.refreshState(record);
    this.publishState(record);
    return this.getState(record);
  }

  private getState(record: WebViewRecord): DesktopExtensionWebViewState {
    this.refreshState(record);
    return { ...record.state };
  }

  private async capture(record: WebViewRecord): Promise<string> {
    const image = await record.view.webContents.capturePage();
    return image.toDataURL();
  }

  private async executeScript(record: WebViewRecord, code: string): Promise<unknown> {
    if (typeof code !== "string") {
      throw new Error("Extension web view script must be a string.");
    }
    const result: unknown = await record.view.webContents.executeJavaScript(code, true);
    if (result === undefined) {
      return null;
    }
    const serialized = JSON.stringify(result);
    if (serialized === undefined) {
      throw new Error("Extension web view script result must be JSON-serializable.");
    }
    return JSON.parse(serialized) as unknown;
  }

  private refreshState(record: WebViewRecord): void {
    if (record.view.webContents.isDestroyed()) {
      return;
    }
    record.state.url = record.view.webContents.getURL() || record.state.url;
    record.state.title = record.view.webContents.getTitle();
    record.state.isLoading = record.view.webContents.isLoading();
    record.state.canGoBack = record.view.webContents.navigationHistory.canGoBack();
    record.state.canGoForward = record.view.webContents.navigationHistory.canGoForward();
  }

  private publishState(record: WebViewRecord): void {
    if (!record.owner.capabilities.has("desktop-webview-control")) {
      return;
    }
    this.refreshState(record);
    this.deps.publish({
      windowId: record.windowId,
      extensionId: record.owner.extensionId,
      contributionId: record.owner.contributionId,
      instanceId: record.owner.instanceId,
      channelId: record.owner.channelId,
      state: { ...record.state },
    });
  }

  private requireRendererRecord(
    sender: WebContents,
    viewId: string,
    capability: "desktop-webview-display" | "desktop-webview-control" | "desktop-webview-script",
  ): WebViewRecord {
    const record = this.records.get(viewId);
    if (!record || record.host.id !== sender.id) {
      throw new Error("Extension web view is not owned by this renderer.");
    }
    requireExtensionWebViewCapability(record.owner, capability);
    return record;
  }

  private requireBackendRecord(
    extensionId: string,
    viewId: string,
    capability: "desktop-webview-control" | "desktop-webview-script",
  ): WebViewRecord {
    const record = this.records.get(viewId);
    if (!record || record.owner.extensionId !== extensionId) {
      throw new Error("Extension web view is not owned by this extension.");
    }
    requireExtensionWebViewCapability(record.owner, capability);
    return record;
  }

  private destroy(viewId: string, sender?: WebContents): void {
    const record = this.records.get(viewId);
    if (!record) {
      return;
    }
    if (sender && record.host.id !== sender.id) {
      throw new Error("Extension web view is not owned by this renderer.");
    }
    this.destroyRecord(record);
  }

  private destroyRecord(record: WebViewRecord): void {
    this.records.delete(record.state.viewId);
    const ownerWindow = BrowserWindow.fromWebContents(record.host);
    if (ownerWindow && !ownerWindow.isDestroyed()) {
      ownerWindow.contentView.removeChildView(record.view);
    }
    if (!record.view.webContents.isDestroyed()) {
      record.view.webContents.close({ waitForBeforeUnload: false });
    }
  }
}

export function requireExtensionWebViewCapability(
  owner: DesktopExtensionWebViewOwner,
  capability: "desktop-webview-display" | "desktop-webview-control" | "desktop-webview-script",
): void {
  if (!owner.capabilities.has(capability)) {
    throw new Error(`The extension does not declare ${capability}.`);
  }
  if (
    capability === "desktop-webview-script" &&
    !owner.capabilities.has("desktop-webview-control")
  ) {
    throw new Error("desktop-webview-script also requires desktop-webview-control.");
  }
}

function normalizeUrl(rawUrl: string): string {
  const url = rawUrl.trim() || "about:blank";
  if (!isExtensionWebViewUrlAllowed(url)) {
    throw new Error("Extension web views only allow about:blank, http:, and https: URLs.");
  }
  return url;
}
