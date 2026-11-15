type ExtensionTabIdentity = {
  channelId: string;
  extensionId: string;
  contributionId: string;
  instanceId: string;
};

type ExtensionTabContext = ExtensionTabIdentity & {
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
};

const pathSegments = location.pathname.split("/").filter(Boolean);
const identity: ExtensionTabIdentity = {
  extensionId: decodeURIComponent(pathSegments[1] ?? ""),
  contributionId: decodeURIComponent(pathSegments[2] ?? ""),
  instanceId: decodeURIComponent(pathSegments[3] ?? ""),
  channelId: new URLSearchParams(location.search).get("channelId") ?? "",
};
let currentContext: ExtensionTabContext | undefined;
let requested = false;
let resolveReady: ((context: ExtensionTabContext) => void) | undefined;
const readyPromise = new Promise<ExtensionTabContext>((resolve) => {
  resolveReady = resolve;
});
const contextListeners = new Set<(context: ExtensionTabContext) => void>();

function post(type: string, payload: Record<string, unknown> = {}): void {
  parent.postMessage({ type, ...identity, ...payload }, "*");
}

function ready(): Promise<ExtensionTabContext> {
  if (!requested) {
    requested = true;
    post("spirit-extension-tab-ready-request");
  }
  return readyPromise;
}

function applyContext(context: ExtensionTabContext): void {
  currentContext = context;
  document.documentElement.className = context.theme.htmlClassName;
  document.documentElement.setAttribute("style", context.theme.htmlStyle);
  let style = document.getElementById("spirit-extension-host-theme");
  if (!style) {
    style = document.createElement("style");
    style.id = "spirit-extension-host-theme";
    document.head.appendChild(style);
  }
  style.textContent = context.theme.cssText;
  resolveReady?.(context);
  for (const listener of contextListeners) {
    listener(context);
  }
  post("spirit-extension-tab-ready");
}

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

const pendingRequests = new Map<string, PendingRequest>();
const eventListeners = new Set<(event: { event: string; params?: unknown }) => void>();

window.addEventListener("message", (event) => {
  if (event.source !== parent) {
    return;
  }
  const data = event.data as Record<string, unknown> & { type?: string };
  if (
    data.extensionId !== identity.extensionId ||
    data.contributionId !== identity.contributionId ||
    data.instanceId !== identity.instanceId ||
    data.channelId !== identity.channelId
  ) {
    return;
  }
  if (data.type === "spirit-extension-tab-context") {
    applyContext(data as ExtensionTabContext);
    return;
  }
  if (data.type === "spirit-extension-tab-result") {
    const requestId = String(data.requestId ?? "");
    const pending = pendingRequests.get(requestId);
    if (!pending) {
      return;
    }
    pendingRequests.delete(requestId);
    if (data.ok === true) {
      pending.resolve(data.result);
    } else {
      pending.reject(new Error(String(data.error ?? "Extension tab request failed.")));
    }
    return;
  }
  if (data.type === "spirit-extension-tab-event") {
    for (const listener of eventListeners) {
      listener({ event: String(data.event ?? ""), params: data.params });
    }
    return;
  }
  if (data.type === "spirit-extension-tab-closed") {
    const error = new Error("The extension tab was closed.");
    for (const pending of pendingRequests.values()) {
      pending.reject(error);
    }
    pendingRequests.clear();
    for (const pending of nativePending.values()) {
      pending.reject(error);
    }
    nativePending.clear();
    nativeProxies.clear();
    nativeListeners.clear();
  }
});

const tab = {
  ready,
  request(method: string, params?: unknown): Promise<unknown> {
    const requestId =
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `tab-request-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const promise = new Promise<unknown>((resolve, reject) => {
      pendingRequests.set(requestId, { resolve, reject });
    });
    post("spirit-extension-tab-request", { requestId, method, params });
    return promise;
  },
  onEvent(listener: (event: { event: string; params?: unknown }) => void): () => void {
    eventListeners.add(listener);
    return () => eventListeners.delete(listener);
  },
  setChrome(patch: { title?: string; icon?: unknown; dirty?: boolean }): void {
    post("spirit-extension-tab-chrome", { patch });
  },
  onContextChange(listener: (context: ExtensionTabContext) => void): () => void {
    contextListeners.add(listener);
    if (currentContext) {
      listener(currentContext);
    }
    return () => contextListeners.delete(listener);
  },
};

type NativeRequest = {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
};
type NativeProxy = {
  viewId: string;
  navigate: (url: string) => Promise<unknown>;
  getState: () => Promise<unknown>;
  capture: () => Promise<string>;
  executeScript: (code: string) => Promise<unknown>;
  destroy: () => Promise<void>;
  onEvent: (listener: (state: unknown) => void) => () => void;
};

const nativePending = new Map<string, NativeRequest>();
const nativeProxies = new Map<string, NativeProxy>();
const nativeListeners = new Map<string, Set<(state: unknown) => void>>();

function nativeRequest(operation: string, payload: Record<string, unknown>): Promise<any> {
  const requestId =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `native-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const promise = new Promise((resolve, reject) => {
    nativePending.set(requestId, { resolve, reject });
  });
  post("spirit-extension-web-view-request", { requestId, operation, ...payload });
  return promise;
}

function localRect(element: Element): Record<string, number> {
  const rect = element.getBoundingClientRect();
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function createNativeWebView(
  element: Element,
  options: { url?: string } = {},
): Promise<NativeProxy> {
  return nativeRequest("create", {
    localRect: localRect(element),
    visible: element.getClientRects().length > 0,
    url: options.url ?? "about:blank",
  }).then(({ viewId }) => {
    const listeners = new Set<(state: unknown) => void>();
    nativeListeners.set(viewId, listeners);
    let destroyed = false;
    const sendBounds = () => {
      if (!destroyed) {
        void nativeRequest("bounds", {
          viewId,
          localRect: localRect(element),
          visible: element.getClientRects().length > 0,
        }).catch(() => undefined);
      }
    };
    const observer = new ResizeObserver(sendBounds);
    observer.observe(element);
    window.addEventListener("resize", sendBounds);
    window.addEventListener("scroll", sendBounds, true);
    const cleanup = () => {
      if (destroyed) {
        return;
      }
      destroyed = true;
      observer.disconnect();
      window.removeEventListener("resize", sendBounds);
      window.removeEventListener("scroll", sendBounds, true);
      nativeProxies.delete(viewId);
      nativeListeners.delete(viewId);
    };
    const proxy: NativeProxy = {
      viewId,
      navigate: (url) => nativeRequest("navigate", { viewId, url }),
      getState: () => nativeRequest("getState", { viewId }),
      capture: () => nativeRequest("capture", { viewId }),
      executeScript: (code) => nativeRequest("executeScript", { viewId, code }),
      destroy: async () => {
        try {
          await nativeRequest("destroy", { viewId });
        } finally {
          cleanup();
        }
      },
      onEvent: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    nativeProxies.set(viewId, proxy);
    sendBounds();
    return proxy;
  });
}

window.addEventListener("message", (event) => {
  if (event.source !== parent) {
    return;
  }
  const data = event.data as Record<string, unknown> & { type?: string };
  if (
    data.extensionId !== identity.extensionId ||
    data.contributionId !== identity.contributionId ||
    data.instanceId !== identity.instanceId ||
    data.channelId !== identity.channelId
  ) {
    return;
  }
  if (data.type === "spirit-extension-web-view-result") {
    const requestId = String(data.requestId ?? "");
    const pending = nativePending.get(requestId);
    if (!pending) {
      return;
    }
    nativePending.delete(requestId);
    if (data.ok === true) {
      pending.resolve(data.result);
    } else {
      pending.reject(new Error(String(data.error ?? "Native WebView request failed.")));
    }
    return;
  }
  if (data.type === "spirit-extension-web-view-event") {
    const state = data.state as { viewId?: string };
    const listeners = nativeListeners.get(String(state?.viewId ?? ""));
    if (listeners) {
      for (const listener of listeners) {
        listener(state);
      }
    }
  }
});

const webViews = { create: createNativeWebView };
Object.assign(window, { spirit: { tab, webViews } });
void ready();
