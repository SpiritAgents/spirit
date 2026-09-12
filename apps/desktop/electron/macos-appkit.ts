import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

type DesktopAppKitAddon = {
  setStartDictationMenuEnabled: (enabled: boolean) => boolean;
};

let cachedModule: DesktopAppKitAddon | null | undefined;

function resolveAppkitAddonPath(): string {
  const fromCompiled = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "native",
    "spirit_desktop_appkit.node",
  );
  return fromCompiled.replace(
    `${path.sep}app.asar${path.sep}`,
    `${path.sep}app.asar.unpacked${path.sep}`,
  );
}

function loadDesktopAppKit(): DesktopAppKitAddon | null {
  if (cachedModule !== undefined) {
    return cachedModule;
  }
  if (process.platform !== "darwin") {
    cachedModule = null;
    return cachedModule;
  }
  try {
    const require = createRequire(import.meta.url);
    cachedModule = require(resolveAppkitAddonPath()) as DesktopAppKitAddon;
  } catch (err) {
    console.error("[spirit-desktop] failed to load native appkit addon", err);
    cachedModule = null;
  }
  return cachedModule;
}

/**
 * AppKit injects Start Dictation; Electron cannot reach that item, so the native addon
 * sets `enabled` from the renderer-derived canDictate flag.
 */
export function setStartDictationMenuEnabled(enabled: boolean): void {
  const mod = loadDesktopAppKit();
  if (!mod) {
    return;
  }
  mod.setStartDictationMenuEnabled(enabled);
}
