// Must be the first import: self-installs uncaught-error reporting so that even
// errors thrown by the import side effects below reach the main-process crash log.
import "./lib/renderer-error-reporting";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./lib/i18n";
import App from "./App";
import { UiPortalProvider } from "@spiritagent/ui/portal";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WorkspaceToolsChromeProvider } from "@/contexts/workspace-tools-chrome-context";
import { ThemeProvider } from "./hooks/useTheme";
import {
  applyClickablePointerCursorToDocument,
  getStoredClickablePointerCursor,
} from "./lib/clickable-pointer-cursor";
import { applyDesktopNativeChromeToDocument } from "./lib/desktop-shell";
import { applyFontToDocument, getStoredFont } from "./lib/font";
import { applyFontSmoothingToDocument, getStoredFontSmoothing } from "./lib/font-smoothing";
import {
  applyReduceMotionToDocument,
  getStoredReduceMotion,
  startReduceMotionSystemListener,
} from "./lib/reduce-motion";
import { applyThemeToDocument, getStoredTheme } from "./lib/theme";
import { getUiLayoutPortalContainer } from "./lib/ui-layout-scale";
import "katex/dist/katex.min.css";
import "streamdown/styles.css";
import "./styles.css";

// Apply stored appearance preferences before first paint, so portaled overlays match the root styles
if (typeof document !== "undefined") {
  applyThemeToDocument(getStoredTheme());
  applyDesktopNativeChromeToDocument();
  applyFontToDocument(getStoredFont());
  applyFontSmoothingToDocument(getStoredFontSmoothing());
  applyClickablePointerCursorToDocument(getStoredClickablePointerCursor());
  applyReduceMotionToDocument(getStoredReduceMotion());
  startReduceMotionSystemListener();
}

const rootElement = document.getElementById("app");

if (!rootElement) {
  throw new Error("Desktop root element #app was not found.");
}

createRoot(rootElement).render(
  <StrictMode>
    <ThemeProvider>
      <UiPortalProvider getContainer={getUiLayoutPortalContainer}>
        <Toaster position="bottom-right" />
        <TooltipProvider delayDuration={300} getPortalContainer={getUiLayoutPortalContainer}>
          <WorkspaceToolsChromeProvider>
            <App />
          </WorkspaceToolsChromeProvider>
        </TooltipProvider>
      </UiPortalProvider>
    </ThemeProvider>
  </StrictMode>,
);
