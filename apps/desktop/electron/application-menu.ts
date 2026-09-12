import { BrowserWindow, Menu, app, dialog } from "electron";

import i18nHost from "../src/lib/i18n-host.js";
import {
  DISABLED_EDIT_COMMAND_STATE,
  EDIT_MENU_ITEM_IDS,
  parseEditCommandState,
  type EditCommand,
  type EditCommandState,
} from "../src/lib/edit-command-state.js";
import { setStartDictationMenuEnabled } from "./macos-appkit.js";
import { PRODUCT_DISPLAY_NAME } from "./product-display-name.js";

const isDevChrome = Boolean(process.env.VITE_DEV_SERVER_URL) || !app.isPackaged;

export type ApplicationMenuSection = "file" | "edit" | "view" | "window" | "help";

let lastEditCommandState: EditCommandState = { ...DISABLED_EDIT_COMMAND_STATE };

function menuLabel(key: string, options?: Record<string, unknown>): string {
  return i18nHost.t(`titleBar.${key}`, options);
}

function commandOrControlAccelerator(accelerator: string): string {
  if (process.platform === "darwin") {
    return accelerator;
  }
  return accelerator.replaceAll("Command", "Control");
}

function focusedWindow(win?: BrowserWindow): BrowserWindow | undefined {
  const target = win ?? BrowserWindow.getFocusedWindow();
  if (!target || target.isDestroyed()) {
    return undefined;
  }
  return target;
}

function sendNewSession(win?: BrowserWindow): void {
  const target = focusedWindow(win);
  if (target) {
    target.webContents.send("desktop:new-session");
  }
}

function sendOpenSettings(win?: BrowserWindow): void {
  const target = focusedWindow(win);
  if (target) {
    target.webContents.send("desktop:open-settings");
  }
}

type UiLayoutZoomAction = "in" | "out" | "reset";

function sendUiLayoutZoom(action: UiLayoutZoomAction, win?: BrowserWindow): void {
  const target = focusedWindow(win);
  if (target) {
    target.webContents.send("desktop:ui-layout-zoom", action);
  }
}

function sendEditCommand(command: EditCommand, win?: BrowserWindow): void {
  const target = focusedWindow(win);
  if (target) {
    target.webContents.send("desktop:edit-command", command);
  }
}

export function requestEditCommandStateRefresh(win?: BrowserWindow): void {
  const target = focusedWindow(win);
  if (target) {
    target.webContents.send("desktop:request-edit-command-state");
  }
}

function editMenuItems(win?: BrowserWindow): Electron.MenuItemConstructorOptions[] {
  const state = lastEditCommandState;
  return [
    {
      id: EDIT_MENU_ITEM_IDS.undo,
      label: menuLabel("undo"),
      accelerator: commandOrControlAccelerator("Command+Z"),
      enabled: state.canUndo,
      click: () => {
        sendEditCommand("undo", win);
      },
    },
    {
      id: EDIT_MENU_ITEM_IDS.redo,
      label: menuLabel("redo"),
      accelerator: commandOrControlAccelerator("Shift+Command+Z"),
      enabled: state.canRedo,
      click: () => {
        sendEditCommand("redo", win);
      },
    },
    { type: "separator" },
    {
      id: EDIT_MENU_ITEM_IDS.cut,
      label: menuLabel("cut"),
      accelerator: commandOrControlAccelerator("Command+X"),
      enabled: state.canCut,
      click: () => {
        sendEditCommand("cut", win);
      },
    },
    {
      id: EDIT_MENU_ITEM_IDS.copy,
      label: menuLabel("copy"),
      accelerator: commandOrControlAccelerator("Command+C"),
      enabled: state.canCopy,
      click: () => {
        sendEditCommand("copy", win);
      },
    },
    {
      id: EDIT_MENU_ITEM_IDS.paste,
      label: menuLabel("paste"),
      accelerator: commandOrControlAccelerator("Command+V"),
      enabled: state.canPaste,
      click: () => {
        sendEditCommand("paste", win);
      },
    },
    { type: "separator" },
    {
      id: EDIT_MENU_ITEM_IDS.selectAll,
      label: menuLabel("selectAll"),
      accelerator: commandOrControlAccelerator("Command+A"),
      enabled: state.canSelectAll,
      click: () => {
        sendEditCommand("selectAll", win);
      },
    },
    ...macOSEditMenuSystemBeacons(),
  ];
}

/**
 * AppKit injects Autofill / Start Dictation / Emoji & Symbols only when the Edit
 * menu contains items whose action is a first-responder selector (copy:, paste:, …).
 * Custom click items do not use those selectors, so the system block disappears.
 * Hidden role items restore the selectors without a second visible Cut/Copy row
 * and without taking accelerators from the contextual items above.
 */
function macOSEditMenuSystemBeacons(): Electron.MenuItemConstructorOptions[] {
  if (process.platform !== "darwin") {
    return [];
  }
  const beacon = (
    role: "cut" | "copy" | "paste" | "selectAll",
  ): Electron.MenuItemConstructorOptions => ({
    role,
    visible: false,
    registerAccelerator: false,
    acceleratorWorksWhenHidden: false,
  });
  return [beacon("cut"), beacon("copy"), beacon("paste"), beacon("selectAll")];
}

function viewMenuItems(win?: BrowserWindow): Electron.MenuItemConstructorOptions[] {
  return [
    ...(isDevChrome
      ? ([
          { role: "reload" as const, label: menuLabel("reload") },
          { role: "forceReload" as const, label: menuLabel("forceReload") },
          { role: "toggleDevTools" as const, label: menuLabel("devTools") },
          { type: "separator" as const },
        ] satisfies Electron.MenuItemConstructorOptions[])
      : []),
    // UI layout scale — not Electron webContents zoomIn/zoomOut/resetZoom roles.
    {
      label: menuLabel("zoomIn"),
      accelerator: commandOrControlAccelerator("Command+Plus"),
      click: () => {
        sendUiLayoutZoom("in", win);
      },
    },
    {
      label: menuLabel("zoomOut"),
      accelerator: commandOrControlAccelerator("Command+-"),
      click: () => {
        sendUiLayoutZoom("out", win);
      },
    },
    {
      label: menuLabel("zoomReset"),
      accelerator: commandOrControlAccelerator("Command+0"),
      click: () => {
        sendUiLayoutZoom("reset", win);
      },
    },
    { type: "separator" },
    { role: "togglefullscreen", label: menuLabel("toggleFullscreen") },
  ];
}

function appMenuItems(): Electron.MenuItemConstructorOptions[] {
  const appName = PRODUCT_DISPLAY_NAME;
  return [
    { role: "about", label: menuLabel("about") },
    { type: "separator" },
    {
      label: menuLabel("settings"),
      accelerator: "Command+,",
      click: () => {
        sendOpenSettings();
      },
    },
    { type: "separator" },
    { role: "services", label: menuLabel("services") },
    { type: "separator" },
    { role: "hide", label: menuLabel("hideApp", { appName }) },
    { role: "hideOthers", label: menuLabel("hideOthers") },
    { role: "unhide", label: menuLabel("showAll") },
    { type: "separator" },
    { role: "quit", label: menuLabel("quitApp", { appName }) },
  ];
}

function linuxFileMenuItems(): Electron.MenuItemConstructorOptions[] {
  return [
    {
      label: menuLabel("newSession"),
      accelerator: "Control+N",
      click: () => {
        sendNewSession();
      },
    },
    { type: "separator" },
    {
      label: menuLabel("settings"),
      accelerator: "Control+,",
      click: () => {
        sendOpenSettings();
      },
    },
    { type: "separator" },
    { role: "quit", label: menuLabel("quit") },
  ];
}

function buildSectionTemplate(
  win: BrowserWindow,
  section: ApplicationMenuSection,
): Electron.MenuItemConstructorOptions[] {
  switch (section) {
    case "file":
      return [
        {
          label: menuLabel("newSession"),
          click: () => {
            sendNewSession(win);
          },
        },
        { type: "separator" },
        { role: "quit", label: menuLabel("quit") },
      ];
    case "edit":
      return editMenuItems(win);
    case "view":
      return viewMenuItems(win);
    case "window":
      return [
        { role: "minimize", label: menuLabel("minimize") },
        {
          label: menuLabel("maximize"),
          click: (_item, focused) => {
            const target = focused ?? win;
            if (target.isMaximized()) {
              target.unmaximize();
            } else {
              target.maximize();
            }
          },
        },
        { role: "close", label: menuLabel("close") },
      ];
    case "help":
      return [
        {
          label: menuLabel("about"),
          click: () => {
            const target = focusedWindow(win);
            if (!target) {
              return;
            }
            void dialog.showMessageBox(target, {
              type: "info",
              title: PRODUCT_DISPLAY_NAME,
              message: PRODUCT_DISPLAY_NAME,
              detail: menuLabel("versionDetail", { version: app.getVersion() }),
            });
          },
        },
      ];
    default:
      return [];
  }
}

function editSubmenu(win?: BrowserWindow): Electron.MenuItemConstructorOptions {
  return {
    id: "edit-menu",
    label: menuLabel("edit"),
    submenu: editMenuItems(win),
  };
}

function buildMacOSApplicationMenuTemplate(): Electron.MenuItemConstructorOptions[] {
  return [
    {
      label: PRODUCT_DISPLAY_NAME,
      submenu: appMenuItems(),
    },
    {
      label: menuLabel("file"),
      submenu: [
        {
          label: menuLabel("newSession"),
          accelerator: "Command+N",
          click: () => {
            sendNewSession();
          },
        },
        { type: "separator" },
        { role: "close", label: menuLabel("close") },
      ],
    },
    editSubmenu(),
    {
      label: menuLabel("view"),
      submenu: viewMenuItems(),
    },
    {
      label: menuLabel("window"),
      submenu: [
        { role: "minimize", label: menuLabel("minimize") },
        { role: "zoom", label: menuLabel("zoom") },
        { type: "separator" },
        { role: "front", label: menuLabel("bringAllToFront") },
      ],
    },
  ];
}

function buildLinuxApplicationMenuTemplate(): Electron.MenuItemConstructorOptions[] {
  return [
    {
      label: menuLabel("file"),
      submenu: linuxFileMenuItems(),
    },
    editSubmenu(),
    {
      label: menuLabel("view"),
      submenu: viewMenuItems(),
    },
    {
      label: menuLabel("window"),
      submenu: [
        { role: "minimize", label: menuLabel("minimize") },
        { role: "zoom", label: menuLabel("zoom") },
        { role: "close", label: menuLabel("close") },
      ],
    },
    {
      label: menuLabel("help"),
      submenu: [
        {
          label: menuLabel("about"),
          click: () => {
            const target = focusedWindow();
            if (!target) {
              return;
            }
            void dialog.showMessageBox(target, {
              type: "info",
              title: PRODUCT_DISPLAY_NAME,
              message: PRODUCT_DISPLAY_NAME,
              detail: menuLabel("versionDetail", { version: app.getVersion() }),
            });
          },
        },
      ],
    },
  ];
}

function attachEditMenuWillShow(menu: Electron.Menu): void {
  const edit = menu.getMenuItemById("edit-menu");
  edit?.submenu?.on("menu-will-show", () => {
    setStartDictationMenuEnabled(lastEditCommandState.canDictate);
    requestEditCommandStateRefresh();
  });
}

function installApplicationMenu(template: Electron.MenuItemConstructorOptions[]): void {
  const menu = Menu.buildFromTemplate(template);
  attachEditMenuWillShow(menu);
  Menu.setApplicationMenu(menu);
  applyEditCommandStateToMenu(lastEditCommandState);
}

/** macOS system menu bar: the standard application menu plus a "New Session" item under File. */
export function setMacOSApplicationMenu(): void {
  installApplicationMenu(buildMacOSApplicationMenuTemplate());
}

/** Linux: File / Edit / View / Window / Help without macOS app-menu roles. */
export function setLinuxApplicationMenu(): void {
  installApplicationMenu(buildLinuxApplicationMenuTemplate());
}

export function setDesktopApplicationMenu(): void {
  if (process.platform === "win32") {
    Menu.setApplicationMenu(null);
    return;
  }
  if (process.platform === "darwin") {
    setMacOSApplicationMenu();
    return;
  }
  setLinuxApplicationMenu();
}

export function applyEditCommandStateToMenu(state: EditCommandState): void {
  lastEditCommandState = state;
  const menu = Menu.getApplicationMenu();
  if (!menu) {
    return;
  }
  const enabledById: Array<[string, boolean]> = [
    [EDIT_MENU_ITEM_IDS.undo, state.canUndo],
    [EDIT_MENU_ITEM_IDS.redo, state.canRedo],
    [EDIT_MENU_ITEM_IDS.cut, state.canCut],
    [EDIT_MENU_ITEM_IDS.copy, state.canCopy],
    [EDIT_MENU_ITEM_IDS.paste, state.canPaste],
    [EDIT_MENU_ITEM_IDS.selectAll, state.canSelectAll],
  ];
  for (const [id, enabled] of enabledById) {
    const item = menu.getMenuItemById(id);
    if (item) {
      item.enabled = enabled;
    }
  }
  setStartDictationMenuEnabled(state.canDictate);
}

export function rememberEditCommandState(value: unknown): EditCommandState | null {
  const state = parseEditCommandState(value);
  if (!state) {
    return null;
  }
  applyEditCommandStateToMenu(state);
  return state;
}

/** Custom top-bar menu items as a native submenu; x/y are relative to the content-area origin (do not add getContentBounds). */
export function popupApplicationMenuSection(
  win: BrowserWindow,
  section: ApplicationMenuSection,
  anchorClientX: number,
  anchorClientY: number,
): void {
  if (section === "edit") {
    requestEditCommandStateRefresh(win);
  }
  const template = buildSectionTemplate(win, section);
  if (template.length === 0) {
    return;
  }
  const zoom = win.webContents.getZoomFactor() || 1;
  const menu = Menu.buildFromTemplate(template);
  menu.popup({
    window: win,
    x: Math.round(anchorClientX * zoom),
    y: Math.round(anchorClientY * zoom),
  });
}
