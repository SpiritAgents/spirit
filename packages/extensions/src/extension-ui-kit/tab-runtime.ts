type ExtensionTabIdentity = {
  extensionId: string;
  contributionId: string;
  instanceId: string;
};

type ExtensionTabContext = ExtensionTabIdentity & {
  initialParams?: unknown;
  scope: unknown;
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
};
let currentContext: ExtensionTabContext | undefined;
let requested = false;
let resolveReady: ((context: ExtensionTabContext) => void) | undefined;
const readyPromise = new Promise<ExtensionTabContext>((resolve) => {
  resolveReady = resolve;
});
const contextListeners = new Set<(context: ExtensionTabContext) => void>();

function post(type: string): void {
  parent.postMessage({ type, ...identity }, "*");
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

window.addEventListener("message", (event) => {
  if (event.source !== parent || event.data?.type !== "spirit-extension-tab-context") {
    return;
  }
  const data = event.data as ExtensionTabContext;
  if (
    data.extensionId !== identity.extensionId ||
    data.contributionId !== identity.contributionId ||
    data.instanceId !== identity.instanceId
  ) {
    return;
  }
  applyContext(data);
});

const tab = {
  ready,
  onContextChange(listener: (context: ExtensionTabContext) => void): () => void {
    contextListeners.add(listener);
    if (currentContext) {
      listener(currentContext);
    }
    return () => contextListeners.delete(listener);
  },
};

Object.assign(window, { spirit: { tab } });
void ready();
