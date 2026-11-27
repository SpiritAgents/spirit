// Capability groups for the extension detail page: everything the extension contributes,
// grouped as MCPs / Rules / Hooks / Skills / Tools / Desktop with settings-style section labels.
// Rows sit on the page background without a card surface, matching Information.

import { useTranslation } from "react-i18next";

import { Monitor, Plug, ScrollText, ShieldCheck, Wand2, Webhook, Wrench } from "lucide-react";
import type { ElementType, ReactNode } from "react";

import { DESKTOP_LIST_ITEM_PRIMARY_CLASS } from "@/lib/desktop-typography";
import { cn } from "@/lib/utils";
import { ExtensionTabIcon } from "@/components/extension-tab-icon";
import type { DesktopExtensionListItem, DesktopMarketplaceCatalogEntry } from "@/types";

/** Structural subset shared by installed list items and marketplace catalog entries. */
type ContributionItem = Pick<
  DesktopExtensionListItem,
  | "id"
  | "instructionContributions"
  | "contributedTools"
  | "desktopCss"
  | "desktopSettingsPage"
  | "desktopViews"
  | "desktopTabs"
  | "authorizations"
  | "automationTriggers"
  | "requestedCapabilities"
>;

type ContributionEntry = {
  key: string;
  icon: ElementType;
  iconClassName?: string;
  iconNode?: ReactNode;
  title: string;
  overview?: string;
  /**
   * Declaration-level placeholder: the marketplace index declares the
   * capability, but the package files are not locally readable (a remote
   * http-index entry that is not installed yet), so the row cannot name
   * concrete contributions.
   */
  declared?: boolean;
};

type ContributionGroup = {
  key: string;
  label: string;
  items: ContributionEntry[];
};

export function MarketplaceContributionGroups({
  item,
}: {
  item: ContributionItem | DesktopMarketplaceCatalogEntry;
}) {
  const { t } = useTranslation();

  const groups: ContributionGroup[] = [];
  const contributions = item.instructionContributions;
  const declaredCapabilities = new Set(item.requestedCapabilities ?? []);
  const declaredEntry = (key: string, icon: ElementType): ContributionEntry => ({
    key: `declared:${key}`,
    icon,
    title: t("marketplace.declaredContribution"),
    declared: true,
  });

  const mcpItems: ContributionEntry[] = (contributions?.mcp ?? []).map((server) => ({
    key: `mcp:${server.name}`,
    icon: Plug,
    title: server.displayName,
  }));
  if (mcpItems.length > 0) {
    groups.push({ key: "mcps", label: t("settings.mcps"), items: mcpItems });
  } else if (declaredCapabilities.has("mcp")) {
    groups.push({ key: "mcps", label: t("settings.mcps"), items: [declaredEntry("mcp", Plug)] });
  }

  const rule = contributions?.rules;
  if (rule) {
    groups.push({
      key: "rules",
      label: t("settings.rules"),
      items: [
        {
          key: "rule",
          icon: ScrollText,
          title: rule.displayName,
          overview: rule.summary,
        },
      ],
    });
  } else if (declaredCapabilities.has("rules")) {
    groups.push({
      key: "rules",
      label: t("settings.rules"),
      items: [declaredEntry("rules", ScrollText)],
    });
  }

  const hookItems: ContributionEntry[] = (contributions?.hooks ?? []).map((hook) => ({
    key: `hook:${hook.event}`,
    icon: Webhook,
    title: hook.displayName,
  }));
  if (hookItems.length > 0) {
    groups.push({ key: "hooks", label: t("settings.hooks"), items: hookItems });
  } else if (declaredCapabilities.has("hooks")) {
    groups.push({
      key: "hooks",
      label: t("settings.hooks"),
      items: [declaredEntry("hooks", Webhook)],
    });
  }

  const skillItems: ContributionEntry[] = (contributions?.skills ?? []).map((skill) => ({
    key: `skill:${skill.name}`,
    icon: Wand2,
    title: skill.displayName,
    overview: skill.summary,
  }));
  if (skillItems.length > 0) {
    groups.push({ key: "skills", label: t("settings.skills"), items: skillItems });
  } else if (declaredCapabilities.has("skills")) {
    groups.push({
      key: "skills",
      label: t("settings.skills"),
      items: [declaredEntry("skills", Wand2)],
    });
  }

  const toolItems: ContributionEntry[] = (item.contributedTools ?? []).map((tool) => ({
    key: `tool:${tool.name}`,
    icon: Wrench,
    title: tool.displayName,
    overview: tool.summary,
  }));
  if (toolItems.length > 0) {
    groups.push({ key: "tools", label: t("marketplace.contributionGroupTools"), items: toolItems });
  }

  if (item.authorizations?.length) {
    groups.push({
      key: "authorizations",
      label: t("marketplace.contributionGroupAuthorization"),
      items: item.authorizations.map((authorization) => ({
        key: `authorization:${authorization.id}`,
        icon: ShieldCheck,
        title: authorization.displayName,
      })),
    });
  }

  if (item.automationTriggers?.length) {
    groups.push({
      key: "automation-triggers",
      label: t("marketplace.contributionGroupAutomationTriggers"),
      items: item.automationTriggers.map((trigger) => ({
        key: `automation-trigger:${trigger.kind}`,
        icon: Monitor,
        iconNode: (
          <ExtensionTabIcon
            extensionId={item.id}
            icon={trigger.icon}
            className="size-4 text-foreground"
          />
        ),
        title: trigger.name,
        overview: trigger.description,
      })),
    });
  }

  const desktopItems: ContributionEntry[] = [];
  if (item.desktopCss?.length) {
    desktopItems.push({
      key: "desktop:style",
      icon: Monitor,
      title: t("marketplace.contributionStyleTitle"),
    });
  }
  if (item.desktopSettingsPage) {
    desktopItems.push({
      key: "desktop:settings",
      icon: Monitor,
      title: t("threadSidebar.extensionSettings"),
    });
  }
  if (item.desktopViews?.length) {
    desktopItems.push({
      key: "desktop:views",
      icon: Monitor,
      title: t("marketplace.contributionViewsTitle"),
    });
  }
  for (const tab of item.desktopTabs ?? []) {
    desktopItems.push({
      key: `desktop:tab:${tab.id}`,
      icon: Monitor,
      iconNode: (
        <ExtensionTabIcon
          extensionId={item.id}
          icon={tab.icon}
          className="size-4 text-foreground"
        />
      ),
      title: tab.name,
    });
  }
  if (desktopItems.length > 0) {
    groups.push({
      key: "desktop",
      label: t("marketplace.contributionGroupDesktop"),
      items: desktopItems,
    });
  }

  if (groups.length === 0) {
    return null;
  }

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <section key={group.key} className="space-y-3">
          {/* Section labels match the marketplace list's section headers. */}
          <p className="text-base font-medium text-foreground">{group.label}</p>
          {/* Two-line + icon rows need more air than Information's single-line space-y-2. */}
          <div className="space-y-4">
            {group.items.map((entry) => (
              <div key={entry.key} className="flex items-center gap-3">
                {entry.iconNode ?? (
                  <entry.icon
                    className={cn("size-4 shrink-0", entry.iconClassName ?? "text-foreground")}
                    aria-hidden
                    strokeWidth={1.75}
                  />
                )}
                <div className="min-w-0 flex-1">
                  <span
                    className={cn(
                      DESKTOP_LIST_ITEM_PRIMARY_CLASS,
                      "block truncate",
                      entry.declared && "text-muted-foreground",
                    )}
                  >
                    {entry.title}
                  </span>
                  {entry.overview ? (
                    <span className="mt-0.5 block truncate text-xs leading-5 text-muted-foreground">
                      {entry.overview}
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
