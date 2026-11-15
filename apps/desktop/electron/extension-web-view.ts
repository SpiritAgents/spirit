import { randomUUID } from "node:crypto";

import { type WebContents } from "electron";

import type {
  DesktopExtensionWebViewEvent,
  DesktopExtensionWebViewRequest,
  DesktopExtensionWebViewState,
} from "../src/types.js";
import type { DesktopExtensionWebViewOwner } from "@spiritagent/sessions/host/extension-web-view-contracts";
import { requireOwnedWebviewGuest } from "./workspace-browser-guest.js";

type WebViewRecord = {
  owner: DesktopExtensionWebViewOwner;
  windowId: string;
  host: WebContents;
  guest?: WebContents;
  initialUrl: string;
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
    if (request.operation === "attach") {
      return this.attach(sender, request);
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
    const initialUrl = normalizeUrl(request.url);
    const viewId = randomUUID();
    const record: WebViewRecord = {
      owner,
      windowId,
      host: sender,
      initialUrl,
      state: {
        viewId,
        url: initialUrl,
        title: "",
        isLoading: false,
        canGoBack: false,
        canGoForward: false,
      },
    };
    this.records.set(viewId, record);
    return this.getState(record);
  }

  private async attach(
    sender: WebContents,
    request: Extract<DesktopExtensionWebViewRequest, { operation: "attach" }>,
  ): Promise<DesktopExtensionWebViewState> {
    const record = this.requireRendererRecord(sender, request.viewId, "desktop-webview-display");
    if (record.guest) {
      throw new Error("Extension web view is already attached.");
    }
    const initialState = { ...record.state };
    const guest = requireOwnedWebviewGuest(sender, request.guestWebContentsId);
    record.guest = guest;
    guest.session.setPermissionRequestHandler((_contents, _permission, callback) =>
      callback(false),
    );
    guest.setWindowOpenHandler(() => ({ action: "deny" }));
    const enforceNavigationPolicy = (event: { url: string; preventDefault: () => void }) => {
      if (!isExtensionWebViewUrlAllowed(event.url)) {
        event.preventDefault();
      }
    };
    guest.on("will-navigate", enforceNavigationPolicy);
    guest.on("will-redirect", enforceNavigationPolicy);
    const publish = () => this.publishState(record);
    guest.on("did-start-loading", publish);
    guest.on("did-stop-loading", publish);
    guest.on("did-navigate", publish);
    guest.on("did-navigate-in-page", publish);
    guest.on("page-title-updated", publish);
    guest.on("did-fail-load", (_event, _code, description) => {
      record.state.error = description;
      record.state.isLoading = false;
      publish();
    });
    guest.once("destroyed", () => {
      if (this.records.get(record.state.viewId) === record) {
        this.records.delete(record.state.viewId);
      }
    });
    const state = await this.navigate(record, record.initialUrl);
    return record.owner.capabilities.has("desktop-webview-control") ? state : initialState;
  }

  private async navigate(
    record: WebViewRecord,
    rawUrl: string,
  ): Promise<DesktopExtensionWebViewState> {
    const guest = this.requireGuest(record);
    const url = normalizeUrl(rawUrl);
    record.state.error = undefined;
    record.state.isLoading = true;
    this.publishState(record);
    try {
      await guest.loadURL(url);
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
    const image = await this.requireGuest(record).capturePage();
    return image.toDataURL();
  }

  private async executeScript(record: WebViewRecord, code: string): Promise<unknown> {
    if (typeof code !== "string") {
      throw new Error("Extension web view script must be a string.");
    }
    const result: unknown = await this.requireGuest(record).executeJavaScript(code, true);
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
    const guest = record.guest;
    if (!guest || guest.isDestroyed()) {
      return;
    }
    record.state.url = guest.getURL() || record.state.url;
    record.state.title = guest.getTitle();
    record.state.isLoading = guest.isLoading();
    record.state.canGoBack = guest.navigationHistory.canGoBack();
    record.state.canGoForward = guest.navigationHistory.canGoForward();
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

  private requireGuest(record: WebViewRecord): WebContents {
    if (!record.guest || record.guest.isDestroyed()) {
      throw new Error("Extension web view is not attached to a live renderer guest.");
    }
    return record.guest;
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
    if (record.guest && !record.guest.isDestroyed()) {
      record.guest.close({ waitForBeforeUnload: false });
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
