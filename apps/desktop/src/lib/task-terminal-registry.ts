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

let sessionDisposedHandler: ((tabId: string) => void) | undefined;

/** One-time wiring for the task run coordinator, called by the run service init. */
export function setTaskTerminalSessionDisposedHandler(handler: (tabId: string) => void): void {
  sessionDisposedHandler = handler;
}

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
  const notify = entry.onSessionDisposed ?? sessionDisposedHandler;
  notify?.(tabId);
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

// A task tab registers its session from a React effect after the run host has already
// updated the tab state, so the host polls briefly for the registration to appear. The
// timeout only fires when the tab never mounted (closed instantly, or no pty bridge).
export function waitForTaskTerminal(
  tabId: string,
  timeoutMs = 2000,
): Promise<TaskTerminalRegistration | undefined> {
  const existing = registrations.get(tabId);
  if (existing !== undefined) {
    return Promise.resolve(existing);
  }
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const poll = (): void => {
      const entry = registrations.get(tabId);
      if (entry !== undefined) {
        resolve(entry);
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        resolve(undefined);
        return;
      }
      setTimeout(poll, 16);
    };
    poll();
  });
}

/** Test-only escape hatch: drops every registration without disposing sessions. */
export function clearTaskTerminalRegistry(): void {
  registrations.clear();
  sessionDisposedHandler = undefined;
}
