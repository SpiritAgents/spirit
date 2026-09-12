import { useTranslation } from "react-i18next";
import { useRef } from "react";
import { useEditCommandState } from "@/contexts/edit-command-state-context";
import { useSessionSidebarChrome } from "@/contexts/session-sidebar-chrome-context";
import { editCommandDisabled, type EditCommand } from "@/lib/edit-command-state";
import { useTheme } from "@/hooks/useTheme";
import { useSessionSidebarShellRightInsetPx } from "@/hooks/useSessionSidebarShellRightInsetPx";
import { spiritAgentTitleBarIconSrc } from "@/lib/brand-icon";
import { sessionSidebarShellWidth } from "@/lib/desktop-chrome";
import { desktopTranslucencyTitleBarTintClass } from "@/lib/desktop-translucency-surface";
import { cn } from "@/lib/utils";
import { isViteDev } from "@/lib/vite-dev";
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarShortcut,
  MenubarTrigger,
} from "@/components/ui/menubar";

type DesktopTitleBarProps = {
  /** Native window material (Sidebar / All). */
  useTranslucency: boolean;
  /** All-mode main-content tint; when false with native material on, the trailing title-bar segment is solid. */
  useContentTranslucency?: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onOpenSettings: () => void;
};

type TitleBarZoomMenuProps = {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
};

function titleBarSurfaceClass(useTranslucency: boolean, withBorder: boolean) {
  return cn(
    withBorder && (useTranslucency ? "border-black/5 dark:border-white/10" : "border-border/40"),
    desktopTranslucencyTitleBarTintClass(useTranslucency),
  );
}

/** Transparent-background title-bar mark (the brand glyph SVG canvas is large, so 14px looks close to the old 20px favicon) */
const TITLE_BAR_ICON_PX = 14;

/** Mica title-bar dark-background mark (the artwork inside `logo-dark.svg` is smaller, restoring the 20px used before migrating to the transparent mark) */
const TITLE_BAR_ICON_TRANSLUCENCY_PX = 20;

/** Matches the sidebar interactive items' default text color (`text-sidebar-action-foreground`) */
const TITLE_BAR_MENUBAR_TRIGGER_CLASS = "px-2 py-1 text-[13px] text-sidebar-action-foreground";

function execWindowAction(action: string): void {
  void window.spiritDesktop?.executeWindowAction(action);
}

const TITLE_BAR_EDIT_SHORTCUTS: Record<EditCommand, string> = {
  undo: "Ctrl+Z",
  redo: "Ctrl+Y",
  cut: "Ctrl+X",
  copy: "Ctrl+C",
  paste: "Ctrl+V",
  selectAll: "Ctrl+A",
};

function TitleBarEditMenu() {
  const { t } = useTranslation();
  const { state, dispatch, flush } = useEditCommandState();
  return (
    <MenubarMenu>
      <MenubarTrigger
        className={TITLE_BAR_MENUBAR_TRIGGER_CLASS}
        onPointerDown={() => flush(true)}
        onFocus={() => flush(true)}
      >
        {t("titleBar.edit")}
      </MenubarTrigger>
      <MenubarContent>
        <MenubarItem
          disabled={editCommandDisabled(state, "undo")}
          onSelect={() => dispatch("undo")}
        >
          {t("titleBar.undo")}
          <MenubarShortcut>{TITLE_BAR_EDIT_SHORTCUTS.undo}</MenubarShortcut>
        </MenubarItem>
        <MenubarItem
          disabled={editCommandDisabled(state, "redo")}
          onSelect={() => dispatch("redo")}
        >
          {t("titleBar.redo")}
          <MenubarShortcut>{TITLE_BAR_EDIT_SHORTCUTS.redo}</MenubarShortcut>
        </MenubarItem>
        <MenubarSeparator />
        <MenubarItem disabled={editCommandDisabled(state, "cut")} onSelect={() => dispatch("cut")}>
          {t("titleBar.cut")}
          <MenubarShortcut>{TITLE_BAR_EDIT_SHORTCUTS.cut}</MenubarShortcut>
        </MenubarItem>
        <MenubarItem
          disabled={editCommandDisabled(state, "copy")}
          onSelect={() => dispatch("copy")}
        >
          {t("titleBar.copy")}
          <MenubarShortcut>{TITLE_BAR_EDIT_SHORTCUTS.copy}</MenubarShortcut>
        </MenubarItem>
        <MenubarItem
          disabled={editCommandDisabled(state, "paste")}
          onSelect={() => dispatch("paste")}
        >
          {t("titleBar.paste")}
          <MenubarShortcut>{TITLE_BAR_EDIT_SHORTCUTS.paste}</MenubarShortcut>
        </MenubarItem>
        <MenubarSeparator />
        <MenubarItem
          disabled={editCommandDisabled(state, "selectAll")}
          onSelect={() => dispatch("selectAll")}
        >
          {t("titleBar.selectAll")}
          <MenubarShortcut>{TITLE_BAR_EDIT_SHORTCUTS.selectAll}</MenubarShortcut>
        </MenubarItem>
      </MenubarContent>
    </MenubarMenu>
  );
}

function TitleBarAppIcon({ useTranslucency }: { useTranslucency: boolean }) {
  const { resolvedDark } = useTheme();
  const iconSrc = spiritAgentTitleBarIconSrc(resolvedDark, useTranslucency);
  const iconPx = useTranslucency ? TITLE_BAR_ICON_TRANSLUCENCY_PX : TITLE_BAR_ICON_PX;
  return (
    <span
      className="electron-no-drag ml-1 inline-flex shrink-0 items-center justify-center"
      style={{ width: iconPx, height: iconPx }}
    >
      <img
        key={iconSrc}
        src={iconSrc}
        alt=""
        width={iconPx}
        height={iconPx}
        draggable={false}
        className={cn(
          "max-h-full max-w-full object-contain select-none",
          useTranslucency && "rounded-sm",
        )}
      />
    </span>
  );
}

function TitleBarMenuCluster({
  useTranslucency,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onOpenSettings,
}: {
  useTranslucency: boolean;
  onOpenSettings: () => void;
} & TitleBarZoomMenuProps) {
  const { t } = useTranslation();
  const isDevChrome = isViteDev;
  return (
    <div className="electron-no-drag flex shrink-0 items-center gap-1">
      <TitleBarAppIcon useTranslucency={useTranslucency} />
      <Menubar
        className="h-auto border-none bg-transparent p-0 shadow-none"
        aria-label={t("titleBar.appMenu")}
      >
        <MenubarMenu>
          <MenubarTrigger className={TITLE_BAR_MENUBAR_TRIGGER_CLASS}>
            {t("titleBar.file")}
          </MenubarTrigger>
          <MenubarContent>
            <MenubarItem onSelect={() => void window.spiritDesktop?.resetSession()}>
              {t("titleBar.newSession")}
              <MenubarShortcut>Ctrl+N</MenubarShortcut>
            </MenubarItem>
            <MenubarSeparator />
            <MenubarItem onSelect={onOpenSettings}>
              {t("titleBar.settings")}
              <MenubarShortcut>Ctrl+,</MenubarShortcut>
            </MenubarItem>
            <MenubarSeparator />
            <MenubarItem onSelect={() => execWindowAction("quit")}>
              {t("titleBar.quit")}
              <MenubarShortcut>Ctrl+Q</MenubarShortcut>
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        <TitleBarEditMenu />

        <MenubarMenu>
          <MenubarTrigger className={TITLE_BAR_MENUBAR_TRIGGER_CLASS}>
            {t("titleBar.view")}
          </MenubarTrigger>
          <MenubarContent>
            {isDevChrome && (
              <>
                <MenubarItem onSelect={() => execWindowAction("reload")}>
                  {t("titleBar.reload")}
                  <MenubarShortcut>Ctrl+R</MenubarShortcut>
                </MenubarItem>
                <MenubarItem onSelect={() => execWindowAction("forceReload")}>
                  {t("titleBar.forceReload")}
                  <MenubarShortcut>Ctrl+Shift+R</MenubarShortcut>
                </MenubarItem>
                <MenubarItem onSelect={() => execWindowAction("toggleDevTools")}>
                  {t("titleBar.devTools")}
                  <MenubarShortcut>F12</MenubarShortcut>
                </MenubarItem>
                <MenubarSeparator />
              </>
            )}
            <MenubarItem onSelect={onZoomIn}>
              {t("titleBar.zoomIn")}
              <MenubarShortcut>Ctrl+=</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onSelect={onZoomOut}>
              {t("titleBar.zoomOut")}
              <MenubarShortcut>Ctrl+-</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onSelect={onZoomReset}>
              {t("titleBar.zoomReset")}
              <MenubarShortcut>Ctrl+0</MenubarShortcut>
            </MenubarItem>
            <MenubarSeparator />
            <MenubarItem onSelect={() => execWindowAction("toggleFullscreen")}>
              {t("titleBar.toggleFullscreen")}
              <MenubarShortcut>F11</MenubarShortcut>
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        <MenubarMenu>
          <MenubarTrigger className={TITLE_BAR_MENUBAR_TRIGGER_CLASS}>
            {t("titleBar.window")}
          </MenubarTrigger>
          <MenubarContent>
            <MenubarItem onSelect={() => execWindowAction("minimize")}>
              {t("titleBar.minimize")}
              <MenubarShortcut>Win+↓</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onSelect={() => execWindowAction("maximize")}>
              {t("titleBar.maximize")}
              <MenubarShortcut>Win+↑</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onSelect={() => execWindowAction("close")}>
              {t("titleBar.close")}
              <MenubarShortcut>Alt+F4</MenubarShortcut>
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        <MenubarMenu>
          <MenubarTrigger className={TITLE_BAR_MENUBAR_TRIGGER_CLASS}>
            {t("titleBar.help")}
          </MenubarTrigger>
          <MenubarContent>
            <MenubarItem onSelect={() => execWindowAction("showAbout")}>
              {t("titleBar.about")}
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>
      </Menubar>
    </div>
  );
}

/**
 * Windows: custom-drawn title bar (LOGO + menu text); window controls are still drawn by
 * `titleBarOverlay`.
 */
export function DesktopTitleBar({
  useTranslucency,
  useContentTranslucency = false,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onOpenSettings,
}: DesktopTitleBarProps) {
  const headerRef = useRef<HTMLElement>(null);
  const { open: sessionSidebarOpen, widthPx: sessionSidebarWidthPx } = useSessionSidebarChrome();
  /** Under Blur, the trailing divider is anchored to the sidebar shell's right edge; it moves in sync with collapse/expand. */
  const partialBorder = useTranslucency;
  const solidTrailingTitleBar = useTranslucency && !useContentTranslucency;
  const sidebarShellRightInsetPx = useSessionSidebarShellRightInsetPx(headerRef, partialBorder);

  return (
    <header
      ref={headerRef}
      data-spirit-surface="desktop-title-bar"
      className={cn(
        "relative electron-drag flex h-8 w-full shrink-0 overflow-hidden",
        partialBorder ? "border-b-0" : "border-b",
        titleBarSurfaceClass(useTranslucency, !partialBorder),
      )}
    >
      {partialBorder ? (
        <>
          {solidTrailingTitleBar ? (
            <div
              className="pointer-events-none absolute inset-y-0 right-0 bg-background"
              style={{ left: sidebarShellRightInsetPx }}
              aria-hidden
            />
          ) : null}
          <div
            className={cn(
              "pointer-events-none absolute bottom-0 right-0 h-px",
              solidTrailingTitleBar ? "bg-border/55" : "bg-black/5 dark:bg-white/5",
            )}
            style={{ left: sidebarShellRightInsetPx }}
            aria-hidden
          />
        </>
      ) : null}
      <div
        className="flex h-full min-h-0 w-fit shrink-0 items-center gap-1 pl-2"
        style={
          sessionSidebarOpen
            ? { minWidth: sessionSidebarShellWidth(true, sessionSidebarWidthPx) }
            : undefined
        }
      >
        <TitleBarMenuCluster
          useTranslucency={useTranslucency}
          onZoomIn={onZoomIn}
          onZoomOut={onZoomOut}
          onZoomReset={onZoomReset}
          onOpenSettings={onOpenSettings}
        />
      </div>
      <div className="electron-drag relative h-full min-w-0 flex-1" aria-hidden />
    </header>
  );
}
