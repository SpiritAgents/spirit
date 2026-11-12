use anyhow::{Result, anyhow};
use serde_json::{Value, json};
use std::{path::Path, time::Duration};

use crate::model_registry::{AppConfig, ModelProfile, ModelRef};

use super::{
    client::{DaemonClient, validate_product_build},
    resolve::{ensure_daemon, is_loopback_host},
};

/// Calls a management RPC without creating a session. Used during bootstrap,
/// before a full DaemonRuntime exists.
pub(crate) fn call_config_rpc(workspace_root: &Path, method: &str, params: Value) -> Result<Value> {
    let (instance, token) = ensure_daemon(workspace_root)?;
    if !is_loopback_host(&instance.host) {
        return Err(anyhow!("daemon host must be loopback: {}", instance.host));
    }
    let mut client = DaemonClient::connect(&instance.host, instance.port, &token)?;
    let hello = client
        .next_notification(Duration::from_secs(5))?
        .ok_or_else(|| anyhow!("daemon handshake timed out: server.connected not received"))?;
    if hello.get("method").and_then(Value::as_str) != Some("server.connected") {
        return Err(anyhow!(
            "daemon handshake failed: first frame was not server.connected"
        ));
    }
    validate_product_build(&client.call("server.health", json!({}))?)?;
    client.call(
        "server.initialize",
        json!({
            "clientKind": "cli",
            "clientId": format!("cli-config-{}", std::process::id()),
            "workspaceRoot": workspace_root.to_string_lossy(),
        }),
    )?;
    let result = client.call(method, params);
    client.close();
    result
}

fn profile_signature(profile: &ModelProfile) -> Value {
    serde_json::to_value(profile).unwrap_or(Value::Null)
}

fn resolved_profile_signature(config: &AppConfig, model_ref: Option<&ModelRef>) -> Option<Value> {
    config
        .resolve_model_profile(model_ref?)
        .as_ref()
        .map(profile_signature)
}

pub(crate) fn transport_config_will_change(stored_config: &AppConfig, config: &AppConfig) -> bool {
    if stored_config.active_model != config.active_model {
        return true;
    }
    if resolved_profile_signature(stored_config, Some(&stored_config.active_model))
        != resolved_profile_signature(config, Some(&config.active_model))
    {
        return true;
    }

    if stored_config.image_generation_model != config.image_generation_model {
        return true;
    }
    if resolved_profile_signature(stored_config, stored_config.image_generation_model.as_ref())
        != resolved_profile_signature(config, config.image_generation_model.as_ref())
    {
        return true;
    }

    if stored_config.video_generation_model != config.video_generation_model {
        return true;
    }
    resolved_profile_signature(stored_config, stored_config.video_generation_model.as_ref())
        != resolved_profile_signature(config, config.video_generation_model.as_ref())
}

#[cfg(test)]
mod tests {
    use super::transport_config_will_change;
    use crate::model_registry::{ModelRef, make_test_app_config_with_models};
    use serde_json::{Map, json};

    fn base_config() -> crate::model_registry::AppConfig {
        make_test_app_config_with_models(
            "acme",
            "https://api.acme.invalid/v1",
            &["acme-1", "acme-2"],
            "acme-1",
        )
    }

    #[test]
    fn transport_config_will_change_ignores_non_transport_edits() {
        let stored = base_config();
        let mut next = stored.clone();
        next.ui_locale = Some("zh-CN".to_string());
        next.tui = "fullscreen".to_string();
        next.extra.insert("theme".to_string(), json!("dark"));

        assert!(!transport_config_will_change(&stored, &next));
    }

    #[test]
    fn transport_config_will_change_detects_profile_changes() {
        let stored = base_config();

        let mut next = stored.clone();
        next.active_model = ModelRef {
            provider_id: "acme".to_string(),
            name: "acme-2".to_string(),
        };
        assert!(transport_config_will_change(&stored, &next));

        let mut next = stored.clone();
        next.find_provider_entry_mut("acme")
            .expect("provider")
            .models[0]
            .reasoning_effort = Some("low".to_string());
        assert!(transport_config_will_change(&stored, &next));

        let mut next = stored.clone();
        next.find_provider_entry_mut("acme")
            .expect("provider")
            .options = Some(Map::from_iter([("storedState".to_string(), json!(true))]));
        assert!(transport_config_will_change(&stored, &next));

        assert!(!transport_config_will_change(&stored, &stored.clone()));
    }
}
