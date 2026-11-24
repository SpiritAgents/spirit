import type { McpAppResourceCsp } from "@spiritagent/agent-core";

export const MCP_APP_SANDBOX_PROTOCOL = "spirit-mcp-sandbox";
export const MCP_APP_DESKTOP_SANDBOX_URL = `${MCP_APP_SANDBOX_PROTOCOL}://sandbox/index.html`;
export const MCP_APP_SANDBOX_PATH = "/sandbox.html";

/**
 * Validate a single CSP source token declared by an MCP App resource.
 * Only permits explicit https:// origins (and loopback http:// origins for local dev/testing),
 * rejecting wildcards, scheme-less tokens, control characters, and CSP directive injection.
 */
export function sanitizeMcpAppCspSource(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed || /[\s;,'"\\<>]/.test(trimmed)) {
    return undefined;
  }
  if (trimmed === "*" || trimmed.includes("*")) {
    return undefined;
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return undefined;
  }
  if (parsed.protocol === "https:") {
    return parsed.origin;
  }
  if (
    parsed.protocol === "http:" &&
    (parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "localhost" ||
      parsed.hostname === "[::1]")
  ) {
    return parsed.origin;
  }
  return undefined;
}

function sanitizeSourceList(domains: readonly string[] | undefined): string[] {
  if (!domains || domains.length === 0) {
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of domains) {
    const safe = sanitizeMcpAppCspSource(item);
    if (safe && !seen.has(safe)) {
      seen.add(safe);
      out.push(safe);
    }
  }
  return out;
}

/**
 * Build the strict Content-Security-Policy applied to the inner MCP App document inside
 * the double-iframe sandbox proxy. Network access defaults to `'none'` unless explicitly
 * declared in `uiMeta.csp`.
 */
export function buildMcpAppInnerCsp(csp?: McpAppResourceCsp): string {
  const connectSources = sanitizeSourceList(csp?.connectDomains);
  const resourceSources = sanitizeSourceList(csp?.resourceDomains);
  const frameSources = sanitizeSourceList(csp?.frameDomains);
  const baseUriSources = sanitizeSourceList(csp?.baseUriDomains);

  const scriptSrc = ["'unsafe-inline'", "'unsafe-eval'", "blob:", "data:", ...resourceSources].join(
    " ",
  );
  const styleSrc = ["'unsafe-inline'", "blob:", "data:", ...resourceSources].join(" ");
  const mediaAndImgSrc = ["data:", "blob:", ...resourceSources].join(" ");
  const connectSrc = connectSources.length > 0 ? connectSources.join(" ") : "'none'";
  const frameSrc = frameSources.length > 0 ? frameSources.join(" ") : "'none'";
  const baseUri = baseUriSources.length > 0 ? baseUriSources.join(" ") : "'none'";

  return [
    "default-src 'none'",
    `script-src ${scriptSrc}`,
    `style-src ${styleSrc}`,
    `img-src ${mediaAndImgSrc}`,
    `font-src ${mediaAndImgSrc}`,
    `media-src ${mediaAndImgSrc}`,
    `connect-src ${connectSrc}`,
    `frame-src ${frameSrc}`,
    "object-src 'none'",
    `base-uri ${baseUri}`,
    "form-action 'none'",
  ].join("; ");
}

/**
 * HTTP response CSP for the outer sandbox proxy document itself.
 *
 * Because Chromium/W3C CSP3 causes `<iframe srcdoc>` to inherit its parent document's HTTP CSP
 * (intersecting with the inner `<meta>` CSP), the outer proxy must ONLY declare universal
 * invariants (`object-src 'none'`, `form-action 'none'`, `frame-ancestors`). Per-resource
 * restrictions (`default-src 'none'`, `connect-src`, `script-src`, `img-src`, `frame-src`,
 * `base-uri`) are enforced inside the inner `srcdoc` document's injected `<meta>` CSP.
 */
export function buildMcpAppSandboxOuterCsp(allowedFrameAncestors?: readonly string[]): string {
  const directives = ["object-src 'none'", "form-action 'none'"];
  const safeAncestors: string[] = [];
  if (allowedFrameAncestors && allowedFrameAncestors.length > 0) {
    for (const raw of allowedFrameAncestors) {
      const origin = raw.trim();
      if (!origin || /[\s;,'"]/.test(origin)) {
        continue;
      }
      try {
        const parsed = new URL(origin);
        if (parsed.protocol === "http:" || parsed.protocol === "https:") {
          safeAncestors.push(parsed.origin);
        } else if (/^[a-z][a-z0-9+.-]*:$/i.test(parsed.protocol)) {
          safeAncestors.push(origin);
        }
      } catch {
        // Ignore malformed origins.
      }
    }
  }
  directives.push(
    safeAncestors.length > 0
      ? `frame-ancestors ${safeAncestors.join(" ")}`
      : "frame-ancestors 'none'",
  );
  return directives.join("; ");
}

/**
 * Build the HTML for the cross-origin double-iframe MCP Apps sandbox proxy.
 *
 * Protocol (MCP Apps 2026-01-26):
 * 1. Outer proxy loads in a distinct origin (`spirit-mcp-sandbox://sandbox/index.html` on Desktop,
 *    or a dedicated loopback port `http://127.0.0.1:<sandboxPort>/sandbox.html` on Web Host).
 * 2. Outer proxy posts `{ jsonrpc: "2.0", method: "ui/notifications/sandbox-proxy-ready", params: {} }`
 *    to `window.parent`.
 * 3. Host responds with `{ jsonrpc: "2.0", method: "ui/notifications/sandbox-resource-ready", params: { html, sandbox, csp, permissions } }`.
 * 4. Outer proxy mounts a nested `<iframe sandbox="allow-scripts allow-forms">` with the strict CSP
 *    injected into the inner `srcdoc` HTML, and relays JSON-RPC messages between `window.parent`
 *    and `innerFrame.contentWindow` without exposing the parent origin or cookies/storage.
 */
export function buildMcpAppSandboxProxyHtml(options?: {
  allowedParentOrigins?: readonly string[];
}): string {
  const allowedOriginsJson = JSON.stringify(
    (options?.allowedParentOrigins ?? []).filter(
      (o) => typeof o === "string" && o.trim().length > 0,
    ),
  );

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>MCP App Sandbox</title>
<style>
html, body {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: transparent;
}
iframe#mcp-app-inner {
  border: 0;
  width: 100%;
  height: 100%;
  display: block;
  background: transparent;
}
</style>
</head>
<body>
<script>
(() => {
  const ALLOWED_PARENT_ORIGINS = ${allowedOriginsJson};
  const DEFAULT_SANDBOX = "allow-scripts allow-forms";
  let innerFrame = null;
  let parentOrigin = "*";
  let outerFrameCspApplied = null;

  function isAllowedParentOrigin(origin) {
    return ALLOWED_PARENT_ORIGINS.includes(origin);
  }

  function sanitizeCspSource(raw) {
    if (typeof raw !== "string") return null;
    const trimmed = raw.trim();
    if (!trimmed || /[\\s;,'"\\\\<>]/.test(trimmed) || trimmed.includes("*")) return null;
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === "https:") return parsed.origin;
      if (
        parsed.protocol === "http:" &&
        (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "[::1]")
      ) {
        return parsed.origin;
      }
    } catch {}
    return null;
  }

  function sanitizeSourceList(list) {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    const out = [];
    for (const item of list) {
      const safe = sanitizeCspSource(item);
      if (safe && !seen.has(safe)) {
        seen.add(safe);
        out.push(safe);
      }
    }
    return out;
  }

  function buildInnerCsp(csp) {
    const connectSources = sanitizeSourceList(csp && csp.connectDomains);
    const resourceSources = sanitizeSourceList(csp && csp.resourceDomains);
    const frameSources = sanitizeSourceList(csp && csp.frameDomains);
    const baseUriSources = sanitizeSourceList(csp && csp.baseUriDomains);
    const scriptSrc = ["'unsafe-inline'", "'unsafe-eval'", "blob:", "data:", ...resourceSources].join(" ");
    const styleSrc = ["'unsafe-inline'", "blob:", "data:", ...resourceSources].join(" ");
    const mediaAndImgSrc = ["data:", "blob:", ...resourceSources].join(" ");
    const connectSrc = connectSources.length ? connectSources.join(" ") : "'none'";
    const frameSrc = frameSources.length ? frameSources.join(" ") : "'none'";
    const baseUri = baseUriSources.length ? baseUriSources.join(" ") : "'none'";
    return [
      "default-src 'none'",
      "script-src " + scriptSrc,
      "style-src " + styleSrc,
      "img-src " + mediaAndImgSrc,
      "font-src " + mediaAndImgSrc,
      "media-src " + mediaAndImgSrc,
      "connect-src " + connectSrc,
      "frame-src " + frameSrc,
      "object-src 'none'",
      "base-uri " + baseUri,
      "form-action 'none'",
    ].join("; ");
  }

  function injectCspMeta(html, cspString) {
    // Parse with the browser's HTML5 parser so comments, <template>, <noscript>, or
    // rawtext elements containing fake <head>/<html> tags cannot trap the CSP meta tag.
    const doc = new DOMParser().parseFromString(html, "text/html");
    const meta = doc.createElement("meta");
    meta.setAttribute("http-equiv", "Content-Security-Policy");
    meta.setAttribute("content", cspString);
    if (doc.head) {
      doc.head.insertBefore(meta, doc.head.firstChild);
    } else if (doc.documentElement) {
      const head = doc.createElement("head");
      head.appendChild(meta);
      doc.documentElement.insertBefore(head, doc.documentElement.firstChild);
    }
    return "<!doctype html>\\n" + doc.documentElement.outerHTML;
  }

  function buildAllowAttribute(permissions) {
    if (!permissions || typeof permissions !== "object") return "";
    const list = [];
    if (permissions.clipboardWrite) list.push("clipboard-write");
    if (permissions.camera) list.push("camera");
    if (permissions.microphone) list.push("microphone");
    if (permissions.geolocation) list.push("geolocation");
    return list.join("; ");
  }

  function sanitizeSandboxAttr(raw) {
    // Match the outer sandbox frame policy (allow-scripts + allow-forms only); never grant
    // allow-same-origin, allow-top-navigation, popups, modals, or downloads to untrusted apps.
    const allowedTokens = new Set(["allow-scripts", "allow-forms"]);
    if (typeof raw !== "string" || !raw.trim()) {
      return DEFAULT_SANDBOX;
    }
    const tokens = raw.split(/\\s+/).filter((t) => allowedTokens.has(t));
    if (!tokens.includes("allow-scripts")) tokens.unshift("allow-scripts");
    return tokens.join(" ");
  }

  function applyOuterFrameSrcCsp(csp) {
    // Enforce frame-src on the outer proxy document itself before mounting the inner srcdoc
    // iframe: Chromium allows about:srcdoc while blocking navigations of innerFrame to any
    // undeclared URL at the network layer, and still permits declared frameDomains for nested frames.
    const frameSources = sanitizeSourceList(csp && csp.frameDomains);
    const directive = "frame-src " + (frameSources.length ? frameSources.join(" ") : "'none'");
    if (outerFrameCspApplied === directive) {
      return;
    }
    outerFrameCspApplied = directive;
    const meta = document.createElement("meta");
    meta.setAttribute("http-equiv", "Content-Security-Policy");
    meta.setAttribute("content", directive);
    document.head.appendChild(meta);
  }

  function mountInnerResource(params) {
    const html = typeof params.html === "string" ? params.html : "";
    const cspHeader = buildInnerCsp(params.csp);
    const wrappedHtml = injectCspMeta(html, cspHeader);

    if (innerFrame) {
      innerFrame.remove();
      innerFrame = null;
    }

    applyOuterFrameSrcCsp(params.csp);

    const frame = document.createElement("iframe");
    frame.id = "mcp-app-inner";
    frame.setAttribute("sandbox", sanitizeSandboxAttr(params.sandbox));
    const allow = buildAllowAttribute(params.permissions);
    if (allow) {
      frame.setAttribute("allow", allow);
    }
    let loadCount = 0;
    frame.addEventListener("load", () => {
      loadCount += 1;
      if (loadCount > 1 && innerFrame === frame) {
        // Any navigation after the initial srcdoc load escapes the injected CSP document;
        // detach immediately so the navigated page cannot continue using AppBridge RPC.
        innerFrame = null;
        frame.remove();
      }
    });
    frame.srcdoc = wrappedHtml;
    document.body.appendChild(frame);
    innerFrame = frame;
  }

  window.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || typeof data !== "object") {
      return;
    }

    if (event.source === window.parent) {
      if (!isAllowedParentOrigin(event.origin)) {
        return;
      }
      if (event.origin && event.origin !== "null") {
        parentOrigin = event.origin;
      }
      if (data.jsonrpc === "2.0" && data.method === "ui/notifications/sandbox-resource-ready") {
        mountInnerResource(data.params || {});
        return;
      }
      if (innerFrame && innerFrame.contentWindow) {
        innerFrame.contentWindow.postMessage(data, "*");
      }
      return;
    }

    if (innerFrame && event.source === innerFrame.contentWindow) {
      window.parent.postMessage(data, parentOrigin);
    }
  });

  window.parent.postMessage(
    {
      jsonrpc: "2.0",
      method: "ui/notifications/sandbox-proxy-ready",
      params: {},
    },
    "*",
  );
})();
</script>
</body>
</html>`;
}
