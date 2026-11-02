import { MessageCircle } from "lucide-react";

import { ChipIcon, ChipLabel } from "./chip-shell.js";
import { NavigableChipShell } from "../chip-navigate-context.js";
import {
  WORKSPACE_FILE_CHIP_CLASS,
  WORKSPACE_FILE_CHIP_ICON_CLASS,
} from "../workspace-file-chip-styles.js";
import { WORKSPACE_FILE_ICON_CHIP_CLASS } from "../workspace-file-icon-sizes.js";

type SessionReferenceChipProps = {
  path: string;
  title: string;
};

export function SessionReferenceChip({ path, title }: SessionReferenceChipProps) {
  const label = title.trim() || "Session";
  return (
    <NavigableChipShell
      target={{ kind: "sessionReference", transcriptPath: path }}
      data-chip-kind="sessionReference"
      className={WORKSPACE_FILE_CHIP_CLASS}
      title={label}
      aria-label={label}
    >
      <ChipIcon className={WORKSPACE_FILE_CHIP_ICON_CLASS}>
        <MessageCircle className={WORKSPACE_FILE_ICON_CHIP_CLASS} aria-hidden strokeWidth={1.75} />
      </ChipIcon>
      <ChipLabel>{label}</ChipLabel>
    </NavigableChipShell>
  );
}
