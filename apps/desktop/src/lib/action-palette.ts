import en from "../locales/en.json";
import {
  LANGUAGE_PREFERENCE_OPTIONS,
  LOCALE_LABEL_KEYS,
  type LanguagePreference,
} from "@/lib/ui-locale";
import { STATIC_SLASH_COMMANDS, type SkillSlashSuggestion } from "@/lib/skill-slash";
import type { ThemePreference } from "@/lib/theme";

export type ActionPaletteTranslate = (key: string) => string;

export type ActionPaletteGroup = "chat" | "mode" | "appearance";

export type ActionPaletteView = "root" | "theme" | "locale";

export const ACTION_PALETTE_GROUP_ORDER: readonly ActionPaletteGroup[] = [
  "chat",
  "mode",
  "appearance",
] as const;

export const ACTION_PALETTE_GROUP_LABEL_KEYS: Record<ActionPaletteGroup, string> = {
  chat: "actionPalette.group.chat",
  mode: "actionPalette.group.mode",
  appearance: "actionPalette.group.appearance",
};

const THEME_OPTION_DEFS: ReadonlyArray<{ value: ThemePreference; labelKey: string }> = [
  { value: "system", labelKey: "settings.themeSystem" },
  { value: "light", labelKey: "settings.themeLight" },
  { value: "dark", labelKey: "settings.themeDark" },
];

export type NewChatActionPaletteItem = {
  id: "action:new-chat";
  kind: "new-chat";
  group: "chat";
  labelKey: "sidebar.newChat";
};

export type ThemeMenuActionPaletteItem = {
  id: "action:theme-menu";
  kind: "theme-menu";
  group: "appearance";
  labelKey: "actionPalette.theme";
};

export type LocaleMenuActionPaletteItem = {
  id: "action:locale-menu";
  kind: "locale-menu";
  group: "appearance";
  labelKey: "actionPalette.language";
};

export type ThemeOptionActionPaletteItem = {
  id: `action:theme:${ThemePreference}`;
  kind: "theme-option";
  value: ThemePreference;
  labelKey: string;
};

export type LocaleOptionActionPaletteItem = {
  id: `action:locale:${LanguagePreference}`;
  kind: "locale-option";
  value: LanguagePreference;
  labelKey: string;
};

export type SlashActionPaletteItem = SkillSlashSuggestion & {
  group: "chat" | "mode";
};

export type ActionPaletteItem =
  | NewChatActionPaletteItem
  | SlashActionPaletteItem
  | ThemeMenuActionPaletteItem
  | LocaleMenuActionPaletteItem
  | ThemeOptionActionPaletteItem
  | LocaleOptionActionPaletteItem;

const NEW_CHAT_ITEM: NewChatActionPaletteItem = {
  id: "action:new-chat",
  kind: "new-chat",
  group: "chat",
  labelKey: "sidebar.newChat",
};

const THEME_MENU_ITEM: ThemeMenuActionPaletteItem = {
  id: "action:theme-menu",
  kind: "theme-menu",
  group: "appearance",
  labelKey: "actionPalette.theme",
};

const LOCALE_MENU_ITEM: LocaleMenuActionPaletteItem = {
  id: "action:locale-menu",
  kind: "locale-menu",
  group: "appearance",
  labelKey: "actionPalette.language",
};

const MODE_SLASH_KINDS = new Set<SkillSlashSuggestion["kind"]>(["loop", "plan", "ask", "debug"]);

function slashPaletteGroup(kind: SkillSlashSuggestion["kind"]): "chat" | "mode" {
  return MODE_SLASH_KINDS.has(kind) ? "mode" : "chat";
}

const ROOT_ITEMS: ActionPaletteItem[] = [
  NEW_CHAT_ITEM,
  ...STATIC_SLASH_COMMANDS.map((command): SlashActionPaletteItem => ({
    ...command,
    group: slashPaletteGroup(command.kind),
  })),
  THEME_MENU_ITEM,
  LOCALE_MENU_ITEM,
];

const THEME_OPTION_ITEMS: ThemeOptionActionPaletteItem[] = THEME_OPTION_DEFS.map((opt) => ({
  id: `action:theme:${opt.value}`,
  kind: "theme-option",
  value: opt.value,
  labelKey: opt.labelKey,
}));

const LOCALE_OPTION_ITEMS: LocaleOptionActionPaletteItem[] = LANGUAGE_PREFERENCE_OPTIONS.map(
  (lang) => ({
    id: `action:locale:${lang}`,
    kind: "locale-option",
    value: lang,
    labelKey: LOCALE_LABEL_KEYS[lang],
  }),
);

/** English search aliases for endonym labels in the command palette. */
const LOCALE_SEARCH_ALIASES: Record<LanguagePreference, string> = {
  system: "System OS default",
  "zh-CN": "Simplified Chinese Chinese",
  en: "English",
  "zh-TW": "Traditional Chinese Chinese",
  ja: "Japanese",
  ko: "Korean",
  de: "German",
  fr: "French",
  es: "Spanish",
  "pt-BR": "Brazilian Portuguese Portuguese",
  ru: "Russian",
};

function matchesQuery(haystack: string, query: string): boolean {
  return haystack.toLowerCase().includes(query.trim().toLowerCase());
}

function englishCopy(key: string): string {
  let current: unknown = en;
  for (const part of key.split(".")) {
    if (current == null || typeof current !== "object" || !(part in current)) {
      return "";
    }
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" ? current : "";
}

function withEnglishSearchText(localized: string, englishKey: string): string {
  const english = englishCopy(englishKey);
  if (!english || english === localized) {
    return localized;
  }
  return `${localized} ${english}`;
}

function actionPaletteSearchText(item: ActionPaletteItem, t: ActionPaletteTranslate): string {
  if (item.kind === "new-chat" || item.kind === "theme-menu" || item.kind === "locale-menu") {
    return withEnglishSearchText(t(item.labelKey), item.labelKey);
  }

  if (item.kind === "theme-option") {
    return `${withEnglishSearchText(t(item.labelKey), item.labelKey)} ${item.value}`;
  }

  if (item.kind === "locale-option") {
    return `${t(item.labelKey)} ${LOCALE_SEARCH_ALIASES[item.value]} ${item.value}`;
  }

  const parts = [item.name, item.paletteName, item.alias.slice(1)].filter(
    (part): part is string => typeof part === "string" && part.length > 0,
  );
  if (item.descriptionKey) {
    parts.push(withEnglishSearchText(t(item.descriptionKey), item.descriptionKey));
  }
  if (item.description) {
    parts.push(item.description);
  }
  return parts.join(" ");
}

function filterByQuery(
  items: readonly ActionPaletteItem[],
  query: string,
  t: ActionPaletteTranslate,
): ActionPaletteItem[] {
  const trimmed = query.trim();
  if (!trimmed) {
    return [...items];
  }
  return items.filter((item) => matchesQuery(actionPaletteSearchText(item, t), trimmed));
}

export function buildActionPaletteItems(
  query: string,
  t: ActionPaletteTranslate,
  view: ActionPaletteView = "root",
): ActionPaletteItem[] {
  if (view === "theme") {
    return filterByQuery(THEME_OPTION_ITEMS, query, t);
  }
  if (view === "locale") {
    return filterByQuery(LOCALE_OPTION_ITEMS, query, t);
  }
  return filterByQuery(ROOT_ITEMS, query, t);
}

export function groupActionPaletteRootItems(
  items: readonly ActionPaletteItem[],
): Array<{ group: ActionPaletteGroup; items: ActionPaletteItem[] }> {
  const buckets = new Map<ActionPaletteGroup, ActionPaletteItem[]>();
  for (const group of ACTION_PALETTE_GROUP_ORDER) {
    buckets.set(group, []);
  }
  for (const item of items) {
    if (!("group" in item) || item.group == null) {
      continue;
    }
    buckets.get(item.group)?.push(item);
  }
  return ACTION_PALETTE_GROUP_ORDER.map((group) => ({
    group,
    items: buckets.get(group) ?? [],
  })).filter((entry) => entry.items.length > 0);
}

export function isNewChatAction(item: ActionPaletteItem): item is NewChatActionPaletteItem {
  return item.kind === "new-chat";
}

export function isAppearanceMenuAction(
  item: ActionPaletteItem,
): item is ThemeMenuActionPaletteItem | LocaleMenuActionPaletteItem {
  return item.kind === "theme-menu" || item.kind === "locale-menu";
}

export function isThemeOptionAction(item: ActionPaletteItem): item is ThemeOptionActionPaletteItem {
  return item.kind === "theme-option";
}

export function isLocaleOptionAction(
  item: ActionPaletteItem,
): item is LocaleOptionActionPaletteItem {
  return item.kind === "locale-option";
}

export function isSlashActionPaletteItem(item: ActionPaletteItem): item is SlashActionPaletteItem {
  return (
    item.kind === "export-session" ||
    item.kind === "compact" ||
    item.kind === "fork" ||
    item.kind === "side-chat" ||
    item.kind === "loop" ||
    item.kind === "plan" ||
    item.kind === "ask" ||
    item.kind === "debug" ||
    item.kind === "skill"
  );
}
