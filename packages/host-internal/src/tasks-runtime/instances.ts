import { taskKeyWithInstance } from "../tasks/public.js";

export type TaskInstanceAcquireResult =
  | { status: "acquired"; instanceKey: string }
  | { status: "overLimit"; active: string[] };

export class TaskInstanceRegistry {
  private readonly activeByKey = new Map<string, string[]>();

  tryAcquire(key: string, limit: number): TaskInstanceAcquireResult {
    const active = this.activeByKey.get(key) ?? [];
    if (active.length >= limit) {
      return { status: "overLimit", active: [...active] };
    }
    // The first free slot wins: the base key for the first concurrent instance, the
    // lowest free "|n" suffix (n >= 2) for parallel ones.
    let instanceKey = key;
    let n = 2;
    while (active.includes(instanceKey)) {
      instanceKey = taskKeyWithInstance(key, n);
      n += 1;
    }
    active.push(instanceKey);
    this.activeByKey.set(key, active);
    return { status: "acquired", instanceKey };
  }

  release(instanceKey: string): void {
    for (const [key, active] of this.activeByKey) {
      const index = active.indexOf(instanceKey);
      if (index < 0) {
        continue;
      }
      active.splice(index, 1);
      if (active.length === 0) {
        this.activeByKey.delete(key);
      }
      return;
    }
  }

  activeCount(key: string): number {
    return this.activeByKey.get(key)?.length ?? 0;
  }

  activeInstances(key: string): string[] {
    return [...(this.activeByKey.get(key) ?? [])];
  }

  oldestActive(key: string): string | undefined {
    return this.activeByKey.get(key)?.[0];
  }
}
