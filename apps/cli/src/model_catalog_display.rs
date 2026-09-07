//! Reads the `model-catalog-cache` shared with Desktop to resolve display names for Gateway/OpenRouter models.

use std::{
    collections::{HashMap, HashSet},
    env, fs,
    path::PathBuf,
    process::Command,
};

use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::mcp::spirit_data_dir;
use crate::model_registry::{ModelProfile, ModelProvider};

const CACHE_DIR_NAME: &str = "model-catalog-cache";

fn normalize_openai_api_base(base_url: &str) -> String {
    base_url.trim().trim_end_matches('/').to_string()
}

fn model_catalog_hint_key(provider: &str, transport_kind: &str, api_base: &str) -> String {
    let base = normalize_openai_api_base(api_base);
    format!("{provider}::{transport_kind}::{base}")
}

fn model_catalog_cache_file_path(hint_key: &str) -> PathBuf {
    let hash = Sha256::digest(hint_key.as_bytes());
    let hex = hash
        .iter()
        .take(16)
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    spirit_data_dir()
        .join(CACHE_DIR_NAME)
        .join(format!("{hex}.json"))
}

fn provider_uses_catalog_display(provider: ModelProvider) -> bool {
    matches!(
        provider,
        ModelProvider::VercelAiGateway
            | ModelProvider::Openrouter
            | ModelProvider::Google
            | ModelProvider::GoogleVertexAi
    )
}

fn resolve_host_internal_id_display_title_path() -> Result<PathBuf, String> {
    if let Ok(path) = env::var("SPIRIT_HOST_INTERNAL_MODULE_PATH") {
        let candidate = PathBuf::from(&path);
        let id_display_title = candidate
            .parent()
            .map(|parent| parent.join("id-display-title.js"))
            .ok_or_else(|| "Invalid host-internal module path".to_string())?;
        if id_display_title.exists() {
            return Ok(id_display_title);
        }
        return Err(format!(
            "id-display-title.js not found next to the SPIRIT_HOST_INTERNAL_MODULE_PATH environment variable: {}",
            id_display_title.display()
        ));
    }

    let from_crate = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("packages")
        .join("host-internal")
        .join("dist")
        .join("id-display-title.js");
    if from_crate.exists() {
        return Ok(from_crate);
    }

    Err(format!(
        "host-internal id-display-title.js not found. Run pnpm run build in packages/host-internal first. Default lookup path: {}",
        from_crate.display()
    ))
}

fn format_model_display_names_via_host_internal(
    model_ids: &[String],
) -> Result<HashMap<String, String>, String> {
    if model_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let module_path = resolve_host_internal_id_display_title_path()?;
    let module_url = module_path
        .to_str()
        .ok_or_else(|| "Invalid host-internal module path".to_string())?
        .replace('\\', "/");
    let module_url = if module_url.starts_with('/') {
        format!("file://{module_url}")
    } else {
        format!("file:///{module_url}")
    };

    let payload = serde_json::to_string(model_ids)
        .map_err(|err| format!("Failed to serialize the model id list: {err}"))?;

    let script = format!(
        r#"
import {{ buildFormattedDisplayTitlesFromIds }} from '{module_url}';
const modelIds = JSON.parse(process.argv[1]);
console.log(JSON.stringify(buildFormattedDisplayTitlesFromIds(modelIds)));
"#
    );

    let output = Command::new("node")
        .arg("--input-type=module")
        .arg("-e")
        .arg(script)
        .arg(payload)
        .output()
        .map_err(|err| {
            format!("Failed to start the Node format model display name process: {err}")
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if !stderr.is_empty() { stderr } else { stdout };
        return Err(if detail.is_empty() {
            "Failed to format model display names.".to_string()
        } else {
            format!("Failed to format model display names: {detail}")
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let parsed: HashMap<String, String> = serde_json::from_str(stdout.trim())
        .map_err(|err| format!("Failed to parse the model display name response: {err}"))?;
    Ok(parsed)
}

#[derive(Debug, Deserialize)]
struct ModelCatalogCacheEntry {
    #[serde(rename = "modelCatalog", default)]
    model_catalog: Option<Vec<PreviewCatalogItem>>,
}

#[derive(Debug, Deserialize)]
struct PreviewCatalogItem {
    id: String,
    #[serde(rename = "displayName", default)]
    display_name: Option<String>,
}

fn read_display_names_for_hint(hint_key: &str) -> HashMap<String, String> {
    let path = model_catalog_cache_file_path(hint_key);
    let raw = match fs::read_to_string(&path) {
        Ok(value) => value,
        Err(_) => return HashMap::new(),
    };
    let parsed: ModelCatalogCacheEntry = match serde_json::from_str(&raw) {
        Ok(value) => value,
        Err(_) => return HashMap::new(),
    };
    let mut titles = HashMap::new();
    for item in parsed.model_catalog.unwrap_or_default() {
        let id = item.id.trim();
        if id.is_empty() {
            continue;
        }
        let display = item
            .display_name
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(id);
        titles.insert(id.to_string(), display.to_string());
    }
    titles
}

/// Reads the cache in bulk per config; each `(provider, transport, apiBase)` combination reads from disk at most once.
pub fn build_model_display_titles(models: &[ModelProfile]) -> HashMap<String, String> {
    let mut titles = HashMap::new();
    let mut cache_by_hint: HashMap<String, HashMap<String, String>> = HashMap::new();
    let mut loaded_hints = HashSet::new();
    let mut ids_to_format = Vec::new();

    for model in models {
        let Some(provider) = model.provider else {
            ids_to_format.push(model.name.clone());
            continue;
        };
        if provider_uses_catalog_display(provider) {
            let transport = model.transport_kind().as_str();
            let hint_key = model_catalog_hint_key(provider.as_str(), transport, &model.api_base);
            if loaded_hints.insert(hint_key.clone()) {
                let display_names = read_display_names_for_hint(&hint_key);
                cache_by_hint.insert(hint_key.clone(), display_names);
            }

            let Some(display_names) = cache_by_hint.get(&hint_key) else {
                continue;
            };
            let display = display_names
                .get(&model.name)
                .cloned()
                .unwrap_or_else(|| model.name.clone());
            if display != model.name {
                titles.insert(model.name.clone(), display);
            }
            continue;
        }

        ids_to_format.push(model.name.clone());
    }

    if let Ok(formatted_titles) = format_model_display_names_via_host_internal(&ids_to_format) {
        titles.extend(formatted_titles);
    }

    titles
}

pub fn model_display_title<'a>(
    model_name: &'a str,
    display_titles: &'a HashMap<String, String>,
) -> &'a str {
    display_titles
        .get(model_name)
        .map(String::as_str)
        .unwrap_or(model_name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::shared_env_lock;
    use std::env;

    fn temp_test_dir(label: &str) -> PathBuf {
        env::temp_dir().join(format!(
            "spirit-model-catalog-display-{label}-{}",
            std::process::id()
        ))
    }

    fn with_isolated_data_dir(label: &str) -> PathBuf {
        let data_dir = temp_test_dir(label);
        unsafe {
            env::set_var("SPIRIT_DATA_DIR", &data_dir);
            env::remove_var("APPDATA");
        }
        data_dir
    }

    fn restore_data_dir_env(previous_data_dir: Option<String>, previous_appdata: Option<String>) {
        unsafe {
            if let Some(value) = previous_data_dir {
                env::set_var("SPIRIT_DATA_DIR", value);
            } else {
                env::remove_var("SPIRIT_DATA_DIR");
            }
            if let Some(value) = previous_appdata {
                env::set_var("APPDATA", value);
            } else {
                env::remove_var("APPDATA");
            }
        }
    }

    #[test]
    fn model_catalog_cache_file_path_matches_desktop_layout() {
        let hint = "vercel-ai-gateway::openai-compatible::https://gateway.example/v1";
        let path = model_catalog_cache_file_path(hint);
        assert!(path.to_string_lossy().contains("model-catalog-cache"));
        assert_eq!(path.extension().and_then(|ext| ext.to_str()), Some("json"));
    }

    #[test]
    fn read_display_names_for_hint_parses_model_catalog() {
        let _guard = shared_env_lock()
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        let previous_data_dir = env::var("SPIRIT_DATA_DIR").ok();
        let previous_appdata = env::var("APPDATA").ok();
        let data_dir = with_isolated_data_dir("openrouter-catalog");
        let hint = "openrouter::openai-compatible::https://openrouter.ai/api/v1";
        let path = model_catalog_cache_file_path(hint);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("cache dir");
        }
        fs::write(
            &path,
            r#"{"apiBase":"https://openrouter.ai/api/v1","fetchedAtUnixMs":1,"modelIds":["anthropic/claude-sonnet-4"],"modelCatalog":[{"id":"anthropic/claude-sonnet-4","displayName":"Claude Sonnet 4"}]}"#,
        )
        .expect("write cache");
        let titles = read_display_names_for_hint(hint);
        restore_data_dir_env(previous_data_dir, previous_appdata);
        let _ = fs::remove_dir_all(data_dir);

        assert_eq!(
            titles.get("anthropic/claude-sonnet-4").map(String::as_str),
            Some("Claude Sonnet 4")
        );
    }

    #[test]
    fn build_model_display_titles_formats_non_gateway_providers() {
        let models = vec![ModelProfile {
            group_id: "openai".to_string(),
            name: "gpt-4o-mini".to_string(),
            api_base: "https://api.openai.com/v1".to_string(),
            provider: Some(ModelProvider::Openai),
            reasoning_effort: None,
            reasoning_mode: None,
            context_length: None,
            extra: serde_json::Map::new(),
        }];
        let titles = build_model_display_titles(&models);
        if resolve_host_internal_id_display_title_path().is_ok() {
            assert_eq!(
                titles.get("gpt-4o-mini").map(String::as_str),
                Some("GPT 4o Mini")
            );
        }
    }

    #[test]
    fn provider_uses_catalog_display_includes_google() {
        assert!(provider_uses_catalog_display(ModelProvider::Google));
        assert!(!provider_uses_catalog_display(ModelProvider::Openai));
    }

    #[test]
    fn read_display_names_for_hint_parses_google_model_catalog() {
        let _guard = shared_env_lock()
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        let previous_data_dir = env::var("SPIRIT_DATA_DIR").ok();
        let previous_appdata = env::var("APPDATA").ok();
        let data_dir = with_isolated_data_dir("google-catalog");
        let hint = "google::openai-compatible::https://generativelanguage.googleapis.com/v1beta";
        let path = model_catalog_cache_file_path(hint);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("cache dir");
        }
        fs::write(
            &path,
            r#"{"apiBase":"https://generativelanguage.googleapis.com/v1beta","fetchedAtUnixMs":1,"modelIds":["gemini-2.5-flash"],"modelCatalog":[{"id":"gemini-2.5-flash","displayName":"Gemini 2.5 Flash"}]}"#,
        )
        .expect("write cache");
        let titles = read_display_names_for_hint(hint);
        restore_data_dir_env(previous_data_dir, previous_appdata);
        let _ = fs::remove_dir_all(data_dir);

        assert_eq!(
            titles.get("gemini-2.5-flash").map(String::as_str),
            Some("Gemini 2.5 Flash")
        );
    }
}
