import i18n from "@/lib/i18n";
import { joinWithCjkSpacing } from "@/lib/cjk";

export type McpCapabilityCounts = {
  tools: number;
  resources: number;
  prompts: number;
};

export function formatMcpCapabilityCounts(counts: McpCapabilityCounts): string {
  const items = [
    i18n.t("settings.mcpToolCount", { count: counts.tools }),
    i18n.t("settings.mcpResourceCount", { count: counts.resources }),
    i18n.t("settings.mcpPromptCount", { count: counts.prompts }),
  ];
  const localizedItems = joinWithCjkSpacing(
    ...new Intl.ListFormat(i18n.language, {
      style: "long",
      type: "conjunction",
    })
      .formatToParts(items)
      .map((part) => part.value),
  );
  return i18n.t("settings.mcpCountsAvailable", { items: localizedItems });
}
