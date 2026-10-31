import type { JsonObject, JsonValue } from "../ports.js";
import { isOpenAiFunctionToolEntry, isPlainJsonObject } from "./types.js";

/**
 * Declared OpenAI function `parameters` schemas keyed by tool name, from literal `tools` entries;
 * the first declaration of a name wins.
 */
export function providerToolParametersMap(tools: readonly unknown[]): Map<string, JsonObject> {
  const map = new Map<string, JsonObject>();
  for (const tool of tools) {
    if (!isOpenAiFunctionToolEntry(tool)) {
      continue;
    }
    const { name, parameters } = tool.function;
    if (parameters !== undefined && !map.has(name)) {
      map.set(name, parameters);
    }
  }
  return map;
}

function checkArgumentValue(
  toolName: string,
  key: string,
  value: JsonValue,
  schema: JsonObject,
): string | undefined {
  const type = schema.type;
  if (typeof type === "string") {
    switch (type) {
      case "string":
        if (typeof value !== "string") {
          return `${toolName}: argument "${key}" must be a string.`;
        }
        break;
      case "integer":
        if (typeof value !== "number" || !Number.isInteger(value)) {
          return `${toolName}: argument "${key}" must be an integer.`;
        }
        break;
      case "number":
        if (typeof value !== "number" || !Number.isFinite(value)) {
          return `${toolName}: argument "${key}" must be a number.`;
        }
        break;
      case "boolean":
        if (typeof value !== "boolean") {
          return `${toolName}: argument "${key}" must be a boolean.`;
        }
        break;
      case "array":
        if (!Array.isArray(value)) {
          return `${toolName}: argument "${key}" must be an array.`;
        }
        break;
      case "object":
        if (!isPlainJsonObject(value)) {
          return `${toolName}: argument "${key}" must be an object.`;
        }
        break;
      default:
        break;
    }
  }

  if (typeof value === "number") {
    const minimum = schema.minimum;
    if (typeof minimum === "number" && value < minimum) {
      return `${toolName}: argument "${key}" must be >= ${minimum}.`;
    }
    const maximum = schema.maximum;
    if (typeof maximum === "number" && value > maximum) {
      return `${toolName}: argument "${key}" must be <= ${maximum}.`;
    }
  }

  return undefined;
}

/**
 * Fail-fast validation of tool-call arguments against the declared JSON schema subset
 * (type / required / properties / additionalProperties / minimum / maximum). Out-of-bounds input
 * returns an error string for the model — never silent clamping. Schemas or features outside the
 * subset are permissive; a missing schema passes through.
 */
export function validateProviderToolArguments(
  toolName: string,
  argumentsJson: string,
  parameters: JsonObject | undefined,
): string | undefined {
  if (parameters === undefined) {
    return undefined;
  }

  let args: unknown;
  try {
    args = JSON.parse(argumentsJson);
  } catch {
    return `${toolName}: arguments are not valid JSON.`;
  }
  if (!isPlainJsonObject(args)) {
    return `${toolName}: arguments must be a JSON object.`;
  }

  const properties = isPlainJsonObject(parameters.properties) ? parameters.properties : undefined;

  if (Array.isArray(parameters.required)) {
    for (const name of parameters.required) {
      if (typeof name === "string" && !(name in args)) {
        return `${toolName}: missing required argument "${name}".`;
      }
    }
  }

  if (parameters.additionalProperties === false && properties !== undefined) {
    for (const key of Object.keys(args)) {
      if (!(key in properties)) {
        return `${toolName}: unknown argument "${key}".`;
      }
    }
  }

  if (properties !== undefined) {
    for (const [key, value] of Object.entries(args)) {
      const schema = properties[key];
      if (!isPlainJsonObject(schema)) {
        continue;
      }
      const error = checkArgumentValue(toolName, key, value, schema);
      if (error !== undefined) {
        return error;
      }
    }
  }

  return undefined;
}
