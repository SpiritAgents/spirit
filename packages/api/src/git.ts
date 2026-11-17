import type { WorkLocationKind } from "./work-location.js";

export interface DesktopGitSnapshot {
  revision: number;
  isRepository: boolean;
  hasChanges: boolean;
  workingTreeLineDelta?: { added: number; removed: number };
  branch?: string;
  branches: string[];
  upstreamRemote?: string;
  upstreamBranch?: string;
  aheadCount: number;
  behindCount: number;
  pushRemote?: string;
  needsPush: boolean;
  selectedBranch?: string;
  workLocation?: WorkLocationKind;
  isWorktreeSession?: boolean;
  primaryRepoRoot?: string;
  worktreeName?: string;
  worktreeBranch?: string;
  defaultBranch?: string;
}
