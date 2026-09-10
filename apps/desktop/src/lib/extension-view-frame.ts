import type { HostDocumentChrome } from "./extension-view-tokens.js";

export const SPIRIT_EXTENSION_UI_ORIGIN = "spirit://extension-ui";
export const SPIRIT_EXTENSION_UI_RUNTIME_URL = `${SPIRIT_EXTENSION_UI_ORIGIN}/runtime.js`;

export const SPIRIT_EXTENSION_VIEW_CLOSE_MESSAGE = "spirit-extension-view-close";
export const SPIRIT_EXTENSION_VIEW_THEME_MESSAGE = "spirit-extension-view-theme";
export const SPIRIT_EXTENSION_VIEW_READY_MESSAGE = "spirit-extension-view-ready";
export const SPIRIT_EXTENSION_VIEW_SIZE_MESSAGE = "spirit-extension-view-size";

export function extensionViewFileUrl(extensionId: string, viewId: string): string {
  const params = new URLSearchParams({ extensionId, viewId });
  return `${SPIRIT_EXTENSION_UI_ORIGIN}/view?${params.toString()}`;
}

export function buildExtensionViewSrcdoc(input: {
  cssText: string;
  chrome: HostDocumentChrome;
  viewUrl: string;
  params: unknown;
  requestId: string;
}): string {
  const paramsJson = JSON.stringify(input.params ?? null).replace(/</g, "\\u003c");
  const requestIdJson = JSON.stringify(input.requestId);
  const cssText = input.cssText.replace(/<\/style/gi, "<\\/style");
  const htmlClass = escapeHtmlAttribute(input.chrome.htmlClassName);
  const htmlStyle = escapeHtmlAttribute(input.chrome.htmlStyle);
  const viewUrl = JSON.stringify(input.viewUrl);
  const runtimeUrl = JSON.stringify(SPIRIT_EXTENSION_UI_RUNTIME_URL);

  return `<!doctype html>
<html class="${htmlClass}" style="${htmlStyle}">
  <head>
    <meta charset="utf-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline' ${SPIRIT_EXTENSION_UI_ORIGIN}; connect-src ${SPIRIT_EXTENSION_UI_ORIGIN};"
    />
    <style>${cssText}</style>
    <style>html,body{margin:0;height:auto;min-height:0}#root{display:block}</style>
    <script type="importmap">
      {
        "imports": {
          "react": ${runtimeUrl},
          "react-dom": ${runtimeUrl},
          "react-dom/client": ${runtimeUrl},
          "react/jsx-runtime": ${runtimeUrl},
          "@spirit/desktop-ui": ${runtimeUrl}
        }
      }
    </script>
  </head>
  <body class="bg-background text-foreground">
    <div id="root"></div>
    <script type="module">
      import { createElement } from "react";
      import { createRoot } from "react-dom/client";
      try {
        const { default: View } = await import(${viewUrl});
        if (typeof View !== "function") {
          throw new Error("Extension view must default-export function View({ params, close })");
        }
        const close = (result) => {
          parent.postMessage({ type: "${SPIRIT_EXTENSION_VIEW_CLOSE_MESSAGE}", result }, "*");
        };
        window.addEventListener("message", (event) => {
          if (event.data && event.data.type === "${SPIRIT_EXTENSION_VIEW_THEME_MESSAGE}") {
            document.documentElement.className = event.data.htmlClassName ?? "";
            document.documentElement.setAttribute("style", event.data.htmlStyle ?? "");
          }
        });
        const root = document.getElementById("root");
        createRoot(root).render(
          createElement(View, { params: ${paramsJson}, close }),
        );
        // Ready means the View module rendered — same gate as before height
        // reporting. Do not wait for ResizeObserver: the host keeps the
        // force-mounted dialog display:none until ready, so the frame cannot
        // layout and RO never fires (3s timeout deadlock).
        parent.postMessage({ type: "${SPIRIT_EXTENSION_VIEW_READY_MESSAGE}", requestId: ${requestIdJson} }, "*");
        const reportHeight = () => {
          const height = Math.ceil(root.getBoundingClientRect().height);
          parent.postMessage({ type: "${SPIRIT_EXTENSION_VIEW_SIZE_MESSAGE}", requestId: ${requestIdJson}, height }, "*");
        };
        new ResizeObserver(reportHeight).observe(root);
      } catch (error) {
        parent.postMessage({ type: "${SPIRIT_EXTENSION_VIEW_READY_MESSAGE}", requestId: ${requestIdJson}, error: String(error) }, "*");
        throw error;
      }
    </script>
  </body>
</html>
`;
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
