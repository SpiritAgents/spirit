import { SKILL_CHIP_CLASS } from "../skill-chip-styles.js";
import { ChipLabel, ChipLeadingSpacer } from "./chip-shell.js";
import { NavigableChipShell } from "../chip-navigate-context.js";

type SkillChipProps = {
  alias: string;
};

export function SkillChip({ alias }: SkillChipProps) {
  return (
    <NavigableChipShell
      target={{ kind: "skill", alias }}
      data-chip-kind="skill"
      className={SKILL_CHIP_CLASS}
      aria-label={alias}
    >
      <ChipLeadingSpacer />
      <ChipLabel>{alias}</ChipLabel>
    </NavigableChipShell>
  );
}
