use std::{env, path::PathBuf};

use anyhow::Result;
use serde_json::Value;

use crate::{
    model_registry::{
        AppConfig, DEFAULT_API_BASE, ModelEntry, ModelProvider, ModelRef,
        ProviderGroupConnectDraft, make_test_app_config_with_models,
    },
    ports::SecretStore,
    transport_config::{
        TransportHost, constants::ENV_API_KEY, resolve_transport_config_json_for,
        transport_config_will_change,
    },
};

struct StubSecretStore;

impl SecretStore for StubSecretStore {
    fn load_global_api_key(&self) -> Result<Option<String>> {
        Ok(Some("test-key".to_string()))
    }

    fn save_global_api_key(&self, _api_key: &str) -> Result<()> {
        Ok(())
    }

    fn remove_global_api_key(&self) -> Result<()> {
        Ok(())
    }

    fn load_model_api_key(&self, _model_name: &str) -> Result<Option<String>> {
        Ok(None)
    }

    fn save_model_api_key(&self, _model_name: &str, _api_key: &str) -> Result<()> {
        Ok(())
    }

    fn remove_model_api_key(&self, _model_name: &str) -> Result<()> {
        Ok(())
    }

    fn has_model_api_key(&self, _model_name: &str) -> Result<bool> {
        Ok(false)
    }
}

struct TestTransportFixture {
    workspace: PathBuf,
    config: AppConfig,
    secret_store: StubSecretStore,
}

impl TestTransportFixture {
    fn new() -> Self {
        Self {
            workspace: PathBuf::new(),
            config: make_test_app_config_with_models(
                "openai",
                ModelProvider::Openai,
                DEFAULT_API_BASE,
                &["gpt-4o-mini", "gpt-4.1-mini"],
                "gpt-4o-mini",
            ),
            secret_store: StubSecretStore,
        }
    }

    fn host(&self) -> TransportHost<'_> {
        TransportHost {
            workspace_root: &self.workspace,
            secret_store: &self.secret_store,
            stored_config: &self.config,
        }
    }
}

#[test]
fn resolve_transport_config_json_includes_model_knobs() {
    let fixture = TestTransportFixture::new();
    let host = fixture.host();
    let mut next = fixture.config.clone();
    if let Some(entry) = next.active_model_entry_mut() {
        entry.reasoning_effort = Some("minimal".to_string());
    }
    if let Some(group) = next.active_provider_group_mut() {
        group.provider = ModelProvider::Custom;
    }

    let transport =
        resolve_transport_config_json_for(&host, &next).expect("resolve transport config");

    assert_eq!(
        transport.get("llmVendor").and_then(Value::as_str),
        Some("custom")
    );
    assert!(transport.get("transportImplementation").is_none());
    assert_eq!(
        transport.get("reasoningEffort").and_then(Value::as_str),
        Some("default")
    );
}

#[test]
fn resolve_transport_config_json_uses_anthropic_union_shape() {
    let fixture = TestTransportFixture::new();
    let host = fixture.host();
    let mut next = fixture.config.clone();
    if let Some(group) = next.active_provider_group_mut() {
        group.provider = ModelProvider::Anthropic;
        group.transport_kind = Some("anthropic".to_string());
    }
    if let Some(entry) = next.active_model_entry_mut() {
        entry.reasoning_effort = Some("max".to_string());
    }

    let transport =
        resolve_transport_config_json_for(&host, &next).expect("resolve transport config");

    assert_eq!(
        transport.get("transportKind").and_then(Value::as_str),
        Some("anthropic")
    );
    assert_eq!(transport.get("llmVendor"), None);
    assert_eq!(transport.get("effort").and_then(Value::as_str), Some("max"));
    assert_eq!(transport.get("imageGeneration"), None);
}

#[test]
fn resolve_transport_config_json_uses_azure_official_responses_provider() {
    let fixture = TestTransportFixture::new();
    let host = fixture.host();
    let previous_api_key = env::var(ENV_API_KEY).ok();
    // SAFETY: the unit test writes process-level environment variables serially and restores them afterwards.
    unsafe {
        env::set_var(ENV_API_KEY, "test-azure-key");
    }

    let mut next = fixture.config.clone();
    next.add_model_to_group(
        "azure",
        ModelProvider::Azure,
        "https://my-openai-resource.openai.azure.com/openai/v1".to_string(),
        ProviderGroupConnectDraft {
            transport_kind: Some("open-responses".to_string()),
            azure_resource_name: Some("my-openai-resource".to_string()),
            ..Default::default()
        },
        ModelEntry {
            name: "my-gpt4o-deploy".to_string(),
            reasoning_effort: None,
            reasoning_mode: None,
            thinking_enabled: None,
            supported_reasoning_efforts: None,
            capabilities: None,
            context_length: None,
            supports_thinking_type: None,
            supports_thinking_switch: None,
            service_tier: None,
            upstream_provider: None,
        },
    );
    next.active_model = ModelRef {
        group_id: "azure".to_string(),
        name: "my-gpt4o-deploy".to_string(),
    };

    let transport =
        resolve_transport_config_json_for(&host, &next).expect("resolve transport config");

    assert_eq!(
        transport.get("transportKind").and_then(Value::as_str),
        Some("open-responses")
    );
    assert_eq!(
        transport.get("responsesProvider").and_then(Value::as_str),
        Some("azure")
    );

    unsafe {
        match previous_api_key {
            Some(value) => env::set_var(ENV_API_KEY, value),
            None => env::remove_var(ENV_API_KEY),
        }
    }
}

#[test]
fn transport_config_will_change_detects_model_knobs() {
    let fixture = TestTransportFixture::new();
    let stored = fixture.config.clone();

    let mut next = stored.clone();
    if let Some(group) = next.active_provider_group_mut() {
        group.provider = ModelProvider::Custom;
    }
    assert!(transport_config_will_change(&stored, &next));

    let mut next = stored.clone();
    next.active_model = ModelRef {
        group_id: "openai".to_string(),
        name: "gpt-4.1-mini".to_string(),
    };
    assert!(transport_config_will_change(&stored, &next));

    let mut next = stored.clone();
    if let Some(entry) = next.active_model_entry_mut() {
        entry.reasoning_effort = Some("low".to_string());
    }
    assert!(transport_config_will_change(&stored, &next));

    let mut next = stored.clone();
    if let Some(entry) = next.active_model_entry_mut() {
        entry.service_tier = Some("flex".to_string());
    }
    assert!(transport_config_will_change(&stored, &next));

    let mut next = stored.clone();
    if let Some(entry) = next.active_model_entry_mut() {
        entry.upstream_provider = Some("acme-upstream".to_string());
    }
    assert!(transport_config_will_change(&stored, &next));
}

#[test]
fn resolve_transport_config_json_bridges_service_tier_fields() {
    let fixture = TestTransportFixture::new();
    let host = fixture.host();

    let mut next = fixture.config.clone();
    if let Some(entry) = next.active_model_entry_mut() {
        entry.service_tier = Some("flex".to_string());
        entry.upstream_provider = Some("acme-upstream".to_string());
    }
    let transport =
        resolve_transport_config_json_for(&host, &next).expect("resolve transport config");
    assert_eq!(
        transport.get("transportKind").and_then(Value::as_str),
        Some("open-responses")
    );
    assert_eq!(
        transport.get("serviceTier").and_then(Value::as_str),
        Some("flex")
    );
    assert_eq!(
        transport.get("upstreamProvider").and_then(Value::as_str),
        Some("acme-upstream")
    );

    let mut next = fixture.config.clone();
    if let Some(group) = next.active_provider_group_mut() {
        group.provider = ModelProvider::Custom;
    }
    if let Some(entry) = next.active_model_entry_mut() {
        entry.service_tier = Some("flex".to_string());
        entry.upstream_provider = Some("acme-upstream".to_string());
    }
    let transport =
        resolve_transport_config_json_for(&host, &next).expect("resolve transport config");
    assert_eq!(
        transport.get("serviceTier").and_then(Value::as_str),
        Some("flex")
    );
    assert_eq!(
        transport.get("upstreamProvider").and_then(Value::as_str),
        Some("acme-upstream")
    );

    let mut next = fixture.config.clone();
    if let Some(group) = next.active_provider_group_mut() {
        group.provider = ModelProvider::Anthropic;
        group.transport_kind = Some("anthropic".to_string());
    }
    if let Some(entry) = next.active_model_entry_mut() {
        entry.service_tier = Some("fast".to_string());
        entry.upstream_provider = Some("acme-upstream".to_string());
    }
    let transport =
        resolve_transport_config_json_for(&host, &next).expect("resolve transport config");
    assert_eq!(
        transport.get("serviceTier").and_then(Value::as_str),
        Some("fast")
    );
    assert_eq!(transport.get("upstreamProvider"), None);

    let mut next = fixture.config.clone();
    next.add_model_to_group(
        "bedrock-tier-test",
        ModelProvider::AmazonBedrock,
        "https://bedrock.example.invalid".to_string(),
        ProviderGroupConnectDraft {
            aws_region: Some("us-east-1".to_string()),
            ..Default::default()
        },
        ModelEntry {
            name: "anthropic.claude-sonnet-4".to_string(),
            reasoning_effort: None,
            reasoning_mode: None,
            thinking_enabled: None,
            supported_reasoning_efforts: None,
            capabilities: None,
            context_length: None,
            supports_thinking_type: None,
            supports_thinking_switch: None,
            service_tier: Some("flex".to_string()),
            upstream_provider: Some("acme-upstream".to_string()),
        },
    );
    next.active_model = ModelRef {
        group_id: "bedrock-tier-test".to_string(),
        name: "anthropic.claude-sonnet-4".to_string(),
    };
    let transport =
        resolve_transport_config_json_for(&host, &next).expect("resolve transport config");
    assert_eq!(
        transport.get("transportKind").and_then(Value::as_str),
        Some("bedrock")
    );
    assert_eq!(transport.get("serviceTier"), None);
    assert_eq!(transport.get("upstreamProvider"), None);
}

#[test]
fn resolve_transport_config_json_includes_image_generation_model() {
    let fixture = TestTransportFixture::new();
    let host = fixture.host();
    let mut next = fixture.config.clone();
    next.add_model_to_group(
        "custom",
        ModelProvider::Custom,
        "https://images.example.invalid/v1".to_string(),
        ProviderGroupConnectDraft::default(),
        ModelEntry {
            name: "image-model".to_string(),
            reasoning_effort: None,
            reasoning_mode: None,
            thinking_enabled: None,
            supported_reasoning_efforts: None,
            capabilities: Some(vec!["imageGeneration".to_string()]),
            context_length: None,
            supports_thinking_type: None,
            supports_thinking_switch: None,
            service_tier: None,
            upstream_provider: None,
        },
    );
    next.image_generation_model = Some(ModelRef {
        group_id: "custom".to_string(),
        name: "image-model".to_string(),
    });

    let transport =
        resolve_transport_config_json_for(&host, &next).expect("resolve transport config");
    let image_generation = transport
        .get("imageGeneration")
        .expect("image generation config");
    assert_eq!(
        image_generation.get("model").and_then(Value::as_str),
        Some("image-model")
    );
}
