import type { GitChipAction } from "../types.js";

export const GIT_CHIP_PROMPT_COMMIT = `## Goal

Create one local Git commit for the active workspace.

## Steps

1. Run \`git status\` and \`git diff\` (or \`git diff HEAD\`) to inspect changes.
2. If there is nothing to commit, say so and stop.
3. Infer the commit message from **this repository** (recent \`git log\`, \`CONTRIBUTING*\`, \`.github/\`, \`AGENTS.md\`, copilot instructions, etc.). Do not assume a fixed language or Conventional Commits layout unless the repo shows it.
4. If the user added notes in this turn, apply them when they fit repo conventions.
5. Stage and commit with \`git add\` and \`git commit\` via the shell tool in this session.
6. Briefly report the outcome (hash or summary).`;

export const GIT_CHIP_PROMPT_PUSH = `## Goal

Push the current branch to the configured upstream remote for this workspace.

## Steps

1. Run \`git status -sb\` to see branch and ahead/behind state.
2. If there is nothing to push, say so and stop.
3. Run \`git push\` (use \`-u\` only when upstream is missing and appropriate).
4. If the user added notes in this turn, follow them when safe.
5. Briefly report the outcome.`;

export const GIT_CHIP_PROMPT_MERGE = `## Goal

Merge the current **spirit/** worktree branch into the default branch on the **primary** repository (not inside the worktree checkout alone).

## Constraints

- Only when this session uses a linked worktree with a \`spirit/...\` branch.
- The primary repo working tree must be clean before merging.
- On merge conflicts: explain, run \`git merge --abort\` if needed, and stop without leaving a broken merge.

## Steps

1. Confirm worktree context (\`git status\`, worktree list if needed).
2. In the primary repo root: checkout the default branch, then \`git merge --no-edit <spirit-branch>\`.
3. If the user added notes in this turn, follow them when safe.
4. Briefly report the outcome.`;

const GIT_CHIP_PROMPTS: Record<GitChipAction, string> = {
  commit: GIT_CHIP_PROMPT_COMMIT,
  push: GIT_CHIP_PROMPT_PUSH,
  merge: GIT_CHIP_PROMPT_MERGE,
};

export function buildGitChipUserTurn(action: GitChipAction, extraNote?: string): string {
  const body = GIT_CHIP_PROMPTS[action];
  const note = extraNote?.trim();
  return note ? `${body}\n\n${note}` : body;
}

/** i18n keys aligned with git-changes-actions button labels. */
export const GIT_CHIP_DISPLAY_I18N_KEYS: Record<GitChipAction, string> = {
  commit: "app.commit",
  push: "workspace.git.push",
  merge: "app.merge",
};
