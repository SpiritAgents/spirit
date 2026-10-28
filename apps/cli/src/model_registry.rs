use crate::mcp::spirit_data_dir;
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::{
    collections::{BTreeMap, HashMap},
    env, fs,
    path::{Path, PathBuf},
    str::FromStr,
};

pub const DEFAULT_API_BASE: &str = "https://api.openai.com/v1";
pub const SPIRIT_CONFIG_SCHEMA_VERSION: u64 = 1;
const KEYRING_SERVICE: &str = "Spirit";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModelTransportKind {
    OpenAiCompatible,
    OpenResponses,
    Anthropic,
    Bedrock,
}

impl ModelTransportKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::OpenAiCompatible => "openai-compatible",
            Self::OpenResponses => "open-responses",
            Self::Anthropic => "anthropic",
            Self::Bedrock => "bedrock",
        }
    }
}

impl FromStr for ModelTransportKind {
    type Err = String;

    fn from_str(value: &str) -> std::result::Result<Self, Self::Err> {
        match value.trim().to_ascii_lowercase().as_str() {
            "openai-compatible" => Ok(Self::OpenAiCompatible),
            "open-responses" => Ok(Self::OpenResponses),
            "anthropic" => Ok(Self::Anthropic),
            "bedrock" => Ok(Self::Bedrock),
            other => Err(format!("Unsupported transport kind: {other}")),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModelRef {
    #[serde(rename = "providerId")]
    pub provider_id: String,
    pub name: String,
}

impl ModelRef {
    pub fn empty() -> Self {
        Self {
            provider_id: String::new(),
            name: String::new(),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.provider_id.trim().is_empty() || self.name.trim().is_empty()
    }
}

pub fn model_refs_equal(a: &ModelRef, b: &ModelRef) -> bool {
    a.provider_id == b.provider_id && a.name == b.name
}

pub fn model_ref_key(model_ref: &ModelRef) -> String {
    format!("{}::{}", model_ref.provider_id, model_ref.name)
}

/// `apiKeyKeyring` channel / `credentials` slot keyring source: an external keyring entry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KeyringReference {
    pub service: String,
    pub account: String,
}

/// One `credentials` slot declaration; resolution order is `value` → `env` → `keyring`, then
/// the internal keyring account `provider::{id}::{slot}`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct CredentialSlot {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub env: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub keyring: Option<KeyringReference>,
}

/// schemaVersion 1 model entry: only `name` is required. Flat capability fields inherit from the
/// provider; transportKind/sdk are explicit per-model overrides and must appear together.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ModelEntry {
    pub name: String,
    #[serde(
        rename = "transportKind",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub transport_kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sdk: Option<String>,
    /// User thinking on/off state; model-level only and never inherited (absent = on).
    #[serde(
        rename = "thinkingEnabled",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub thinking_enabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<Vec<String>>,
    #[serde(
        rename = "contextLength",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub context_length: Option<u64>,
    #[serde(
        rename = "outputLimit",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub output_limit: Option<u64>,
    #[serde(
        rename = "reasoningEffort",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub reasoning_effort: Option<String>,
    #[serde(
        rename = "supportedReasoningEfforts",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub supported_reasoning_efforts: Option<Vec<String>>,
    #[serde(
        rename = "effortSemantics",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub effort_semantics: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effort: Option<String>,
    #[serde(
        rename = "supportedEfforts",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub supported_efforts: Option<Vec<String>>,
    #[serde(
        rename = "defaultEffort",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub default_effort: Option<String>,
    #[serde(
        rename = "thinkingCapabilities",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub thinking_capabilities: Option<Value>,
    #[serde(
        rename = "reasoningMode",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub reasoning_mode: Option<String>,
    #[serde(
        rename = "supportedReasoningModes",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub supported_reasoning_modes: Option<Vec<String>>,
    #[serde(
        rename = "supportsThinkingType",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub supports_thinking_type: Option<String>,
    #[serde(
        rename = "supportsThinkingSwitch",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub supports_thinking_switch: Option<bool>,
    /// Opaque thinking on/off wire patches (`{ on, off }`); the CLI passes them through.
    #[serde(
        rename = "thinkingSwitch",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub thinking_switch: Option<Value>,
    /// Opaque dual form (tier name list or tier → wire patch map); the CLI passes it through.
    #[serde(
        rename = "serviceTiers",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub service_tiers: Option<Value>,
    /// Selected service tier; validation against `serviceTiers` is owned by the TS host.
    #[serde(
        rename = "serviceTier",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub service_tier: Option<String>,
}

/// schemaVersion 1 provider entry: connection fields plus flat model-level defaults that its
/// models inherit (a model-level explicit declaration wins). There is deliberately no vendor
/// field; unknown keys are ignored by the CLI (the TS host fail-fast validates the file).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderEntry {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(rename = "apiBase")]
    pub api_base: String,
    #[serde(
        rename = "transportKind",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub transport_kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sdk: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub headers: Option<BTreeMap<String, String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<Map<String, Value>>,
    /// Opaque provider tool declarations; the CLI forwards them to the daemon untouched.
    #[serde(
        rename = "providerTools",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub provider_tools: Option<Vec<Value>>,
    /// Opaque upload declaration; the CLI forwards it to the daemon untouched.
    #[serde(
        rename = "fileUpload",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub file_upload: Option<Value>,
    #[serde(rename = "imageApi", default, skip_serializing_if = "Option::is_none")]
    pub image_api: Option<String>,
    #[serde(rename = "videoApi", default, skip_serializing_if = "Option::is_none")]
    pub video_api: Option<String>,
    #[serde(rename = "apiKey", default, skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
    #[serde(rename = "apiKeyEnv", default, skip_serializing_if = "Option::is_none")]
    pub api_key_env: Option<String>,
    #[serde(
        rename = "apiKeyKeyring",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub api_key_keyring: Option<KeyringReference>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credentials: Option<BTreeMap<String, CredentialSlot>>,
    /// Transport-level parameter namespace (`awsRegion`, `project` / `location`, `auth`, …).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub options: Option<Map<String, Value>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<Vec<String>>,
    #[serde(
        rename = "contextLength",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub context_length: Option<u64>,
    #[serde(
        rename = "outputLimit",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub output_limit: Option<u64>,
    #[serde(
        rename = "reasoningEffort",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub reasoning_effort: Option<String>,
    #[serde(
        rename = "supportedReasoningEfforts",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub supported_reasoning_efforts: Option<Vec<String>>,
    #[serde(
        rename = "effortSemantics",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub effort_semantics: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effort: Option<String>,
    #[serde(
        rename = "supportedEfforts",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub supported_efforts: Option<Vec<String>>,
    #[serde(
        rename = "defaultEffort",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub default_effort: Option<String>,
    #[serde(
        rename = "thinkingCapabilities",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub thinking_capabilities: Option<Value>,
    #[serde(
        rename = "reasoningMode",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub reasoning_mode: Option<String>,
    #[serde(
        rename = "supportedReasoningModes",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub supported_reasoning_modes: Option<Vec<String>>,
    #[serde(
        rename = "supportsThinkingType",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub supports_thinking_type: Option<String>,
    #[serde(
        rename = "supportsThinkingSwitch",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub supports_thinking_switch: Option<bool>,
    #[serde(
        rename = "thinkingSwitch",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub thinking_switch: Option<Value>,
    #[serde(
        rename = "serviceTiers",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub service_tiers: Option<Value>,
    #[serde(
        rename = "serviceTier",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub service_tier: Option<String>,
    pub models: Vec<ModelEntry>,
}

impl ProviderEntry {
    /// The credential channel declarations of this entry, fed to the key resolvers.
    pub fn key_channels(&self) -> ProviderKeyChannels<'_> {
        ProviderKeyChannels {
            provider_id: &self.id,
            api_key: self.api_key.as_deref(),
            api_key_env: self.api_key_env.as_deref(),
            api_key_keyring: self.api_key_keyring.as_ref(),
            credentials: self.credentials.as_ref(),
        }
    }
}

/// Resolved model profile: the provider entry's connection fields plus the effective
/// (post-inheritance) model fields. Vendor-free mirror of host-internal `SpiritModelProfile`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelProfile {
    #[serde(rename = "providerId")]
    pub provider_id: String,
    pub name: String,
    #[serde(rename = "apiBase")]
    pub api_base: String,
    #[serde(
        rename = "transportKind",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub transport_kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sdk: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub headers: Option<BTreeMap<String, String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<Map<String, Value>>,
    #[serde(
        rename = "providerTools",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub provider_tools: Option<Vec<Value>>,
    #[serde(
        rename = "fileUpload",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub file_upload: Option<Value>,
    #[serde(rename = "imageApi", default, skip_serializing_if = "Option::is_none")]
    pub image_api: Option<String>,
    #[serde(rename = "videoApi", default, skip_serializing_if = "Option::is_none")]
    pub video_api: Option<String>,
    #[serde(rename = "apiKey", default, skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
    #[serde(rename = "apiKeyEnv", default, skip_serializing_if = "Option::is_none")]
    pub api_key_env: Option<String>,
    #[serde(
        rename = "apiKeyKeyring",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub api_key_keyring: Option<KeyringReference>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credentials: Option<BTreeMap<String, CredentialSlot>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub options: Option<Map<String, Value>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<Vec<String>>,
    #[serde(
        rename = "contextLength",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub context_length: Option<u64>,
    #[serde(
        rename = "outputLimit",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub output_limit: Option<u64>,
    #[serde(
        rename = "reasoningEffort",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub reasoning_effort: Option<String>,
    #[serde(
        rename = "supportedReasoningEfforts",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub supported_reasoning_efforts: Option<Vec<String>>,
    #[serde(
        rename = "effortSemantics",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub effort_semantics: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effort: Option<String>,
    #[serde(
        rename = "supportedEfforts",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub supported_efforts: Option<Vec<String>>,
    #[serde(
        rename = "defaultEffort",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub default_effort: Option<String>,
    #[serde(
        rename = "thinkingCapabilities",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub thinking_capabilities: Option<Value>,
    #[serde(
        rename = "reasoningMode",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub reasoning_mode: Option<String>,
    #[serde(
        rename = "supportedReasoningModes",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub supported_reasoning_modes: Option<Vec<String>>,
    #[serde(
        rename = "supportsThinkingType",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub supports_thinking_type: Option<String>,
    #[serde(
        rename = "supportsThinkingSwitch",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub supports_thinking_switch: Option<bool>,
    #[serde(
        rename = "thinkingSwitch",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub thinking_switch: Option<Value>,
    #[serde(
        rename = "thinkingEnabled",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub thinking_enabled: Option<bool>,
    #[serde(
        rename = "serviceTiers",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub service_tiers: Option<Value>,
    #[serde(
        rename = "serviceTier",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub service_tier: Option<String>,
}

impl ModelProfile {
    /// The declared transport; absent / unknown values resolve to `openai-compatible`.
    pub fn transport_kind(&self) -> ModelTransportKind {
        self.transport_kind
            .as_deref()
            .and_then(|value| value.parse().ok())
            .unwrap_or(ModelTransportKind::OpenAiCompatible)
    }

    /// `sdk` declaration, or the generic adapter for the transport kind when omitted
    /// (bedrock is a self-held implementation with no adapter).
    pub fn resolved_sdk_package_name(&self) -> Option<String> {
        if let Some(sdk) = self.sdk.as_deref().map(str::trim).filter(|v| !v.is_empty()) {
            return Some(sdk.to_string());
        }
        match self.transport_kind() {
            ModelTransportKind::OpenAiCompatible => Some("@ai-sdk/openai-compatible".to_string()),
            ModelTransportKind::OpenResponses => Some("@ai-sdk/open-responses".to_string()),
            ModelTransportKind::Anthropic => Some("@ai-sdk/anthropic".to_string()),
            ModelTransportKind::Bedrock => None,
        }
    }

    fn has_declared_capability(&self, capability: &str) -> bool {
        self.capabilities
            .as_ref()
            .is_some_and(|capabilities| capabilities.iter().any(|value| value == capability))
    }

    /// Undeclared `capabilities` keeps the model eligible (safe default for listing).
    pub fn supports_language_model(&self) -> bool {
        self.capabilities
            .as_ref()
            .is_none_or(|capabilities| capabilities.iter().any(|value| value == "languageModel"))
    }

    pub fn supports_image_generation(&self) -> bool {
        self.has_declared_capability("imageGeneration")
    }

    pub fn supports_video_generation(&self) -> bool {
        self.has_declared_capability("videoGeneration")
    }

    /// A trimmed, non-empty `options` string value.
    pub fn option_str(&self, key: &str) -> Option<String> {
        self.options
            .as_ref()?
            .get(key)?
            .as_str()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
    }

    /// `options.auth: "aws-sigv4"` — SigV4-signed requests from IAM credential slots.
    pub fn options_auth_aws_sigv4(&self) -> bool {
        self.options
            .as_ref()
            .and_then(|options| options.get("auth"))
            .and_then(Value::as_str)
            == Some("aws-sigv4")
    }

    /// The credential channel declarations carried by this profile, fed to the key resolvers.
    pub fn key_channels(&self) -> ProviderKeyChannels<'_> {
        ProviderKeyChannels {
            provider_id: &self.provider_id,
            api_key: self.api_key.as_deref(),
            api_key_env: self.api_key_env.as_deref(),
            api_key_keyring: self.api_key_keyring.as_ref(),
            credentials: self.credentials.as_ref(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworksConfig {
    #[serde(rename = "llmHttpVersion", default = "default_llm_http_version")]
    pub llm_http_version: String,
}

fn default_llm_http_version() -> String {
    "http2".to_string()
}

impl Default for NetworksConfig {
    fn default() -> Self {
        Self {
            llm_http_version: default_llm_http_version(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AgentsAttributionToggleConfig {
    #[serde(default)]
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AgentsAttributionConfig {
    #[serde(default)]
    pub commit: AgentsAttributionToggleConfig,
    #[serde(default)]
    pub pr: AgentsAttributionToggleConfig,
}

/// Opt-out toggle for a built-in web tool: only an explicit `"enabled": false`
/// hides the tool; a missing key keeps the default (on).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AgentsWebToolToggleConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AgentsConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lsp: Option<Value>,
    #[serde(
        rename = "codeCompletion",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub code_completion: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attribution: Option<AgentsAttributionConfig>,
    /// Provider tools opt-out (`agents.providerTools.enabled`; renamed from `agents.webSearch`).
    #[serde(
        rename = "providerTools",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub provider_tools: Option<AgentsWebToolToggleConfig>,
    #[serde(rename = "webFetch", default, skip_serializing_if = "Option::is_none")]
    pub web_fetch: Option<AgentsWebToolToggleConfig>,
    #[serde(flatten, default, skip_serializing_if = "Map::is_empty")]
    pub extra: Map<String, Value>,
}

/// Action a single permission rule applies when its pattern matches; values are
/// the lowercase strings stored in config.json.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PermissionRuleAction {
    Allow,
    Ask,
    Deny,
}

/// Three-state permission allowlist stored in config.json under `permission`.
/// The CLI only round-trips the shape; rule evaluation stays daemon-side.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PermissionConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shell: Option<HashMap<String, PermissionRuleAction>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub read_file: Option<HashMap<String, PermissionRuleAction>>,
}

/// CLI-side parsing of the Attribution switches.
///
/// Both are false (off) when the fields are missing. The CLI has no Desktop OOBE;
/// defaulting to on would inject attribution into commits / PRs without the user's
/// knowledge, so it must be explicitly opted in via config.json.
pub fn resolve_cli_attribution(config: &AppConfig) -> (bool, bool) {
    let Some(attribution) = config.agents.attribution.as_ref() else {
        return (false, false);
    };
    (attribution.commit.enabled, attribution.pr.enabled)
}

/// CLI-side parsing of the Provider Tools / Web Fetch switches.
///
/// Both are true (on) when the fields are missing: unlike attribution, the web
/// tools ship in the default tool surface, so the toggles are opt-out and only
/// an explicit `"enabled": false` in config.json hides them from the model.
/// The first return value reads `agents.providerTools` (renamed from `agents.webSearch`);
/// it is still sent on the wire as `webSearchEnabled` until the protocol rename lands.
pub fn resolve_cli_web_tool_exposure(config: &AppConfig) -> (bool, bool) {
    let provider_tools_enabled = config
        .agents
        .provider_tools
        .as_ref()
        .and_then(|toggle| toggle.enabled)
        != Some(false);
    let web_fetch_enabled = config
        .agents
        .web_fetch
        .as_ref()
        .and_then(|toggle| toggle.enabled)
        != Some(false);
    (provider_tools_enabled, web_fetch_enabled)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    #[serde(rename = "schemaVersion", default = "default_schema_version")]
    pub schema_version: u64,
    #[serde(rename = "providers", default)]
    pub providers: Vec<ProviderEntry>,
    #[serde(rename = "activeModel")]
    pub active_model: ModelRef,
    #[serde(
        rename = "imageGenerationModel",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub image_generation_model: Option<ModelRef>,
    #[serde(
        rename = "videoGenerationModel",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub video_generation_model: Option<ModelRef>,
    #[serde(
        rename = "secondaryLanguageModel",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub secondary_language_model: Option<ModelRef>,
    #[serde(rename = "uiLocale", default, skip_serializing_if = "Option::is_none")]
    pub ui_locale: Option<String>,
    #[serde(default = "default_tui_mode")]
    pub tui: String,
    #[serde(default)]
    pub networks: NetworksConfig,
    #[serde(default)]
    pub agents: AgentsConfig,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub permission: Option<PermissionConfig>,
    #[serde(flatten, default, skip_serializing_if = "Map::is_empty")]
    pub extra: Map<String, Value>,
}

fn default_schema_version() -> u64 {
    SPIRIT_CONFIG_SCHEMA_VERSION
}

fn default_tui_mode() -> String {
    crate::ports::TUI_MODE_INLINE.to_string()
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            schema_version: SPIRIT_CONFIG_SCHEMA_VERSION,
            providers: vec![],
            active_model: ModelRef::empty(),
            image_generation_model: None,
            video_generation_model: None,
            secondary_language_model: None,
            ui_locale: None,
            tui: default_tui_mode(),
            networks: NetworksConfig::default(),
            agents: AgentsConfig::default(),
            permission: None,
            extra: Map::new(),
        }
    }
}

/// Resolved profile: connection fields come from the provider entry; the model-level fields
/// apply the shared inheritance rule (provider flat declarations are the defaults, the model's
/// explicit declaration wins). Mirrors host-internal `resolveModelEntry` + profile build.
pub fn resolve_model_profile_from_parts(
    provider: &ProviderEntry,
    model: &ModelEntry,
) -> Option<ModelProfile> {
    if provider.id.trim().is_empty() || model.name.trim().is_empty() {
        return None;
    }

    Some(ModelProfile {
        provider_id: provider.id.clone(),
        name: model.name.clone(),
        api_base: provider.api_base.clone(),
        transport_kind: model
            .transport_kind
            .clone()
            .or_else(|| provider.transport_kind.clone()),
        sdk: model.sdk.clone().or_else(|| provider.sdk.clone()),
        headers: provider.headers.clone(),
        body: provider.body.clone(),
        provider_tools: provider.provider_tools.clone(),
        file_upload: provider.file_upload.clone(),
        image_api: provider.image_api.clone(),
        video_api: provider.video_api.clone(),
        api_key: provider.api_key.clone(),
        api_key_env: provider.api_key_env.clone(),
        api_key_keyring: provider.api_key_keyring.clone(),
        credentials: provider.credentials.clone(),
        options: provider.options.clone(),
        capabilities: model
            .capabilities
            .clone()
            .or_else(|| provider.capabilities.clone()),
        context_length: model.context_length.or(provider.context_length),
        output_limit: model.output_limit.or(provider.output_limit),
        reasoning_effort: model
            .reasoning_effort
            .clone()
            .or_else(|| provider.reasoning_effort.clone()),
        supported_reasoning_efforts: model
            .supported_reasoning_efforts
            .clone()
            .or_else(|| provider.supported_reasoning_efforts.clone()),
        effort_semantics: model
            .effort_semantics
            .clone()
            .or_else(|| provider.effort_semantics.clone()),
        effort: model.effort.clone().or_else(|| provider.effort.clone()),
        supported_efforts: model
            .supported_efforts
            .clone()
            .or_else(|| provider.supported_efforts.clone()),
        default_effort: model
            .default_effort
            .clone()
            .or_else(|| provider.default_effort.clone()),
        thinking_capabilities: model
            .thinking_capabilities
            .clone()
            .or_else(|| provider.thinking_capabilities.clone()),
        reasoning_mode: model
            .reasoning_mode
            .clone()
            .or_else(|| provider.reasoning_mode.clone()),
        supported_reasoning_modes: model
            .supported_reasoning_modes
            .clone()
            .or_else(|| provider.supported_reasoning_modes.clone()),
        supports_thinking_type: model
            .supports_thinking_type
            .clone()
            .or_else(|| provider.supports_thinking_type.clone()),
        supports_thinking_switch: model
            .supports_thinking_switch
            .or(provider.supports_thinking_switch),
        thinking_switch: model
            .thinking_switch
            .clone()
            .or_else(|| provider.thinking_switch.clone()),
        thinking_enabled: model.thinking_enabled,
        service_tiers: model
            .service_tiers
            .clone()
            .or_else(|| provider.service_tiers.clone()),
        service_tier: model
            .service_tier
            .clone()
            .or_else(|| provider.service_tier.clone()),
    })
}

impl AppConfig {
    pub fn active_model_name(&self) -> &str {
        self.active_model.name.as_str()
    }

    pub fn find_provider_entry(&self, provider_id: &str) -> Option<&ProviderEntry> {
        let normalized = provider_id.trim();
        if normalized.is_empty() {
            return None;
        }
        self.providers.iter().find(|entry| entry.id == normalized)
    }

    pub fn find_provider_entry_mut(&mut self, provider_id: &str) -> Option<&mut ProviderEntry> {
        let normalized = provider_id.trim();
        if normalized.is_empty() {
            return None;
        }
        self.providers
            .iter_mut()
            .find(|entry| entry.id == normalized)
    }

    pub fn find_model_entry_in_provider<'a>(
        provider: &'a ProviderEntry,
        name: &str,
    ) -> Option<&'a ModelEntry> {
        let normalized = name.trim();
        if normalized.is_empty() {
            return None;
        }
        provider
            .models
            .iter()
            .find(|model| model.name == normalized)
    }

    pub fn find_model_entry_in_provider_mut<'a>(
        provider: &'a mut ProviderEntry,
        name: &str,
    ) -> Option<&'a mut ModelEntry> {
        let normalized = name.trim();
        if normalized.is_empty() {
            return None;
        }
        provider
            .models
            .iter_mut()
            .find(|model| model.name == normalized)
    }

    pub fn resolve_model_profile(&self, model_ref: &ModelRef) -> Option<ModelProfile> {
        if model_ref.is_empty() {
            return None;
        }
        let provider = self.find_provider_entry(&model_ref.provider_id)?;
        let model = Self::find_model_entry_in_provider(provider, &model_ref.name)?;
        resolve_model_profile_from_parts(provider, model)
    }

    pub fn flatten_models(&self) -> Vec<ModelProfile> {
        let mut resolved = Vec::new();
        for provider in &self.providers {
            for model in &provider.models {
                if let Some(profile) = resolve_model_profile_from_parts(provider, model) {
                    resolved.push(profile);
                }
            }
        }
        resolved
    }

    pub fn list_all_model_refs(&self) -> Vec<ModelRef> {
        let mut refs = Vec::new();
        for provider in &self.providers {
            for model in &provider.models {
                refs.push(ModelRef {
                    provider_id: provider.id.clone(),
                    name: model.name.clone(),
                });
            }
        }
        refs
    }

    pub fn first_model_ref(&self) -> ModelRef {
        let Some(provider) = self.providers.first() else {
            return ModelRef::empty();
        };
        let Some(model) = provider.models.first() else {
            return ModelRef::empty();
        };
        ModelRef {
            provider_id: provider.id.clone(),
            name: model.name.clone(),
        }
    }

    pub fn find_model_refs_by_name(&self, name: &str) -> Vec<ModelRef> {
        let normalized = name.trim();
        if normalized.is_empty() {
            return Vec::new();
        }
        let mut refs = Vec::new();
        for provider in &self.providers {
            for model in &provider.models {
                if model.name == normalized {
                    refs.push(ModelRef {
                        provider_id: provider.id.clone(),
                        name: model.name.clone(),
                    });
                }
            }
        }
        refs
    }

    pub fn has_model_name(&self, name: &str) -> bool {
        !self.find_model_refs_by_name(name).is_empty()
    }

    pub fn parse_model_ref_selector(&self, selector: &str) -> Result<ModelRef, String> {
        let trimmed = selector.trim();
        if trimmed.is_empty() {
            return Err("model id cannot be empty".to_string());
        }
        if let Some((provider_id, name)) = trimmed.split_once("::") {
            let provider_id = provider_id.trim();
            let name = name.trim();
            if provider_id.is_empty() || name.is_empty() {
                return Err(format!("invalid model id: {}", trimmed));
            }
            let model_ref = ModelRef {
                provider_id: provider_id.to_string(),
                name: name.to_string(),
            };
            if !self.model_ref_exists(&model_ref) {
                return Err(format!("model not found: {}", trimmed));
            }
            return Ok(model_ref);
        }
        let matches = self.find_model_refs_by_name(trimmed);
        match matches.len() {
            0 => Err(format!("model not found: {}", trimmed)),
            1 => Ok(matches[0].clone()),
            _ => {
                let examples = matches
                    .iter()
                    .take(3)
                    .map(model_ref_key)
                    .collect::<Vec<_>>()
                    .join(", ");
                Err(format!(
                    "ambiguous model name; use providerId::name, e.g. {}",
                    examples
                ))
            }
        }
    }

    pub fn find_model_ref_by_name(&self, name: &str) -> Option<ModelRef> {
        let matches = self.find_model_refs_by_name(name);
        if matches.len() == 1 {
            Some(matches[0].clone())
        } else {
            None
        }
    }

    pub fn has_model_in_provider(&self, provider_id: &str, name: &str) -> bool {
        let Some(provider) = self.find_provider_entry(provider_id) else {
            return false;
        };
        Self::find_model_entry_in_provider(provider, name).is_some()
    }

    pub fn model_ref_exists(&self, model_ref: &ModelRef) -> bool {
        self.resolve_model_profile(model_ref).is_some()
    }

    pub fn active_model_profile(&self) -> Option<ModelProfile> {
        self.resolve_model_profile(&self.active_model)
    }

    pub fn has_sendable_active_model(&self) -> bool {
        self.active_model_profile()
            .is_some_and(|profile| !profile.name.trim().is_empty())
    }

    pub fn active_provider_entry_mut(&mut self) -> Option<&mut ProviderEntry> {
        let provider_id = self.active_model.provider_id.clone();
        self.find_provider_entry_mut(&provider_id)
    }

    pub fn active_model_entry_mut(&mut self) -> Option<&mut ModelEntry> {
        let provider_id = self.active_model.provider_id.clone();
        let name = self.active_model.name.clone();
        let provider = self.find_provider_entry_mut(&provider_id)?;
        Self::find_model_entry_in_provider_mut(provider, &name)
    }

    pub fn image_generation_model_profile(&self) -> Option<ModelProfile> {
        let model_ref = self.image_generation_model.as_ref()?;
        self.resolve_model_profile(model_ref)
    }

    pub fn video_generation_model_profile(&self) -> Option<ModelProfile> {
        let model_ref = self.video_generation_model.as_ref()?;
        self.resolve_model_profile(model_ref)
    }

    pub fn secondary_language_model_profile(&self) -> Option<ModelProfile> {
        let model_ref = self.secondary_language_model.as_ref()?;
        self.resolve_model_profile(model_ref)
    }

    pub fn add_model_to_provider(
        &mut self,
        provider_id: &str,
        api_base: String,
        connect: ProviderConnectDraft,
        entry: ModelEntry,
    ) {
        let normalized_provider_id = provider_id.trim().to_string();
        if let Some(provider) = self.find_provider_entry_mut(&normalized_provider_id) {
            provider.api_base = api_base;
            connect.apply_to_provider(provider);
            if !provider.models.iter().any(|model| model.name == entry.name) {
                provider.models.push(entry);
            }
            return;
        }

        let mut provider = ProviderEntry {
            id: normalized_provider_id,
            label: normalize_optional_string(connect.label.clone()),
            api_base,
            transport_kind: None,
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
            models: vec![entry],
        };
        connect.apply_to_provider(&mut provider);
        self.providers.push(provider);
    }

    pub fn remove_model(&mut self, model_ref: &ModelRef) -> bool {
        let Some(provider) = self
            .providers
            .iter_mut()
            .find(|provider| provider.id == model_ref.provider_id)
        else {
            return false;
        };
        let before = provider.models.len();
        provider.models.retain(|model| model.name != model_ref.name);
        if provider.models.len() == before {
            return false;
        }
        if provider.models.is_empty() {
            let provider_id = model_ref.provider_id.clone();
            self.providers.retain(|provider| provider.id != provider_id);
        }
        true
    }

    pub fn remove_model_by_name(&mut self, name: &str) -> bool {
        let Ok(model_ref) = self.parse_model_ref_selector(name) else {
            return false;
        };
        self.remove_model(&model_ref)
    }
}

/// Wizard-owned declarations written when connecting a provider; reconnect rewrites them
/// (an absent declaration clears the key), while everything else on the entry — `label`,
/// credential channels, flat model-level defaults, user-added models — survives. Sites /
/// billing plans / `{placeholder}` template values are already materialized into `api_base`
/// (or `headers`) by the wizard before this draft is built — they never land in config.json.
#[derive(Debug, Clone, Default)]
pub struct ProviderConnectDraft {
    /// Creation-time display name; ignored on reconnect (the user's label survives).
    pub label: Option<String>,
    pub transport_kind: Option<String>,
    pub sdk: Option<String>,
    pub headers: Option<BTreeMap<String, String>>,
    pub provider_tools: Option<Vec<Value>>,
    pub file_upload: Option<Value>,
    pub body: Option<Map<String, Value>>,
    pub thinking_switch: Option<Value>,
    pub image_api: Option<String>,
    pub video_api: Option<String>,
    pub options: Option<Map<String, Value>>,
}

impl ProviderConnectDraft {
    fn apply_to_provider(&self, provider: &mut ProviderEntry) {
        provider.transport_kind = self.transport_kind.clone();
        provider.sdk = self.sdk.clone();
        provider.headers = self.headers.clone();
        provider.provider_tools = self.provider_tools.clone();
        provider.file_upload = self.file_upload.clone();
        provider.body = self.body.clone();
        provider.thinking_switch = self.thinking_switch.clone();
        provider.image_api = self.image_api.clone();
        provider.video_api = self.video_api.clone();
        provider.options = self.options.clone();
    }
}

pub fn make_test_app_config_with_models(
    provider_id: &str,
    api_base: &str,
    model_names: &[&str],
    active_name: &str,
) -> AppConfig {
    let mut cfg = AppConfig::default();
    for name in model_names {
        cfg.add_model_to_provider(
            provider_id,
            api_base.to_string(),
            ProviderConnectDraft::default(),
            ModelEntry {
                name: (*name).to_string(),
                ..ModelEntry::default()
            },
        );
    }
    cfg.active_model = ModelRef {
        provider_id: provider_id.to_string(),
        name: active_name.to_string(),
    };
    cfg
}

pub fn config_file_path() -> PathBuf {
    spirit_data_dir().join("config.json")
}

pub fn load_config() -> Result<AppConfig> {
    let path = config_file_path();
    if !Path::new(&path).exists() {
        let cfg = AppConfig::default();
        save_config(&cfg)?;
        return Ok(cfg);
    }

    let content = fs::read_to_string(&path)
        .with_context(|| format!("Failed to read config: {}", path.display()))?;

    deserialize_config(&content, &path)
}

fn deserialize_config(content: &str, path: &Path) -> Result<AppConfig> {
    let raw: Value = serde_json::from_str(content)
        .with_context(|| format!("Failed to parse config: {}", path.display()))?;

    let version = raw.get("schemaVersion").and_then(Value::as_u64);
    if version != Some(SPIRIT_CONFIG_SCHEMA_VERSION) {
        return Err(anyhow::anyhow!(
            "config.json must be schemaVersion {}; delete the old config and reconnect the provider.",
            SPIRIT_CONFIG_SCHEMA_VERSION
        ));
    }

    let mut cfg: AppConfig = serde_json::from_value(raw)
        .with_context(|| format!("Failed to parse config: {}", path.display()))?;
    for provider in &cfg.providers {
        for model in &provider.models {
            if model.transport_kind.is_some() != model.sdk.is_some() {
                return Err(anyhow::anyhow!(
                    "model {}.{}: transportKind and sdk must be declared together",
                    provider.id,
                    model.name
                ));
            }
        }
    }
    normalize_config(&mut cfg);
    Ok(cfg)
}

pub fn save_config(cfg: &AppConfig) -> Result<()> {
    let path = config_file_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("Failed to create config directory: {}", parent.display()))?;
    }

    let content = serialize_config(cfg)?;
    fs::write(&path, content)
        .with_context(|| format!("Failed to write config: {}", path.display()))?;
    Ok(())
}

fn serialize_config(cfg: &AppConfig) -> Result<String> {
    Ok(serde_json::to_string_pretty(cfg)?)
}

fn normalize_config(cfg: &mut AppConfig) {
    cfg.schema_version = SPIRIT_CONFIG_SCHEMA_VERSION;
    cfg.networks.llm_http_version =
        crate::ports::normalize_llm_http_version(&cfg.networks.llm_http_version);
    cfg.tui = crate::ports::normalize_tui_mode(&cfg.tui);

    if cfg.providers.is_empty() || cfg.providers.iter().all(|entry| entry.models.is_empty()) {
        cfg.active_model = ModelRef::empty();
        cfg.image_generation_model = None;
        cfg.video_generation_model = None;
        cfg.secondary_language_model = None;
        return;
    }

    if !cfg.model_ref_exists(&cfg.active_model) {
        cfg.active_model = cfg.first_model_ref();
    }

    let flattened = cfg.flatten_models();
    cfg.image_generation_model = normalize_slot_model_ref(
        cfg.image_generation_model.take(),
        &flattened,
        ModelProfile::supports_image_generation,
    );
    cfg.video_generation_model = normalize_slot_model_ref(
        cfg.video_generation_model.take(),
        &flattened,
        ModelProfile::supports_video_generation,
    );
    cfg.secondary_language_model =
        normalize_secondary_language_model_ref(cfg.secondary_language_model.take(), &flattened);

    for provider in &mut cfg.providers {
        if provider.api_base.trim().is_empty() {
            provider.api_base = DEFAULT_API_BASE.to_string();
        }
    }
}

fn normalize_slot_model_ref(
    value: Option<ModelRef>,
    models: &[ModelProfile],
    predicate: impl Fn(&ModelProfile) -> bool,
) -> Option<ModelRef> {
    let model_ref = value?;
    if model_ref.is_empty() {
        return None;
    }
    let profile = models
        .iter()
        .find(|model| model.provider_id == model_ref.provider_id && model.name == model_ref.name)?;
    if predicate(profile) {
        Some(model_ref)
    } else {
        None
    }
}

fn normalize_secondary_language_model_ref(
    value: Option<ModelRef>,
    models: &[ModelProfile],
) -> Option<ModelRef> {
    let model_ref = value?;
    if model_ref.is_empty() {
        return None;
    }
    let profile = models
        .iter()
        .find(|model| model.provider_id == model_ref.provider_id && model.name == model_ref.name)?;
    if profile.supports_language_model() {
        Some(model_ref)
    } else {
        None
    }
}

fn normalize_optional_string(value: Option<String>) -> Option<String> {
    let trimmed = value?.trim().to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

fn non_blank(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

/// Reads a process env var as a credential channel source (blank = missing).
pub fn env_channel_value(name: &str) -> Option<String> {
    env::var(name).ok().and_then(|value| non_blank(&value))
}

fn keyring_entry_for_account(account: &str) -> Result<keyring::Entry> {
    keyring::Entry::new(KEYRING_SERVICE, account)
        .with_context(|| format!("Failed to initialize keyring entry: {}", account))
}

/// Internal keyring account written by the connect wizard for a provider's API key:
/// `provider::{id}`.
pub fn provider_key_account(provider_id: &str) -> String {
    format!("provider::{provider_id}")
}

/// Internal keyring account for a `credentials` slot: `provider::{id}::{slot}`
/// (the `apiKey` slot shares `provider::{id}`).
pub fn provider_slot_account(provider_id: &str, slot: &str) -> String {
    if slot == "apiKey" {
        provider_key_account(provider_id)
    } else {
        format!("provider::{provider_id}::{slot}")
    }
}

fn read_keyring_password(service: &str, account: &str) -> Option<String> {
    let entry = keyring::Entry::new(service, account).ok()?;
    entry
        .get_password()
        .ok()
        .and_then(|value| non_blank(&value))
}

/// Reads an external keyring entry referenced by `apiKeyKeyring` or a `credentials` slot.
pub fn read_external_keyring_secret(service: &str, account: &str) -> Option<String> {
    read_keyring_password(service, account)
}

/// Writes an internal keyring account; a blank value deletes the entry.
pub fn save_provider_secret(account: &str, secret: &str) -> Result<()> {
    let entry = keyring_entry_for_account(account)?;
    if secret.trim().is_empty() {
        match entry.delete_password() {
            Ok(_) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(anyhow::anyhow!(
                "Failed to delete keyring entry {account}: {err}"
            )),
        }
    } else {
        entry
            .set_password(secret.trim())
            .with_context(|| format!("Failed to save keyring entry {account}"))
    }
}

pub fn remove_provider_secret(account: &str) -> Result<()> {
    let entry = keyring_entry_for_account(account)?;
    match entry.delete_password() {
        Ok(_) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(anyhow::anyhow!(
            "Failed to delete keyring entry {account}: {err}"
        )),
    }
}

/// Writes a provider's API key to the internal keyring account `provider::{id}`.
pub fn save_provider_api_key(provider_id: &str, api_key: &str) -> Result<()> {
    save_provider_secret(&provider_key_account(provider_id), api_key)
}

/// Writes one `credentials` slot secret to `provider::{id}::{slot}`.
pub fn save_provider_slot_secret(provider_id: &str, slot: &str, secret: &str) -> Result<()> {
    save_provider_secret(&provider_slot_account(provider_id, slot), secret)
}

/// The credential channel declarations key resolution reads (flat keys + the slot map);
/// structurally shared by `ProviderEntry` and the resolved `ModelProfile`.
pub struct ProviderKeyChannels<'a> {
    pub provider_id: &'a str,
    pub api_key: Option<&'a str>,
    pub api_key_env: Option<&'a str>,
    pub api_key_keyring: Option<&'a KeyringReference>,
    pub credentials: Option<&'a BTreeMap<String, CredentialSlot>>,
}

pub fn declares_key_channel(channels: &ProviderKeyChannels<'_>) -> bool {
    channels.api_key.is_some()
        || channels.api_key_env.is_some()
        || channels.api_key_keyring.is_some()
        || channels.credentials.is_some()
}

fn resolve_slot_channels(
    slot: &CredentialSlot,
    read_env: &mut dyn FnMut(&str) -> Option<String>,
    read_keyring: &mut dyn FnMut(&str, &str) -> Option<String>,
) -> Option<String> {
    if let Some(value) = slot.value.as_deref().and_then(non_blank) {
        return Some(value);
    }
    if let Some(env_name) = &slot.env
        && let Some(value) = read_env(env_name).and_then(|value| non_blank(&value))
    {
        return Some(value);
    }
    if let Some(reference) = &slot.keyring
        && let Some(value) =
            read_keyring(&reference.service, &reference.account).and_then(|value| non_blank(&value))
    {
        return Some(value);
    }
    None
}

/// Flat single-key chain: `apiKey` → `apiKeyEnv` → `apiKeyKeyring` → `credentials.apiKey`
/// slot channels → internal keyring `provider::{id}`. Empty values fall through; the legacy
/// scopes (`group::…`, `model::…`, global `openai_api_key`) are never read. Mirrors
/// host-internal `resolveProviderApiKey`.
pub fn resolve_provider_api_key(
    channels: &ProviderKeyChannels<'_>,
    mut read_env: impl FnMut(&str) -> Option<String>,
    mut read_keyring: impl FnMut(&str, &str) -> Option<String>,
) -> Option<String> {
    if let Some(value) = channels.api_key.and_then(non_blank) {
        return Some(value);
    }
    if let Some(env_name) = channels.api_key_env
        && let Some(value) = read_env(env_name).and_then(|value| non_blank(&value))
    {
        return Some(value);
    }
    if let Some(reference) = channels.api_key_keyring
        && let Some(value) =
            read_keyring(&reference.service, &reference.account).and_then(|value| non_blank(&value))
    {
        return Some(value);
    }
    if let Some(slot) = channels.credentials.and_then(|slots| slots.get("apiKey"))
        && let Some(value) = resolve_slot_channels(slot, &mut read_env, &mut read_keyring)
    {
        return Some(value);
    }
    read_keyring(KEYRING_SERVICE, &provider_key_account(channels.provider_id))
        .and_then(|value| non_blank(&value))
}

/// `credentials` slot chain: slot `value` → `env` → `keyring` → internal keyring
/// `provider::{id}::{slot}`. Empty values fall through.
pub fn resolve_provider_credential_slot(
    channels: &ProviderKeyChannels<'_>,
    slot: &str,
    mut read_env: impl FnMut(&str) -> Option<String>,
    mut read_keyring: impl FnMut(&str, &str) -> Option<String>,
) -> Option<String> {
    if let Some(declared) = channels.credentials.and_then(|slots| slots.get(slot))
        && let Some(value) = resolve_slot_channels(declared, &mut read_env, &mut read_keyring)
    {
        return Some(value);
    }
    read_keyring(
        KEYRING_SERVICE,
        &provider_slot_account(channels.provider_id, slot),
    )
    .and_then(|value| non_blank(&value))
}

#[cfg(test)]
mod tests {
    use super::{
        AppConfig, ModelEntry, ModelRef, ModelTransportKind, PermissionRuleAction,
        ProviderConnectDraft, SPIRIT_CONFIG_SCHEMA_VERSION, deserialize_config,
        provider_key_account, provider_slot_account, resolve_cli_attribution,
        resolve_cli_web_tool_exposure, resolve_provider_api_key, resolve_provider_credential_slot,
        serialize_config,
    };
    use serde_json::{Value, json};
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::path::Path;
    use std::rc::Rc;

    fn stub_env(values: &[(&str, &str)]) -> impl FnMut(&str) -> Option<String> {
        let map: HashMap<String, String> = values
            .iter()
            .map(|(key, value)| ((*key).to_string(), (*value).to_string()))
            .collect();
        move |name: &str| map.get(name).cloned()
    }

    type KeyringReader = Box<dyn FnMut(&str, &str) -> Option<String>>;
    type KeyringQueryLog = Rc<RefCell<Vec<(String, String)>>>;

    fn stub_keyring(values: &[(&str, &str, &str)]) -> (KeyringReader, KeyringQueryLog) {
        let map: HashMap<(String, String), String> = values
            .iter()
            .map(|(service, account, value)| {
                (
                    ((*service).to_string(), (*account).to_string()),
                    (*value).to_string(),
                )
            })
            .collect();
        let queries = Rc::new(RefCell::new(Vec::new()));
        let seen = Rc::clone(&queries);
        let reader: KeyringReader = Box::new(move |service: &str, account: &str| {
            seen.borrow_mut()
                .push((service.to_string(), account.to_string()));
            map.get(&(service.to_string(), account.to_string()))
                .cloned()
        });
        (reader, queries)
    }

    fn key_channels<'a>(provider: &'a super::ProviderEntry) -> super::ProviderKeyChannels<'a> {
        provider.key_channels()
    }

    #[test]
    fn rejects_non_v1_schema_version() {
        // The v2 shape is rejected by the version gate, without migration.
        let v2 =
            r#"{"schemaVersion":2,"providerGroups":[],"activeModel":{"groupId":"","name":""}}"#;
        let err = deserialize_config(v2, Path::new("config.json")).unwrap_err();
        assert!(
            err.to_string()
                .contains(&format!("schemaVersion {SPIRIT_CONFIG_SCHEMA_VERSION}"))
        );

        let missing = r#"{"providers":[]}"#;
        assert!(deserialize_config(missing, Path::new("config.json")).is_err());

        // The pre-v2 flat v1 shape does not parse as the v1 `providers` shape either.
        let legacy_flat_v1 = r#"{"schemaVersion":1,"models":[],"activeModel":""}"#;
        assert!(deserialize_config(legacy_flat_v1, Path::new("config.json")).is_err());
    }

    #[test]
    fn parses_v1_provider_entry_full_shape() {
        let config = json!({
            "schemaVersion": 1,
            "providers": [{
                "id": "acme",
                "label": "Acme",
                "apiBase": "https://api.acme.invalid/v1",
                "transportKind": "open-responses",
                "sdk": "@ai-sdk/open-responses",
                "headers": { "X-Org-Id": "robotics" },
                "body": { "stream_options": { "include_usage": true } },
                "providerTools": [{ "label": "Web Search", "body": { "enable_search": true } }],
                "fileUpload": { "path": "/files", "refTemplate": "files://{id}" },
                "imageApi": "acme-images",
                "videoApi": "acme-videos",
                "apiKeyEnv": "ACME_API_KEY",
                "credentials": { "accessKeyId": { "env": "ACME_ACCESS_KEY_ID" } },
                "options": { "auth": "aws-sigv4", "storedState": true },
                "capabilities": ["languageModel", "image"],
                "contextLength": 262144,
                "outputLimit": 8192,
                "reasoningEffort": "default",
                "supportedReasoningEfforts": ["low", "high"],
                "reasoningMode": "standard",
                "supportedReasoningModes": ["standard", "pro"],
                "supportsThinkingType": "only",
                "supportsThinkingSwitch": true,
                "thinkingSwitch": { "on": { "body": { "thinking": { "type": "enabled" } } } },
                "serviceTiers": ["default", "fast"],
                "serviceTier": "fast",
                "models": [
                    { "name": "acme-1" },
                    {
                        "name": "acme-2",
                        "capabilities": ["languageModel", "audio"],
                        "contextLength": 1048576
                    }
                ]
            }],
            "activeModel": { "providerId": "acme", "name": "acme-1" },
            "secondaryLanguageModel": { "providerId": "acme", "name": "acme-2" }
        });
        let parsed = deserialize_config(&config.to_string(), Path::new("config.json"))
            .expect("parse config");

        let provider = &parsed.providers[0];
        assert_eq!(provider.id, "acme");
        assert_eq!(provider.label.as_deref(), Some("Acme"));
        assert_eq!(provider.sdk.as_deref(), Some("@ai-sdk/open-responses"));
        assert_eq!(
            provider
                .headers
                .as_ref()
                .and_then(|headers| headers.get("X-Org-Id"))
                .map(String::as_str),
            Some("robotics")
        );
        assert!(provider.provider_tools.is_some());
        assert!(provider.file_upload.is_some());
        assert_eq!(provider.image_api.as_deref(), Some("acme-images"));
        assert_eq!(provider.video_api.as_deref(), Some("acme-videos"));
        assert_eq!(provider.api_key_env.as_deref(), Some("ACME_API_KEY"));
        assert!(
            provider
                .credentials
                .as_ref()
                .is_some_and(|slots| slots.contains_key("accessKeyId"))
        );

        let profile = parsed.active_model_profile().expect("active model");
        assert_eq!(profile.provider_id, "acme");
        assert_eq!(profile.api_base, "https://api.acme.invalid/v1");
        assert_eq!(profile.transport_kind(), ModelTransportKind::OpenResponses);
        // Provider-level flat declarations inherit onto the model.
        assert_eq!(profile.context_length, Some(262144));
        assert_eq!(profile.output_limit, Some(8192));
        assert_eq!(profile.service_tier.as_deref(), Some("fast"));
        assert_eq!(
            profile.capabilities.as_deref(),
            Some(&["languageModel".to_string(), "image".to_string()][..])
        );
        assert!(profile.supports_language_model());
        assert!(!profile.supports_image_generation());
        assert!(profile.options_auth_aws_sigv4());

        // A model-level explicit declaration wins over the provider default.
        let secondary = parsed
            .secondary_language_model_profile()
            .expect("secondary model");
        assert_eq!(secondary.context_length, Some(1048576));
        assert_eq!(secondary.output_limit, Some(8192));
        assert_eq!(
            secondary.capabilities.as_deref(),
            Some(&["languageModel".to_string(), "audio".to_string()][..])
        );

        let serialized = serialize_config(&parsed).expect("serialize config");
        let value: Value = serde_json::from_str(&serialized).expect("json value");
        let entry = &value["providers"][0];
        assert_eq!(entry["sdk"], json!("@ai-sdk/open-responses"));
        assert_eq!(
            entry["providerTools"][0]["body"]["enable_search"],
            json!(true)
        );
        assert_eq!(entry["fileUpload"]["refTemplate"], json!("files://{id}"));
        assert_eq!(entry["options"]["auth"], json!("aws-sigv4"));
        assert_eq!(
            entry["thinkingSwitch"]["on"]["body"]["thinking"]["type"],
            json!("enabled")
        );
        assert_eq!(entry["serviceTiers"], json!(["default", "fast"]));
        assert_eq!(value["activeModel"]["providerId"], json!("acme"));
        assert!(value.get("providerGroups").is_none());
    }

    #[test]
    fn transport_kind_comes_from_the_declaration_only() {
        // Vendor-keyed transport inference is gone: an entry without transportKind is
        // openai-compatible regardless of its id.
        let config = r#"{
          "schemaVersion": 1,
          "providers": [
            { "id": "openai", "apiBase": "https://api.openai.com/v1", "models": [{ "name": "gpt-4o-mini" }] },
            { "id": "minimax", "apiBase": "https://api.minimax.io/anthropic/v1", "transportKind": "anthropic", "models": [{ "name": "minimax-m3" }] }
          ],
          "activeModel": { "providerId": "openai", "name": "gpt-4o-mini" }
        }"#;
        let parsed = deserialize_config(config, Path::new("config.json")).expect("parse config");
        let active = parsed.active_model_profile().expect("active model");
        assert_eq!(
            active.transport_kind(),
            ModelTransportKind::OpenAiCompatible
        );

        let minimax = parsed
            .resolve_model_profile(&ModelRef {
                provider_id: "minimax".to_string(),
                name: "minimax-m3".to_string(),
            })
            .expect("minimax model");
        assert_eq!(minimax.transport_kind(), ModelTransportKind::Anthropic);
    }

    #[test]
    fn model_transport_override_preserves_provider_connection_and_requires_a_pair() {
        let config = r#"{
          "schemaVersion": 1,
          "providers": [{
            "id": "openrouter",
            "apiBase": "https://openrouter.ai/api/v1",
            "transportKind": "openai-compatible",
            "sdk": "@ai-sdk/openai-compatible",
            "models": [{
              "name": "anthropic/claude-opus-4.5",
              "transportKind": "anthropic",
              "sdk": "@ai-sdk/anthropic"
            }]
          }],
          "activeModel": { "providerId": "openrouter", "name": "anthropic/claude-opus-4.5" }
        }"#;
        let parsed = deserialize_config(config, Path::new("config.json")).expect("parse config");
        let active = parsed.active_model_profile().expect("active model");
        assert_eq!(active.transport_kind(), ModelTransportKind::Anthropic);
        assert_eq!(active.sdk.as_deref(), Some("@ai-sdk/anthropic"));
        assert_eq!(active.api_base, "https://openrouter.ai/api/v1");

        let without_sdk = config.replace(
            r#""transportKind": "anthropic",
              "sdk": "@ai-sdk/anthropic""#,
            r#""transportKind": "anthropic""#,
        );
        let error = deserialize_config(&without_sdk, Path::new("config.json")).unwrap_err();
        assert!(error.to_string().contains("must be declared together"));
    }

    #[test]
    fn reasoning_declarations_pass_through_without_vendor_clamping() {
        // The old per-vendor normalization tables are gone: declared values round-trip
        // verbatim; wire-level omission of "default" is the transport's job.
        let config = r#"{
          "schemaVersion": 1,
          "providers": [{
            "id": "custom",
            "apiBase": "https://example.invalid/v1",
            "models": [
              { "name": "m-min", "reasoningEffort": "minimal" },
              { "name": "m-max", "reasoningEffort": "max", "reasoningMode": "pro" }
            ]
          }],
          "activeModel": { "providerId": "custom", "name": "m-min" }
        }"#;
        let parsed = deserialize_config(config, Path::new("config.json")).expect("parse config");
        let active = parsed.active_model_profile().expect("active model");
        assert_eq!(active.reasoning_effort.as_deref(), Some("minimal"));
        let max = parsed
            .resolve_model_profile(&ModelRef {
                provider_id: "custom".to_string(),
                name: "m-max".to_string(),
            })
            .expect("m-max");
        assert_eq!(max.reasoning_effort.as_deref(), Some("max"));
        assert_eq!(max.reasoning_mode.as_deref(), Some("pro"));
    }

    #[test]
    fn image_generation_model_requires_declared_capability() {
        let config = r#"{
    "schemaVersion": 1,
    "providers": [
        {
            "id": "custom",
            "apiBase": "https://example.invalid/v1",
            "models": [
                { "name": "chat-model", "capabilities": ["languageModel"] },
                { "name": "image-model", "capabilities": ["imageGeneration"] }
            ]
        }
    ],
    "activeModel": { "providerId": "custom", "name": "chat-model" },
    "imageGenerationModel": { "providerId": "custom", "name": "image-model" }
}
"#;

        let parsed = deserialize_config(config, Path::new("config.json")).expect("parse config");
        assert_eq!(
            parsed.image_generation_model,
            Some(ModelRef {
                provider_id: "custom".to_string(),
                name: "image-model".to_string(),
            })
        );

        let invalid = config.replace("image-model\"", "chat-model\"");
        let parsed = deserialize_config(&invalid, Path::new("config.json")).expect("parse config");
        assert_eq!(parsed.image_generation_model, None);
    }

    #[test]
    fn video_generation_model_requires_declared_capability() {
        let config = r#"{
    "schemaVersion": 1,
    "providers": [
        {
            "id": "custom",
            "apiBase": "https://example.invalid/v1",
            "models": [
                { "name": "chat-model", "capabilities": ["languageModel"] },
                { "name": "video-model", "capabilities": ["videoGeneration"] }
            ]
        }
    ],
    "activeModel": { "providerId": "custom", "name": "chat-model" },
    "videoGenerationModel": { "providerId": "custom", "name": "video-model" }
}
"#;

        let parsed = deserialize_config(config, Path::new("config.json")).expect("parse config");
        assert_eq!(
            parsed.video_generation_model,
            Some(ModelRef {
                provider_id: "custom".to_string(),
                name: "video-model".to_string(),
            })
        );

        let invalid = config.replace("video-model\"", "chat-model\"");
        let parsed = deserialize_config(&invalid, Path::new("config.json")).expect("parse config");
        assert_eq!(parsed.video_generation_model, None);
    }

    #[test]
    fn preserves_unknown_top_level_fields() {
        let config = r#"
{
  "schemaVersion": 1,
  "providers": [
    {
      "id": "custom",
      "apiBase": "https://example.invalid/v1",
      "models": [
        {
          "name": "agent-test-model",
          "reasoningEffort": "minimal"
        }
      ]
    }
  ],
  "activeModel": { "providerId": "custom", "name": "agent-test-model" },
  "imageGenerationModel": { "providerId": "custom", "name": "agent-test-model" },
  "uiLocale": "zh-CN",
  "translucency": true,
  "recentWorkspaces": ["D:/Spirit", "D:/Other"],
  "dreams": {
    "enabled": true,
    "collectorModel": "collector-test-model",
    "debugMode": true
  }
}
"#;

        let parsed = deserialize_config(config, Path::new("config.json")).expect("parse config");
        let serialized = serialize_config(&parsed).expect("serialize config");
        let json: Value = serde_json::from_str(&serialized).expect("json value");

        assert_eq!(
            json.get("translucency").and_then(Value::as_bool),
            Some(true)
        );
        assert_eq!(
            json.get("recentWorkspaces")
                .and_then(Value::as_array)
                .map(|items| items.len()),
            Some(2)
        );
        assert_eq!(
            json.get("dreams")
                .and_then(|dreams| dreams.get("collectorModel"))
                .and_then(Value::as_str),
            Some("collector-test-model")
        );
        // Declared reasoning effort round-trips verbatim (no vendor normalization).
        assert_eq!(
            json.get("providers")
                .and_then(Value::as_array)
                .and_then(|providers| providers.first())
                .and_then(|provider| provider.get("models"))
                .and_then(Value::as_array)
                .and_then(|models| models.first())
                .and_then(|model| model.get("reasoningEffort"))
                .and_then(Value::as_str),
            Some("minimal")
        );
        // The model declares no imageGeneration capability, so the slot is cleared.
        assert_eq!(parsed.image_generation_model, None);
    }

    #[test]
    fn normalizing_empty_providers_keeps_unknown_desktop_fields() {
        let config = r#"
{
  "schemaVersion": 1,
  "providers": [],
  "activeModel": { "providerId": "", "name": "" },
  "translucency": false,
  "dreams": {
    "enabled": true,
    "debugMode": false
  }
}
"#;

        let parsed = deserialize_config(config, Path::new("config.json")).expect("parse config");
        let serialized = serialize_config(&parsed).expect("serialize config");
        let json: Value = serde_json::from_str(&serialized).expect("json value");

        assert_eq!(
            json.get("translucency").and_then(Value::as_bool),
            Some(false)
        );
        assert_eq!(
            json.get("dreams")
                .and_then(|dreams| dreams.get("enabled"))
                .and_then(Value::as_bool),
            Some(true)
        );
        assert_eq!(
            json.get("providers")
                .and_then(Value::as_array)
                .map(Vec::len),
            Some(0)
        );
        assert_eq!(
            json.get("activeModel")
                .and_then(|active| active.get("name"))
                .and_then(Value::as_str),
            Some("")
        );
    }

    #[test]
    fn cli_attribution_defaults_off_when_missing() {
        let config = r#"
{
  "schemaVersion": 1,
  "providers": [],
  "activeModel": { "providerId": "", "name": "" }
}
"#;
        let parsed = deserialize_config(config, Path::new("config.json")).expect("parse config");
        assert_eq!(resolve_cli_attribution(&parsed), (false, false));
        assert!(parsed.agents.attribution.is_none());
    }

    #[test]
    fn cli_attribution_honors_explicit_enabled() {
        let config = r#"
{
  "schemaVersion": 1,
  "providers": [],
  "activeModel": { "providerId": "", "name": "" },
  "agents": {
    "attribution": {
      "commit": { "enabled": true },
      "pr": { "enabled": false }
    }
  }
}
"#;
        let parsed = deserialize_config(config, Path::new("config.json")).expect("parse config");
        assert_eq!(resolve_cli_attribution(&parsed), (true, false));

        let serialized = serialize_config(&parsed).expect("serialize config");
        let json: Value = serde_json::from_str(&serialized).expect("json value");
        assert_eq!(
            json.pointer("/agents/attribution/commit/enabled")
                .and_then(Value::as_bool),
            Some(true)
        );
        assert_eq!(
            json.pointer("/agents/attribution/pr/enabled")
                .and_then(Value::as_bool),
            Some(false)
        );
    }

    #[test]
    fn cli_web_tool_exposure_defaults_on_when_missing() {
        let config = r#"
{
  "schemaVersion": 1,
  "providers": [],
  "activeModel": { "providerId": "", "name": "" }
}
"#;
        let parsed = deserialize_config(config, Path::new("config.json")).expect("parse config");
        assert_eq!(resolve_cli_web_tool_exposure(&parsed), (true, true));
        assert!(parsed.agents.provider_tools.is_none());
        assert!(parsed.agents.web_fetch.is_none());
    }

    #[test]
    fn cli_web_tool_exposure_reads_provider_tools_toggle() {
        let config = r#"
{
  "schemaVersion": 1,
  "providers": [],
  "activeModel": { "providerId": "", "name": "" },
  "agents": {
    "providerTools": { "enabled": false },
    "webFetch": { "enabled": true }
  }
}
"#;
        let parsed = deserialize_config(config, Path::new("config.json")).expect("parse config");
        assert_eq!(resolve_cli_web_tool_exposure(&parsed), (false, true));

        let serialized = serialize_config(&parsed).expect("serialize config");
        let json: Value = serde_json::from_str(&serialized).expect("json value");
        assert_eq!(
            json.pointer("/agents/providerTools/enabled")
                .and_then(Value::as_bool),
            Some(false)
        );
        assert_eq!(
            json.pointer("/agents/webFetch/enabled")
                .and_then(Value::as_bool),
            Some(true)
        );
    }

    #[test]
    fn tui_mode_defaults_to_inline_when_omitted() {
        let config = r#"
{
  "schemaVersion": 1,
  "providers": [],
  "activeModel": { "providerId": "", "name": "" }
}
"#;
        let parsed = deserialize_config(config, Path::new("config.json")).expect("parse config");
        assert_eq!(parsed.tui, "inline");
    }

    #[test]
    fn tui_mode_normalizes_unknown_to_inline() {
        let config = r#"
{
  "schemaVersion": 1,
  "providers": [],
  "activeModel": { "providerId": "", "name": "" },
  "tui": "mini"
}
"#;
        let parsed = deserialize_config(config, Path::new("config.json")).expect("parse config");
        assert_eq!(parsed.tui, "inline");
    }

    #[test]
    fn tui_mode_preserves_fullscreen() {
        let config = r#"
{
  "schemaVersion": 1,
  "providers": [],
  "activeModel": { "providerId": "", "name": "" },
  "tui": "fullscreen"
}
"#;
        let parsed = deserialize_config(config, Path::new("config.json")).expect("parse config");
        assert_eq!(parsed.tui, "fullscreen");
        let json: Value =
            serde_json::from_str(&serialize_config(&parsed).expect("serialize")).expect("json");
        assert_eq!(json.get("tui").and_then(Value::as_str), Some("fullscreen"));
    }

    #[test]
    fn deserializes_permission_config_and_round_trips() {
        let raw = r#"{
          "schemaVersion": 1,
          "providers": [],
          "activeModel": { "providerId": "g", "name": "m" },
          "permission": {
            "shell": { "git push *": "ask", "rm -rf /": "deny" },
            "read_file": { "~/.ssh/**": "deny", "src/**": "allow" }
          }
        }"#;
        let parsed = deserialize_config(raw, Path::new("config.json")).expect("parse config");
        let permission = parsed.permission.as_ref().expect("permission config");
        assert_eq!(
            permission
                .shell
                .as_ref()
                .and_then(|rules| rules.get("git push *")),
            Some(&PermissionRuleAction::Ask)
        );
        assert_eq!(
            permission
                .read_file
                .as_ref()
                .and_then(|rules| rules.get("src/**")),
            Some(&PermissionRuleAction::Allow)
        );

        let serialized = serde_json::to_value(&parsed).expect("serialize config");
        assert_eq!(
            serialized["permission"]["shell"]["rm -rf /"],
            serde_json::json!("deny")
        );
        assert_eq!(
            serialized["permission"]["read_file"]["~/.ssh/**"],
            serde_json::json!("deny")
        );
    }

    #[test]
    fn provider_keyring_accounts_follow_the_v1_scheme() {
        assert_eq!(provider_key_account("acme"), "provider::acme");
        assert_eq!(provider_slot_account("acme", "apiKey"), "provider::acme");
        assert_eq!(
            provider_slot_account("acme", "accessKeyId"),
            "provider::acme::accessKeyId"
        );
    }

    #[test]
    fn api_key_resolution_prefers_flat_value() {
        let provider: super::ProviderEntry = serde_json::from_value(json!({
            "id": "acme",
            "apiBase": "https://api.acme.invalid/v1",
            "apiKey": "declared-key",
            "apiKeyEnv": "ACME_API_KEY",
            "models": []
        }))
        .expect("parse provider");
        let (read_keyring, queries) = stub_keyring(&[("Spirit", "provider::acme", "internal")]);
        let resolved = resolve_provider_api_key(
            &key_channels(&provider),
            stub_env(&[("ACME_API_KEY", "env-key")]),
            read_keyring,
        );
        assert_eq!(resolved.as_deref(), Some("declared-key"));
        // A flat `apiKey` short-circuits before env / keyring channels are read.
        assert!(queries.borrow().is_empty());
    }

    #[test]
    fn api_key_resolution_falls_through_empty_values() {
        let provider: super::ProviderEntry = serde_json::from_value(json!({
            "id": "acme",
            "apiBase": "https://api.acme.invalid/v1",
            "apiKey": "   ",
            "apiKeyEnv": "ACME_API_KEY",
            "models": []
        }))
        .expect("parse provider");
        let (read_keyring, _) = stub_keyring(&[]);
        let resolved = resolve_provider_api_key(
            &key_channels(&provider),
            stub_env(&[("ACME_API_KEY", "env-key")]),
            read_keyring,
        );
        assert_eq!(resolved.as_deref(), Some("env-key"));
    }

    #[test]
    fn api_key_resolution_orders_env_keyring_then_internal() {
        let provider: super::ProviderEntry = serde_json::from_value(json!({
            "id": "acme",
            "apiBase": "https://api.acme.invalid/v1",
            "apiKeyEnv": "ACME_MISSING",
            "apiKeyKeyring": { "service": "Vault", "account": "acme-prod" },
            "models": []
        }))
        .expect("parse provider");
        let (read_keyring, queries) = stub_keyring(&[("Vault", "acme-prod", "external-key")]);
        let resolved =
            resolve_provider_api_key(&key_channels(&provider), stub_env(&[]), read_keyring);
        assert_eq!(resolved.as_deref(), Some("external-key"));
        // The env channel missed, then the external keyring hit; the internal fallback is unread.
        assert_eq!(
            queries.borrow().as_slice(),
            &[("Vault".to_string(), "acme-prod".to_string())]
        );

        let (read_keyring, queries) = stub_keyring(&[("Spirit", "provider::acme", "internal-key")]);
        let resolved =
            resolve_provider_api_key(&key_channels(&provider), stub_env(&[]), read_keyring);
        assert_eq!(resolved.as_deref(), Some("internal-key"));
        assert_eq!(
            queries.borrow().as_slice(),
            &[
                ("Vault".to_string(), "acme-prod".to_string()),
                ("Spirit".to_string(), "provider::acme".to_string()),
            ]
        );
    }

    #[test]
    fn api_key_resolution_reads_credentials_slot_before_internal_keyring() {
        let provider: super::ProviderEntry = serde_json::from_value(json!({
            "id": "acme",
            "apiBase": "https://api.acme.invalid/v1",
            "credentials": { "apiKey": { "env": "ACME_SLOT_KEY" } },
            "models": []
        }))
        .expect("parse provider");
        let (read_keyring, _) = stub_keyring(&[]);
        let resolved = resolve_provider_api_key(
            &key_channels(&provider),
            stub_env(&[("ACME_SLOT_KEY", "slot-key")]),
            read_keyring,
        );
        assert_eq!(resolved.as_deref(), Some("slot-key"));
    }

    #[test]
    fn api_key_resolution_never_reads_legacy_keyring_scopes() {
        let provider: super::ProviderEntry = serde_json::from_value(json!({
            "id": "acme",
            "apiBase": "https://api.acme.invalid/v1",
            "models": [{ "name": "m" }]
        }))
        .expect("parse provider");
        // Legacy v2 scopes still present in the user's keychain are not read anymore.
        let (read_keyring, queries) = stub_keyring(&[
            ("Spirit", "group::acme", "legacy-group-key"),
            ("Spirit", "model::m", "legacy-model-key"),
            ("Spirit", "openai_api_key", "legacy-global-key"),
        ]);
        let resolved =
            resolve_provider_api_key(&key_channels(&provider), stub_env(&[]), read_keyring);
        assert_eq!(resolved, None);
        assert_eq!(
            queries.borrow().as_slice(),
            &[("Spirit".to_string(), "provider::acme".to_string())]
        );
    }

    #[test]
    fn credential_slot_resolution_chains_value_env_keyring_internal() {
        let provider: super::ProviderEntry = serde_json::from_value(json!({
            "id": "acme",
            "apiBase": "https://api.acme.invalid/v1",
            "credentials": {
                "accessKeyId": { "value": " AKID " },
                "secretAccessKey": { "env": "ACME_SECRET" }
            },
            "models": []
        }))
        .expect("parse provider");
        let (read_keyring, _) = stub_keyring(&[]);
        let channels = key_channels(&provider);

        // `value` wins verbatim (trimmed).
        let resolved =
            resolve_provider_credential_slot(&channels, "accessKeyId", stub_env(&[]), read_keyring);
        assert_eq!(resolved.as_deref(), Some("AKID"));

        let (read_keyring, _) = stub_keyring(&[]);
        let resolved = resolve_provider_credential_slot(
            &channels,
            "secretAccessKey",
            stub_env(&[("ACME_SECRET", "secret")]),
            read_keyring,
        );
        assert_eq!(resolved.as_deref(), Some("secret"));

        // An undeclared slot falls back to the internal keyring account provider::{id}::{slot}.
        let (read_keyring, queries) = stub_keyring(&[(
            "Spirit",
            "provider::acme::clientEmail",
            "sa@example.invalid",
        )]);
        let resolved =
            resolve_provider_credential_slot(&channels, "clientEmail", stub_env(&[]), read_keyring);
        assert_eq!(resolved.as_deref(), Some("sa@example.invalid"));
        assert_eq!(
            queries.borrow().as_slice(),
            &[(
                "Spirit".to_string(),
                "provider::acme::clientEmail".to_string()
            )]
        );
    }

    #[test]
    fn add_model_to_provider_applies_reconnect_reset_semantics() {
        let mut cfg = AppConfig::default();
        let connect = ProviderConnectDraft {
            label: Some("Acme".to_string()),
            sdk: Some("@ai-sdk/openai-compatible".to_string()),
            provider_tools: Some(vec![json!({ "label": "Web Search" })]),
            ..ProviderConnectDraft::default()
        };
        cfg.add_model_to_provider(
            "acme",
            "https://api.acme.invalid/v1".to_string(),
            connect,
            ModelEntry {
                name: "acme-1".to_string(),
                ..ModelEntry::default()
            },
        );
        let provider = &cfg.providers[0];
        assert_eq!(provider.label.as_deref(), Some("Acme"));
        assert!(provider.provider_tools.is_some());

        // Reconnect: wizard-owned keys are rewritten (absent declarations clear them),
        // the user-visible label and hand-added models survive.
        cfg.providers[0].label = Some("My Acme".to_string());
        cfg.add_model_to_provider(
            "acme",
            "https://api2.acme.invalid/v1".to_string(),
            ProviderConnectDraft::default(),
            ModelEntry {
                name: "acme-2".to_string(),
                ..ModelEntry::default()
            },
        );
        let provider = &cfg.providers[0];
        assert_eq!(provider.api_base, "https://api2.acme.invalid/v1");
        assert_eq!(provider.label.as_deref(), Some("My Acme"));
        assert!(provider.sdk.is_none());
        assert!(provider.provider_tools.is_none());
        assert_eq!(provider.models.len(), 2);
    }

    #[test]
    fn active_model_profile_merges_provider_and_model_entry() {
        let mut cfg = AppConfig::default();
        cfg.add_model_to_provider(
            "acme",
            "https://api.acme.invalid/v1".to_string(),
            ProviderConnectDraft {
                transport_kind: Some("open-responses".to_string()),
                ..ProviderConnectDraft::default()
            },
            ModelEntry {
                name: "acme-1".to_string(),
                reasoning_effort: Some("medium".to_string()),
                capabilities: Some(vec!["languageModel".to_string()]),
                ..ModelEntry::default()
            },
        );
        cfg.active_model = ModelRef {
            provider_id: "acme".to_string(),
            name: "acme-1".to_string(),
        };
        let active = cfg.active_model_profile().expect("active model");
        assert_eq!(active.provider_id, "acme");
        assert_eq!(active.name, "acme-1");
        assert_eq!(active.api_base, "https://api.acme.invalid/v1");
        assert_eq!(active.transport_kind(), ModelTransportKind::OpenResponses);
    }

    #[test]
    fn has_sendable_active_model_is_false_without_a_profile() {
        let cfg = AppConfig::default();
        assert!(!cfg.has_sendable_active_model());
    }

    #[test]
    fn has_sendable_active_model_is_true_with_a_named_profile() {
        let mut cfg = AppConfig::default();
        cfg.add_model_to_provider(
            "acme",
            "https://api.acme.invalid/v1".to_string(),
            ProviderConnectDraft::default(),
            ModelEntry {
                name: "acme-1".to_string(),
                capabilities: Some(vec!["languageModel".to_string()]),
                ..ModelEntry::default()
            },
        );
        cfg.active_model = ModelRef {
            provider_id: "acme".to_string(),
            name: "acme-1".to_string(),
        };
        assert!(cfg.has_sendable_active_model());
    }
}
