/**
 * Public entry: the scaffolding API, consumed by the extension-toolkit CLI's
 * init delegation. The CLI entry point is cli.ts (the npm create bin).
 */

export { initExtension } from "./init.js";
export type { InitExtensionOptions, InitExtensionResult } from "./init.js";
export {
  CAPABILITY_DEFINITIONS,
  INIT_CAPABILITY_IDS,
  isInitCapabilityId,
  titleFromName,
  type InitCapabilityId,
} from "./capabilities.js";
