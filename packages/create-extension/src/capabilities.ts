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
 * ${title} extension main module. The host imports this file on activation;
 * exported tool handlers and the system prompt are picked up directly.
 */
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
    }),
  },
  {
    id: "hooks",
    label: "Hooks (hooks.json)",
    requestedCapabilities: ["hooks"],
    contributes: () => ({ hooks: true }),
    files: (input) => ({
      "hooks.json": `${JSON.stringify(
        {
          version: 1,
          hooks: {
            sessionStart: [{ command: `echo "session started with ${input.name}"` }],
          },
        },
        null,
        2,
      )}\n`,
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
export function mergeRequestedCapabilities(
  capabilities: readonly InitCapabilityId[],
): string[] {
  const seen = new Set<string>();
  for (const id of capabilities) {
    for (const capability of capabilityDefinition(id).requestedCapabilities) {
      seen.add(capability);
    }
  }
  return [...seen];
}
