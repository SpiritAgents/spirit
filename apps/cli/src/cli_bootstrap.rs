use anyhow::{Result, anyhow};
use rust_i18n::t;

use crate::{
    adapters::JsonConfigStore,
    locale::{self, available_ui_locales_csv, parse_ui_locale},
    model_registry::AppConfig,
    ports::{
        ConfigStore, available_approval_levels_csv, available_tui_modes_csv,
        parse_approval_level_strict, parse_tui_mode_strict,
    },
    runtime_handle::RuntimeHandle,
};

#[derive(Clone, Debug, Default)]
pub struct GlobalCliOptions {
    pub prompt: Option<String>,
    pub model: Option<String>,
    pub approval: Option<String>,
    pub language: Option<String>,
    /// Process-only TUI layout override (`inline` / `fullscreen`); not written to config.
    pub tui: Option<String>,
}

pub fn list_model_ids(config: &AppConfig) -> Vec<String> {
    config
        .flatten_models()
        .into_iter()
        .map(|model| model.name)
        .collect()
}

pub fn available_models_csv(config: &AppConfig) -> String {
    list_model_ids(config).join(", ")
}

pub fn model_not_found_message(name: &str, config: &AppConfig) -> String {
    t!(
        "cli.model.not_found",
        name = name,
        available = available_models_csv(config)
    )
    .into_owned()
}

/// Load config, apply `--language` (persist), then `--model` (persist). Locale is set before
/// any further CLI output. Does not touch approval (needs a live runtime).
pub fn bootstrap_config(options: &GlobalCliOptions) -> Result<AppConfig> {
    let config_store = JsonConfigStore;
    let mut config = config_store.load()?;

    // Apply locale from env/config first so unknown --language errors are localized.
    locale::apply_ui_locale(&config);

    if let Some(raw) = options.language.as_deref() {
        let Some(normalized) = parse_ui_locale(raw) else {
            return Err(anyhow!(
                "{}",
                t!(
                    "cli.language.unsupported",
                    code = raw,
                    available = available_ui_locales_csv()
                )
            ));
        };
        config.ui_locale = Some(normalized.clone());
        config_store.save(&config)?;
        rust_i18n::set_locale(&normalized);
    }

    if let Some(model) = options.model.as_deref() {
        apply_active_model(model, &mut config, &config_store)?;
    }

    // Validate early so unknown --approval fails before TUI/headless init.
    if let Some(raw) = options.approval.as_deref() {
        let _ = parse_cli_approval_level(raw)?;
    }

    // Validate `--tui` early; do not persist (session override only).
    if let Some(raw) = options.tui.as_deref() {
        let _ = parse_cli_tui_mode(raw)?;
    }

    Ok(config)
}

pub fn apply_active_model(
    selector: &str,
    config: &mut AppConfig,
    config_store: &dyn ConfigStore,
) -> Result<()> {
    let trimmed = selector.trim();
    if trimmed.is_empty() {
        return Err(anyhow!("{}", t!("cli.model.selector_empty")));
    }

    match config.parse_model_ref_selector(trimmed) {
        Ok(model_ref) => {
            config.active_model = model_ref;
            config_store.save(config)?;
            Ok(())
        }
        Err(err) => {
            let selector_failed = || {
                anyhow!(
                    "{}",
                    t!(
                        "cli.model.selector_failed",
                        err = err.clone(),
                        available = available_models_csv(config)
                    )
                )
            };

            // Invalid syntax (e.g. "::name", "provider::") must not be reported as "not found".
            if let Some((provider_id, name)) = trimmed.split_once("::") {
                if provider_id.trim().is_empty() || name.trim().is_empty() {
                    return Err(selector_failed());
                }
                let model_ref = crate::model_registry::ModelRef {
                    provider_id: provider_id.trim().to_string(),
                    name: name.trim().to_string(),
                };
                if !config.model_ref_exists(&model_ref) {
                    return Err(anyhow!("{}", model_not_found_message(trimmed, config)));
                }
                return Err(selector_failed());
            }

            if config.find_model_refs_by_name(trimmed).is_empty() {
                return Err(anyhow!("{}", model_not_found_message(trimmed, config)));
            }
            // Ambiguous name or other selector errors.
            Err(selector_failed())
        }
    }
}

pub fn parse_cli_approval_level(raw: &str) -> Result<String> {
    parse_approval_level_strict(raw).ok_or_else(|| {
        anyhow!(
            "{}",
            t!(
                "cli.approval.unsupported",
                level = raw,
                available = available_approval_levels_csv()
            )
        )
    })
}

pub fn apply_approval_level(runtime: &mut RuntimeHandle, raw: &str) -> Result<()> {
    let level = parse_cli_approval_level(raw)?;
    runtime.set_approval_level(&level)
}

pub fn parse_cli_tui_mode(raw: &str) -> Result<String> {
    parse_tui_mode_strict(raw).ok_or_else(|| {
        anyhow!(
            "{}",
            t!(
                "cli.tui.unsupported",
                mode = raw,
                available = available_tui_modes_csv()
            )
        )
    })
}

pub fn resolve_session_tui_mode(options: &GlobalCliOptions, config: &AppConfig) -> String {
    options
        .tui
        .as_deref()
        .and_then(parse_tui_mode_strict)
        .unwrap_or_else(|| crate::ports::normalize_tui_mode(&config.tui))
}

pub fn print_skills_stub() {
    println!("{}", t!("cli.skills.header"));
    println!("{}", t!("cli.skills.file"));
    println!("{}", t!("cli.skills.shell"));
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model_registry::{ModelEntry, ModelRef, ProviderEntry};

    fn config_with_models(names: &[&str]) -> AppConfig {
        let models = names
            .iter()
            .map(|name| ModelEntry {
                name: (*name).to_string(),
                ..ModelEntry::default()
            })
            .collect();
        AppConfig {
            active_model: ModelRef {
                provider_id: "g".to_string(),
                name: names.first().copied().unwrap_or("m").to_string(),
            },
            providers: vec![ProviderEntry {
                id: "g".to_string(),
                label: None,
                api_base: "https://example.com/v1".to_string(),
                transport_kind: Some("openai-compatible".to_string()),
                sdk: None,
                headers: None,
                body: None,
                provider_tools: None,
                file_upload: None,
                image_api: None,
                video_api: None,
                api_key: None,
                api_key_env: None,
                api_key_keyring: None,
                credentials: None,
                options: None,
                capabilities: None,
                context_length: None,
                output_limit: None,
                reasoning_effort: None,
                supported_reasoning_efforts: None,
                effort_semantics: None,
                effort: None,
                supported_efforts: None,
                default_effort: None,
                thinking_capabilities: None,
                reasoning_mode: None,
                supported_reasoning_modes: None,
                supports_thinking_type: None,
                supports_thinking_switch: None,
                thinking_switch: None,
                service_tiers: None,
                service_tier: None,
                models,
            }],
            ..AppConfig::default()
        }
    }

    #[test]
    fn available_models_csv_joins_with_comma_space() {
        let config = config_with_models(&["alpha", "beta"]);
        assert_eq!(available_models_csv(&config), "alpha, beta");
    }

    #[test]
    fn model_not_found_message_includes_available_list() {
        rust_i18n::set_locale("en");
        let config = config_with_models(&["k3", "kimi-for-coding"]);
        let message = model_not_found_message("missing", &config);
        assert!(message.contains("missing"));
        assert!(message.contains("k3, kimi-for-coding"));
    }

    #[test]
    fn parse_cli_approval_level_errors_list_available() {
        rust_i18n::set_locale("en");
        let err = parse_cli_approval_level("nope").unwrap_err().to_string();
        assert!(err.contains("nope"));
        assert!(err.contains("default, auto-approval, bypass-approval"));
    }

    #[test]
    fn parse_cli_tui_mode_errors_list_available() {
        rust_i18n::set_locale("en");
        let err = parse_cli_tui_mode("mini").unwrap_err().to_string();
        assert!(err.contains("mini"));
        assert!(err.contains("inline, fullscreen"));
    }

    #[test]
    fn resolve_session_tui_mode_prefers_cli_override() {
        let config = AppConfig {
            tui: "inline".to_string(),
            ..AppConfig::default()
        };
        let options = GlobalCliOptions {
            tui: Some("fullscreen".to_string()),
            ..GlobalCliOptions::default()
        };
        assert_eq!(resolve_session_tui_mode(&options, &config), "fullscreen");
    }

    struct NoopConfigStore;

    impl ConfigStore for NoopConfigStore {
        fn load(&self) -> Result<AppConfig> {
            unreachable!("load unused in apply_active_model tests")
        }

        fn save(&self, _config: &AppConfig) -> Result<()> {
            Ok(())
        }
    }

    #[test]
    fn apply_active_model_keeps_invalid_selector_distinct_from_not_found() {
        rust_i18n::set_locale("en");
        let mut config = config_with_models(&["alpha"]);
        let err = apply_active_model("::name", &mut config, &NoopConfigStore)
            .unwrap_err()
            .to_string();
        assert!(
            err.contains("invalid model id"),
            "expected invalid selector error, got: {err}"
        );
        assert!(
            !err.contains("Model not found"),
            "invalid syntax must not be reported as not found: {err}"
        );
    }
}
