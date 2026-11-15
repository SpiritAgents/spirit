import type { JsonObject } from "@spiritagent/agent-core";
import { assertHostExtensionJsonValue } from "@spiritagent/extensions";

export function assertAutomationMenuConfig(value: unknown): JsonObject {
  assertHostExtensionJsonValue(value, "Automation trigger menu config");
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Automation trigger menu config must be an object.");
  }
  return value as JsonObject;
}
