use std::env;

use rust_i18n::t;

use crate::model_registry::AppConfig;

pub const DEFAULT_UI_LOCALE: &str = "en";
pub const ENV_UI_LANG: &str = "SPIRIT_UI_LANG";
pub const SUPPORTED_UI_LOCALES: [&str; 10] = [
    "en", "zh-CN", "zh-TW", "ja", "ko", "de", "fr", "es", "pt-BR", "ru",
];

pub fn apply_ui_locale(config: &AppConfig) {
    rust_i18n::set_locale(&resolve_ui_locale(config));
}

pub fn resolve_ui_locale(config: &AppConfig) -> String {
    resolve_ui_locale_with_override(config, None)
}

/// Priority: `cli_override` > `SPIRIT_UI_LANG` > `config.ui_locale` > default `en`.
pub fn resolve_ui_locale_with_override(config: &AppConfig, cli_override: Option<&str>) -> String {
    cli_override
        .and_then(parse_ui_locale)
        .or_else(|| {
            env::var(ENV_UI_LANG)
                .ok()
                .as_deref()
                .and_then(parse_ui_locale)
        })
        .or_else(|| config.ui_locale.as_deref().and_then(parse_ui_locale))
        .unwrap_or_else(|| DEFAULT_UI_LOCALE.to_string())
}

pub fn available_ui_locales_csv() -> String {
    SUPPORTED_UI_LOCALES.join(", ")
}

pub fn normalize_ui_locale(locale: &str) -> String {
    parse_ui_locale(locale).unwrap_or_else(|| DEFAULT_UI_LOCALE.to_string())
}

pub fn parse_ui_locale(locale: &str) -> Option<String> {
    match locale.trim().to_ascii_lowercase().as_str() {
        "zh" | "zh-cn" | "zh_cn" | "zh-hans" | "zh_hans" => Some("zh-CN".to_string()),
        "zh-tw" | "zh_tw" | "zh-hant" | "zh_hant" => Some("zh-TW".to_string()),
        "ja" | "ja-jp" | "ja_jp" => Some("ja".to_string()),
        "ko" | "ko-kr" | "ko_kr" => Some("ko".to_string()),
        "de" | "de-de" | "de_de" => Some("de".to_string()),
        "fr" | "fr-fr" | "fr_fr" => Some("fr".to_string()),
        "es" | "es-es" | "es_es" => Some("es".to_string()),
        "pt" | "pt-br" | "pt_br" => Some("pt-BR".to_string()),
        "ru" | "ru-ru" | "ru_ru" => Some("ru".to_string()),
        "en" | "en-us" | "en_us" | "en-gb" | "en_gb" => Some("en".to_string()),
        _ => None,
    }
}

pub fn supported_ui_locales() -> &'static [&'static str] {
    &SUPPORTED_UI_LOCALES
}

pub fn language_display_name(locale: &str) -> String {
    match normalize_ui_locale(locale).as_str() {
        "zh-CN" => t!("ui.picker.languages.simplified_chinese").into_owned(),
        "zh-TW" => t!("ui.picker.languages.traditional_chinese").into_owned(),
        "ja" => t!("ui.picker.languages.japanese").into_owned(),
        "ko" => t!("ui.picker.languages.korean").into_owned(),
        "de" => t!("ui.picker.languages.german").into_owned(),
        "fr" => t!("ui.picker.languages.french").into_owned(),
        "es" => t!("ui.picker.languages.spanish").into_owned(),
        "pt-BR" => t!("ui.picker.languages.brazilian_portuguese").into_owned(),
        "ru" => t!("ui.picker.languages.russian").into_owned(),
        _ => t!("ui.picker.languages.english").into_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model_registry::AppConfig;

    #[test]
    fn parse_ui_locale_accepts_aliases() {
        assert_eq!(parse_ui_locale("zh").as_deref(), Some("zh-CN"));
        assert_eq!(parse_ui_locale("zh-Hant").as_deref(), Some("zh-TW"));
        assert_eq!(parse_ui_locale("ja-JP").as_deref(), Some("ja"));
        assert_eq!(parse_ui_locale("ko-KR").as_deref(), Some("ko"));
        assert_eq!(parse_ui_locale("de-DE").as_deref(), Some("de"));
        assert_eq!(parse_ui_locale("fr-FR").as_deref(), Some("fr"));
        assert_eq!(parse_ui_locale("es-ES").as_deref(), Some("es"));
        assert_eq!(parse_ui_locale("pt-BR").as_deref(), Some("pt-BR"));
        assert_eq!(parse_ui_locale("ru-RU").as_deref(), Some("ru"));
        assert_eq!(parse_ui_locale("en-US").as_deref(), Some("en"));
    }

    #[test]
    fn parse_ui_locale_rejects_unknown() {
        assert_eq!(parse_ui_locale("xx"), None);
    }

    #[test]
    fn available_ui_locales_csv_uses_comma_space() {
        assert_eq!(
            available_ui_locales_csv(),
            "en, zh-CN, zh-TW, ja, ko, de, fr, es, pt-BR, ru"
        );
    }

    #[test]
    fn resolve_ui_locale_with_override_prefers_cli_flag() {
        let config = AppConfig {
            ui_locale: Some("en".to_string()),
            ..AppConfig::default()
        };
        assert_eq!(
            resolve_ui_locale_with_override(&config, Some("zh-CN")),
            "zh-CN"
        );
    }
}
