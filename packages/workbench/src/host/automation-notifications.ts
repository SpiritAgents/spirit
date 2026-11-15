import type { HostAutomationDefinition, HostAutomationRun } from "@spiritagent/automations";
import i18n from "@spiritagent/sessions/lib/i18n-host";

export interface AutomationNotificationPayload {
  title: string;
  body?: string;
  tag: string;
  kind: "automation";
  context: {
    automationId: string;
    runId?: string;
    sessionPath?: string;
  };
}

export interface DesktopAutomationNotificationAdapter {
  isAway(): Promise<boolean>;
  show(payload: AutomationNotificationPayload): Promise<unknown>;
}

let adapter: DesktopAutomationNotificationAdapter | undefined;

export function setDesktopAutomationNotificationAdapter(
  next: DesktopAutomationNotificationAdapter | undefined,
): void {
  adapter = next;
}

const notifiedTriggerErrors = new Map<string, string>();

export async function notifyAutomationRunFinished(
  definition: HostAutomationDefinition,
  run: HostAutomationRun,
): Promise<void> {
  if (!adapter || !(await adapter.isAway())) {
    return;
  }
  const titleKey =
    run.status === "completed"
      ? "notification.automation.completedTitle"
      : run.status === "blocked"
        ? "notification.automation.blockedTitle"
        : "notification.automation.failedTitle";
  await adapter.show({
    title: i18n.t(titleKey, { title: definition.title }),
    ...(run.error ? { body: run.error } : {}),
    tag: `spirit-automation-${definition.id}`,
    kind: "automation",
    context: {
      automationId: definition.id,
      runId: run.id,
      sessionPath: run.sessionPath,
    },
  });
}

export async function notifyAutomationTriggerError(
  definition: HostAutomationDefinition,
  error: string | undefined,
): Promise<void> {
  const normalized = error?.trim() || undefined;
  if (!normalized) {
    notifiedTriggerErrors.delete(definition.id);
    return;
  }
  if (notifiedTriggerErrors.get(definition.id) === normalized) {
    return;
  }
  if (!adapter || !(await adapter.isAway())) {
    return;
  }
  notifiedTriggerErrors.set(definition.id, normalized);
  await adapter.show({
    title: i18n.t("notification.automation.triggerErrorTitle", { title: definition.title }),
    body: normalized,
    tag: `spirit-automation-${definition.id}`,
    kind: "automation",
    context: { automationId: definition.id },
  });
}

export function resetAutomationTriggerErrorNotification(automationId: string): void {
  notifiedTriggerErrors.delete(automationId);
}
