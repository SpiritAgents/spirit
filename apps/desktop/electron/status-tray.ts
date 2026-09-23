import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Menu, Tray, app, nativeImage, type MenuItemConstructorOptions } from "electron";

import { invokeDesktopHostCommand } from "../src/host/service.js";
import { loadConfig } from "../src/host/storage.js";
import i18nHost from "../src/lib/i18n-host.js";
import type { SessionListItem } from "../src/types.js";

import { buildRecentSessionMenuItems } from "./session-menu-items.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type StatusTrayDeps = {
  focusOrCreateMainWindow: () => void | Promise<void>;
  openSession: (sessionPath: string) => void | Promise<void>;
  newSession: () => void | Promise<void>;
  openSettings: () => void | Promise<void>;
};

let tray: Tray | undefined;
let depsStore: StatusTrayDeps | undefined;
let syncInFlight: Promise<void> | undefined;
/** True after quit; an in-flight sync must not ensureTray after awaiting. */
let disposed = false;
/** Incremented on dispose to invalidate stale syncs before they complete. */
let syncGeneration = 0;

function resolveTrayIconPath(): string | undefined {
  const fileName = process.platform === "win32" ? "iconTemplate-32.png" : "iconTemplate.png";
  const candidates = [
    path.join(__dirname, "..", "..", "build", "tray", fileName),
    path.join(process.cwd(), "build", "tray", fileName),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function buildTrayMenu(sessions: readonly SessionListItem[], deps: StatusTrayDeps): Menu {
  const openSession = (sessionPath: string) => {
    void deps.openSession(sessionPath);
  };

  const template: MenuItemConstructorOptions[] = [
    {
      label: i18nHost.t("tray.recent"),
      enabled: false,
    },
    ...buildRecentSessionMenuItems(sessions, openSession),
    { type: "separator" },
    {
      label: i18nHost.t("tray.newChat"),
      click: () => {
        void deps.newSession();
      },
    },
    { type: "separator" },
    {
      label: i18nHost.t("tray.openApp"),
      click: () => {
        void deps.focusOrCreateMainWindow();
      },
    },
    {
      label: i18nHost.t("tray.settings"),
      click: () => {
        void deps.openSettings();
      },
    },
    {
      label: i18nHost.t("tray.quitApp"),
      click: () => {
        app.quit();
      },
    },
  ];

  return Menu.buildFromTemplate(template);
}

function destroyTray(): void {
  if (!tray) {
    return;
  }
  tray.destroy();
  tray = undefined;
}

function ensureTray(iconPath: string, menu: Menu): Tray {
  if (!tray) {
    const image = nativeImage.createFromPath(iconPath);
    if (process.platform === "darwin") {
      image.setTemplateImage(true);
    }
    tray = new Tray(image.isEmpty() ? iconPath : image);
    tray.setToolTip(i18nHost.t("tray.tooltip"));
    if (process.platform === "win32") {
      tray.on("click", () => {
        tray?.popUpContextMenu();
      });
    }
  } else {
    tray.setToolTip(i18nHost.t("tray.tooltip"));
  }
  tray.setContextMenu(menu);
  return tray;
}

function isSyncStale(generation: number): boolean {
  return disposed || generation !== syncGeneration;
}

async function syncStatusTrayUnlocked(deps: StatusTrayDeps, generation: number): Promise<void> {
  if (isSyncStale(generation)) {
    return;
  }
  if (process.platform !== "darwin" && process.platform !== "win32") {
    destroyTray();
    return;
  }

  let enabled = true;
  try {
    const config = await loadConfig();
    enabled = config.trayIcon !== false;
  } catch (error) {
    console.warn("[spirit-desktop] status tray loadConfig failed:", error);
  }

  if (isSyncStale(generation)) {
    return;
  }

  if (!enabled) {
    destroyTray();
    return;
  }

  const iconPath = resolveTrayIconPath();
  if (!iconPath) {
    console.warn("[spirit-desktop] status tray icon missing under build/tray");
    destroyTray();
    return;
  }

  let sessions: SessionListItem[] = [];
  try {
    const listed = await invokeDesktopHostCommand("listSessions");
    sessions = Array.isArray(listed) ? (listed as SessionListItem[]) : [];
  } catch (error) {
    console.warn("[spirit-desktop] status tray listSessions failed:", error);
  }

  if (isSyncStale(generation)) {
    return;
  }

  const menu = buildTrayMenu(sessions, deps);
  ensureTray(iconPath, menu);
}

export function bindStatusTrayDeps(deps: StatusTrayDeps): void {
  if (disposed) {
    return;
  }
  depsStore = deps;
}

export async function syncStatusTray(deps?: StatusTrayDeps): Promise<void> {
  if (disposed) {
    return;
  }
  const resolved = deps ?? depsStore;
  if (!resolved) {
    return;
  }
  depsStore = resolved;
  if (syncInFlight) {
    await syncInFlight;
  }
  if (disposed) {
    return;
  }
  const generation = syncGeneration;
  syncInFlight = syncStatusTrayUnlocked(resolved, generation).finally(() => {
    syncInFlight = undefined;
  });
  await syncInFlight;
}

export function disposeStatusTray(): void {
  disposed = true;
  syncGeneration += 1;
  destroyTray();
  depsStore = undefined;
}
