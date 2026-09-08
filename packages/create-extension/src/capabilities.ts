/**
 * The init capability catalog: each capability maps to the files it scaffolds
 * and the manifest fragments it contributes. The layouts mirror the host's
 * install-time validation and runtime loading contracts (host-internal
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
  return capabilities.includes("tools") || capabilities.includes("system-prompt");
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
  if (capabilities.includes("system-prompt")) {
    parts.push(`export const systemPrompt =
  "You are helping the user with the ${input.title} extension.";
`);
  }
  return parts.join("\n");
}

/**
 * Merge contributes fragments from all selected capabilities. The desktop
 * contributions (css / settingsPage) share one `desktop` object.
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
