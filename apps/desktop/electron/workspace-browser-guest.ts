import { webContents, type WebContents } from "electron";

import { toggleBrowserWindowFullScreen } from "./window-fullscreen.js";

type GuestF12Registration = {
  host: WebContents;
  tabId: string;
  onBeforeInput: (event: Electron.Event, input: Electron.Input) => void;
};

const f12ByGuestId = new Map<number, GuestF12Registration>();

/**
 * The webContentsId passed over IPC can be any value; the live target must be a <webview> guest
 * whose host (embedder) is the sender of the IPC, preventing the renderer from manipulating the
 * webContents of other windows / the main window.
 * Returns null when the target is already destroyed (e.g. a tab-close race); the caller decides
 * whether to treat that as invalid.
 */
function findOwnedWebviewGuest(host: WebContents, guestWebContentsId: number): WebContents | null {
  const guest = webContents.fromId(guestWebContentsId);
  if (!guest || guest.isDestroyed()) {
    return null;
  }
  if (guest.getType() !== "webview" || guest.hostWebContents?.id !== host.id) {
    throw new Error("Invalid browser guest webContents");
  }
  return guest;
}

export function requireOwnedWebviewGuest(
  host: WebContents,
  guestWebContentsId: number,
): WebContents {
  const guest = findOwnedWebviewGuest(host, guestWebContentsId);
  if (!guest) {
    throw new Error("Invalid browser guest webContents");
  }
  return guest;
}

export function registerBrowserGuestF12(
  host: WebContents,
  tabId: string,
  guestWebContentsId: number,
): void {
  unregisterBrowserGuestF12(host, guestWebContentsId);
  const guest = requireOwnedWebviewGuest(host, guestWebContentsId);

  const onBeforeInput = (event: Electron.Event, input: Electron.Input) => {
    if (input.type !== "keyDown") {
      return;
    }

    if (process.platform === "win32" && input.key === "F11") {
      event.preventDefault();
      toggleBrowserWindowFullScreen(host);
      return;
    }

    if (input.key === "F12") {
      event.preventDefault();
      if (!host.isDestroyed()) {
        host.send("desktop:browser-guest-f12", { tabId });
      }
    }
  };

  guest.on("before-input-event", onBeforeInput);
  f12ByGuestId.set(guestWebContentsId, { host, tabId, onBeforeInput });
}

export function unregisterBrowserGuestF12(host: WebContents, guestWebContentsId: number): void {
  const registration = f12ByGuestId.get(guestWebContentsId);
  if (!registration || registration.host.id !== host.id) {
    return;
  }
  const guest = webContents.fromId(guestWebContentsId);
  if (guest && !guest.isDestroyed()) {
    guest.removeListener("before-input-event", registration.onBeforeInput);
  }
  f12ByGuestId.delete(guestWebContentsId);
}

export function bindBrowserGuestDevtools(
  host: WebContents,
  pageGuestId: number,
  devtoolsGuestId: number,
): void {
  const page = requireOwnedWebviewGuest(host, pageGuestId);
  const devtools = requireOwnedWebviewGuest(host, devtoolsGuestId);
  page.setDevToolsWebContents(devtools);
}

export function openBrowserGuestDevtools(host: WebContents, pageGuestId: number): boolean {
  const page = findOwnedWebviewGuest(host, pageGuestId);
  if (!page || page.isDevToolsOpened()) {
    return false;
  }
  page.openDevTools({ mode: "detach", activate: true });
  return true;
}

export function closeBrowserGuestDevtools(host: WebContents, pageGuestId: number): void {
  const page = findOwnedWebviewGuest(host, pageGuestId);
  if (!page || !page.isDevToolsOpened()) {
    return;
  }
  page.closeDevTools();
}
