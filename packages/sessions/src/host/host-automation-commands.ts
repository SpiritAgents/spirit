import {
  createHostAutomationStore,
  formatTriggerLabel,
  type HostAutomationCreateInput,
  type HostAutomationDefinition,
  type HostAutomationRun,
  type HostAutomationUpdateInput,
} from "@spiritagent/host-internal";

import type { DesktopAutomationDetail, DesktopAutomationListItem } from "../types.js";
import { spiritDataDir } from "./storage.js";

export async function listAutomationsCommand(): Promise<DesktopAutomationListItem[]> {
  const store = createHostAutomationStore(spiritDataDir());
  return store.listSummaries();
}

export async function getAutomationCommand(
  automationId: string,
): Promise<DesktopAutomationDetail | undefined> {
  const store = createHostAutomationStore(spiritDataDir());
  const record = await store.get(automationId);
  if (!record) {
    return undefined;
  }
  return {
    definition: record.definition,
    runs: record.runs,
  };
}

export async function createAutomationCommand(
  input: HostAutomationCreateInput,
): Promise<HostAutomationDefinition> {
  const store = createHostAutomationStore(spiritDataDir());
  return store.create(input);
}

export async function updateAutomationCommand(
  automationId: string,
  patch: HostAutomationUpdateInput,
): Promise<HostAutomationDefinition> {
  const store = createHostAutomationStore(spiritDataDir());
  return store.update(automationId, patch);
}

export async function deleteAutomationCommand(automationId: string): Promise<void> {
  const store = createHostAutomationStore(spiritDataDir());
  await store.delete(automationId);
}

export async function setAutomationEnabledCommand(
  automationId: string,
  enabled: boolean,
): Promise<HostAutomationDefinition> {
  const store = createHostAutomationStore(spiritDataDir());
  return store.setEnabled(automationId, enabled);
}

export function toDesktopAutomationListItem(
  definition: HostAutomationDefinition,
  lastRunAtUnixMs?: number,
): DesktopAutomationListItem {
  return {
    id: definition.id,
    title: definition.title,
    scheduleLabel: formatTriggerLabel(definition.trigger),
    trigger: definition.trigger,
    enabled: definition.enabled,
    updatedAtUnixMs: definition.updatedAtUnixMs,
    ...(definition.githubPollError ? { githubPollError: definition.githubPollError } : {}),
    ...(lastRunAtUnixMs !== undefined ? { lastRunAtUnixMs } : {}),
  };
}

export type { HostAutomationRun };
