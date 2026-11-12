import type { ChildProcess } from "node:child_process";
import { once } from "node:events";

export interface WorkbenchChildState {
  child?: ChildProcess;
}

/** Stop only the process started by this Desktop launch and wait for its exit before retrying. */
export async function stopWorkbenchChild(
  state: WorkbenchChildState,
  timeoutMs = 10_000,
): Promise<void> {
  const child = state.child;
  state.child = undefined;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    child.kill("SIGTERM");
    await Promise.race([
      exited,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Workbench child did not exit after SIGTERM")),
          timeoutMs,
        );
      }),
    ]);
  } catch {
    // A stuck teardown must not block recovery forever; preserve the same exit
    // waiter and escalate only after the graceful-stop deadline expires.
    child.kill("SIGKILL");
    await exited;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
