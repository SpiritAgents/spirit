import i18n from "@/lib/i18n";
import type { DesktopSkillRootKind } from "@/types";

export function skillRootKindLabel(rootKind: DesktopSkillRootKind): string {
  if (rootKind === "user") {
    return i18n.t("settings.skillUserDir");
  }
  if (rootKind === "workspaceSpirit") {
    return i18n.t("settings.skillWorkspaceSpirit");
  }
  return i18n.t("settings.skillWorkspaceAgents");
}
