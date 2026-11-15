import {
  extensionAutomationTriggerKind,
  type RegisteredAutomationTriggerContribution,
} from "@spiritagent/automations/trigger-provider";

import type { HostInstalledExtension } from "./extensions.js";

export function collectAutomationTriggerContributions(
  extensions: readonly HostInstalledExtension[],
): RegisteredAutomationTriggerContribution[] {
  return extensions.flatMap((extension) => {
    if (!extension.enabled) {
      return [];
    }
    return (extension.manifest.contributes?.automationTriggers ?? []).map((trigger) => ({
      ...trigger,
      kind: extensionAutomationTriggerKind(
        extension.manifest.sourceId,
        extension.manifest.name,
        trigger.id,
      ),
      extensionId: extension.id,
      contributionId: trigger.id,
    }));
  });
}
