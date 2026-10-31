//! OpenAI-compatible `GET /v1/models` listing — aligned with `packages/host-internal/src/openai-models.ts`.

use crate::model_registry::ModelTransportKind;
use serde_json::Value;

const MODELS_PATH: &str = "/models";
const ANTHROPIC_VERSION: &str = "2023-06-01";

pub fn normalize_openai_api_base(base_url: &str) -> String {
    base_url.trim().trim_end_matches('/').to_string()
}

pub fn openai_compatible_models_list_url(base_url: &str) -> String {
    format!("{}{}", normalize_openai_api_base(base_url), MODELS_PATH)
}

pub fn anthropic_models_list_url(base_url: &str) -> String {
    format!("{}{}", normalize_openai_api_base(base_url), MODELS_PATH)
}

/// Parse `data[].id` from an OpenAI-style list models JSON body.
pub fn parse_openai_models_payload(json: &Value) -> Vec<String> {
    let Some(data) = json.get("data").and_then(|v| v.as_array()) else {
        return Vec::new();
    };
    let mut ids = Vec::new();
    for entry in data {
        let Some(id) = entry.get("id").and_then(|v| v.as_str()) else {
            continue;
        };
        let t = id.trim();
        if !t.is_empty() {
            ids.push(t.to_string());
        }
    }
    ids.sort();
    ids.dedup();
    ids
}

pub fn parse_anthropic_models_payload(json: &Value) -> Vec<String> {
    let Some(data) = json.get("data").and_then(|v| v.as_array()) else {
        return Vec::new();
    };
    let mut ids = Vec::new();
    for entry in data {
        let Some(id) = entry.get("id").and_then(|v| v.as_str()) else {
            continue;
        };
        let t = id.trim();
        if !t.is_empty() {
            ids.push(t.to_string());
        }
    }
    ids.sort();
    ids.dedup();
    ids
}

/// `GET {apiBase}/models` with Bearer auth; returns sorted unique ids.
pub fn list_openai_compatible_model_ids(
    api_base: &str,
    api_key: &str,
) -> Result<Vec<String>, String> {
    let key = api_key.trim();

    let url = openai_compatible_models_list_url(api_base);
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| format!("Failed to initialize HTTP client: {e}"))?;

    let mut request = client.get(&url);
    if !key.is_empty() {
        request = request.header("Authorization", format!("Bearer {key}"));
    }
    let response = request
        .send()
        .map_err(|e| format!("List models request failed: {e}"))?;

    let status = response.status();
    let text = response
        .text()
        .map_err(|e| format!("Failed to read list models response: {e}"))?;

    let json: Value = if text.trim().is_empty() {
        Value::Object(Default::default())
    } else {
        serde_json::from_str(&text).map_err(|_| {
            if status.is_success() {
                "List models response is not valid JSON.".to_string()
            } else {
                format!("List models failed (HTTP {}).", status.as_u16())
            }
        })?
    };

    if !status.is_success() {
        let err_msg = json
            .get("error")
            .and_then(|e| e.get("message"))
            .and_then(|m| m.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty());
        return Err(match err_msg {
            Some(m) => format!("List models failed (HTTP {}): {}", status.as_u16(), m),
            None => format!("List models failed (HTTP {}).", status.as_u16()),
        });
    }

    Ok(parse_openai_models_payload(&json))
}

pub fn list_anthropic_model_ids(api_base: &str, api_key: &str) -> Result<Vec<String>, String> {
    let key = api_key.trim();

    let url = anthropic_models_list_url(api_base);
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| format!("Failed to initialize HTTP client: {e}"))?;

    let mut request = client
        .get(&url)
        .header("anthropic-version", ANTHROPIC_VERSION);
    if !key.is_empty() {
        request = request.header("x-api-key", key);
    }
    let response = request
        .send()
        .map_err(|e| format!("List models request failed: {e}"))?;

    let status = response.status();
    let text = response
        .text()
        .map_err(|e| format!("Failed to read list models response: {e}"))?;

    let json: Value = if text.trim().is_empty() {
        Value::Object(Default::default())
    } else {
        serde_json::from_str(&text).map_err(|_| {
            if status.is_success() {
                "List models response is not valid JSON.".to_string()
            } else {
                format!("List models failed (HTTP {}).", status.as_u16())
            }
        })?
    };

    if !status.is_success() {
        let err_msg = json
            .get("error")
            .and_then(|error| {
                error
                    .get("message")
                    .and_then(Value::as_str)
                    .or_else(|| error.as_str())
            })
            .map(str::trim)
            .filter(|s| !s.is_empty());
        return Err(match err_msg {
            Some(m) => format!("List models failed (HTTP {}): {}", status.as_u16(), m),
            None => format!("List models failed (HTTP {}).", status.as_u16()),
        });
    }

    Ok(parse_anthropic_models_payload(&json))
}

/// Lists model ids over the transport's listing shape (`GET {apiBase}/models`). Bedrock has
/// no HTTP listing; the caller routes Vertex service-account listing through host-internal.
pub fn list_model_ids(
    api_base: &str,
    api_key: &str,
    transport_kind: ModelTransportKind,
) -> Result<Vec<String>, String> {
    match transport_kind {
        ModelTransportKind::OpenAiCompatible | ModelTransportKind::OpenResponses => {
            list_openai_compatible_model_ids(api_base, api_key)
        }
        ModelTransportKind::Anthropic => list_anthropic_model_ids(api_base, api_key),
        ModelTransportKind::Bedrock => Err(
            "To list Amazon Bedrock models, import via the Desktop connect wizard or read the catalog cache written by Desktop"
                .to_string(),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parse_openai_models_payload_reads_data_ids() {
        let body = json!({
            "data": [
                { "id": "z" },
                { "id": "a" },
                { "id": "a" },
                { "foo": "bar" }
            ]
        });
        assert_eq!(
            parse_openai_models_payload(&body),
            vec!["a".to_string(), "z".to_string()]
        );
    }

    #[test]
    fn parse_anthropic_models_payload_reads_data_ids() {
        let body = json!({
            "data": [
                { "id": "claude-z" },
                { "id": "claude-a" },
                { "id": "claude-a" },
                { "foo": "bar" }
            ]
        });
        assert_eq!(
            parse_anthropic_models_payload(&body),
            vec!["claude-a".to_string(), "claude-z".to_string()]
        );
    }

    #[test]
    fn normalize_openai_api_base_trims_slashes() {
        assert_eq!(normalize_openai_api_base(" https://x/v1/ "), "https://x/v1");
    }
}
