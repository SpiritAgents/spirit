import { MessageCircle } from "lucide-react";

import { ChipIcon, ChipShell } from "@/components/composer-lexical/chips/chip-shell";
import { NavigableChipLabel } from "@/contexts/composer-chip-navigate-context";
import {
  WORKSPACE_FILE_CHIP_CLASS,
  WORKSPACE_FILE_CHIP_ICON_CLASS,
} from "@/lib/workspace-file-chip-styles";
import { WORKSPACE_FILE_ICON_CHIP_CLASS } from "@/lib/workspace-file-icon-sizes";

type SessionReferenceChipProps = {
  path: string;
  title: string;
};

export function SessionReferenceChip({ path, title }: SessionReferenceChipProps) {
  const label = title.trim() || "Session";
  return (
    <ChipShell
      data-chip-kind="sessionReference"
      className={WORKSPACE_FILE_CHIP_CLASS}
      title={label}
      aria-label={label}
    >
      <ChipIcon className={WORKSPACE_FILE_CHIP_ICON_CLASS}>
        <MessageCircle className={WORKSPACE_FILE_ICON_CHIP_CLASS} aria-hidden strokeWidth={1.75} />
      </ChipIcon>
      <NavigableChipLabel target={{ kind: "sessionReference", transcriptPath: path }}>
        {label}
      </NavigableChipLabel>
    </ChipShell>
  );
}
