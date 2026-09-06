/**
 * Extension contribution config files (`mcp.json` / `hooks.json`): the parsers
 * and error types, collected as a lean subpath for tooling consumers (e.g. the
 * extension-toolkit CLI) that must not load the full agent runtime.
 */

export { parseMcpConfigFile } from "./mcp/config.js";
export { McpConfigError } from "./mcp/errors.js";
export type { McpConfigFile } from "./mcp/types.js";

export { parseHooksConfigFile } from "./hooks/config.js";
export { HookConfigError } from "./hooks/errors.js";
export type { HooksConfigFile } from "./hooks/types.js";
