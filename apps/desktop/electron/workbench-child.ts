import type { ChildProcess } from "node:child_process";

export interface WorkbenchChildState {
  child?: ChildProcess;
}

/** Stop only the process started by this Desktop launch and clear its reusable handle. */
export function stopWorkbenchChild(state: WorkbenchChildState): void {
  const child = state.child;
  state.child = undefined;
  child?.kill("SIGTERM");
}
