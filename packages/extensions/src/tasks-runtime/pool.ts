import type { TaskPanelKind } from "../tasks/public.js";

export type TaskTerminalClaim = { reuse: string } | { create: true };

// The pool only ever tracks IDLE terminals (of exited tasks); a claimed terminal leaves
// the pool entirely until it is offered again after its task exits.
export class TaskTerminalPool {
  private readonly idleByKey = new Map<string, string[]>();
  private readonly keyByIdleTerminal = new Map<string, string>();

  offerIdle(key: string, terminalId: string): void {
    if (this.keyByIdleTerminal.has(terminalId)) {
      return;
    }
    this.keyByIdleTerminal.set(terminalId, key);
    const idle = this.idleByKey.get(key) ?? [];
    idle.push(terminalId);
    this.idleByKey.set(key, idle);
  }

  claim(key: string, panel: TaskPanelKind): TaskTerminalClaim {
    if (panel !== "new") {
      const idle = this.idleByKey.get(key);
      const terminalId = idle?.shift();
      if (terminalId !== undefined) {
        this.keyByIdleTerminal.delete(terminalId);
        if (idle!.length === 0) {
          this.idleByKey.delete(key);
        }
        return { reuse: terminalId };
      }
    }
    return { create: true };
  }

  remove(terminalId: string): void {
    const key = this.keyByIdleTerminal.get(terminalId);
    if (key === undefined) {
      return;
    }
    this.keyByIdleTerminal.delete(terminalId);
    const idle = this.idleByKey.get(key);
    if (idle !== undefined) {
      const index = idle.indexOf(terminalId);
      if (index >= 0) {
        idle.splice(index, 1);
      }
      if (idle.length === 0) {
        this.idleByKey.delete(key);
      }
    }
  }

  idleCount(key: string): number {
    return this.idleByKey.get(key)?.length ?? 0;
  }
}
