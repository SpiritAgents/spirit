import de from "./cli-locales/de.json" with { type: "json" };
import en from "./cli-locales/en.json" with { type: "json" };
import es from "./cli-locales/es.json" with { type: "json" };
import fr from "./cli-locales/fr.json" with { type: "json" };
import ja from "./cli-locales/ja.json" with { type: "json" };
import ko from "./cli-locales/ko.json" with { type: "json" };
import ptBR from "./cli-locales/pt-BR.json" with { type: "json" };
import ru from "./cli-locales/ru.json" with { type: "json" };
import zhCN from "./cli-locales/zh-CN.json" with { type: "json" };
import zhTW from "./cli-locales/zh-TW.json" with { type: "json" };

export const cliResources = {
  "zh-CN": zhCN,
  en,
  "zh-TW": zhTW,
  ja,
  ko,
  de,
  fr,
  es,
  "pt-BR": ptBR,
  ru,
} as const;
