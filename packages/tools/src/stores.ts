import type { HostTodoItem, HostTodoScope } from "@spiritagent/api/tools";

export interface HostTodoToolStore {
  listItems(options?: { includeCompleted?: boolean }): Promise<HostTodoItem[]>;
  write(items: HostTodoItem[]): Promise<HostTodoItem[]>;
}

export interface HostToolStorePorts {
  createTodoStore(scope: HostTodoScope): HostTodoToolStore;
}
