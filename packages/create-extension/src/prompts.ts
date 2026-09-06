/**
 * Interactive wizard layer (TTY only). Thin: collects whatever the command
 * line left missing and confirms. All validation delegates to the toolkit.
 */

import { checkbox, confirm, input } from "@inquirer/prompts";
import { assertMarketplaceExtensionName } from "@spiritagent/extension-toolkit";

import {
  CAPABILITY_DEFINITIONS,
  isInitCapabilityId,
  titleFromName,
  type InitCapabilityId,
} from "./capabilities.js";
import type { InitExtensionOptions } from "./init.js";

export interface PartialInitOptions {
  name?: string;
  displayName?: string;
  description?: string;
  capabilities?: InitCapabilityId[];
  skipConfirmation?: boolean;
}

export async function promptForInitOptions(
  partial: PartialInitOptions,
): Promise<Omit<InitExtensionOptions, "targetDir">> {
  const name =
    partial.name ??
    (await input({
      message: "Extension name (kebab-case)",
      validate: (value) => {
        try {
          assertMarketplaceExtensionName(value, "name");
          return true;
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
      },
    }));

  const displayName =
    partial.displayName ??
    (await input({
      message: "Display name",
      default: titleFromName(name),
    }));

  const description =
    partial.description ??
    (await input({
      message: "One-line description",
      default: `TODO: describe what the ${name} extension does and when to use it.`,
    }));

  const capabilities =
    partial.capabilities ??
    (await checkbox<InitCapabilityId>({
      message: "Capabilities to scaffold",
      choices: CAPABILITY_DEFINITIONS.map((definition) => ({
        name: definition.label,
        value: definition.id,
      })),
    }));

  if (!partial.skipConfirmation) {
    const proceed = await confirm({
      message: `Scaffold "${displayName}" with ${capabilities.length} capability(ies)?`,
      default: true,
    });
    if (!proceed) {
      throw new Error("Aborted by the user.");
    }
  }

  return { name, displayName, description, capabilities };
}

/** Parse the --capabilities flag value into validated capability ids. */
export function parseCapabilitiesFlag(raw: string): InitCapabilityId[] {
  const result: InitCapabilityId[] = [];
  for (const item of raw.split(",")) {
    const id = item.trim();
    if (!id) {
      continue;
    }
    if (!isInitCapabilityId(id)) {
      throw new Error(
        `Unknown capability "${id}". Available: ${CAPABILITY_DEFINITIONS.map((d) => d.id).join(", ")}`,
      );
    }
    if (!result.includes(id)) {
      result.push(id);
    }
  }
  return result;
}
