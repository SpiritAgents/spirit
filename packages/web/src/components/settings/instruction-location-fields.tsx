import { useTranslation } from "react-i18next";

import { RovingFocusGroup, RovingFocusItem } from "@/components/ui/roving-focus-group";
import { Label } from "@/components/ui/label";
import { DESKTOP_EDITOR_TAB_CLASS } from "@/lib/desktop-typography";
import { cn } from "@/lib/utils";
import type { DesktopSkillRootKind } from "@/types";

type InstructionScope = "workspace" | "user";
type InstructionType = "spirit" | "generic";

interface ChoiceOption<T extends string> {
  value: T;
  labelKey: string;
}

interface LocalizedChoiceOption<T extends string> {
  value: T;
  label: string;
}

const scopeOptions: readonly ChoiceOption<InstructionScope>[] = [
  { value: "workspace", labelKey: "settings.instructionScopeWorkspace" },
  { value: "user", labelKey: "settings.instructionScopeUser" },
];

const typeOptions: readonly ChoiceOption<InstructionType>[] = [
  { value: "spirit", labelKey: "settings.instructionTypeSpirit" },
  { value: "generic", labelKey: "settings.instructionTypeGeneric" },
];

function InstructionChoiceGroup<T extends string>({
  idPrefix,
  label,
  options,
  selected,
  onSelect,
  disabled,
}: {
  idPrefix: string;
  label: string;
  options: readonly LocalizedChoiceOption<T>[];
  selected: T;
  onSelect: (value: T) => void;
  disabled: boolean;
}) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      <RovingFocusGroup
        asChild
        orientation="horizontal"
        loop
        defaultCurrentTabStopId={`${idPrefix}-${selected}`}
      >
        <div
          role="tablist"
          aria-label={label}
          className="inline-flex h-9 shrink-0 rounded-lg border border-border/40 bg-muted/30 p-0.5"
        >
          {options.map((option) => (
            <RovingFocusItem
              asChild
              key={option.value}
              tabStopId={`${idPrefix}-${option.value}`}
              active={selected === option.value}
              focusable={!disabled}
            >
              <button
                type="button"
                role="tab"
                aria-selected={selected === option.value}
                className={cn(
                  DESKTOP_EDITOR_TAB_CLASS,
                  selected === option.value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-chrome-emphasis",
                )}
                disabled={disabled}
                onClick={() => onSelect(option.value)}
              >
                {option.label}
              </button>
            </RovingFocusItem>
          ))}
        </div>
      </RovingFocusGroup>
    </div>
  );
}

export function InstructionLocationFields({
  idPrefix,
  rootKind,
  onRootKindChange,
  disabled,
  workspaceDisabled,
  includeGeneric = true,
}: {
  idPrefix: string;
  rootKind: DesktopSkillRootKind;
  onRootKindChange: (rootKind: DesktopSkillRootKind) => void;
  disabled: boolean;
  workspaceDisabled: boolean;
  includeGeneric?: boolean;
}) {
  const { t } = useTranslation();
  const scope: InstructionScope = rootKind === "user" ? "user" : "workspace";
  const type: InstructionType = rootKind === "workspaceAgents" ? "generic" : "spirit";
  const localizedScopeOptions = scopeOptions
    .filter((option) => !workspaceDisabled || option.value === "user")
    .map((option) => ({ ...option, label: t(option.labelKey) }));
  const localizedTypeOptions = typeOptions
    .filter((option) => includeGeneric || option.value === "spirit")
    .map((option) => ({ ...option, label: t(option.labelKey) }));

  return (
    <>
      <InstructionChoiceGroup
        idPrefix={`${idPrefix}-scope`}
        label={t("settings.instructionScope")}
        options={localizedScopeOptions}
        selected={scope}
        disabled={disabled}
        onSelect={(nextScope) => {
          if (nextScope === "user") {
            onRootKindChange("user");
            return;
          }
          onRootKindChange(type === "generic" ? "workspaceAgents" : "workspaceSpirit");
        }}
      />
      <InstructionChoiceGroup
        key={scope}
        idPrefix={`${idPrefix}-type`}
        label={t("settings.instructionType")}
        options={localizedTypeOptions}
        selected={type}
        disabled={disabled}
        onSelect={(nextType) => {
          if (nextType === "generic") {
            onRootKindChange("workspaceAgents");
            return;
          }
          onRootKindChange(scope === "user" ? "user" : "workspaceSpirit");
        }}
      />
    </>
  );
}
