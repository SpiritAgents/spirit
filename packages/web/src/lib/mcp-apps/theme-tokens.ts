import type { CallToolResult, ContentBlock } from "@modelcontextprotocol/client";
import type {
  McpUiDisplayMode,
  McpUiHostContext,
  McpUiResourceCsp,
  McpUiStyles,
  McpUiTheme,
  McpUiUpdateModelContextRequest,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import type { JsonValue } from "@spiritagent/agent-core";

function readCssVar(computed: CSSStyleDeclaration | null, name: string, fallback: string): string {
  const value = computed?.getPropertyValue(name).trim();
  return value ? value : fallback;
}

/**
 * Collect Spirit's active semantic design tokens and map them to the canonical
 * MCP Apps host style variable set (`McpUiStyles`).
 */
export function collectMcpAppHostStyleVariables(
  resolvedDark: boolean,
  doc: Document | undefined = typeof document !== "undefined" ? document : undefined,
): McpUiStyles {
  const computed = doc?.defaultView?.getComputedStyle(doc.documentElement) ?? null;

  const background = readCssVar(computed, "--background", resolvedDark ? "#000000" : "#ffffff");
  const card = readCssVar(computed, "--card", resolvedDark ? "#090909" : "#ffffff");
  const secondary = readCssVar(computed, "--secondary", resolvedDark ? "#171717" : "#f5f5f5");
  const muted = readCssVar(computed, "--muted", resolvedDark ? "#171717" : "#f5f5f5");
  const primary = readCssVar(computed, "--primary", resolvedDark ? "#ffffff" : "#171717");
  const primaryForeground = readCssVar(
    computed,
    "--primary-foreground",
    resolvedDark ? "#000000" : "#fafafa",
  );
  const foreground = readCssVar(computed, "--foreground", resolvedDark ? "#e4e4e4" : "#2b2b2b");
  const mutedForeground = readCssVar(
    computed,
    "--muted-foreground",
    resolvedDark ? "rgba(255, 255, 255, 0.55)" : "rgba(0, 0, 0, 0.5)",
  );
  const subtleForeground = readCssVar(computed, "--foreground-subtle", mutedForeground);
  const destructive = readCssVar(computed, "--destructive", resolvedDark ? "#f14c4c" : "#dc2626");
  const border = readCssVar(computed, "--border", resolvedDark ? "#262626" : "#e5e5e5");
  const outlineBorder = readCssVar(computed, "--outline-border", border);
  const ring = readCssVar(computed, "--ring", resolvedDark ? "#737373" : "#a3a3a3");
  const radius = readCssVar(computed, "--radius", "0.625rem");
  const fontSans = readCssVar(
    computed,
    "--spirit-ui-font-stack",
    'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  );
  const fontMono = readCssVar(
    computed,
    "--font-mono",
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  );

  const infoColor = resolvedDark ? "#3b8eea" : "#0451a5";
  const successColor = resolvedDark ? "#23d18b" : "#107c10";
  const warningColor = resolvedDark ? "#f2bc4a" : "#9a7500";

  return {
    "--color-background-primary": card,
    "--color-background-secondary": secondary,
    "--color-background-tertiary": muted,
    "--color-background-inverse": primary,
    "--color-background-ghost": "transparent",
    "--color-background-info": resolvedDark ? "rgba(59, 142, 234, 0.14)" : "rgba(4, 81, 165, 0.08)",
    "--color-background-danger": resolvedDark
      ? "rgba(241, 76, 76, 0.14)"
      : "rgba(220, 38, 38, 0.08)",
    "--color-background-success": resolvedDark
      ? "rgba(35, 209, 139, 0.14)"
      : "rgba(16, 124, 16, 0.08)",
    "--color-background-warning": resolvedDark
      ? "rgba(242, 188, 74, 0.14)"
      : "rgba(154, 117, 0, 0.08)",
    "--color-background-disabled": muted,

    "--color-text-primary": foreground,
    "--color-text-secondary": mutedForeground,
    "--color-text-tertiary": subtleForeground,
    "--color-text-inverse": primaryForeground,
    "--color-text-ghost": mutedForeground,
    "--color-text-info": infoColor,
    "--color-text-danger": destructive,
    "--color-text-success": successColor,
    "--color-text-warning": warningColor,
    "--color-text-disabled": subtleForeground,

    "--color-border-primary": border,
    "--color-border-secondary": outlineBorder,
    "--color-border-tertiary": outlineBorder,
    "--color-border-inverse": background,
    "--color-border-ghost": "transparent",
    "--color-border-info": infoColor,
    "--color-border-danger": destructive,
    "--color-border-success": successColor,
    "--color-border-warning": warningColor,
    "--color-border-disabled": outlineBorder,

    "--color-ring-primary": ring,
    "--color-ring-secondary": outlineBorder,
    "--color-ring-inverse": primaryForeground,
    "--color-ring-info": infoColor,
    "--color-ring-danger": destructive,
    "--color-ring-success": successColor,
    "--color-ring-warning": warningColor,

    "--font-sans": fontSans,
    "--font-mono": fontMono,
    "--font-weight-normal": "400",
    "--font-weight-medium": "500",
    "--font-weight-semibold": "600",
    "--font-weight-bold": "700",

    "--font-text-xs-size": "0.75rem",
    "--font-text-sm-size": "0.875rem",
    "--font-text-md-size": "0.9375rem",
    "--font-text-lg-size": "1.0625rem",
    "--font-heading-xs-size": "0.875rem",
    "--font-heading-sm-size": "1rem",
    "--font-heading-md-size": "1.125rem",
    "--font-heading-lg-size": "1.25rem",
    "--font-heading-xl-size": "1.5rem",
    "--font-heading-2xl-size": "1.875rem",
    "--font-heading-3xl-size": "2.25rem",

    "--font-text-xs-line-height": "1.4",
    "--font-text-sm-line-height": "1.5",
    "--font-text-md-line-height": "1.55",
    "--font-text-lg-line-height": "1.55",
    "--font-heading-xs-line-height": "1.35",
    "--font-heading-sm-line-height": "1.35",
    "--font-heading-md-line-height": "1.3",
    "--font-heading-lg-line-height": "1.25",
    "--font-heading-xl-line-height": "1.2",
    "--font-heading-2xl-line-height": "1.15",
    "--font-heading-3xl-line-height": "1.1",

    "--border-radius-xs": "0.25rem",
    "--border-radius-sm": "0.375rem",
    "--border-radius-md": radius,
    "--border-radius-lg": "0.75rem",
    "--border-radius-xl": "1rem",
    "--border-radius-full": "9999px",
    "--border-width-regular": "1px",

    "--shadow-hairline": resolvedDark
      ? "0 0 0 1px rgba(255, 255, 255, 0.08)"
      : "0 0 0 1px rgba(0, 0, 0, 0.06)",
    "--shadow-sm": resolvedDark ? "0 1px 2px rgba(0, 0, 0, 0.45)" : "0 1px 2px rgba(0, 0, 0, 0.06)",
    "--shadow-md": resolvedDark
      ? "0 4px 12px rgba(0, 0, 0, 0.55)"
      : "0 4px 12px rgba(0, 0, 0, 0.08)",
    "--shadow-lg": resolvedDark
      ? "0 12px 32px rgba(0, 0, 0, 0.65)"
      : "0 12px 32px rgba(0, 0, 0, 0.12)",
  };
}

export function buildMcpAppHostContext(options: {
  resolvedDark: boolean;
  displayMode: McpUiDisplayMode;
  locale: string;
  hostKind: "electron" | "web" | null;
  containerDimensions?: McpUiHostContext["containerDimensions"];
  doc?: Document;
}): McpUiHostContext {
  const theme: McpUiTheme = options.resolvedDark ? "dark" : "light";
  const timeZone =
    typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined;

  return {
    theme,
    styles: {
      variables: collectMcpAppHostStyleVariables(options.resolvedDark, options.doc),
    },
    displayMode: options.displayMode,
    availableDisplayModes: ["inline", "pip", "fullscreen"],
    ...(options.containerDimensions ? { containerDimensions: options.containerDimensions } : {}),
    locale: options.locale || "en-US",
    ...(timeZone ? { timeZone } : {}),
    platform: options.hostKind === "electron" ? "desktop" : "web",
    deviceCapabilities: {
      touch: false,
      hover: true,
    },
  };
}

export function parseMcpAppToolArguments(argumentsJson?: string): Record<string, unknown> {
  if (!argumentsJson || !argumentsJson.trim()) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(argumentsJson);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Ignore malformed arguments JSON; provide empty object to view.
  }
  return {};
}

const MCP_META_KEY = "_meta";

export function buildMcpAppCallToolResult(
  toolResult: JsonValue | undefined,
  fallbackText?: string,
  isError?: boolean,
): CallToolResult {
  if (toolResult && typeof toolResult === "object" && !Array.isArray(toolResult)) {
    const record = toolResult as Record<string, unknown>;
    const rawContent = Array.isArray(record.content)
      ? (record.content as CallToolResult["content"])
      : [];
    const rawMeta = record[MCP_META_KEY];
    const result: CallToolResult = {
      content:
        rawContent.length > 0
          ? rawContent
          : fallbackText
            ? [{ type: "text", text: fallbackText }]
            : [],
      ...(record.structuredContent &&
      typeof record.structuredContent === "object" &&
      !Array.isArray(record.structuredContent)
        ? { structuredContent: record.structuredContent as Record<string, unknown> }
        : {}),
      ...(rawMeta && typeof rawMeta === "object" && !Array.isArray(rawMeta)
        ? { [MCP_META_KEY]: rawMeta as Record<string, unknown> }
        : {}),
      ...(typeof record.isError === "boolean"
        ? { isError: record.isError }
        : isError
          ? { isError: true }
          : {}),
    };
    return result;
  }

  return {
    content: fallbackText ? [{ type: "text", text: fallbackText }] : [],
    ...(isError ? { isError: true } : {}),
  };
}

export function extractMcpAppMessageText(content: readonly ContentBlock[] | undefined): string {
  if (!Array.isArray(content) || content.length === 0) {
    return "";
  }
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") {
      continue;
    }
    if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
      parts.push(block.text.trim());
    } else if (block.type === "resource_link") {
      const label = block.name || block.uri;
      if (label) {
        parts.push(label);
      }
    }
  }
  return parts.join("\n\n").trim();
}

export function extractMcpAppModelContext(params: McpUiUpdateModelContextRequest["params"]): {
  text?: string;
  structuredContent?: JsonValue;
} {
  const text = extractMcpAppMessageText(params.content);
  const structuredContent =
    params.structuredContent !== undefined ? (params.structuredContent as JsonValue) : undefined;
  return {
    ...(text ? { text } : {}),
    ...(structuredContent !== undefined ? { structuredContent } : {}),
  };
}

export function validateMcpAppExternalUrl(rawUrl: string): URL | null {
  if (typeof rawUrl !== "string") {
    return null;
  }
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}

const KNOWN_EXTENSION_HOSTS: Record<string, readonly string[]> = {
  github: ["github.com", "gist.github.com", "docs.github.com"],
  vercel: ["vercel.com", "vercel.app"],
  linear: ["linear.app"],
  notion: ["notion.so", "www.notion.so", "notion.site"],
};

function matchesOriginDomain(url: URL, allowedEntry: string): boolean {
  try {
    const parsed = new URL(allowedEntry);
    return parsed.origin === url.origin;
  } catch {
    return false;
  }
}

export function isTrustedMcpAppExternalUrl(
  url: URL,
  options?: {
    csp?: McpUiResourceCsp;
    extensionId?: string;
  },
): boolean {
  const cspDomains = [
    ...(options?.csp?.resourceDomains ?? []),
    ...(options?.csp?.connectDomains ?? []),
    ...(options?.csp?.frameDomains ?? []),
  ];
  if (cspDomains.some((entry) => matchesOriginDomain(url, entry))) {
    return true;
  }
  const extensionId = options?.extensionId?.trim().toLowerCase();
  if (extensionId) {
    for (const [key, hosts] of Object.entries(KNOWN_EXTENSION_HOSTS)) {
      if (extensionId === key || extensionId.endsWith(`.${key}`) || extensionId.includes(key)) {
        const hostname = url.hostname.toLowerCase();
        if (hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`))) {
          return true;
        }
      }
    }
  }
  return false;
}
