import { SKILL_CHIP_CLASS } from "@/lib/skill-chip-styles";
import { ChipLabel, ChipLeadingSpacer } from "@/components/composer-lexical/chips/chip-shell";
import { NavigableChipShell } from "@/contexts/composer-chip-navigate-context";

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
