import type { ChildProcess } from "node:child_process";
import { once } from "node:events";

export interface WorkbenchChildState {
  child?: ChildProcess;
}

/** Stop only the process started by this Desktop launch and wait for its exit before retrying. */
export async function stopWorkbenchChild(state: WorkbenchChildState): Promise<void> {
  const child = state.child;
  state.child = undefined;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  await exited;
}
