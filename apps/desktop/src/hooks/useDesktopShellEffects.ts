import { useEffect } from "react";

import i18n from "@/lib/i18n";
import {
  desktopNativeThemeForPreference,
  getStoredTheme,
  resolveDark,
  syncDesktopWindowFrame,
} from "@/lib/theme";
import type { DesktopExtensionCssLayer } from "@/types";

export type UseDesktopShellEffectsOptions = {
  isElectronShell: boolean;
  darwinElectronChrome: boolean;
  useTranslucency: boolean;
  extensionCss: DesktopExtensionCssLayer[] | undefined;
};

export function useDesktopShellEffects({
  isElectronShell,
  darwinElectronChrome,
  useTranslucency,
  extensionCss,
}: UseDesktopShellEffectsOptions) {
  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    if (isElectronShell) {
      document.documentElement.classList.add("spirit-desktop-native");
    } else {
      document.documentElement.classList.remove("spirit-desktop-native");
    }
  }, [isElectronShell]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    if (darwinElectronChrome) {
      document.documentElement.classList.add("spirit-desktop-darwin");
    } else {
      document.documentElement.classList.remove("spirit-desktop-darwin");
      document.documentElement.classList.remove("spirit-desktop-darwin-fullscreen");
      document.documentElement.classList.remove("spirit-desktop-darwin-conversation-split");
    }
  }, [darwinElectronChrome]);

  useEffect(() => {
    if (!darwinElectronChrome || typeof document === "undefined") {
      return;
    }
    const bridge = window.spiritDesktop;
    if (!bridge?.getWindowFullScreen || !bridge.subscribeWindowFullScreen) {
      return;
    }
    const applyFullscreenChrome = (fullScreen: boolean) => {
      document.documentElement.classList.toggle("spirit-desktop-darwin-fullscreen", fullScreen);
    };
    void bridge.getWindowFullScreen().then(applyFullscreenChrome);
    return bridge.subscribeWindowFullScreen(applyFullscreenChrome);
  }, [darwinElectronChrome]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    if (useTranslucency) {
      document.documentElement.classList.add("spirit-desktop-translucency");
    } else {
      document.documentElement.classList.remove("spirit-desktop-translucency");
    }
    if (isElectronShell) {
      // Window sync on theme change is handled by applyThemeToDocument (to avoid double IPC);
      // here we only refresh the window material with the current stored theme when the translucency toggle changes
      const theme = getStoredTheme();
      syncDesktopWindowFrame(resolveDark(theme), desktopNativeThemeForPreference(theme), {
        translucency: useTranslucency,
      });
    }
  }, [useTranslucency, isElectronShell]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const styleNodes = Array.from(
      document.head.querySelectorAll<HTMLStyleElement>('style[data-spirit-extension-css="true"]'),
    );
    for (const node of styleNodes) {
      node.remove();
    }

    const layers = extensionCss ?? [];
    for (const layer of layers) {
      const style = document.createElement("style");
      style.dataset.spiritExtensionCss = "true";
      style.dataset.extensionId = layer.extensionId;
      style.dataset.sourcePath = layer.sourcePath;
      if (layer.media) {
        style.media = layer.media;
      }
      style.textContent = layer.cssText;
      document.head.append(style);
    }

    return () => {
      for (const node of document.head.querySelectorAll<HTMLStyleElement>(
        'style[data-spirit-extension-css="true"]',
      )) {
        node.remove();
      }
    };
  }, [extensionCss]);

  useEffect(() => {
    if (!isElectronShell) {
      return;
    }
    void window.spiritDesktop?.syncLanguage?.(i18n.language);
  }, [isElectronShell]);
}
