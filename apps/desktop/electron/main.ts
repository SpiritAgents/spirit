import { existsSync, readFileSync, statSync } from "node:fs";
import { copyFile, lstat, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  BrowserWindow,
  IpcMainInvokeEvent,
  Menu,
  app,
  clipboard,
  dialog,
  ipcMain,
  nativeTheme,
  net,
  shell,
} from "electron";

import { detectSupportedImageFile } from "@spiritagent/host-internal/image-file-support";

import {
  registerDesktopNotifications,
  registerWindowsToastActivationHandler,
  setApprovalNotificationHandler,
  showDesktopNotification,
  type DesktopNotificationPayload,
} from "./desktop-notifications.js";
import {
  registerDesktopAttention,
  setDesktopAttentionPending,
  refreshDesktopAttention,
} from "./desktop-attention.js";
import {
  installSpiritGeneratedAssetProtocolHandler,
  registerSpiritGeneratedAssetPrivilegedScheme,
} from "./generated-asset-protocol.js";
import { syncWindowsJumpList } from "./sync-windows-jump-list.js";
import {
  bindMacOSDockMenuDeps,
  disposeMacOSDockMenu,
  syncMacOSDockMenu,
} from "./sync-macos-dock-menu.js";
import { bindStatusTrayDeps, disposeStatusTray, syncStatusTray } from "./status-tray.js";
import {
  bindSpiritProtocolActionHandlers,
  flushPendingSpiritProtocolActions,
  handleSpiritNewSessionRequest,
  handleSpiritOpenSessionRequest,
} from "./spirit-protocol-actions.js";
import {
  getAppAwayFromUser,
  registerWindowPresence,
  setRendererVisibility,
} from "./window-presence.js";
import { openSystemTerminalInDirectory } from "./open-system-terminal.js";
import { WorkspacePtyManager } from "./workspace-pty.js";
import {
  isAllowedExternalUrl,
  getCachedLocalListeningEndpoints,
  getScanningPromise,
  startLocalListenersScan,
} from "./local-listeners.js";
import {
  bindBrowserGuestDevtools,
  closeBrowserGuestDevtools,
  openBrowserGuestDevtools,
  registerBrowserGuestF12,
  unregisterBrowserGuestF12,
} from "./workspace-browser-guest.js";
import { toggleBrowserWindowFullScreen } from "./window-fullscreen.js";
import {
  buildCrashLogText,
  buildIssueFeedbackUrl,
  crashPageDataUrl,
  installMainStderrCapture,
  recordCrashLog,
  recordRendererError,
  type CrashSceneDetails,
  type RendererErrorReport,
} from "./crash-report.js";

import type { DesktopLiveUpdate, DesktopSnapshot } from "../src/types.js";
import {
  DEFAULT_TRANSLUCENCY,
  isNativeTranslucencyEnabled,
  parseTranslucencyPreference,
  type TranslucencyPreference,
} from "../src/lib/translucency.js";

registerSpiritGeneratedAssetPrivilegedScheme();

const gotSpiritSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSpiritSingleInstanceLock) {
  app.quit();
} else {
  const spiritDataDir = resolveConfiguredSpiritDataDir();
  app.setPath("userData", spiritDataDir);
  setSpiritDataDirOverride(spiritDataDir);

  app.on("second-instance", (_event, argv) => {
    if (!handleWindowsLaunchArgv(argv)) {
      focusSpiritDesktopWindows();
    }
  });
}

function focusSpiritDesktopWindows(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) {
      continue;
    }
    if (window.isMinimized()) {
      window.restore();
    }
    window.show();
    window.focus();
  }
}

/** First launch: reveal only after the renderer's LaunchSplash is ready, avoiding the pure-black empty frame before React mounts. */
function revealMainWindowWhenLaunchSplashReady(window: BrowserWindow): void {
  if (window.isDestroyed()) {
    return;
  }
  if (window.isVisible()) {
    return;
  }
  window.show();
  if (process.platform === "darwin") {
    app.focus({ steal: true });
  }
  window.focus();
}

async function focusOrCreateSpiritDesktopWindows(): Promise<void> {
  const windows = BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed());
  if (windows.length === 0) {
    await createMainWindow();
    return;
  }
  focusSpiritDesktopWindows();
}

import {
  invokeDesktopHostCommand,
  resolveDesktopExtensionViewFile,
  openDesktopHostExtensionUi,
  closeDesktopHostExtensionUi,
  resolveDesktopExtensionViewOwner,
  setDesktopGitHubFetchImplementation,
  setDesktopExtensionHostAdapter,
  shutdownDesktopHostService,
  subscribeDesktopAutomationsUpdates,
  subscribeDesktopDreamUpdates,
  subscribeDesktopSessionListUpdates,
} from "../src/host/service.js";
import {
  chatsDirPath,
  configFilePath,
  loadConfig,
  resolveConfiguredSpiritDataDir,
  setSpiritDataDirOverride,
  spiritDataDir,
  type DesktopWebHostConfigFile,
} from "../src/host/storage.js";
import {
  parseWindowsLaunchArgv,
  resolveJumpListSessionPath,
} from "../src/lib/windows-launch-argv.js";
import { setDesktopWebHostRuntimeStatus } from "../src/host/web-host-state.js";
import { diffLiveSnapshots } from "../src/lib/live-update.js";
import {
  type ApplicationMenuSection,
  popupApplicationMenuSection,
  setMacOSApplicationMenu,
} from "./application-menu.js";
import {
  createDesktopHttpHost,
  createDesktopWebPairingCode,
  resolveDesktopWebHostFromEnv,
  type DesktopHttpHost,
} from "./http-host.js";
import {
  beginGitHubDeviceLoginInElectron,
  clearPendingGitHubDeviceAuth,
  completeGitHubDeviceLoginInElectron,
} from "./github-oauth-flow.js";
import { resolveRendererDistPath } from "./renderer-dist.js";
import { registerGitHubDeviceLoginRunners } from "../src/host/github-oauth-bridge.js";
import { listSystemFonts } from "./system-fonts.js";
import { syncWindowsImmersiveDarkMode } from "./win-dwm.js";
import {
  configureElectronProductDisplayName,
  PRODUCT_DISPLAY_NAME,
} from "./product-display-name.js";
import i18nHost from "../src/lib/i18n-host.js";
import { resolveUiLocalePreference } from "../src/lib/ui-locale.js";

/** Must match `titleBarOverlay.height` and the custom title bar CSS height (px) */
const TITLE_BAR_OVERLAY_HEIGHT = 32;
const LOCAL_IMAGE_PREVIEW_MAX_BYTES = 8 * 1024 * 1024;
const MANAGED_ASSET_PROTOCOL = "spirit:";
const MANAGED_ASSET_HOST = "generated";
const MANAGED_GENERATED_IMAGES_DIR = "generated-images";
const MANAGED_GENERATED_VIDEOS_DIR = "generated-videos";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

configureElectronProductDisplayName();
installMainStderrCapture();

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

let desktopWebHost: DesktopHttpHost | undefined;
let desktopWebHostConfig: DesktopWebHostConfigFile | undefined;
let desktopWebHostPairingCode = createDesktopWebPairingCode();
/** True after the pairing failure limit is reached; must not regenerate the pairing code until the failure count inside the HTTP handler is reset. */
let desktopWebHostPairingLocked = false;
let quittingAfterDesktopWebHostStop = false;
let unsubscribeDesktopDreamUpdates: (() => void) | undefined;
let unsubscribeDesktopAutomationsUpdates: (() => void) | undefined;
let unsubscribeDesktopSessionListUpdates: (() => void) | undefined;
/** Last snapshot pushed to each webContents; basis for incremental (delta) live updates. Reset on renderer reload. */
const lastLivePushByWebContents = new WeakMap<Electron.WebContents, DesktopSnapshot>();
let desktopHostShutdownComplete = false;
let desktopHostShutdownPromise: Promise<void> | undefined;

const workspacePtyManager = new WorkspacePtyManager();

setDesktopExtensionHostAdapter({
  async showMessageBox(request) {
    const targetWindow = BrowserWindow.getAllWindows().find((window) => !window.isDestroyed());
    const options = {
      title: request.title,
      message: request.message,
      ...(request.detail ? { detail: request.detail } : {}),
      ...(request.buttons?.length ? { buttons: request.buttons } : {}),
      ...(request.cancelId !== undefined ? { cancelId: request.cancelId } : {}),
      ...(request.defaultId !== undefined ? { defaultId: request.defaultId } : {}),
      ...(request.noLink !== undefined ? { noLink: request.noLink } : {}),
      ...(request.type ? { type: request.type } : {}),
    };

    if (targetWindow) {
      await dialog.showMessageBox(targetWindow, options);
      return;
    }

    await dialog.showMessageBox(options);
  },
  ui: {
    async open(viewId, params) {
      const owner = await resolveDesktopExtensionViewOwner(viewId);
      if (!owner) {
        throw new Error(`Unknown or ambiguous extension view: ${viewId}`);
      }
      const opened = await openDesktopHostExtensionUi({
        extensionId: owner.extensionId,
        viewId,
        params,
      });
      return opened.kind === "opened" ? opened.result : opened;
    },
    close() {
      closeDesktopHostExtensionUi();
    },
  },
});

function shouldStartDesktopWebHostFromEnv(): boolean {
  return process.env.SPIRIT_DESKTOP_WEB_HOST === "1";
}

function getDesktopWebHost(config: DesktopWebHostConfigFile): DesktopHttpHost {
  if (!desktopWebHost) {
    desktopWebHost = createDesktopHttpHost({
      host: config.host,
      port: config.port,
      invokeHostCommand: invokeDesktopHostCommand,
      onHostCommandResult: handleDesktopWebHostCommandResult,
      subscribeHostUpdates: subscribeDesktopDreamUpdates,
      auth: {
        getTokenHash: () => desktopWebHostConfig?.authTokenHash,
        getPairingCode: () => desktopWebHostPairingCode,
        completePairing: completeDesktopWebHostPairing,
        onPairingLockout: handleDesktopWebHostPairingLockout,
      },
      static: {
        root: rendererDistPath(),
        spaFallback: true,
      },
    });
  }
  return desktopWebHost;
}

function rendererDistPath(): string {
  return resolveRendererDistPath(__dirname);
}

async function startDesktopWebHostFromEnv(): Promise<void> {
  if (!shouldStartDesktopWebHostFromEnv()) {
    return;
  }
  const { host, port } = resolveDesktopWebHostFromEnv();
  const config = await loadConfig();
  await syncDesktopWebHostWithConfig({
    ...config.webHost,
    enabled: true,
    host,
    port,
  });
}

async function syncInitialDesktopWebHost(): Promise<void> {
  if (shouldStartDesktopWebHostFromEnv()) {
    await startDesktopWebHostFromEnv();
    return;
  }
  const config = await loadConfig();
  await syncDesktopWebHostWithConfig(config.webHost);
}

async function stopDesktopWebHostIfRunning(): Promise<void> {
  if (!desktopWebHost?.isRunning()) {
    return;
  }
  await desktopWebHost.stop();
}

function handleWindowsLaunchArgv(argv: readonly string[]): boolean {
  const parsed = parseWindowsLaunchArgv(argv);
  if (!parsed) {
    return false;
  }
  if (parsed.kind === "new-session") {
    handleSpiritNewSessionRequest();
    return true;
  }
  const resolved = resolveJumpListSessionPath(chatsDirPath(), parsed.fileName);
  if (!resolved) {
    return false;
  }
  void handleSpiritOpenSessionRequest(resolved);
  return true;
}

async function handleSpiritOpenSessionFromProtocol(sessionPath: string): Promise<void> {
  try {
    const next = await invokeMainDesktopHostCommand("openSession", { path: sessionPath });
    if (isDesktopSnapshot(next)) {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) {
          window.webContents.send("desktop:notify-refresh");
        }
      }
    }
  } catch (error) {
    console.error("[spirit-desktop] open-session protocol failed:", error);
  }
}

async function handleApprovalNotificationAction(decision: "allow" | "deny"): Promise<void> {
  let deliveredToRenderer = false;
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed() || window.webContents.isDestroyed()) {
      continue;
    }
    window.webContents.send("desktop:approval-from-notification", { decision });
    deliveredToRenderer = true;
  }
  if (deliveredToRenderer) {
    return;
  }

  try {
    const next = await invokeMainDesktopHostCommand("replyPendingApproval", {
      request: { decision: { kind: decision } },
    });
    if (isDesktopSnapshot(next)) {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) {
          window.webContents.send("desktop:notify-refresh");
        }
      }
    }
  } catch (error) {
    console.error("[spirit-desktop] approval notification action failed:", error);
  }
}

async function invokeMainDesktopHostCommand(
  command: Parameters<typeof invokeDesktopHostCommand>[0],
  payload?: unknown,
) {
  const result = await invokeDesktopHostCommand(command, payload);
  if (isDesktopSnapshot(result) && (command === "bootstrap" || command === "updateConfig")) {
    const config = await loadConfig();
    await syncDesktopWebHostWithConfig(config.webHost);
    // Toggling the tray must take effect immediately; it does not go through the session-list trailing-edge coalescing.
    void syncStatusTray();
  }
  return result;
}

async function handleDesktopWebHostCommandResult(
  command: Parameters<typeof invokeDesktopHostCommand>[0],
  _payload: unknown,
  result: unknown,
): Promise<void> {
  if (command !== "updateConfig" || !isDesktopSnapshot(result)) {
    return;
  }
  const config = await loadConfig();
  await syncDesktopWebHostWithConfig(config.webHost);
}

async function syncDesktopWebHostWithConfig(config: DesktopWebHostConfigFile): Promise<void> {
  const previousConfig = desktopWebHostConfig;
  const changedEndpoint =
    previousConfig?.host !== config.host || previousConfig?.port !== config.port;
  desktopWebHostConfig = config;
  if (config.authTokenHash) {
    desktopWebHostPairingCode = "";
  } else if (!desktopWebHostPairingCode && !desktopWebHostPairingLocked) {
    desktopWebHostPairingCode = createDesktopWebPairingCode();
  }

  if (!config.enabled) {
    await stopDesktopWebHostIfRunning();
    setDesktopWebHostRuntimeStatus({
      state: "disabled",
      host: config.host,
      port: config.port,
    });
    return;
  }

  if (desktopWebHost?.isRunning() && !changedEndpoint) {
    const state = desktopWebHost.getState();
    setDesktopWebHostRuntimeStatus(
      state.running
        ? {
            state: "running",
            host: config.host,
            port: config.port,
            url: state.url,
            ...(config.authTokenHash ? {} : { pairingCode: desktopWebHostPairingCode }),
          }
        : {
            state: "stopped",
            host: config.host,
            port: config.port,
          },
    );
    return;
  }

  if (desktopWebHost?.isRunning()) {
    await desktopWebHost.stop();
  }
  if (changedEndpoint) {
    desktopWebHost = undefined;
  }

  // Restarting the HTTP handler resets the pairing failure count inside it; only then unlock and issue a new code.
  if (!config.authTokenHash) {
    desktopWebHostPairingLocked = false;
    if (!desktopWebHostPairingCode) {
      desktopWebHostPairingCode = createDesktopWebPairingCode();
    }
  }

  setDesktopWebHostRuntimeStatus({
    state: "starting",
    host: config.host,
    port: config.port,
  });

  try {
    const state = await getDesktopWebHost(config).start();
    setDesktopWebHostRuntimeStatus({
      state: "running",
      host: state.host,
      port: state.port,
      ...(state.url ? { url: state.url } : {}),
      ...(config.authTokenHash ? {} : { pairingCode: desktopWebHostPairingCode }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[spirit-desktop] start desktop web host failed", error);
    setDesktopWebHostRuntimeStatus({
      state: "error",
      host: config.host,
      port: config.port,
      error: message,
    });
  }
}

/** Pairing failure limit reached: void the current pairing code and stop displaying it; regenerated when the Web Host restarts. */
function handleDesktopWebHostPairingLockout(): void {
  console.warn("[spirit-desktop] web host pairing locked after too many failures");
  desktopWebHostPairingLocked = true;
  desktopWebHostPairingCode = "";
  if (desktopWebHost?.isRunning() && desktopWebHostConfig) {
    const state = desktopWebHost.getState();
    setDesktopWebHostRuntimeStatus({
      state: "running",
      host: desktopWebHostConfig.host,
      port: desktopWebHostConfig.port,
      ...(state.url ? { url: state.url } : {}),
    });
  }
}

async function completeDesktopWebHostPairing(authTokenHash: string): Promise<void> {
  await invokeDesktopHostCommand("setWebHostAuthTokenHash", { authTokenHash });
  const config = await loadConfig();
  desktopWebHostConfig = config.webHost;
  desktopWebHostPairingCode = "";
  if (desktopWebHost?.isRunning()) {
    const state = desktopWebHost.getState();
    setDesktopWebHostRuntimeStatus({
      state: "running",
      host: config.webHost.host,
      port: config.webHost.port,
      ...(state.url ? { url: state.url } : {}),
    });
  }
}

function isDesktopSnapshot(value: unknown): value is DesktopSnapshot {
  return (
    typeof value === "object" &&
    value !== null &&
    "webHost" in value &&
    "config" in value &&
    "conversation" in value
  );
}

/** Windows taskbar / window icon: build/icon.png (generated from the brand SVG at build time, see scripts/gen-brand-assets.mjs). */
function resolveWindowIconPath(): string | undefined {
  const fromBuild = path.join(__dirname, "..", "..", "build", "icon.png");
  if (existsSync(fromBuild)) {
    return fromBuild;
  }
  const fromCwd = path.join(process.cwd(), "build", "icon.png");
  if (existsSync(fromCwd)) {
    return fromCwd;
  }
  return undefined;
}

const WINDOWS_JUMP_LIST_REFRESH_COALESCE_MS = 1_000;
let windowsJumpListRefreshTimer: ReturnType<typeof setTimeout> | undefined;
const STATUS_TRAY_REFRESH_COALESCE_MS = 1_000;
let statusTrayRefreshTimer: ReturnType<typeof setTimeout> | undefined;
const MACOS_DOCK_MENU_REFRESH_COALESCE_MS = 1_000;
let macOSDockMenuRefreshTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Session list updates may fire at high frequency (each one does listSessions + app.setJumpList);
 * the jump list only needs eventual consistency, so refresh is coalesced here on the trailing
 * edge. This is the only throttle point for the jump list.
 */
function refreshWindowsJumpList(): void {
  if (process.platform !== "win32") {
    return;
  }
  if (windowsJumpListRefreshTimer !== undefined) {
    return;
  }
  windowsJumpListRefreshTimer = setTimeout(() => {
    windowsJumpListRefreshTimer = undefined;
    void syncWindowsJumpList(resolveWindowIconPath());
  }, WINDOWS_JUMP_LIST_REFRESH_COALESCE_MS);
}

/** Tray menu refresh on session / config / language changes; trailing-edge coalescing avoids high-frequency listSessions. */
function refreshStatusTray(): void {
  if (process.platform !== "darwin" && process.platform !== "win32") {
    return;
  }
  if (statusTrayRefreshTimer !== undefined) {
    clearTimeout(statusTrayRefreshTimer);
  }
  statusTrayRefreshTimer = setTimeout(() => {
    statusTrayRefreshTimer = undefined;
    void syncStatusTray();
  }, STATUS_TRAY_REFRESH_COALESCE_MS);
}

/** macOS Dock context session list; not tied to trayIcon, trailing-edge coalescing avoids high-frequency listSessions. */
function refreshMacOSDockMenu(): void {
  if (process.platform !== "darwin") {
    return;
  }
  if (macOSDockMenuRefreshTimer !== undefined) {
    clearTimeout(macOSDockMenuRefreshTimer);
  }
  macOSDockMenuRefreshTimer = setTimeout(() => {
    macOSDockMenuRefreshTimer = undefined;
    void syncMacOSDockMenu();
  }, MACOS_DOCK_MENU_REFRESH_COALESCE_MS);
}

/** Matches the Void dark `--background` (#000000) in `src/styles.css`; used as the window background when translucency is off, so the WebView does not show through as Chromium #121212 */
const WIN32_APP_BACKGROUND_DARK = "#000000";
const WIN32_APP_BACKGROUND_LIGHT = "#fafafa";

/** Matches Tauri `frame_chrome`: use a transparent background with window-level translucent materials, leaving compositing to the system compositor. */
function electronRootBackgroundForBackdrop(
  translucencyEnabled: boolean,
  darkContent: boolean,
): string {
  if (translucencyEnabled && (process.platform === "win32" || process.platform === "darwin")) {
    return "#00000000";
  }
  return darkContent ? WIN32_APP_BACKGROUND_DARK : WIN32_APP_BACKGROUND_LIGHT;
}

/** Config keys read synchronously for first-frame renderer IPC (Win Mica / macOS Vibrancy, OOBE). */
let cachedDesktopConfigFlags:
  | {
      mtimeMs: number;
      size: number;
      translucency: TranslucencyPreference;
      onboardingCompleted: boolean;
    }
  | undefined;

/**
 * This value is exposed to the renderer via sync IPC (`desktop:read-translucency` /
 * `desktop:read-onboarding-completed`): the first React frame must get it before the host
 * snapshot is ready, and cannot be made async. To avoid reading and parsing the entire
 * config file on every sync IPC, it is cached by mtime/size and only re-read when the
 * config file changes.
 */
function readDesktopConfigFlagsFromDisk(): {
  translucency: TranslucencyPreference;
  onboardingCompleted: boolean;
} {
  const filePath = configFilePath();
  let mtimeMs: number;
  let size: number;
  try {
    const stats = statSync(filePath);
    mtimeMs = stats.mtimeMs;
    size = stats.size;
  } catch {
    return { translucency: DEFAULT_TRANSLUCENCY, onboardingCompleted: false };
  }
  if (
    cachedDesktopConfigFlags &&
    cachedDesktopConfigFlags.mtimeMs === mtimeMs &&
    cachedDesktopConfigFlags.size === size
  ) {
    return {
      translucency: cachedDesktopConfigFlags.translucency,
      onboardingCompleted: cachedDesktopConfigFlags.onboardingCompleted,
    };
  }

  let translucency: TranslucencyPreference = DEFAULT_TRANSLUCENCY;
  let onboardingCompleted = false;
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as {
      translucency?: unknown;
      onboardingCompleted?: boolean;
    };
    translucency = parseTranslucencyPreference(parsed.translucency);
    onboardingCompleted = parsed.onboardingCompleted === true;
  } catch {
    translucency = DEFAULT_TRANSLUCENCY;
    onboardingCompleted = false;
  }
  cachedDesktopConfigFlags = { mtimeMs, size, translucency, onboardingCompleted };
  return { translucency, onboardingCompleted };
}

function readTranslucencyFromDisk(): TranslucencyPreference {
  return readDesktopConfigFlagsFromDisk().translucency;
}

function readOnboardingCompletedFromDisk(): boolean {
  return readDesktopConfigFlagsFromDisk().onboardingCompleted;
}

const MACOS_WINDOW_VIBRANCY = "under-window" as const;

/**
 * macOS traffic light position cache: the UI scale lives in renderer localStorage, which the
 * main process cannot read at window construction time; if we waited for the renderer to
 * report it after startup (about 1s measured), the traffic lights would sit at the default
 * position and then jump.
 * So the renderer persists the position on every sync, and the next launch uses it directly
 * as a BrowserWindow constructor parameter.
 */
function trafficLightPositionCachePath(): string {
  return path.join(app.getPath("userData"), "traffic-light-position.json");
}

function readTrafficLightPositionFromDisk(): { x: number; y: number } | undefined {
  try {
    const parsed = JSON.parse(readFileSync(trafficLightPositionCachePath(), "utf8")) as {
      x?: unknown;
      y?: unknown;
    };
    if (
      typeof parsed.x === "number" &&
      Number.isFinite(parsed.x) &&
      typeof parsed.y === "number" &&
      Number.isFinite(parsed.y)
    ) {
      return { x: parsed.x, y: parsed.y };
    }
  } catch {
    // First launch or missing cache: use the scale=1 inset (see computeDarwinTrafficLightPosition)
  }
  return undefined;
}

function nativeTranslucencyActive(translucencyEnabled: boolean): boolean {
  return translucencyEnabled && (process.platform === "win32" || process.platform === "darwin");
}

/** Keep in sync with `THEME_STORAGE_KEY` in `src/lib/theme.ts` */
const RENDERER_THEME_STORAGE_KEY = "spirit-desktop-theme";

type RendererThemePrefs = {
  dark: boolean;
  nativeTheme: "system" | "light" | "dark";
  pref: string;
};

const READ_RENDERER_THEME_PREFS_JS = `(() => {
  const raw = localStorage.getItem(${JSON.stringify(RENDERER_THEME_STORAGE_KEY)});
  const pref =
    raw === 'dark' || raw === 'light' || raw === 'system' ? raw : 'system';
  const resolveDark = (p) => {
    if (p === 'dark') return true;
    if (p === 'light') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  };
  const nativeFor = (p) =>
    p === 'system' ? 'system' : p === 'dark' ? 'dark' : 'light';
  return { dark: resolveDark(pref), nativeTheme: nativeFor(pref), pref };
})()`;

async function readRendererThemePrefs(window: BrowserWindow): Promise<RendererThemePrefs | null> {
  try {
    return (await window.webContents.executeJavaScript(
      READ_RENDERER_THEME_PREFS_JS,
    )) as RendererThemePrefs;
  } catch (err) {
    console.error("[spirit-desktop] readRendererThemePrefs failed", err);
    return null;
  }
}

function applyRendererThemePrefs(window: BrowserWindow, prefs: RendererThemePrefs): void {
  nativeTheme.themeSource = prefs.nativeTheme;
  applyNativeWindowBackdrop(window, prefs.dark);
}

/**
 * Does not depend on preload IPC: reads the theme from localStorage and syncs the native window material.
 */
async function syncBrowserWindowFrameFromRendererStorage(
  window: BrowserWindow,
): Promise<RendererThemePrefs | null> {
  const prefs = await readRendererThemePrefs(window);
  if (!prefs) {
    return null;
  }
  applyRendererThemePrefs(window, prefs);
  return prefs;
}

function applyNativeWindowBackdrop(
  window: BrowserWindow,
  darkContent: boolean,
  translucencyOverride?: boolean,
): void {
  const translucencyEnabled =
    translucencyOverride ?? isNativeTranslucencyEnabled(readTranslucencyFromDisk());

  if (process.platform === "win32") {
    try {
      // Use the system Mica material enum value when translucency is enabled
      window.setBackgroundMaterial(translucencyEnabled ? "mica" : "none");
    } catch (err) {
      console.error("[spirit-desktop] setBackgroundMaterial failed", err);
    }
  } else if (process.platform === "darwin") {
    try {
      window.setVibrancy(translucencyEnabled ? MACOS_WINDOW_VIBRANCY : null);
    } catch (err) {
      console.error("[spirit-desktop] setVibrancy failed", err);
    }
  }

  window.setBackgroundColor(
    electronRootBackgroundForBackdrop(nativeTranslucencyActive(translucencyEnabled), darkContent),
  );

  if (process.platform === "win32") {
    syncWindowsImmersiveDarkMode(window, darkContent);
  }

  if (process.platform !== "win32") {
    return;
  }

  try {
    // With translucency off, an opaque overlay would cover the bottom row of the WebView title
    // bar (including its `border-b`), leaving a missing line segment next to the caption buttons.
    // Transparent overlay: the background and bottom border are painted by the page showing
    // through, and the system only draws the three button glyphs (same as when enabled).
    window.setTitleBarOverlay({
      height: TITLE_BAR_OVERLAY_HEIGHT,
      color: "#00000000",
      symbolColor: darkContent ? "#f5f5f5" : "#1f1f1f",
    });
  } catch {
    // Ignore when the overlay is not enabled or the platform does not support it
  }
}

/** Grace period for an unresponsive renderer to recover before it is replaced by the crash page. */
const RENDERER_UNRESPONSIVE_GRACE_MS = 10_000;

function showRendererCrashPage(window: BrowserWindow, details: CrashSceneDetails): void {
  if (window.isDestroyed() || window.webContents.isDestroyed()) {
    return;
  }
  const logText = buildCrashLogText(details);
  console.error(
    `[spirit-desktop] renderer ${details.trigger} (reason=${details.reason}); showing crash page`,
  );
  const feedbackUrl = buildIssueFeedbackUrl({
    trigger: details.trigger,
    reason: details.reason,
    exitCode: details.exitCode,
    logText,
    env: {
      version: app.getVersion(),
      electronVersion: process.versions.electron,
      platform: process.platform,
      arch: process.arch,
      osRelease: os.release(),
      packaged: app.isPackaged,
    },
  });
  const url = crashPageDataUrl(
    {
      title: i18nHost.t("crashPage.title"),
      description: i18nHost.t("crashPage.description"),
      reportLabel: i18nHost.t("crashPage.reportOnGitHub"),
      lang: i18nHost.language,
    },
    logText,
    {
      translucency: nativeTranslucencyActive(
        isNativeTranslucencyEnabled(readTranslucencyFromDisk()),
      ),
    },
    { url: feedbackUrl },
  );
  // The crash page has no scripts, so the feedback link navigates in-window; intercept it
  // and hand the issue URL to the external browser instead. All other navigations (e.g.
  // reloading back into the app) pass through untouched.
  const interceptFeedbackNavigation = (event: Electron.Event, navUrl: string): void => {
    if (navUrl !== feedbackUrl) {
      return;
    }
    event.preventDefault();
    void shell.openExternal(feedbackUrl).catch((err) => {
      console.error("[spirit-desktop] failed to open crash feedback URL", err);
    });
  };
  window.webContents.on("will-navigate", interceptFeedbackNavigation);
  window.webContents.once("destroyed", () => {
    window.webContents.removeListener("will-navigate", interceptFeedbackNavigation);
  });
  window.webContents.loadURL(url).catch((err) => {
    window.webContents.removeListener("will-navigate", interceptFeedbackNavigation);
    console.error("[spirit-desktop] failed to load crash page", err);
  });
}

/** Replaces the blank post-crash window with the crash page; returns cleanup for the listeners. */
function registerRendererCrashPage(window: BrowserWindow): void {
  let crashPageShown = false;
  let forceCrashedForUnresponsive = false;
  let unresponsiveTimer: NodeJS.Timeout | undefined;

  window.webContents.on("render-process-gone", (_event, details) => {
    recordCrashLog(
      "main",
      `render-process-gone reason=${details.reason} exitCode=${details.exitCode}`,
    );
    const unexpected =
      details.reason !== "clean-exit" &&
      // "killed" is intentional teardown, except when we force-killed a hung renderer below
      (details.reason !== "killed" || forceCrashedForUnresponsive);
    if (!unexpected || crashPageShown) {
      return;
    }
    crashPageShown = true;
    showRendererCrashPage(window, {
      trigger: forceCrashedForUnresponsive ? "unresponsive" : "render-process-gone",
      reason: forceCrashedForUnresponsive ? "unresponsive" : details.reason,
      exitCode: details.exitCode,
    });
  });

  window.webContents.on("unresponsive", () => {
    recordCrashLog("main", "renderer became unresponsive");
    if (crashPageShown || unresponsiveTimer) {
      return;
    }
    unresponsiveTimer = setTimeout(() => {
      unresponsiveTimer = undefined;
      if (window.isDestroyed() || window.webContents.isDestroyed() || crashPageShown) {
        return;
      }
      // A hung renderer cannot navigate by itself; force-kill it so the
      // render-process-gone handler above loads the crash page.
      forceCrashedForUnresponsive = true;
      try {
        window.webContents.forcefullyCrashRenderer();
      } catch (err) {
        console.error("[spirit-desktop] forcefullyCrashRenderer failed", err);
      }
    }, RENDERER_UNRESPONSIVE_GRACE_MS);
  });

  window.webContents.on("responsive", () => {
    if (unresponsiveTimer) {
      clearTimeout(unresponsiveTimer);
      unresponsiveTimer = undefined;
    }
  });

  window.webContents.on("console-message", (event) => {
    if (event.level !== "warning" && event.level !== "error") {
      return;
    }
    const location = event.sourceId ? ` (${event.sourceId}:${event.lineNumber})` : "";
    recordCrashLog("renderer", `${event.message}${location}`);
  });

  window.once("closed", () => {
    if (unresponsiveTimer) {
      clearTimeout(unresponsiveTimer);
      unresponsiveTimer = undefined;
    }
  });
}

async function createMainWindow(): Promise<BrowserWindow> {
  const translucencyOnDisk = isNativeTranslucencyEnabled(readTranslucencyFromDisk());
  const initialDark = nativeTheme.shouldUseDarkColors;
  const initialBg = electronRootBackgroundForBackdrop(
    nativeTranslucencyActive(translucencyOnDisk),
    initialDark,
  );
  const preloadPath = path.join(__dirname, "preload.cjs");
  if (!existsSync(preloadPath)) {
    console.error(
      "[spirit-desktop] preload missing (run build:electron to generate preload.cjs):",
      preloadPath,
    );
  }

  const windowIcon = resolveWindowIconPath();
  const storedTrafficLightPosition =
    process.platform === "darwin" ? readTrafficLightPositionFromDisk() : undefined;

  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    // Phone-class minimum (the standard 360x640 handset viewport), so
    // small-screen and phone-like layouts stay testable by resizing.
    minWidth: 360,
    minHeight: 640,
    show: false,
    ...(windowIcon ? { icon: windowIcon } : {}),
    backgroundColor: initialBg,
    // macOS: always attach the vibrancy layer at construction so runtime setVibrancy and
    // transparent-background switching go through the same compositing path;
    // when Blur is off, call setVibrancy(null) before load so the first frame is not blurred.
    ...(process.platform === "darwin"
      ? {
          vibrancy: MACOS_WINDOW_VIBRANCY,
          visualEffectState: "followWindow",
        }
      : {}),
    ...(process.platform === "darwin"
      ? {
          trafficLightPosition: storedTrafficLightPosition ?? { x: 16, y: 16 },
        }
      : {}),
    titleBarStyle:
      process.platform === "darwin"
        ? "hiddenInset"
        : process.platform === "win32"
          ? "hidden"
          : undefined,
    titleBarOverlay:
      process.platform === "win32"
        ? {
            height: TITLE_BAR_OVERLAY_HEIGHT,
            color: "#00000000",
            symbolColor: initialDark ? "#f5f5f5" : "#1f1f1f",
          }
        : undefined,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      webviewTag: true,
    },
  });

  if (process.platform === "darwin" && !translucencyOnDisk) {
    try {
      window.setVibrancy(null);
    } catch (err) {
      console.error("[spirit-desktop] setVibrancy(null) during create failed", err);
    }
  }

  if (DEV_SERVER_URL) {
    await window.loadURL(DEV_SERVER_URL);
  } else {
    await window.loadFile(path.join(rendererDistPath(), "index.html"));
  }

  await syncBrowserWindowFrameFromRendererStorage(window);
  flushPendingSpiritProtocolActions();

  if (process.platform === "darwin") {
    const broadcastWindowFullscreen = () => {
      if (window.isDestroyed()) {
        return;
      }
      window.webContents.send("desktop:window-fullscreen-changed", window.isFullScreen());
    };
    window.on("enter-full-screen", broadcastWindowFullscreen);
    window.on("leave-full-screen", broadcastWindowFullscreen);
    broadcastWindowFullscreen();
  }

  const webContentsId = window.webContents.id;
  window.once("closed", () => {
    workspacePtyManager.disposeAllForWebContents(webContentsId);
  });
  // After a renderer crash or main-frame re-navigation (reload / loading a new page), the old
  // renderer-side PTY sessions and their 500ms polling timers are orphaned and must be
  // reclaimed here; same-document navigation (SPA routing) does not trigger this.
  window.webContents.on("render-process-gone", () => {
    workspacePtyManager.disposeAllForWebContents(webContentsId);
  });
  registerRendererCrashPage(window);
  window.webContents.on("did-finish-load", () => {
    // A freshly loaded renderer bootstraps its own full snapshot; drop the delta baseline so
    // the next push is a full snapshot and no delta is applied against bootstrapping state.
    lastLivePushByWebContents.delete(window.webContents);
  });
  window.webContents.on("did-start-navigation", (details) => {
    if (details.isMainFrame && !details.isSameDocument) {
      workspacePtyManager.disposeAllForWebContents(webContentsId);
    }
  });

  registerDesktopNotifications(window, {
    onApprovalAction: handleApprovalNotificationAction,
    onNotificationReply: (payload) => {
      if (!window.webContents.isDestroyed()) {
        window.webContents.send("desktop:notification-reply", payload);
      }
    },
  });
  registerDesktopAttention(window);
  registerWindowPresence(window);

  window.webContents.setWindowOpenHandler((details) => {
    const url = typeof details.url === "string" ? details.url.trim() : "";
    if (url && isAllowedExternalUrl(url) && !window.webContents.isDestroyed()) {
      window.webContents.send("desktop:browser-open-url", { url });
    }
    return { action: "deny" };
  });

  // Windows has no system menu and the top-bar MenubarShortcut does not bind accelerators;
  // F11/F12 are bound by the main process (macOS fullscreen still goes through the system menu role).
  const isDevChrome = Boolean(DEV_SERVER_URL) || !app.isPackaged;
  window.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") {
      return;
    }

    if (process.platform === "win32" && input.key === "F11") {
      event.preventDefault();
      toggleBrowserWindowFullScreen(window.webContents);
      return;
    }

    if (isDevChrome && input.key === "F12") {
      event.preventDefault();
      window.webContents.toggleDevTools();
    }
  });

  return window;
}

if (gotSpiritSingleInstanceLock) {
  app.whenReady().then(async () => {
    setApprovalNotificationHandler(handleApprovalNotificationAction);
    registerWindowsToastActivationHandler();
    installSpiritGeneratedAssetProtocolHandler({
      resolveManagedGeneratedAssetPath,
      videoPreviewMimeType,
      imagePreviewMimeType,
      resolveExtensionUiRuntimePath: () =>
        path.join(rendererDistPath(), "extension-ui", "runtime.js"),
      resolveExtensionViewFile: resolveDesktopExtensionViewFile,
    });
    bindSpiritProtocolActionHandlers({
      focusWindows: focusSpiritDesktopWindows,
      openSession: handleSpiritOpenSessionFromProtocol,
    });
    handleWindowsLaunchArgv(process.argv);
    if (process.platform === "win32") {
      Menu.setApplicationMenu(null);
    } else if (process.platform === "darwin") {
      setMacOSApplicationMenu();
    }

    registerGitHubDeviceLoginRunners({
      begin: () => beginGitHubDeviceLoginInElectron(),
      complete: () => completeGitHubDeviceLoginInElectron(),
      cancel: () => clearPendingGitHubDeviceAuth(),
    });

    const electronNetFetch: typeof fetch = (input, init) =>
      net.fetch(input instanceof URL ? input.toString() : input, init);

    setDesktopGitHubFetchImplementation(electronNetFetch);

    unsubscribeDesktopDreamUpdates = subscribeDesktopDreamUpdates((snapshot) => {
      for (const window of BrowserWindow.getAllWindows()) {
        // A crashed webContents cannot receive IPC (sending throws EPIPE); the crash page
        // reload re-enables delivery, so skipping here is safe.
        if (window.isDestroyed() || window.webContents.isCrashed()) {
          continue;
        }
        // Incremental push: send only the changed conversation tail when the rest of the
        // snapshot is unchanged, keeping the per-push cost O(delta) at a constant cadence
        // regardless of transcript length. A full snapshot is sent whenever the delta is
        // not applicable (first push, renderer reload, session switch, top-level change).
        const webContents = window.webContents;
        const previous = lastLivePushByWebContents.get(webContents);
        const delta = previous ? diffLiveSnapshots(previous, snapshot) : undefined;
        const payload: DesktopLiveUpdate = delta ?? { kind: "full", snapshot };
        try {
          webContents.send("desktop:dream-updated", payload);
          // Advance the diff baseline only after a successful send; a failed send keeps the
          // older baseline so the next push's delta covers the missed range.
          lastLivePushByWebContents.set(webContents, snapshot);
        } catch {
          // The renderer may die between the isCrashed() check above and the send; the next
          // emit retries against the unchanged baseline, and a reloaded renderer resets the
          // baseline via did-finish-load.
        }
      }
    });

    unsubscribeDesktopAutomationsUpdates = subscribeDesktopAutomationsUpdates((snapshot) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) {
          window.webContents.send("desktop:automations-updated", snapshot);
        }
      }
    });

    unsubscribeDesktopSessionListUpdates = subscribeDesktopSessionListUpdates(() => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) {
          window.webContents.send("desktop:session-list-updated");
        }
      }
      refreshWindowsJumpList();
      refreshStatusTray();
      refreshMacOSDockMenu();
    });

    ipcMain.handle(
      "desktop:invoke",
      (_event, command: Parameters<typeof invokeDesktopHostCommand>[0], payload?: unknown) =>
        invokeMainDesktopHostCommand(command, payload),
    );

    ipcMain.handle("desktop:export-session", async () => {
      const result = (await invokeMainDesktopHostCommand("exportSession")) as {
        snapshot: DesktopSnapshot;
        path: string;
      };
      const openError = await shell.openPath(result.path);
      if (openError) {
        throw new Error(i18nHost.t("app.exportSessionOpenFailed", { error: openError }));
      }
      return result.snapshot;
    });

    ipcMain.handle("desktop:pick-workspace-directory", async (event) => {
      const targetWindow = BrowserWindow.fromWebContents(event.sender);
      const result = targetWindow
        ? await dialog.showOpenDialog(targetWindow, {
            properties: ["openDirectory"],
          })
        : await dialog.showOpenDialog({
            properties: ["openDirectory"],
          });
      if (result.canceled) {
        return null;
      }
      return result.filePaths[0] ?? null;
    });

    ipcMain.handle("desktop:pick-local-file", async (event) => {
      const targetWindow = BrowserWindow.fromWebContents(event.sender);
      const options = {
        properties: ["openFile", "multiSelections"] as ("openFile" | "multiSelections")[],
        buttonLabel: i18nHost.t("composer.attach"),
      };
      const result = targetWindow
        ? await dialog.showOpenDialog(targetWindow, options)
        : await dialog.showOpenDialog(options);
      if (result.canceled) {
        return null;
      }
      return result.filePaths;
    });

    ipcMain.handle(
      "desktop:ingest-browser-element-screenshot",
      async (_event: IpcMainInvokeEvent, payload: { base64: string }) => {
        const base64 = typeof payload?.base64 === "string" ? payload.base64 : "";
        if (!base64) return null;
        const dir = path.join(spiritDataDir(), "clipboard-paste");
        await mkdir(dir, { recursive: true });
        const filePath = path.join(dir, `element-${Date.now()}.png`);
        await writeFile(filePath, Buffer.from(base64, "base64"));
        return filePath;
      },
    );

    ipcMain.handle("desktop:ingest-clipboard-image", async () => {
      const image = clipboard.readImage();
      if (image.isEmpty()) {
        return null;
      }

      const dir = path.join(spiritDataDir(), "clipboard-paste");
      await mkdir(dir, { recursive: true });
      const filePath = path.join(dir, `paste-${Date.now()}.png`);
      await writeFile(filePath, image.toPNG());
      return filePath;
    });

    ipcMain.handle("desktop:list-system-fonts", () => listSystemFonts());

    ipcMain.handle(
      "desktop:read-local-image-preview",
      async (_event, payload: { filePath?: string }) => {
        const filePath = typeof payload?.filePath === "string" ? payload.filePath.trim() : "";
        if (!filePath) {
          return null;
        }

        return readImagePreviewDataUrlFromPath(filePath);
      },
    );

    ipcMain.handle(
      "desktop:read-managed-image-preview",
      async (_event, payload: { reference?: string }) => {
        const reference = typeof payload?.reference === "string" ? payload.reference.trim() : "";
        if (!reference) {
          return null;
        }

        const filePath = await resolveManagedGeneratedAssetPath(reference);
        if (!filePath) {
          return null;
        }

        return readImagePreviewDataUrlFromPath(filePath);
      },
    );

    ipcMain.handle(
      "desktop:read-managed-video-preview",
      async (_event, payload: { reference?: string }) => {
        const reference = typeof payload?.reference === "string" ? payload.reference.trim() : "";
        if (!reference) {
          return null;
        }

        const filePath = await resolveManagedGeneratedAssetPath(reference);
        if (!filePath) {
          return null;
        }

        return managedGeneratedVideoRefFromPath(filePath);
      },
    );

    ipcMain.handle(
      "desktop:read-local-video-preview",
      async (_event, payload: { filePath?: string }) => {
        const filePath = typeof payload?.filePath === "string" ? payload.filePath.trim() : "";
        if (!filePath) {
          return null;
        }

        return readLocalVideoPreviewUrlFromPath(filePath);
      },
    );

    ipcMain.handle("desktop:save-local-image-as", async (event, payload: { filePath?: string }) => {
      const sourcePath = typeof payload?.filePath === "string" ? payload.filePath.trim() : "";
      if (!sourcePath) {
        return false;
      }

      const extension = path.extname(sourcePath).toLowerCase();
      const mimeType = imagePreviewMimeType(extension);
      if (!mimeType) {
        throw new Error(i18nHost.t("app.saveImageAsUnsupportedFormat"));
      }

      const sourceStat = await stat(sourcePath);
      if (!sourceStat.isFile()) {
        throw new Error(i18nHost.t("app.saveImageAsFileMissing"));
      }

      const targetWindow = BrowserWindow.fromWebContents(event.sender);
      const saveResult = targetWindow
        ? await dialog.showSaveDialog(
            targetWindow,
            buildSaveImageDialogOptions(sourcePath, extension),
          )
        : await dialog.showSaveDialog(buildSaveImageDialogOptions(sourcePath, extension));

      if (saveResult.canceled || !saveResult.filePath) {
        return false;
      }

      if (path.resolve(saveResult.filePath) === path.resolve(sourcePath)) {
        return true;
      }

      await copyFile(sourcePath, saveResult.filePath);
      return true;
    });

    ipcMain.handle(
      "desktop:application-menu-popup",
      (event, payload: { section: ApplicationMenuSection; clientX: number; clientY: number }) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (!win) {
          return;
        }

        popupApplicationMenuSection(win, payload.section, payload.clientX, payload.clientY);
      },
    );

    ipcMain.handle("desktop:execute-window-action", (event, action: string) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      switch (action) {
        case "quit":
          app.quit();
          break;
        case "minimize":
          (win ?? BrowserWindow.getFocusedWindow())?.minimize();
          break;
        case "maximize": {
          const w = win ?? BrowserWindow.getFocusedWindow();
          if (w) {
            if (w.isMaximized()) {
              w.unmaximize();
            } else {
              w.maximize();
            }
          }
          break;
        }
        case "close":
          (win ?? BrowserWindow.getFocusedWindow())?.close();
          break;
        case "toggleFullscreen": {
          const w = win ?? BrowserWindow.getFocusedWindow();
          if (w && !w.isDestroyed()) {
            toggleBrowserWindowFullScreen(w.webContents);
          }
          break;
        }
        case "toggleDevTools":
          event.sender.toggleDevTools();
          break;
        case "reload":
          event.sender.reload();
          break;
        case "forceReload":
          event.sender.reloadIgnoringCache();
          break;
        case "showAbout":
          void dialog.showMessageBox(win ?? BrowserWindow.getFocusedWindow()!, {
            type: "info",
            title: PRODUCT_DISPLAY_NAME,
            message: PRODUCT_DISPLAY_NAME,
            detail: i18nHost.t("titleBar.versionDetail", { version: app.getVersion() }),
          });
          break;
        default:
          break;
      }
    });

    ipcMain.on("desktop:launch-splash-ready", (event) => {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window) {
        return;
      }
      revealMainWindowWhenLaunchSplashReady(window);
    });

    ipcMain.on("desktop:read-translucency", (event) => {
      event.returnValue = readTranslucencyFromDisk();
    });

    ipcMain.on("desktop:read-onboarding-completed", (event) => {
      event.returnValue = readOnboardingCompletedFromDisk();
    });

    // Tracked value of the OS-level dark preference. While themeSource is overridden to
    // light/dark, shouldUseDarkColors / prefers-color-scheme on both the main and renderer
    // sides follow the override instead of the OS, so the true value cannot be read; take
    // the initial value here before any override happens (themeSource still 'system'), then
    // only update it from the `updated` event while not overridden. OS changes during an
    // override are not guaranteed to fire `updated`; that case is covered by the correction
    // report sent back after desktop:sync-window-frame switches back to system (the only
    // line of defense).
    let osPrefersDark = nativeTheme.shouldUseDarkColors;
    nativeTheme.on("updated", () => {
      if (nativeTheme.themeSource === "system") {
        osPrefersDark = nativeTheme.shouldUseDarkColors;
      }
    });

    ipcMain.on("desktop:read-os-prefers-dark", (event) => {
      event.returnValue = osPrefersDark;
    });

    ipcMain.on("desktop:flush-renderer-storage", (event) => {
      event.sender.session.flushStorageData();
      event.returnValue = true;
    });

    ipcMain.handle("desktop:get-window-fullscreen", (event) => {
      const window = BrowserWindow.fromWebContents(event.sender);
      return window?.isFullScreen() ?? false;
    });

    ipcMain.handle(
      "desktop:sync-window-frame",
      (
        event,
        request: {
          dark: boolean;
          nativeTheme: "system" | "light" | "dark";
          translucency?: boolean;
        },
      ) => {
        nativeTheme.themeSource = request.nativeTheme;
        // While themeSource is overridden to light/dark, the renderer's prefers-color-scheme
        // follows the override instead of the OS, so the dark value computed by the renderer
        // when switching back to system is stale. Here, after themeSource takes effect, trust
        // the main process and report it back to the renderer for correction.
        const dark =
          request.nativeTheme === "system" ? nativeTheme.shouldUseDarkColors : request.dark;
        if (request.nativeTheme === "system") {
          // osPrefersDark may lag during an override; refresh it on the same frame as the
          // switch back to system so readOsPrefersDark and the IPC report stay consistent.
          osPrefersDark = dark;
        }
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window) {
          console.warn("[spirit-desktop] desktop:sync-window-frame: no BrowserWindow for sender");
          return dark;
        }
        applyNativeWindowBackdrop(window, dark, request.translucency);
        return dark;
      },
    );

    ipcMain.handle(
      "desktop:sync-traffic-light-position",
      (event, position: { x: number; y: number }) => {
        if (process.platform !== "darwin") {
          return;
        }
        if (!Number.isFinite(position?.x) || !Number.isFinite(position?.y)) {
          return;
        }
        const window = BrowserWindow.fromWebContents(event.sender);
        const rounded = { x: Math.round(position.x), y: Math.round(position.y) };
        window?.setWindowButtonPosition(rounded);
        writeFile(trafficLightPositionCachePath(), JSON.stringify(rounded)).catch((err) => {
          console.error("[spirit-desktop] persist traffic light position failed", err);
        });
      },
    );

    // Preload forwards uncaught renderer errors/rejections (with stacks) for the crash page log.
    ipcMain.on("desktop:renderer-error", (_event, report: RendererErrorReport) => {
      if (!report || typeof report !== "object") {
        return;
      }
      recordRendererError({
        kind: report.kind === "unhandledrejection" ? "unhandledrejection" : "error",
        message: String(report.message ?? ""),
        ...(typeof report.stack === "string" ? { stack: report.stack } : {}),
      });
    });

    ipcMain.handle("desktop:sync-language", async (_event, lang: string) => {
      try {
        await i18nHost.changeLanguage(lang);
      } catch {
        // ignore i18n errors
      }
      if (process.platform === "darwin") {
        setMacOSApplicationMenu();
      }
      refreshWindowsJumpList();
      refreshStatusTray();
      refreshMacOSDockMenu();
    });

    ipcMain.handle(
      "desktop:pty-create",
      (
        event,
        request: { cwd: string; cols: number; rows: number },
      ): { ok: true; id: string; shellDisplayName: string } | { ok: false; error: string } => {
        return workspacePtyManager.createSession(event.sender, request);
      },
    );

    ipcMain.on("desktop:pty-write", (event, payload: { id: string; data: string }) => {
      workspacePtyManager.write(event.sender, payload.id, payload.data);
    });

    ipcMain.on(
      "desktop:pty-resize",
      (event, payload: { id: string; cols: number; rows: number }) => {
        workspacePtyManager.resize(event.sender, payload.id, payload.cols, payload.rows);
      },
    );

    ipcMain.handle("desktop:pty-kill", (event, id: string) => {
      workspacePtyManager.kill(event.sender, id);
    });

    ipcMain.handle("desktop:open-system-terminal", (_event, cwd: string) => {
      openSystemTerminalInDirectory(cwd);
    });

    ipcMain.handle("desktop:open-external-url", async (event, payload: { url?: string }) => {
      const url = typeof payload?.url === "string" ? payload.url.trim() : "";
      if (!url || !isAllowedExternalUrl(url)) {
        throw new Error("Invalid external URL");
      }
      if (event.sender.isDestroyed()) {
        return;
      }
      event.sender.send("desktop:browser-open-url", { url });
    });

    ipcMain.handle(
      "desktop:browser-guest-register-f12",
      (event: IpcMainInvokeEvent, payload: { tabId?: string; guestWebContentsId?: number }) => {
        const tabId = payload?.tabId;
        const guestWebContentsId = payload?.guestWebContentsId;
        if (typeof tabId !== "string" || !tabId) {
          throw new Error("Invalid browser tab id");
        }
        if (typeof guestWebContentsId !== "number" || !Number.isFinite(guestWebContentsId)) {
          throw new Error("Invalid browser guest webContents id");
        }
        registerBrowserGuestF12(event.sender, tabId, guestWebContentsId);
      },
    );

    ipcMain.handle(
      "desktop:browser-guest-unregister-f12",
      (event: IpcMainInvokeEvent, payload: { guestWebContentsId?: number }) => {
        const guestWebContentsId = payload?.guestWebContentsId;
        if (typeof guestWebContentsId !== "number" || !Number.isFinite(guestWebContentsId)) {
          throw new Error("Invalid browser guest webContents id");
        }
        unregisterBrowserGuestF12(event.sender, guestWebContentsId);
      },
    );

    ipcMain.handle(
      "desktop:browser-guest-bind-devtools",
      (
        event: IpcMainInvokeEvent,
        payload: { pageWebContentsId?: number; devtoolsWebContentsId?: number },
      ) => {
        const pageWebContentsId = payload?.pageWebContentsId;
        const devtoolsWebContentsId = payload?.devtoolsWebContentsId;
        if (
          typeof pageWebContentsId !== "number" ||
          !Number.isFinite(pageWebContentsId) ||
          typeof devtoolsWebContentsId !== "number" ||
          !Number.isFinite(devtoolsWebContentsId)
        ) {
          throw new Error("Invalid browser devtools bind payload");
        }
        bindBrowserGuestDevtools(event.sender, pageWebContentsId, devtoolsWebContentsId);
      },
    );

    ipcMain.handle(
      "desktop:browser-guest-open-devtools",
      (event: IpcMainInvokeEvent, payload: { pageWebContentsId?: number }) => {
        const pageWebContentsId = payload?.pageWebContentsId;
        if (typeof pageWebContentsId !== "number" || !Number.isFinite(pageWebContentsId)) {
          throw new Error("Invalid browser page webContents id");
        }
        return openBrowserGuestDevtools(event.sender, pageWebContentsId);
      },
    );

    ipcMain.handle(
      "desktop:browser-guest-close-devtools",
      (event: IpcMainInvokeEvent, payload: { pageWebContentsId?: number }) => {
        const pageWebContentsId = payload?.pageWebContentsId;
        if (typeof pageWebContentsId !== "number" || !Number.isFinite(pageWebContentsId)) {
          throw new Error("Invalid browser page webContents id");
        }
        closeBrowserGuestDevtools(event.sender, pageWebContentsId);
      },
    );

    ipcMain.handle("desktop:list-local-listeners", () => {
      const cached = getCachedLocalListeningEndpoints();
      if (cached !== null) return cached;
      return getScanningPromise() ?? [];
    });

    ipcMain.on("desktop:scan-local-listeners", (event) => {
      const { sender } = event;
      void startLocalListenersScan((item) => {
        if (!sender.isDestroyed()) {
          sender.send("desktop:local-listener-found", item);
        }
      }).then(() => {
        if (!sender.isDestroyed()) {
          sender.send("desktop:local-listeners-done");
        }
      });
    });

    ipcMain.handle(
      "desktop:show-notification",
      async (_event, payload: DesktopNotificationPayload) => {
        if (!getAppAwayFromUser()) {
          return false;
        }
        if (!payload || typeof payload.title !== "string" || !payload.title.trim()) {
          return false;
        }
        return showDesktopNotification(payload);
      },
    );

    ipcMain.handle("desktop:get-app-away", () => getAppAwayFromUser());

    ipcMain.handle(
      "desktop:report-renderer-visibility",
      (_event, payload: { hidden?: boolean }) => {
        setRendererVisibility(payload?.hidden === true);
        return getAppAwayFromUser();
      },
    );

    ipcMain.handle(
      "desktop:sync-attention-pending",
      (
        _event,
        payload: {
          needsApproval?: boolean;
          needsQuestions?: boolean;
          needsTaskComplete?: boolean;
          attentionBlockKey?: string;
        },
      ) => {
        setDesktopAttentionPending({
          needsApproval: payload?.needsApproval === true,
          needsQuestions: payload?.needsQuestions === true,
          needsTaskComplete: payload?.needsTaskComplete === true,
          attentionBlockKey:
            typeof payload?.attentionBlockKey === "string" ? payload.attentionBlockKey : undefined,
        });
        refreshDesktopAttention(getAppAwayFromUser());
      },
    );

    await syncInitialDesktopWebHost();
    await createMainWindow();
    refreshWindowsJumpList();
    const openSessionFromQuickMenu = async (sessionPath: string) => {
      await focusOrCreateSpiritDesktopWindows();
      await handleSpiritOpenSessionFromProtocol(sessionPath);
    };
    bindStatusTrayDeps({
      focusOrCreateMainWindow: focusOrCreateSpiritDesktopWindows,
      openSession: openSessionFromQuickMenu,
      newSession: async () => {
        await focusOrCreateSpiritDesktopWindows();
        handleSpiritNewSessionRequest();
      },
      openSettings: async () => {
        await focusOrCreateSpiritDesktopWindows();
        for (const window of BrowserWindow.getAllWindows()) {
          if (!window.isDestroyed()) {
            window.webContents.send("desktop:open-settings");
          }
        }
      },
    });
    bindMacOSDockMenuDeps({
      openSession: openSessionFromQuickMenu,
    });
    try {
      const config = await loadConfig();
      const preference =
        typeof config.uiLocale === "string" && config.uiLocale.trim()
          ? config.uiLocale.trim()
          : undefined;
      await i18nHost.changeLanguage(
        resolveUiLocalePreference(preference, [
          ...app.getPreferredSystemLanguages(),
          app.getLocale(),
        ]),
      );
    } catch {
      // ignore locale bootstrap errors
    }
    void syncStatusTray();
    void syncMacOSDockMenu();

    app.on("activate", async () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        await createMainWindow();
      }
    });
  });
}

app.on("before-quit", (event) => {
  if (statusTrayRefreshTimer !== undefined) {
    clearTimeout(statusTrayRefreshTimer);
    statusTrayRefreshTimer = undefined;
  }
  if (macOSDockMenuRefreshTimer !== undefined) {
    clearTimeout(macOSDockMenuRefreshTimer);
    macOSDockMenuRefreshTimer = undefined;
  }
  disposeStatusTray();
  disposeMacOSDockMenu();
  unsubscribeDesktopDreamUpdates?.();
  unsubscribeDesktopDreamUpdates = undefined;
  unsubscribeDesktopAutomationsUpdates?.();
  unsubscribeDesktopAutomationsUpdates = undefined;
  unsubscribeDesktopSessionListUpdates?.();
  unsubscribeDesktopSessionListUpdates = undefined;
  if (quittingAfterDesktopWebHostStop && desktopHostShutdownComplete) {
    return;
  }

  event.preventDefault();
  quittingAfterDesktopWebHostStop = true;
  desktopHostShutdownPromise ??= shutdownDesktopHostService().finally(() => {
    desktopHostShutdownComplete = true;
  });
  void Promise.all([stopDesktopWebHostIfRunning(), desktopHostShutdownPromise]).finally(() => {
    app.quit();
  });
});

function imagePreviewMimeType(extension: string): string | undefined {
  switch (extension) {
    case ".bmp":
      return "image/bmp";
    case ".gif":
      return "image/gif";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".ico":
      return "image/x-icon";
    default:
      return undefined;
  }
}

function videoPreviewMimeType(extension: string): string | null {
  switch (extension) {
    case ".mp4":
      return "video/mp4";
    case ".webm":
      return "video/webm";
    case ".mov":
      return "video/quicktime";
    case ".mpeg":
    case ".mpg":
      return "video/mpeg";
    default:
      return null;
  }
}

async function readLocalVideoPreviewUrlFromPath(filePath: string): Promise<string | null> {
  const extension = path.extname(filePath).toLowerCase();
  if (!videoPreviewMimeType(extension)) {
    return null;
  }

  try {
    const managedRoot = path.join(spiritDataDir(), MANAGED_GENERATED_VIDEOS_DIR);
    const [rootStats, candidateStats] = await Promise.all([lstat(managedRoot), lstat(filePath)]);
    if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
      return null;
    }
    if (!candidateStats.isFile() || candidateStats.isSymbolicLink()) {
      return null;
    }

    const [canonicalRoot, canonicalPath] = await Promise.all([
      realpath(managedRoot),
      realpath(filePath),
    ]);
    if (!pathIsWithinRoot(canonicalPath, canonicalRoot)) {
      return null;
    }

    return managedGeneratedVideoRefFromPath(canonicalPath);
  } catch {
    return null;
  }
}

function managedGeneratedVideoRefFromPath(filePath: string): string | null {
  const extension = path.extname(filePath).toLowerCase();
  if (!videoPreviewMimeType(extension)) {
    return null;
  }

  const assetId = path.basename(filePath);
  if (!assetId || assetId === "." || assetId === "..") {
    return null;
  }

  return `${MANAGED_ASSET_PROTOCOL}//${MANAGED_ASSET_HOST}/video/${encodeURIComponent(assetId)}`;
}

async function readImagePreviewDataUrlFromPath(filePath: string): Promise<string | null> {
  try {
    const metadata = await stat(filePath);
    if (!metadata.isFile() || metadata.size > LOCAL_IMAGE_PREVIEW_MAX_BYTES) {
      return null;
    }

    const bytes = await readFile(filePath);
    const detected = detectSupportedImageFile(filePath, bytes);
    if (!detected) {
      return null;
    }
    return `data:${detected.mimeType};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

async function resolveManagedGeneratedAssetPath(reference: string): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(reference);
  } catch {
    return null;
  }

  if (url.protocol !== MANAGED_ASSET_PROTOCOL || url.hostname !== MANAGED_ASSET_HOST) {
    return null;
  }
  if (url.search.length > 0 || url.hash.length > 0) {
    return null;
  }

  const segments = url.pathname.replace(/^\/+/, "").split("/").filter(Boolean);
  if (segments.length !== 2) {
    return null;
  }

  const kind = segments[0]?.toLowerCase();
  if (kind !== "image" && kind !== "video") {
    return null;
  }

  let assetId: string;
  try {
    assetId = decodeURIComponent(segments[1] ?? "").trim();
  } catch {
    return null;
  }
  if (!assetId || assetId !== path.basename(assetId) || assetId === "." || assetId === "..") {
    return null;
  }

  const managedDir = kind === "image" ? MANAGED_GENERATED_IMAGES_DIR : MANAGED_GENERATED_VIDEOS_DIR;
  const managedRoot = path.join(spiritDataDir(), managedDir);
  const candidatePath = path.join(managedRoot, assetId);

  try {
    const [rootStats, candidateStats] = await Promise.all([
      lstat(managedRoot),
      lstat(candidatePath),
    ]);
    if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
      return null;
    }
    if (!candidateStats.isFile() || candidateStats.isSymbolicLink()) {
      return null;
    }

    const [canonicalRoot, canonicalPath] = await Promise.all([
      realpath(managedRoot),
      realpath(candidatePath),
    ]);
    if (!pathIsWithinRoot(canonicalPath, canonicalRoot)) {
      return null;
    }

    return canonicalPath;
  } catch {
    return null;
  }
}

function pathIsWithinRoot(candidatePath: string, rootPath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function buildSaveImageDialogOptions(
  sourcePath: string,
  extension: string,
): Electron.SaveDialogOptions {
  const normalizedExtension = extension.startsWith(".") ? extension.slice(1) : extension;
  return {
    defaultPath: path.basename(sourcePath),
    filters: [
      {
        name: "Image",
        extensions: normalizedExtension ? [normalizedExtension] : ["png"],
      },
      {
        name: "All Files",
        extensions: ["*"],
      },
    ],
  };
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
