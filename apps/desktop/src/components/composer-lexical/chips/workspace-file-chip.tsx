import { WorkspaceFileIcon } from "@/components/workspace-file-icon";
import { ChipIcon, ChipLabel } from "@/components/composer-lexical/chips/chip-shell";
import { NavigableChipShell } from "@/contexts/composer-chip-navigate-context";
import { workspaceFileBasename } from "@/lib/file-picker-path";
import {
  resolveWorkspaceFileChipPresentation,
  WORKSPACE_FILE_CHIP_CLASS,
  WORKSPACE_FILE_CHIP_ICON_CLASS,
} from "@/lib/workspace-file-chip-styles";
import { WORKSPACE_FILE_ICON_CHIP_SIZE_PX } from "@/lib/workspace-file-icon-sizes";
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
          <WorkspaceFileIcon
            path={presentation.iconPath}
            kind={presentation.iconKind}
            size={WORKSPACE_FILE_ICON_CHIP_SIZE_PX}
            colorMode="inherit"
          />
        )}
      </ChipIcon>
      <ChipLabel>{isPlan ? "Plan" : workspaceFileBasename(normalized)}</ChipLabel>
    </NavigableChipShell>
  );
}
