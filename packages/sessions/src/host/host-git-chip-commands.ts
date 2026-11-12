import i18n from "../lib/i18n-host.js";
import { buildGitChipUserTurn, GIT_CHIP_DISPLAY_I18N_KEYS } from "./git-chip-prompts.js";
import type { HostExtensionCommandContext } from "./host-extension-commands.js";
import type {
  DesktopGitSnapshot,
  DesktopSnapshot,
  GitChipAction,
  SubmitGitChipRequest,
} from "../types.js";

/** UI bubble label; matches git-changes-actions button copy. */
export function buildGitChipDisplayText(action: GitChipAction, extraNote?: string): string {
  const label = i18n.t(GIT_CHIP_DISPLAY_I18N_KEYS[action]);
  const note = extraNote?.trim();
  return note ? `${label} ${note}` : label;
}

function assertMergeAllowed(git: DesktopGitSnapshot): void {
  if (
    git.isWorktreeSession !== true ||
    !git.worktreeBranch?.trim() ||
    !git.primaryRepoRoot?.trim()
  ) {
    throw new Error(i18n.t("error.notInWorktree"));
  }
}

export async function submitGitChipCommand(
  ctx: HostExtensionCommandContext,
  request: SubmitGitChipRequest,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized(undefined, { fastPath: true });
    const runtime = ctx.requireRuntime();
    if (runtime.isBusy()) {
      throw new Error(i18n.t("error.runtimeBusy"));
    }

    const action = request.action;
    const state = ctx.requireState();
    if (action === "merge") {
      assertMergeAllowed(state.git);
    }
    if (action === "commit") {
      if (!state.git.isRepository) {
        throw new Error(i18n.t("error.notGitRepo"));
      }
      if (state.git.hasChanges !== true) {
        throw new Error(i18n.t("error.noChangesToCommit"));
      }
    }
    if (action === "push") {
      if (!state.git.isRepository) {
        throw new Error(i18n.t("error.notGitRepo"));
      }
      if (state.git.needsPush !== true) {
        throw new Error(i18n.t("error.nothingToPush"));
      }
    }

    const text = buildGitChipUserTurn(action, request.extraNote);
    const displayText = buildGitChipDisplayText(action, request.extraNote);
    return ctx.submitUserTurnAfterInitialized(text, { displayText });
  });
}
