import { WorkspaceFileIconSlot } from "../workspace-file-icon-context.js";
import { ChipIcon, ChipLabel } from "./chip-shell.js";
import { NavigableChipShell } from "../chip-navigate-context.js";
import { workspaceFileBasename } from "../path-utils.js";
import {
  resolveWorkspaceFileChipPresentation,
  WORKSPACE_FILE_CHIP_CLASS,
  WORKSPACE_FILE_CHIP_ICON_CLASS,
} from "../workspace-file-chip-styles.js";
import { WORKSPACE_FILE_ICON_CHIP_SIZE_PX } from "../workspace-file-icon-sizes.js";
import { ListTodo } from "lucide-react";

type WorkspaceFileChipProps = {
  path: string;
  sourceTabId?: string;
  /** The reference is the session Plan file (carried by the segment / navigate meta). */
  isPlan?: boolean;
};

export function WorkspaceFileChip({ path, sourceTabId, isPlan = false }: WorkspaceFileChipProps) {
  const normalized = path.replace(/\\/gu, "/");
  const presentation = resolveWorkspaceFileChipPresentation(normalized);
  return (
    <NavigableChipShell
      target={{
        kind: "workspaceFile",
        path: normalized,
        ...(sourceTabId ? { sourceTabId } : {}),
        ...(isPlan ? { isPlan: true } : {}),
      }}
      data-chip-kind="workspaceFile"
      className={WORKSPACE_FILE_CHIP_CLASS}
      title={normalized}
      aria-label={isPlan ? "Plan" : normalized}
    >
      <ChipIcon className={WORKSPACE_FILE_CHIP_ICON_CLASS}>
        {isPlan ? (
          <ListTodo size={WORKSPACE_FILE_ICON_CHIP_SIZE_PX} aria-hidden strokeWidth={1.75} />
        ) : (
          <WorkspaceFileIconSlot
            path={presentation.iconPath}
            kind={presentation.iconKind}
            size={WORKSPACE_FILE_ICON_CHIP_SIZE_PX}
          />
        )}
      </ChipIcon>
      <ChipLabel>{isPlan ? "Plan" : workspaceFileBasename(normalized)}</ChipLabel>
    </NavigableChipShell>
  );
}
