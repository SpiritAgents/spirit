export type * from "../types.js";
export interface GitHubWorkspaceSnapshot {
  isRepository: boolean;
  branch?: string;
  selectedBranch?: string;
}
