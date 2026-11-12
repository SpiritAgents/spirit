import { taskKeyWithInstance } from "../tasks/public.js";

export interface ActiveTaskInstance {
  instanceKey: string;
  /** 1 for the first concurrent instance (base key), 2, 3, … for parallel ones. */
  instance: number;
  startedAt: number;
}

export type TaskInstanceAcquireResult =
  | { status: "acquired"; instanceKey: string }
  | { status: "overLimit"; active: ActiveTaskInstance[] };

export class TaskInstanceRegistry {
  private readonly activeByKey = new Map<string, ActiveTaskInstance[]>();

  tryAcquire(key: string, limit: number): TaskInstanceAcquireResult {
    const active = this.activeByKey.get(key) ?? [];
    if (active.length >= limit) {
      return { status: "overLimit", active: active.map((entry) => ({ ...entry })) };
    }
    // The first free slot wins: the base key for the first concurrent instance, the
    // lowest free "|n" suffix (n >= 2) for parallel ones.
    let instanceKey = key;
    let instance = 1;
    while (active.some((entry) => entry.instanceKey === instanceKey)) {
      instance += 1;
      instanceKey = taskKeyWithInstance(key, instance);
    }
    active.push({ instanceKey, instance, startedAt: Date.now() });
    this.activeByKey.set(key, active);
    return { status: "acquired", instanceKey };
  }

  release(instanceKey: string): void {
    for (const [key, active] of this.activeByKey) {
      const index = active.findIndex((entry) => entry.instanceKey === instanceKey);
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

  activeInstances(key: string): ActiveTaskInstance[] {
    return (this.activeByKey.get(key) ?? []).map((entry) => ({ ...entry }));
  }

  oldestActive(key: string): string | undefined {
    return this.activeByKey.get(key)?.[0]?.instanceKey;
  }
}
