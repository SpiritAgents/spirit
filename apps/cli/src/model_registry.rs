use crate::mcp::spirit_data_dir;
use anyhow::Result;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::{
    collections::{BTreeMap, HashMap},
    path::PathBuf,
    str::FromStr,
};

pub const DEFAULT_API_BASE: &str = "https://api.openai.com/v1";
pub const SPIRIT_CONFIG_SCHEMA_VERSION: u64 = 1;

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
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
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
}

pub fn make_test_app_config_with_models(
    provider_id: &str,
    api_base: &str,
    model_names: &[&str],
    active_name: &str,
) -> AppConfig {
    AppConfig {
        providers: vec![ProviderEntry {
            id: provider_id.to_string(),
            api_base: api_base.to_string(),
            models: model_names
                .iter()
                .map(|name| ModelEntry {
                    name: (*name).to_string(),
                    ..ModelEntry::default()
                })
                .collect(),
            ..ProviderEntry::default()
        }],
        active_model: ModelRef {
            provider_id: provider_id.to_string(),
            name: active_name.to_string(),
        },
        ..AppConfig::default()
    }
}

pub fn config_file_path() -> PathBuf {
    spirit_data_dir().join("config.json")
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderKeyChannels<'a> {
    pub provider_id: &'a str,
    pub api_key: Option<&'a str>,
    pub api_key_env: Option<&'a str>,
    pub api_key_keyring: Option<&'a KeyringReference>,
    pub credentials: Option<&'a BTreeMap<String, CredentialSlot>>,
}
