/**
 * The init capability catalog: each capability maps to the files it scaffolds
 * and the manifest fragments it contributes. The layouts mirror the host's
 * install-time validation and runtime loading contracts (host services
 * extensions.ts); do not invent new layouts here.
 */

export const INIT_CAPABILITY_IDS = [
  "skills",
  "rules",
  "mcp",
  "hooks",
  "tools",
  "desktop-css",
  "desktop-settings-page",
  "desktop-views",
  "desktop-tabs",
  "authorization",
  "automation-triggers",
  "system-prompt",
] as const;

export type InitCapabilityId = (typeof INIT_CAPABILITY_IDS)[number];

export function isInitCapabilityId(value: string): value is InitCapabilityId {
  return (INIT_CAPABILITY_IDS as readonly string[]).includes(value);
}

export interface CapabilityDefinition {
  id: InitCapabilityId;
  /** Checkbox label. */
  label: string;
  /** requestedCapabilities entries added by this capability. */
  requestedCapabilities: string[];
  /** manifest.contributes fragments (deep-merged by the caller). */
  contributes(input: { name: string; title: string }): Record<string, unknown>;
  /** Additional top-level manifest fields, such as private secret declarations. */
  manifest?(input: { name: string; title: string }): Record<string, unknown>;
  /** Files scaffolded for this capability, relative to the extension root. */
  files(input: { name: string; title: string; description: string }): Record<string, string>;
}

/** Title-case a kebab-case extension name for display ("hello-world" → "Hello World"). */
export function titleFromName(name: string): string {
  return name
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

const skillMarkdown = (input: { name: string; title: string; description: string }): string =>
  `---
name: ${input.name}
description: ${input.description}
---

# ${input.title}

Tell the agent how to use this skill: when it applies, and what to do.
`;

const MAIN_MODULE_HEADER = (title: string): string =>
  `/**
 * ${title} extension main module. The host imports this file and calls
 * activate(context) on activation; the module-level exports below (tools,
 * systemPrompt) are picked up afterwards.
 */
`;

/** Minimal MCP stdio server scaffolded for the mcp capability: newline-delimited JSON-RPC 2.0 with one demo tool. */
const MCP_SERVER_EXAMPLE = `#!/usr/bin/env node
/**
 * Minimal MCP stdio server: newline-delimited JSON-RPC 2.0 over stdio.
 * Answers initialize/ping and exposes one demo tool.
 */

import readline from "node:readline";

const SERVER_INFO = { name: "example", version: "0.1.0" };

const TOOLS = [
  {
    name: "hello",
    description: "Say hello from the example MCP server.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];

function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: id, result: result }) + "\\n");
}

function fail(id, message) {
  process.stdout.write(
    JSON.stringify({ jsonrpc: "2.0", id: id, error: { code: -32601, message: message } }) + "\\n",
  );
}

readline
  .createInterface({ input: process.stdin, terminal: false })
  .on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return; // Not JSON: ignore.
    }
    const { id, method } = message;
    if (id === undefined || id === null) {
      return; // Notification: nothing to answer.
    }
    if (method === "initialize") {
      respond(id, {
        protocolVersion:
          message.params && message.params.protocolVersion
            ? message.params.protocolVersion
            : "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
    } else if (method === "ping") {
      respond(id, {});
    } else if (method === "tools/list") {
      respond(id, { tools: TOOLS });
    } else if (method === "tools/call") {
      respond(id, {
        content: [{ type: "text", text: "Hello from the example MCP server." }],
      });
    } else {
      fail(id, "Unknown method: " + String(method));
    }
  });
`;

export const CAPABILITY_DEFINITIONS: readonly CapabilityDefinition[] = [
  {
    id: "skills",
    label: "Skills (skills/<name>/SKILL.md)",
    requestedCapabilities: ["skills"],
    contributes: () => ({ skills: true }),
    files: (input) => ({ [`skills/${input.name}/SKILL.md`]: skillMarkdown(input) }),
  },
  {
    id: "rules",
    label: "Rules (rule.md)",
    requestedCapabilities: ["rules"],
    contributes: () => ({ rules: true }),
    files: (input) => ({
      "rule.md": `# ${input.title} Rules\n\nWrite the rules the agent should follow here.\n`,
    }),
  },
  {
    id: "mcp",
    label: "MCP servers (mcp.json)",
    requestedCapabilities: ["mcp"],
    contributes: () => ({ mcp: true }),
    files: () => ({
      "mcp.json": `${JSON.stringify(
        {
          servers: {
            example: {
              type: "stdio",
              command: "node",
              args: ["server.mjs"],
              enabled: false,
            },
          },
        },
        null,
        2,
      )}\n`,
      // The referenced server entry must exist: a minimal stdio server.
      "server.mjs": MCP_SERVER_EXAMPLE,
    }),
  },
  {
    id: "hooks",
    label: "Hooks (hooks.json)",
    requestedCapabilities: ["hooks"],
    contributes: () => ({ hooks: true }),
    files: (input) => ({
      // The hook runner spawns command as an executable file resolved inside
      // the extension directory — inline shell strings are not commands.
      "hooks.json": `${JSON.stringify(
        {
          version: 1,
          hooks: {
            sessionStart: [{ command: "hooks/session-start.sh" }],
          },
        },
        null,
        2,
      )}\n`,
      "hooks/session-start.sh": `#!/bin/sh
# sessionStart hook: the hook input JSON arrives on stdin; a JSON object on
# stdout feeds back into the session (anything else is ignored).
echo "session started with ${input.name}"
`,
    }),
  },
  {
    id: "tools",
    label: "Tools (contributes.tools + main module handlers)",
    requestedCapabilities: ["tool-definitions", "tool-execution"],
    contributes: (input) => ({
      tools: [
        {
          name: "hello",
          description: `Say hello from ${input.title}.`,
          inputSchema: { type: "object", properties: {}, additionalProperties: false },
        },
      ],
    }),
    files: () => ({}),
  },
  {
    id: "desktop-css",
    label: "Desktop styles (contributes.desktop.css)",
    requestedCapabilities: ["desktop-ui"],
    contributes: () => ({ desktop: { css: [{ path: "styles.css" }] } }),
    files: (input) => ({
      "styles.css": `/* ${input.title} desktop styles, injected while the extension is enabled. */\n`,
    }),
  },
  {
    id: "desktop-settings-page",
    label: "Desktop settings page (contributes.desktop.settingsPage)",
    requestedCapabilities: ["desktop-ui"],
    contributes: (input) => ({ desktop: { settingsPage: { title: input.title } } }),
    files: () => ({}),
  },
  {
    id: "desktop-views",
    label: "Desktop views (contributes.desktop.views)",
    requestedCapabilities: ["desktop-ui"],
    contributes: () => ({
      desktop: { views: [{ id: "main", path: "ui/view.mjs", title: "View" }] },
    }),
    files: () => ({
      "ui/view.mjs": `/**
 * Precompiled single-file Desktop view. The host imports the default export:
 *   export default function View({ params, close })
 * Bundle this file as one ESM module — relative imports 404.
 * React and @spirit/desktop-ui are provided by the host import map.
 */
export default function View({ params, close }) {
  void params;
  void close;
  return null;
}
`,
    }),
  },
  {
    id: "desktop-tabs",
    label: "Desktop tabs (contributes.desktop.tabs + page channel)",
    requestedCapabilities: ["desktop-ui"],
    contributes: (input) => ({
      desktop: {
        tabs: [
          {
            id: "main",
            name: input.title,
            path: "ui/tab.html",
            icon: { type: "spirit", name: "compose" },
            defaultScope: "window-shared",
          },
        ],
      },
    }),
    files: (input) => ({
      "ui/tab.html": `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${input.title}</title>
    <link rel="stylesheet" href="./tab.css" />
  </head>
  <body>
    <main>
      <h1>${input.title}</h1>
      <p id="context">Loading tab context…</p>
      <button id="echo" type="button">Send Echo Request</button>
      <p id="result" role="status"></p>
    </main>
    <script type="module" src="./tab.js"></script>
  </body>
</html>
`,
      "ui/tab.js": `const context = await window.spirit.tab.ready();
document.getElementById("context").textContent =
  context.instanceId + " · " + JSON.stringify(context.scope);
document.getElementById("echo").addEventListener("click", async () => {
  const result = await window.spirit.tab.request("echo", {
    instanceId: context.instanceId,
  });
  document.getElementById("result").textContent = JSON.stringify(result);
});
`,
      "ui/tab.css": `:root { color-scheme: light dark; }
body { margin: 0; padding: 16px; font: 13px/1.5 var(--font-sans, system-ui); }
main { display: grid; gap: 12px; }
button { width: fit-content; }
`,
    }),
  },
  {
    id: "authorization",
    label: "Authorization (private secrets + action + Desktop view)",
    requestedCapabilities: ["secret-storage", "desktop-ui"],
    manifest: () => ({ secretSlots: ["oauthAccessToken"] }),
    contributes: () => ({
      authorizations: [{ id: "oauth", action: "authorize", secretSlots: ["oauthAccessToken"] }],
      desktop: {
        views: [{ id: "authorize", path: "ui/authorize.mjs", title: "Authorize" }],
      },
    }),
    files: () => ({
      "ui/authorize.mjs": `import { createElement } from "react";
import { Button, Card } from "@spirit/desktop-ui";

export default function View({ params, close }) {
  return createElement(
    Card,
    { className: "flex items-center justify-between gap-3 p-4" },
    createElement("span", null, params.configured
      ? "Manage the configured credential."
      : "Connect this extension to your account."),
    createElement("div", { className: "flex gap-2" },
      params.configured
        ? createElement(Button, { type: "button", variant: "destructive", onClick: () => close({ disconnect: true }) }, "Disconnect")
        : null,
      createElement(Button, { type: "button", onClick: () => close({ accessToken: "demo-access-token" }) },
        params.configured ? "Reauthorize" : "Authorize"),
    ),
  );
}
`,
    }),
  },
  {
    id: "automation-triggers",
    label: "Automation triggers (validate + Native menu + poll)",
    requestedCapabilities: ["automation-triggers"],
    contributes: (input) => ({
      automationTriggers: [
        {
          id: "activity",
          name: input.title,
          description: `React to activity from ${input.title}.`,
          icon: { type: "spirit", name: "compose" },
          configuration: "menu",
          inputSchema: {
            type: "object",
            properties: {
              repository: { type: "string" },
              event: { type: "string", enum: ["created"] },
            },
            required: ["repository", "event"],
            additionalProperties: false,
          },
        },
      ],
    }),
    files: () => ({}),
  },
  {
    id: "system-prompt",
    label: "System prompt contribution (main module export)",
    requestedCapabilities: ["system-prompt"],
    contributes: () => ({}),
    files: () => ({}),
  },
];

export function capabilityDefinition(id: InitCapabilityId): CapabilityDefinition {
  const definition = CAPABILITY_DEFINITIONS.find((candidate) => candidate.id === id);
  if (!definition) {
    throw new Error(`Unknown capability: ${id}`);
  }
  return definition;
}

/** Whether the capability set needs a main module (package.json main + index.mjs). */
export function needsMainModule(capabilities: readonly InitCapabilityId[]): boolean {
  return (
    capabilities.includes("tools") ||
    capabilities.includes("system-prompt") ||
    capabilities.includes("desktop-tabs") ||
    capabilities.includes("authorization") ||
    capabilities.includes("automation-triggers")
  );
}

/** Build the merged main-module source for the selected capabilities. */
export function buildMainModule(
  capabilities: readonly InitCapabilityId[],
  input: { name: string; title: string },
): string {
  const parts: string[] = [MAIN_MODULE_HEADER(input.title)];
  // The host refuses to activate a module without an activate export, so the
  // scaffold always provides one; the exports below are collected afterwards.
  parts.push(`export function activate(context) {
  context.log("${input.title} activated");
}
`);
  if (capabilities.includes("tools")) {
    parts.push(`export const tools = {
  hello: async ({ arguments: args }) =>
    \`Hello from ${input.name}! You passed: \${JSON.stringify(args)}\`,
};
`);
  }
  if (capabilities.includes("desktop-tabs")) {
    parts.push(`export function onTabRequest({ method, params }) {
  if (method === "echo") {
    return { echoed: params ?? null };
  }
  throw new Error("Unknown tab request method: " + method);
}
`);
  }
  if (capabilities.includes("authorization")) {
    parts.push(`export const actions = {
  authorize: async (context) => {
    const session = await context.host.ui.open("authorize", {
      extensionName: "${input.title}",
      configured: await context.secrets.has("oauthAccessToken"),
    });
    const result = await session.result;
    if (result && typeof result.accessToken === "string" && result.accessToken.length > 0) {
      await context.secrets.set("oauthAccessToken", result.accessToken);
    }
    if (result && result.disconnect === true) {
      await context.secrets.delete("oauthAccessToken");
    }
    return { configured: await context.secrets.has("oauthAccessToken") };
  },
};
`);
  }
  if (capabilities.includes("automation-triggers")) {
    parts.push(`export const automationTriggers = {
  activity: {
    validate({ config }) {
      if (typeof config.repository !== "string" || !config.repository.trim()) {
        throw new Error("Repository is required.");
      }
      return { config, label: config.repository + " · " + config.event };
    },
    menu({ path }) {
      if (path.length === 0) {
        return {
          items: [{ action: "submenu", id: "example", label: "Example Repository" }],
          searchPlaceholder: "Search repositories",
        };
      }
      return {
        items: [{
          action: "select",
          id: "created",
          label: "Created",
          config: { repository: "example", event: "created" },
        }],
      };
    },
    poll({ triggers }) {
      return {
        results: triggers.map((trigger) => ({
          automationId: trigger.automationId,
          checkpoint: { initialized: true },
        })),
      };
    },
  },
};
`);
  }
  if (capabilities.includes("system-prompt")) {
    parts.push(`export const systemPrompt =
  "You are helping the user with the ${input.title} extension.";
`);
  }
  return parts.join("\n");
}

/**
 * Merge contributes fragments from all selected capabilities. The desktop
 * contributions (css / settingsPage / views / tabs) share one `desktop` object.
 */
export function mergeContributes(
  capabilities: readonly InitCapabilityId[],
  input: { name: string; title: string },
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const id of capabilities) {
    const fragment = capabilityDefinition(id).contributes(input);
    for (const [key, value] of Object.entries(fragment)) {
      if (key === "desktop") {
        const current = (merged["desktop"] ?? {}) as Record<string, unknown>;
        merged["desktop"] = { ...current, ...(value as Record<string, unknown>) };
      } else {
        merged[key] = value;
      }
    }
  }
  return merged;
}

/** Ordered, de-duplicated requestedCapabilities for the selected capabilities. */
export function mergeRequestedCapabilities(capabilities: readonly InitCapabilityId[]): string[] {
  const seen = new Set<string>();
  for (const id of capabilities) {
    for (const capability of capabilityDefinition(id).requestedCapabilities) {
      seen.add(capability);
    }
  }
  return [...seen];
}
