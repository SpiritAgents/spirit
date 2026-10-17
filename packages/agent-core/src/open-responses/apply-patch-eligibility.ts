import {
  readAgentModeFromTransportConfig,
  type JsonObject,
  type JsonValue,
  type AgentMode,
} from "../ports.js";
import {
  isBedrockMantleOpenResponsesConfig,
  type OpenResponsesTransportConfig,
} from "./responses-compat.js";
import { shouldUseGatewayWebSearch } from "./gateway-web-search.js";

export { normalizeGatewayOpenAiModelId } from "./responses-compat.js";

const LEGACY_FILE_TOOL_NAMES = new Set(["create_file", "edit_file", "delete_file"]);

export const APPLY_PATCH_HOST_TOOL_NAME = "apply_patch";

/** OpenAI Responses apply_patch operation types (API names, not host function tools). */
export type ApplyPatchOperationType = "create_file" | "update_file" | "delete_file";

export interface ApplyPatchOperation {
  type: ApplyPatchOperationType;
  path: string;
  diff?: string;
}

/** The endpoint declares apply_patch support via the `options.applyPatch` mechanism switch. */
function declaresApplyPatch(config: Pick<OpenResponsesTransportConfig, "options">): boolean {
  return config.options?.applyPatch === true;
}

/** Official OpenAI: `@ai-sdk/openai` 3.x `openai.tools.applyPatch`; Gateway goes through fetch function_call. */
export function shouldUseOpenAiSdkApplyPatchTool(
  config: Pick<
    OpenResponsesTransportConfig,
    "baseUrl" | "transportKind" | "model" | "sdk" | "options" | "agentMode"
  >,
): boolean {
  return (
    shouldUseApplyPatchFileTools(config) &&
    config.sdk === "@ai-sdk/openai" &&
    !isBedrockMantleOpenResponsesConfig(config)
  );
}

/**
 * The gateway v3 language-model protocol has no built-in `type: apply_patch`; a flat function tool
 * must be registered in tools. Bedrock Mantle takes the same flat function-tool path.
 */
export function shouldUseApplyPatchFunctionTool(
  config: Pick<
    OpenResponsesTransportConfig,
    "baseUrl" | "transportKind" | "model" | "sdk" | "options" | "agentMode"
  >,
): boolean {
  return (
    shouldUseApplyPatchFileTools(config) &&
    !shouldUseOpenAiSdkApplyPatchTool(config) &&
    (config.sdk === "@ai-sdk/gateway" || isBedrockMantleOpenResponsesConfig(config))
  );
}

/** Generic Open Responses endpoints take the built-in apply_patch request-item shape via the fetch bridge. */
export function shouldUseBuiltInApplyPatchRequestItems(
  config: Pick<
    OpenResponsesTransportConfig,
    "baseUrl" | "transportKind" | "model" | "sdk" | "options" | "agentMode"
  >,
): boolean {
  return (
    shouldUseApplyPatchFileTools(config) &&
    !shouldUseOpenAiSdkApplyPatchTool(config) &&
    !shouldUseApplyPatchFunctionTool(config)
  );
}

/**
 * Gateway v3 language-model uses `prompt`; only the Open Responses fetch omits and stash/reinjects via body.input.
 */
export function shouldOmitApplyPatchFromAiSdkMessages(
  config: Pick<
    OpenResponsesTransportConfig,
    "baseUrl" | "transportKind" | "model" | "sdk" | "options" | "agentMode" | "llmVendor"
  >,
): boolean {
  if (!shouldUseApplyPatchFileTools(config)) {
    return false;
  }
  if (shouldUseOpenAiSdkApplyPatchTool(config)) {
    return false;
  }
  if (shouldUseGatewayWebSearch(config)) {
    return false;
  }
  return true;
}

export function shouldUseApplyPatchFileTools(
  config: Pick<
    OpenResponsesTransportConfig,
    "transportKind" | "model" | "sdk" | "options" | "agentMode"
  >,
  options?: { agentMode?: AgentMode },
): boolean {
  const agentMode = options?.agentMode ?? readAgentModeFromTransportConfig(config);
  if (agentMode === "ask") {
    return false;
  }

  if (config.transportKind !== "open-responses") {
    return false;
  }

  return declaresApplyPatch(config);
}

/** @deprecated Use {@link shouldUseApplyPatchFileTools}. */
export const shouldUseOpenAiApplyPatchTool = shouldUseApplyPatchFileTools;

export function isLegacyHostFileToolName(name: string): boolean {
  return LEGACY_FILE_TOOL_NAMES.has(name);
}

export function filterLegacyHostFileToolDefinitions(
  definitions: readonly JsonValue[],
): JsonValue[] {
  return definitions.filter((definition) => {
    const name = readFunctionToolName(definition);
    return name === undefined || !LEGACY_FILE_TOOL_NAMES.has(name);
  });
}

/** @deprecated Use {@link filterLegacyHostFileToolDefinitions}. */
export const filterBuiltinFileToolsForApplyPatch = filterLegacyHostFileToolDefinitions;

const APPLY_PATCH_OPERATION_SCHEMA: JsonObject = {
  type: "object",
  properties: {
    type: {
      type: "string",
      enum: ["create_file", "update_file", "delete_file"],
      description: "Patch operation kind.",
    },
    path: {
      type: "string",
      description: "Workspace-relative or absolute file path to create, update, or delete.",
    },
    diff: {
      type: "string",
      description: "Headerless V4A unified diff for create_file or update_file.",
    },
  },
  required: ["type", "path"],
  additionalProperties: false,
};

/** Chat Completions `tools[]` shape (trace export / legacy). */
export function buildApplyPatchFunctionToolDefinition(): JsonObject {
  return {
    type: "function",
    function: {
      name: APPLY_PATCH_HOST_TOOL_NAME,
      description: applyPatchFunctionToolDescription(),
      parameters: applyPatchFunctionToolParameters(),
    },
  };
}

/** OpenAI Responses `tools[]` flat function entry (Gateway / `@ai-sdk/openai`). */
export function buildApplyPatchResponsesFunctionToolDefinition(): JsonObject {
  return {
    type: "function",
    name: APPLY_PATCH_HOST_TOOL_NAME,
    description: applyPatchFunctionToolDescription(),
    parameters: applyPatchFunctionToolParameters(),
  };
}

export function isApplyPatchFunctionToolDefinition(tool: unknown): boolean {
  return readFunctionToolName(tool as JsonValue) === APPLY_PATCH_HOST_TOOL_NAME;
}

export function hasApplyPatchToolInResponsesTools(tools: unknown): boolean {
  if (!Array.isArray(tools)) {
    return false;
  }

  for (const tool of tools) {
    if (typeof tool !== "object" || tool === null || Array.isArray(tool)) {
      continue;
    }
    const record = tool as JsonObject;
    if (record.type === "apply_patch") {
      return true;
    }
    if (record.type === "function" && record.name === APPLY_PATCH_HOST_TOOL_NAME) {
      return true;
    }
    if (isApplyPatchFunctionToolDefinition(record)) {
      return true;
    }
  }

  return false;
}

function applyPatchFunctionToolDescription(): string {
  return (
    "Apply a headerless V4A unified diff to create, update, or delete a file. " +
    "Provide operation.type, operation.path, and operation.diff for create/update."
  );
}

function applyPatchFunctionToolParameters(): JsonObject {
  return {
    type: "object",
    properties: {
      operation: APPLY_PATCH_OPERATION_SCHEMA,
    },
    required: ["operation"],
    additionalProperties: false,
  };
}

/** Model-visible guidance when legacy file tools are hidden in favor of apply_patch. */
export function buildApplyPatchFileToolsPromptSection(): string {
  return "File edits on this transport: use apply_patch with headerless V4A unified diffs only.";
}

function readFunctionToolName(definition: JsonValue): string | undefined {
  if (typeof definition !== "object" || definition === null || Array.isArray(definition)) {
    return undefined;
  }

  const fn = definition.function;
  if (typeof fn !== "object" || fn === null || Array.isArray(fn)) {
    return undefined;
  }

  return typeof fn.name === "string" ? fn.name : undefined;
}
