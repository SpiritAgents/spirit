export type WebviewCaptureRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type BrowserPageEventHandlers = {
  onUrl?: (url: string) => void;
  onTitle?: (title: string) => void;
  onNavState?: (canGoBack: boolean, canGoForward: boolean) => void;
};

export function browserWebviewPartition(tabId: string): string {
  return `persist:spirit-browser-${tabId}`;
}

export const BROWSER_WEBVIEW_WEBPREFERENCES = "contextIsolation=yes, sandbox=yes";

function isWebviewNavigationReady(wv: SpiritWebviewTag): boolean {
  try {
    const url = wv.getURL();
    return Boolean(url && url !== "about:blank");
  } catch {
    return false;
  }
}

export function waitForWebviewDomReady(wv: SpiritWebviewTag): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      wv.removeEventListener("dom-ready", onDomReady);
      wv.removeEventListener("did-attach", onDidAttach);
      resolve();
    };

    const onDomReady = () => finish();
    const onDidAttach = () => finish();

    if (isWebviewNavigationReady(wv)) {
      finish();
      return;
    }

    wv.addEventListener("dom-ready", onDomReady);
    wv.addEventListener("did-attach", onDidAttach);
  });
}

export function attachBrowserNavigationPolicy(
  wv: SpiritWebviewTag,
  onExternalUrl: (url: string) => void,
): () => void {
  const onWillNavigate = (event: unknown) => {
    if (
      typeof event !== "object" ||
      event === null ||
      !("url" in event) ||
      typeof (event as { url: unknown }).url !== "string"
    ) {
      return;
    }
    const navigateEvent = event as SpiritWebviewWillNavigateEvent;
    const current = wv.getURL();
    if (!current || current === "about:blank") {
      return;
    }
    try {
      const currentOrigin = new URL(current).origin;
      const nextOrigin = new URL(navigateEvent.url).origin;
      if (currentOrigin !== nextOrigin) {
        navigateEvent.preventDefault();
        onExternalUrl(navigateEvent.url);
      }
    } catch {
      // ignore malformed URLs
    }
  };

  const onNewWindow = (event: unknown) => {
    if (typeof event !== "object" || event === null) {
      return;
    }
    const newWindowEvent = event as SpiritWebviewNewWindowEvent;
    newWindowEvent.preventDefault();
    if (newWindowEvent.url) {
      onExternalUrl(newWindowEvent.url);
    }
  };

  wv.addEventListener("will-navigate", onWillNavigate);
  wv.addEventListener("new-window", onNewWindow);

  return () => {
    wv.removeEventListener("will-navigate", onWillNavigate);
    wv.removeEventListener("new-window", onNewWindow);
  };
}

export function attachBrowserPageEventListeners(
  wv: SpiritWebviewTag,
  handlers: BrowserPageEventHandlers,
): () => void {
  const emitNavState = () => {
    handlers.onNavState?.(wv.canGoBack(), wv.canGoForward());
  };

  const onNavigate = (event: unknown) => {
    let url =
      typeof event === "object" && event !== null && "url" in event
        ? (event as { url: unknown }).url
        : undefined;
    if (typeof url !== "string" || !url) {
      try {
        url = wv.getURL();
      } catch {
        url = undefined;
      }
    }
    if (typeof url === "string" && url && url !== "about:blank") {
      handlers.onUrl?.(url);
    }
    emitNavState();
  };

  const onTitle = (event: unknown) => {
    const title =
      typeof event === "object" && event !== null && "title" in event
        ? String((event as { title?: string }).title ?? "")
        : "";
    handlers.onTitle?.(title);
  };

  const onStopLoading = () => {
    const url = wv.getURL();
    if (url && url !== "about:blank") {
      handlers.onUrl?.(url);
    }
    emitNavState();
  };

  wv.addEventListener("did-navigate", onNavigate);
  wv.addEventListener("did-navigate-in-page", onNavigate);
  wv.addEventListener("page-title-updated", onTitle);
  wv.addEventListener("did-stop-loading", onStopLoading);

  emitNavState();

  return () => {
    wv.removeEventListener("did-navigate", onNavigate);
    wv.removeEventListener("did-navigate-in-page", onNavigate);
    wv.removeEventListener("page-title-updated", onTitle);
    wv.removeEventListener("did-stop-loading", onStopLoading);
  };
}

export async function bindDevtoolsHost(
  pageWv: SpiritWebviewTag,
  devtoolsWv: SpiritWebviewTag,
): Promise<void> {
  await waitForWebviewDomReady(pageWv);
  await waitForWebviewDomReady(devtoolsWv);
  const bridge = window.spiritDesktop;
  if (!bridge?.bindBrowserGuestDevtools) {
    throw new Error("Desktop browser guest bridge unavailable");
  }
  await bridge.bindBrowserGuestDevtools(pageWv.getWebContentsId(), devtoolsWv.getWebContentsId());
}

export async function openEmbeddedDevtools(
  pageWv: SpiritWebviewTag,
  devtoolsWv: SpiritWebviewTag,
): Promise<void> {
  const bridge = window.spiritDesktop;
  if (!bridge?.openBrowserGuestDevtools) {
    throw new Error("Desktop browser guest bridge unavailable");
  }
  const opened = await bridge.openBrowserGuestDevtools(pageWv.getWebContentsId());
  if (!opened) {
    return;
  }
  // On Win32, titleBarOverlay forces native dock to become detach (electron/electron#42079),
  // so setDevToolsWebContents is used to draw DevTools into the webview on the right.
  try {
    await devtoolsWv.executeJavaScript("window.location.reload()");
  } catch {
    devtoolsWv.reload();
  }
}

export function closeEmbeddedDevtools(pageGuestId: number): void {
  const bridge = window.spiritDesktop;
  if (!bridge?.closeBrowserGuestDevtools) {
    return;
  }
  void bridge.closeBrowserGuestDevtools(pageGuestId);
}

export async function captureWebviewPngBase64(
  wv: SpiritWebviewTag,
  rect: WebviewCaptureRect,
): Promise<string> {
  const image = await wv.capturePage(rect);
  const dataUrl = image.toDataURL();
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

export async function executeWebviewScript(wv: SpiritWebviewTag, script: string): Promise<unknown> {
  return wv.executeJavaScript(script);
}

export async function insertWebviewCss(wv: SpiritWebviewTag, css: string): Promise<string> {
  return wv.insertCSS(css);
}

export async function removeWebviewCss(wv: SpiritWebviewTag, cssKey: string): Promise<void> {
  await wv.removeInsertedCSS(cssKey);
}
