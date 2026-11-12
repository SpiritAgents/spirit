export interface WorkspaceSystemOperations {
  trashItem(path: string): Promise<void>;
  openPath(path: string): Promise<string>;
  showItemInFolder(path: string): void;
}

let operations: WorkspaceSystemOperations | undefined;

export function setWorkspaceSystemOperations(value: WorkspaceSystemOperations | undefined): void {
  operations = value;
}

export function requireWorkspaceSystemOperations(): WorkspaceSystemOperations {
  if (!operations) {
    throw new Error("Workspace file shell actions are only available in the Electron desktop app.");
  }
  return operations;
}
