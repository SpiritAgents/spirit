import { WebLinksAddon } from "@xterm/addon-web-links";
import type { Terminal } from "@xterm/xterm";

function isMacPlatform(): boolean {
  return typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
}

function linkModifierPressed(event: MouseEvent): boolean {
  return isMacPlatform() ? event.metaKey : event.ctrlKey;
}

function isSafeHttpUrl(uri: string): boolean {
  try {
    const parsed = new URL(uri);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function openTerminalLink(uri: string): void {
  const trimmed = uri.trim();
  if (!isSafeHttpUrl(trimmed)) {
    return;
  }
  const bridge = window.spiritDesktop;
  if (bridge?.openBrowserUrl) {
    void bridge.openBrowserUrl(trimmed);
    return;
  }
  window.open(trimmed, "_blank", "noopener,noreferrer");
}

function activateTerminalLink(event: MouseEvent, uri: string): void {
  if (!linkModifierPressed(event)) {
    return;
  }
  openTerminalLink(uri);
}

/** Enables URL detection and OSC 8 hyperlinks for the integrated terminal (requires Ctrl/Cmd+click). */
export function configureWorkspaceTerminalLinks(term: Terminal): void {
  term.options.linkHandler = {
    activate: (event, text) => {
      activateTerminalLink(event, text);
    },
  };

  const webLinks = new WebLinksAddon((event, uri) => {
    activateTerminalLink(event, uri);
  });
  term.loadAddon(webLinks);
}
