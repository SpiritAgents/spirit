import type { WorkspaceTaskTerminalSession } from "@/lib/workspace-task-terminal";

export type TaskTerminalRegistration = {
  session: WorkspaceTaskTerminalSession;
  taskKey: string;
  instanceKey?: string;
  running: boolean;
  /** Fired when the registration is unregistered (task tab unmounted); the coordinator hooks here. */
  onSessionDisposed?: (tabId: string) => void;
};

const registrations = new Map<string, TaskTerminalRegistration>();

export function registerTaskTerminal(tabId: string, entry: TaskTerminalRegistration): void {
  registrations.set(tabId, entry);
}

export function getTaskTerminal(tabId: string): TaskTerminalRegistration | undefined {
  return registrations.get(tabId);
}

export function updateTaskTerminal(
  tabId: string,
  patch: Partial<Pick<TaskTerminalRegistration, "instanceKey" | "running">>,
): void {
  const entry = registrations.get(tabId);
  if (entry !== undefined) {
    Object.assign(entry, patch);
  }
}

export function unregisterTaskTerminal(tabId: string): void {
  const entry = registrations.get(tabId);
  if (entry === undefined) {
    return;
  }
  registrations.delete(tabId);
  entry.onSessionDisposed?.(tabId);
}

export function disposeTaskTerminal(tabId: string): void {
  const entry = registrations.get(tabId);
  if (entry === undefined) {
    return;
  }
  entry.session.dispose();
  unregisterTaskTerminal(tabId);
}

export function focusTaskTerminal(tabId: string): boolean {
  const entry = registrations.get(tabId);
  if (entry === undefined) {
    return false;
  }
  entry.session.focus();
  return true;
}

export function listTaskTerminals(): [string, TaskTerminalRegistration][] {
  return [...registrations.entries()];
}

/** Test-only escape hatch: drops every registration without disposing sessions. */
export function clearTaskTerminalRegistry(): void {
  registrations.clear();
}
