use std::{collections::HashMap, path::PathBuf};

use anyhow::Result;
use serde_json::{Value, json};

use crate::{
    model_registry::AppConfig,
    ports::SecretStore,
    test_support::{ScopedEnv, shared_env_lock},
    transport_config::{
        TransportHost, constants::ENV_API_KEY, resolve_transport_config_json_for,
        transport_config_will_change,
    },
};

/// Stub keyring: `(service, account) -> secret`.
#[derive(Default)]
struct StubSecretStore {
    secrets: HashMap<(String, String), String>,
}

impl StubSecretStore {
    fn with_secrets(values: &[(&str, &str, &str)]) -> Self {
        Self {
            secrets: values
                .iter()
                .map(|(service, account, value)| {
                    (
                        ((*service).to_string(), (*account).to_string()),
                        (*value).to_string(),
                    )
                })
                .collect(),
        }
    }
}

impl SecretStore for StubSecretStore {
    fn read_keyring_secret(&self, service: &str, account: &str) -> Result<Option<String>> {
        Ok(self
            .secrets
            .get(&(service.to_string(), account.to_string()))
            .cloned())
    }

    fn save_provider_secret(&self, _account: &str, _secret: &str) -> Result<()> {
        Ok(())
    }

    fn remove_provider_secret(&self, _account: &str) -> Result<()> {
        Ok(())
    }
}

struct TestTransportFixture {
    workspace: PathBuf,
    config: AppConfig,
    secret_store: StubSecretStore,
}

impl TestTransportFixture {
    fn new(config: AppConfig, secret_store: StubSecretStore) -> Self {
        Self {
            workspace: PathBuf::new(),
            config,
            secret_store,
        }
    }

    fn host(&self) -> TransportHost<'_> {
        TransportHost {
            workspace_root: &self.workspace,
            secret_store: &self.secret_store,
        }
    }
}

fn config_from(value: Value) -> AppConfig {
    serde_json::from_value(value).expect("parse config")
}

fn base_config() -> AppConfig {
    config_from(json!({
        "schemaVersion": 1,
        "providers": [{
            "id": "acme",
            "apiBase": "https://api.acme.invalid/v1",
            "models": [{ "name": "acme-1" }, { "name": "acme-2" }]
        }],
        "activeModel": { "providerId": "acme", "name": "acme-1" }
    }))
}

fn base_fixture() -> TestTransportFixture {
    TestTransportFixture::new(
        base_config(),
        StubSecretStore::with_secrets(&[("Spirit", "provider::acme", "test-key")]),
    )
}

#[test]
fn resolve_transport_config_json_builds_openai_compatible_shape() {
    let fixture = base_fixture();
    let transport = resolve_transport_config_json_for(&fixture.host(), &fixture.config)
        .expect("resolve transport config");

    assert_eq!(
        transport.get("transportKind").and_then(Value::as_str),
        Some("openai-compatible")
    );
    assert_eq!(
        transport.get("apiKey").and_then(Value::as_str),
        Some("test-key")
    );
    assert_eq!(
        transport.get("model").and_then(Value::as_str),
        Some("acme-1")
    );
    assert_eq!(
        transport.get("baseUrl").and_then(Value::as_str),
        Some("https://api.acme.invalid/v1")
    );
    // Vendor-keyed wire fields are gone.
    assert!(transport.get("llmVendor").is_none());
    assert!(transport.get("responsesProvider").is_none());
    assert!(transport.get("upstreamProvider").is_none());
    assert!(transport.get("azureResourceName").is_none());
    assert!(transport.get("cloudflareGatewayId").is_none());
}

#[test]
fn reasoning_effort_default_is_omitted_and_declared_passes_through() {
    let mut config = base_config();
    config
        .active_model_entry_mut()
        .expect("model entry")
        .reasoning_effort = Some("default".to_string());
    let fixture = TestTransportFixture::new(config, StubSecretStore::default());
    let transport = resolve_transport_config_json_for(&fixture.host(), &fixture.config)
        .expect("resolve transport config");
    assert!(transport.get("reasoningEffort").is_none());

    let mut config = base_config();
    // "minimal" used to be clamped to "default" for unknown providers; it now passes through.
    config
        .active_model_entry_mut()
        .expect("model entry")
        .reasoning_effort = Some("minimal".to_string());
    let fixture = TestTransportFixture::new(config, StubSecretStore::default());
    let transport = resolve_transport_config_json_for(&fixture.host(), &fixture.config)
        .expect("resolve transport config");
    assert_eq!(
        transport.get("reasoningEffort").and_then(Value::as_str),
        Some("minimal")
    );
}

#[test]
fn declaration_fields_pass_through_verbatim() {
    let config = config_from(json!({
        "schemaVersion": 1,
        "providers": [{
            "id": "acme",
            "apiBase": "https://api.acme.invalid/v1",
            "sdk": "@ai-sdk/openai-compatible",
            "headers": { "X-Org-Id": "robotics" },
            "body": { "stream_options": { "include_usage": true } },
            "providerTools": [{ "label": "Web Search", "body": { "enable_search": true } }],
            "fileUpload": { "path": "/files", "refTemplate": "files://{id}" },
            "options": { "storedState": true },
            "reasoningMode": "pro",
            "supportedReasoningModes": ["standard", "pro"],
            "thinkingSwitch": { "on": { "body": { "thinking": { "type": "enabled" } } } },
            "models": [{ "name": "acme-1", "outputLimit": 8192 }]
        }],
        "activeModel": { "providerId": "acme", "name": "acme-1" }
    }));
    let fixture = TestTransportFixture::new(config, StubSecretStore::default());
    let transport = resolve_transport_config_json_for(&fixture.host(), &fixture.config)
        .expect("resolve transport config");

    assert_eq!(
        transport.get("sdk").and_then(Value::as_str),
        Some("@ai-sdk/openai-compatible")
    );
    assert_eq!(
        transport.get("headers").and_then(|h| h.get("X-Org-Id")),
        Some(&json!("robotics"))
    );
    assert_eq!(
        transport.get("body").and_then(|b| b.get("stream_options")),
        Some(&json!({ "include_usage": true }))
    );
    assert_eq!(
        transport
            .get("providerTools")
            .and_then(|tools| tools.get(0))
            .and_then(|tool| tool.get("body")),
        Some(&json!({ "enable_search": true }))
    );
    assert_eq!(
        transport
            .get("fileUpload")
            .and_then(|f| f.get("refTemplate")),
        Some(&json!("files://{id}"))
    );
    assert_eq!(
        transport.get("options").and_then(|o| o.get("storedState")),
        Some(&json!(true))
    );
    assert_eq!(
        transport.get("outputLimit").and_then(Value::as_u64),
        Some(8192)
    );
    assert_eq!(
        transport.get("reasoningMode").and_then(Value::as_str),
        Some("pro")
    );
    assert_eq!(
        transport.get("supportedReasoningModes"),
        Some(&json!(["standard", "pro"]))
    );
    // Provider-level flat declarations inherit onto the model's transport fields.
    assert_eq!(
        transport.get("thinkingSwitch").and_then(|t| t.get("on")),
        Some(&json!({ "body": { "thinking": { "type": "enabled" } } }))
    );
}

#[test]
fn anthropic_shape_filters_efforts_to_the_protocol_enum() {
    let config = config_from(json!({
        "schemaVersion": 1,
        "providers": [{
            "id": "acme",
            "apiBase": "https://api.acme.invalid/anthropic",
            "transportKind": "anthropic",
            "sdk": "@ai-sdk/anthropic",
            "models": [{
                "name": "acme-1",
                "reasoningEffort": "high",
                "supportedReasoningEfforts": ["none", "minimal", "low", "high"],
                "serviceTier": "fast",
                "supportsThinkingSwitch": true
            }]
        }],
        "activeModel": { "providerId": "acme", "name": "acme-1" }
    }));
    let fixture = TestTransportFixture::new(config, StubSecretStore::default());
    let transport = resolve_transport_config_json_for(&fixture.host(), &fixture.config)
        .expect("resolve transport config");

    assert_eq!(
        transport.get("transportKind").and_then(Value::as_str),
        Some("anthropic")
    );
    // The Anthropic enum has no none/minimal/default; those are filtered, "default" sends nothing.
    assert_eq!(
        transport.get("effort").and_then(Value::as_str),
        Some("high")
    );
    assert_eq!(
        transport.get("supportedEfforts"),
        Some(&json!(["low", "high"]))
    );
    assert_eq!(
        transport.get("serviceTier").and_then(Value::as_str),
        Some("fast")
    );
    assert_eq!(
        transport
            .get("supportsThinkingSwitch")
            .and_then(Value::as_bool),
        Some(true)
    );
    assert!(transport.get("reasoningEffort").is_none());
    assert!(transport.get("imageGeneration").is_none());

    let mut config = fixture.config.clone();
    config
        .active_model_entry_mut()
        .expect("model entry")
        .reasoning_effort = Some("minimal".to_string());
    let transport = resolve_transport_config_json_for(&fixture.host(), &config)
        .expect("resolve transport config");
    assert!(transport.get("effort").is_none());
}

#[test]
fn thinking_enabled_false_stamps_vendor_extended_thinking() {
    let config = config_from(json!({
        "schemaVersion": 1,
        "providers": [{
            "id": "acme",
            "apiBase": "https://api.acme.invalid/v1",
            "models": [{
                "name": "acme-1",
                "supportsThinkingSwitch": true,
                "thinkingEnabled": false
            }]
        }],
        "activeModel": { "providerId": "acme", "name": "acme-1" }
    }));
    let fixture = TestTransportFixture::new(config, StubSecretStore::default());
    let transport = resolve_transport_config_json_for(&fixture.host(), &fixture.config)
        .expect("resolve transport config");
    assert_eq!(
        transport
            .get("vendorExtendedThinking")
            .and_then(Value::as_bool),
        Some(false)
    );
    assert!(transport.get("thinkingEnabled").is_none());

    // Absent or true state omits the field entirely (default = thinking on).
    let mut config = fixture.config.clone();
    config
        .active_model_entry_mut()
        .expect("model entry")
        .thinking_enabled = Some(true);
    let transport = resolve_transport_config_json_for(&fixture.host(), &config)
        .expect("resolve transport config");
    assert!(transport.get("vendorExtendedThinking").is_none());
}

#[test]
fn open_responses_shape_includes_agent_mode_and_service_tier() {
    let config = config_from(json!({
        "schemaVersion": 1,
        "providers": [{
            "id": "acme",
            "apiBase": "https://api.acme.invalid/v1",
            "transportKind": "open-responses",
            "sdk": "@ai-sdk/open-responses",
            "models": [{ "name": "acme-1", "reasoningEffort": "xhigh", "serviceTier": "priority" }]
        }],
        "activeModel": { "providerId": "acme", "name": "acme-1" }
    }));
    let fixture = TestTransportFixture::new(config, StubSecretStore::default());
    let transport = resolve_transport_config_json_for(&fixture.host(), &fixture.config)
        .expect("resolve transport config");

    assert_eq!(
        transport.get("transportKind").and_then(Value::as_str),
        Some("open-responses")
    );
    assert_eq!(
        transport.get("agentMode").and_then(Value::as_str),
        Some("agent")
    );
    assert_eq!(
        transport.get("serviceTier").and_then(Value::as_str),
        Some("priority")
    );
    assert_eq!(
        transport.get("reasoningEffort").and_then(Value::as_str),
        Some("xhigh")
    );
    assert!(transport.get("supportedEfforts").is_none());
}

#[test]
fn bedrock_shape_reads_region_from_options_and_iam_from_slots() {
    let config = config_from(json!({
        "schemaVersion": 1,
        "providers": [{
            "id": "amazon-bedrock",
            "apiBase": "https://bedrock-runtime.us-east-1.amazonaws.com",
            "transportKind": "bedrock",
            "options": { "awsRegion": "us-east-1" },
            "credentials": {
                "accessKeyId": { "value": "AKIDEXAMPLE" },
                "secretAccessKey": { "value": "secret" }
            },
            "models": [{
                "name": "anthropic.claude-opus-5-5-v1",
                "reasoningEffort": "high",
                "supportedReasoningEfforts": ["low", "high"]
            }]
        }],
        "activeModel": { "providerId": "amazon-bedrock", "name": "anthropic.claude-opus-5-5-v1" }
    }));
    let fixture = TestTransportFixture::new(config, StubSecretStore::default());
    let transport = resolve_transport_config_json_for(&fixture.host(), &fixture.config)
        .expect("resolve transport config");

    assert_eq!(
        transport.get("transportKind").and_then(Value::as_str),
        Some("bedrock")
    );
    assert_eq!(
        transport.get("region").and_then(Value::as_str),
        Some("us-east-1")
    );
    assert_eq!(
        transport.get("accessKeyId").and_then(Value::as_str),
        Some("AKIDEXAMPLE")
    );
    assert_eq!(
        transport.get("secretAccessKey").and_then(Value::as_str),
        Some("secret")
    );
    // No Bearer key configured: the field is omitted on the bedrock shape.
    assert!(transport.get("apiKey").is_none());
    // bedrock is a self-held implementation: no SDK adapter is declared.
    assert!(transport.get("sdk").is_none());
    assert_eq!(
        transport.get("reasoningEffort").and_then(Value::as_str),
        Some("high")
    );
    assert_eq!(
        transport.get("supportedReasoningEfforts"),
        Some(&json!(["low", "high"]))
    );
    assert!(transport.get("serviceTier").is_none());
}

#[test]
fn bedrock_iam_slots_fall_back_to_internal_keyring_accounts() {
    let config = config_from(json!({
        "schemaVersion": 1,
        "providers": [{
            "id": "amazon-bedrock",
            "apiBase": "https://bedrock-runtime.eu-west-1.amazonaws.com",
            "transportKind": "bedrock",
            "options": { "awsRegion": "eu-west-1" },
            "models": [{ "name": "anthropic.claude-opus-5-5-v1" }]
        }],
        "activeModel": { "providerId": "amazon-bedrock", "name": "anthropic.claude-opus-5-5-v1" }
    }));
    let store = StubSecretStore::with_secrets(&[
        ("Spirit", "provider::amazon-bedrock::accessKeyId", "AKID"),
        (
            "Spirit",
            "provider::amazon-bedrock::secretAccessKey",
            "SECRET",
        ),
    ]);
    let fixture = TestTransportFixture::new(config, store);
    let transport = resolve_transport_config_json_for(&fixture.host(), &fixture.config)
        .expect("resolve transport config");
    assert_eq!(
        transport.get("accessKeyId").and_then(Value::as_str),
        Some("AKID")
    );
    assert_eq!(
        transport.get("secretAccessKey").and_then(Value::as_str),
        Some("SECRET")
    );
}

#[test]
fn bedrock_without_region_is_a_setup_error() {
    let config = config_from(json!({
        "schemaVersion": 1,
        "providers": [{
            "id": "amazon-bedrock",
            "apiBase": "https://bedrock-runtime.us-east-1.amazonaws.com",
            "transportKind": "bedrock",
            "models": [{ "name": "anthropic.claude-opus-5-5-v1" }]
        }],
        "activeModel": { "providerId": "amazon-bedrock", "name": "anthropic.claude-opus-5-5-v1" }
    }));
    let fixture = TestTransportFixture::new(config, StubSecretStore::default());
    let err = resolve_transport_config_json_for(&fixture.host(), &fixture.config)
        .expect_err("missing region must fail");
    assert!(err.to_string().contains("missing AWS region configuration"));
}

#[test]
fn sigv4_open_responses_maps_iam_slots_onto_bedrock_mantle_iam() {
    let config = config_from(json!({
        "schemaVersion": 1,
        "providers": [{
            "id": "amazon-bedrock",
            "apiBase": "https://bedrock-mantle.us-west-2.api.aws/openai/v1",
            "transportKind": "open-responses",
            "sdk": "@ai-sdk/open-responses",
            "options": { "auth": "aws-sigv4" },
            "credentials": {
                "accessKeyId": { "value": "AKIDEXAMPLE" },
                "secretAccessKey": { "value": "secret" }
            },
            "models": [{ "name": "openai.gpt-oss-120b" }]
        }],
        "activeModel": { "providerId": "amazon-bedrock", "name": "openai.gpt-oss-120b" }
    }));
    let fixture = TestTransportFixture::new(config, StubSecretStore::default());
    let transport = resolve_transport_config_json_for(&fixture.host(), &fixture.config)
        .expect("resolve transport config");

    assert_eq!(
        transport.get("transportKind").and_then(Value::as_str),
        Some("open-responses")
    );
    // The signing region is parsed back off the materialized apiBase host.
    assert_eq!(
        transport.get("bedrockMantleIam"),
        Some(&json!({
            "region": "us-west-2",
            "accessKeyId": "AKIDEXAMPLE",
            "secretAccessKey": "secret"
        }))
    );

    // A Bearer key takes precedence over IAM signing.
    let mut with_key = fixture.config.clone();
    let provider = with_key
        .find_provider_entry_mut("amazon-bedrock")
        .expect("provider entry");
    provider.api_key = Some("bearer-key".to_string());
    let transport = resolve_transport_config_json_for(&fixture.host(), &with_key)
        .expect("resolve transport config");
    assert!(transport.get("bedrockMantleIam").is_none());
    assert_eq!(
        transport.get("apiKey").and_then(Value::as_str),
        Some("bearer-key")
    );
}

#[test]
fn sigv4_open_responses_requires_iam_or_a_bearer_key() {
    let config = config_from(json!({
        "schemaVersion": 1,
        "providers": [{
            "id": "amazon-bedrock",
            "apiBase": "https://bedrock-mantle.us-west-2.api.aws/openai/v1",
            "transportKind": "open-responses",
            "options": { "auth": "aws-sigv4" },
            "models": [{ "name": "openai.gpt-oss-120b" }]
        }],
        "activeModel": { "providerId": "amazon-bedrock", "name": "openai.gpt-oss-120b" }
    }));
    let fixture = TestTransportFixture::new(config, StubSecretStore::default());
    let err = resolve_transport_config_json_for(&fixture.host(), &fixture.config)
        .expect_err("missing IAM slots must fail");
    assert!(
        err.to_string()
            .contains("Bearer API key or IAM credentials")
    );
}

#[test]
fn sigv4_open_responses_requires_a_region_carrying_host() {
    let config = config_from(json!({
        "schemaVersion": 1,
        "providers": [{
            "id": "amazon-bedrock",
            "apiBase": "https://example.invalid/openai/v1",
            "transportKind": "open-responses",
            "options": { "auth": "aws-sigv4" },
            "credentials": {
                "accessKeyId": { "value": "AKIDEXAMPLE" },
                "secretAccessKey": { "value": "secret" }
            },
            "models": [{ "name": "openai.gpt-oss-120b" }]
        }],
        "activeModel": { "providerId": "amazon-bedrock", "name": "openai.gpt-oss-120b" }
    }));
    let fixture = TestTransportFixture::new(config, StubSecretStore::default());
    let err = resolve_transport_config_json_for(&fixture.host(), &fixture.config)
        .expect_err("a non-mantle host must fail");
    assert!(err.to_string().contains("does not carry an AWS region"));
}

#[test]
fn vertex_maps_options_and_service_account_slots_onto_wire_fields() {
    let config = config_from(json!({
        "schemaVersion": 1,
        "providers": [{
            "id": "google-vertex-ai",
            "apiBase": "https://us-central1-aiplatform.googleapis.com",
            "sdk": "@ai-sdk/google-vertex",
            "options": { "project": "my-gcp-project", "location": "us-central1" },
            "credentials": {
                "clientEmail": { "value": "sa@my-gcp-project.iam.gserviceaccount.com" }
            },
            "models": [{ "name": "publishers/google/models/gemini-3.5-flash" }]
        }],
        "activeModel": {
            "providerId": "google-vertex-ai",
            "name": "publishers/google/models/gemini-3.5-flash"
        }
    }));
    let store = StubSecretStore::with_secrets(&[(
        "Spirit",
        "provider::google-vertex-ai::privateKey",
        "-----BEGIN PRIVATE KEY-----\\nstub\\n-----END PRIVATE KEY-----\\n",
    )]);
    let fixture = TestTransportFixture::new(config, store);
    let transport = resolve_transport_config_json_for(&fixture.host(), &fixture.config)
        .expect("resolve transport config");

    assert_eq!(
        transport.get("transportKind").and_then(Value::as_str),
        Some("openai-compatible")
    );
    assert_eq!(
        transport.get("vertexProject").and_then(Value::as_str),
        Some("my-gcp-project")
    );
    assert_eq!(
        transport.get("vertexLocation").and_then(Value::as_str),
        Some("us-central1")
    );
    assert_eq!(
        transport.get("vertexClientEmail").and_then(Value::as_str),
        Some("sa@my-gcp-project.iam.gserviceaccount.com")
    );
    assert!(
        transport
            .get("vertexPrivateKey")
            .and_then(Value::as_str)
            .is_some_and(|key| key.contains("PRIVATE KEY"))
    );
}

#[test]
fn vertex_without_any_credential_is_a_setup_error() {
    let config = config_from(json!({
        "schemaVersion": 1,
        "providers": [{
            "id": "google-vertex-ai",
            "apiBase": "https://us-central1-aiplatform.googleapis.com",
            "sdk": "@ai-sdk/google-vertex",
            "options": { "project": "my-gcp-project", "location": "us-central1" },
            "models": [{ "name": "publishers/google/models/gemini-3.5-flash" }]
        }],
        "activeModel": {
            "providerId": "google-vertex-ai",
            "name": "publishers/google/models/gemini-3.5-flash"
        }
    }));
    let fixture = TestTransportFixture::new(config, StubSecretStore::default());
    let err = resolve_transport_config_json_for(&fixture.host(), &fixture.config)
        .expect_err("vertex without credentials must fail");
    assert!(err.to_string().contains("No Vertex credentials found"));
}

#[test]
fn declared_key_channel_resolving_to_nothing_is_a_setup_error() {
    let config = config_from(json!({
        "schemaVersion": 1,
        "providers": [{
            "id": "acme",
            "apiBase": "https://api.acme.invalid/v1",
            "apiKeyEnv": "SPIRIT_TEST_DEFINITELY_MISSING_KEY",
            "models": [{ "name": "acme-1" }]
        }],
        "activeModel": { "providerId": "acme", "name": "acme-1" }
    }));
    let fixture = TestTransportFixture::new(config, StubSecretStore::default());
    let err = resolve_transport_config_json_for(&fixture.host(), &fixture.config)
        .expect_err("a declared but unresolvable channel must fail");
    assert!(err.to_string().contains("No API key found for model"));

    // An entry declaring no channel at all is an unauthenticated endpoint and proceeds.
    let config = config_from(json!({
        "schemaVersion": 1,
        "providers": [{
            "id": "acme",
            "apiBase": "https://api.acme.invalid/v1",
            "models": [{ "name": "acme-1" }]
        }],
        "activeModel": { "providerId": "acme", "name": "acme-1" }
    }));
    let fixture = TestTransportFixture::new(config, StubSecretStore::default());
    let transport = resolve_transport_config_json_for(&fixture.host(), &fixture.config)
        .expect("resolve transport config");
    assert_eq!(transport.get("apiKey").and_then(Value::as_str), Some(""));
}

#[test]
fn env_api_key_override_wins_over_the_channels() {
    let _guard = shared_env_lock()
        .lock()
        .unwrap_or_else(|err| err.into_inner());
    let _override = ScopedEnv::set(ENV_API_KEY, "override-key");
    let fixture = base_fixture();
    let transport = resolve_transport_config_json_for(&fixture.host(), &fixture.config)
        .expect("resolve transport config");
    assert_eq!(
        transport.get("apiKey").and_then(Value::as_str),
        Some("override-key")
    );
}

#[test]
fn image_generation_block_attaches_without_vendor_fields() {
    let config = config_from(json!({
        "schemaVersion": 1,
        "providers": [
            {
                "id": "acme",
                "apiBase": "https://api.acme.invalid/v1",
                "models": [{ "name": "acme-1", "capabilities": ["languageModel"] }]
            },
            {
                "id": "images",
                "apiBase": "https://images.acme.invalid/v1",
                "apiKey": "image-key",
                "models": [{ "name": "image-model", "capabilities": ["imageGeneration"] }]
            }
        ],
        "activeModel": { "providerId": "acme", "name": "acme-1" },
        "imageGenerationModel": { "providerId": "images", "name": "image-model" }
    }));
    let fixture = TestTransportFixture::new(config, StubSecretStore::default());
    let transport = resolve_transport_config_json_for(&fixture.host(), &fixture.config)
        .expect("resolve transport config");

    let image_generation = transport
        .get("imageGeneration")
        .expect("image generation config");
    assert_eq!(
        image_generation.get("model").and_then(Value::as_str),
        Some("image-model")
    );
    assert_eq!(
        image_generation.get("apiKey").and_then(Value::as_str),
        Some("image-key")
    );
    assert_eq!(
        image_generation.get("baseUrl").and_then(Value::as_str),
        Some("https://images.acme.invalid/v1")
    );
    assert_eq!(
        image_generation.get("modelCapabilities"),
        Some(&json!({ "imageGeneration": true }))
    );
    assert!(image_generation.get("llmVendor").is_none());
}

#[test]
fn mcp_only_shape_when_no_active_model() {
    let config = config_from(json!({
        "schemaVersion": 1,
        "providers": [],
        "activeModel": { "providerId": "", "name": "" }
    }));
    let fixture = TestTransportFixture::new(config, StubSecretStore::default());
    let transport = resolve_transport_config_json_for(&fixture.host(), &fixture.config)
        .expect("resolve transport config");
    assert_eq!(
        transport.get("model").and_then(Value::as_str),
        Some("mcp-only")
    );
}

#[test]
fn transport_config_will_change_detects_profile_changes() {
    let stored = base_config();
    let fixture = TestTransportFixture::new(stored.clone(), StubSecretStore::default());
    let _ = &fixture;

    let mut next = stored.clone();
    next.active_model = crate::model_registry::ModelRef {
        provider_id: "acme".to_string(),
        name: "acme-2".to_string(),
    };
    assert!(transport_config_will_change(&stored, &next));

    let mut next = stored.clone();
    next.active_model_entry_mut()
        .expect("model entry")
        .reasoning_effort = Some("low".to_string());
    assert!(transport_config_will_change(&stored, &next));

    let mut next = stored.clone();
    next.active_model_entry_mut()
        .expect("model entry")
        .service_tier = Some("flex".to_string());
    assert!(transport_config_will_change(&stored, &next));

    // Provider-level declarations (options, sdk, headers, credentials, …) are part of the
    // resolved profile signature too.
    let mut next = stored.clone();
    next.find_provider_entry_mut("acme")
        .expect("provider entry")
        .options = Some(serde_json::Map::from_iter([(
        "storedState".to_string(),
        json!(true),
    )]));
    assert!(transport_config_will_change(&stored, &next));

    let mut next = stored.clone();
    next.find_provider_entry_mut("acme")
        .expect("provider entry")
        .api_key_env = Some("ACME_API_KEY".to_string());
    assert!(transport_config_will_change(&stored, &next));

    assert!(!transport_config_will_change(&stored, &stored.clone()));
}
