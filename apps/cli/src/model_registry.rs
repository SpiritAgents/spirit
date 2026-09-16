use crate::mcp::spirit_data_dir;
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::{
    collections::HashMap,
    env, fs,
    path::{Path, PathBuf},
    str::FromStr,
};

pub const DEFAULT_API_BASE: &str = "https://api.openai.com/v1";
pub const SPIRIT_CONFIG_SCHEMA_VERSION: u64 = 2;
const ENV_API_KEY: &str = "SPIRIT_API_KEY";
const KEYRING_SERVICE: &str = "Spirit";
const KEYRING_ACCOUNT_API_KEY: &str = "openai_api_key";

/// Aligned with Desktop `DesktopModelProvider` and the `provider` field in `config.json`.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ModelProvider {
    Deepseek,
    Xai,
    #[serde(rename = "moonshot-ai")]
    Moonshot,
    #[serde(rename = "kimi-code")]
    KimiCode,
    #[serde(rename = "z-ai")]
    ZAi,
    #[serde(rename = "zhipu-ai")]
    ZhipuAi,
    Minimax,
    Xiaomi,
    Siliconflow,
    Stepfun,
    Alibaba,
    Anthropic,
    #[serde(rename = "vercel-ai-gateway", alias = "vercelaigateway")]
    VercelAiGateway,
    #[serde(rename = "cloudflare-ai-gateway", alias = "cloudflareaigateway")]
    CloudflareAiGateway,
    Openrouter,
    #[serde(rename = "fireworks-ai")]
    FireworksAi,
    #[serde(rename = "together-ai")]
    TogetherAi,
    Groq,
    Deepinfra,
    #[serde(rename = "hugging-face")]
    HuggingFace,
    Baseten,
    Openai,
    Google,
    #[serde(rename = "google-vertex-ai")]
    GoogleVertexAi,
    Volcengine,
    Byteplus,
    Meituan,
    #[serde(rename = "tencent-tokenhub")]
    TencentTokenhub,
    Mistral,
    #[serde(rename = "cohere")]
    Cohere,
    #[serde(rename = "amazon-bedrock")]
    AmazonBedrock,
    Azure,
    Custom,
}

impl ModelProvider {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Deepseek => "deepseek",
            Self::Xai => "xai",
            Self::Moonshot => "moonshot-ai",
            Self::KimiCode => "kimi-code",
            Self::ZAi => "z-ai",
            Self::ZhipuAi => "zhipu-ai",
            Self::Minimax => "minimax",
            Self::Xiaomi => "xiaomi",
            Self::Siliconflow => "siliconflow",
            Self::Stepfun => "stepfun",
            Self::Alibaba => "alibaba",
            Self::Anthropic => "anthropic",
            Self::VercelAiGateway => "vercel-ai-gateway",
            Self::CloudflareAiGateway => "cloudflare-ai-gateway",
            Self::Openrouter => "openrouter",
            Self::FireworksAi => "fireworks-ai",
            Self::TogetherAi => "together-ai",
            Self::Groq => "groq",
            Self::Deepinfra => "deepinfra",
            Self::HuggingFace => "hugging-face",
            Self::Baseten => "baseten",
            Self::Openai => "openai",
            Self::Google => "google",
            Self::GoogleVertexAi => "google-vertex-ai",
            Self::Volcengine => "volcengine",
            Self::Byteplus => "byteplus",
            Self::Meituan => "meituan",
            Self::TencentTokenhub => "tencent-tokenhub",
            Self::Mistral => "mistral",
            Self::Cohere => "cohere",
            Self::AmazonBedrock => "amazon-bedrock",
            Self::Azure => "azure",
            Self::Custom => "custom",
        }
    }
}

impl FromStr for ModelProvider {
    type Err = String;

    fn from_str(value: &str) -> std::result::Result<Self, Self::Err> {
        match value.trim().to_ascii_lowercase().as_str() {
            "deepseek" => Ok(Self::Deepseek),
            "xai" => Ok(Self::Xai),
            "moonshot-ai" => Ok(Self::Moonshot),
            "kimi-code" => Ok(Self::KimiCode),
            "z-ai" => Ok(Self::ZAi),
            "zhipu-ai" => Ok(Self::ZhipuAi),
            "minimax" => Ok(Self::Minimax),
            "xiaomi" => Ok(Self::Xiaomi),
            "siliconflow" => Ok(Self::Siliconflow),
            "stepfun" => Ok(Self::Stepfun),
            "alibaba" => Ok(Self::Alibaba),
            "anthropic" => Ok(Self::Anthropic),
            "vercel-ai-gateway" => Ok(Self::VercelAiGateway),
            "cloudflare-ai-gateway" => Ok(Self::CloudflareAiGateway),
            "openrouter" => Ok(Self::Openrouter),
            "fireworks-ai" => Ok(Self::FireworksAi),
            "together-ai" => Ok(Self::TogetherAi),
            "groq" => Ok(Self::Groq),
            "deepinfra" => Ok(Self::Deepinfra),
            "hugging-face" => Ok(Self::HuggingFace),
            "baseten" => Ok(Self::Baseten),
            "openai" => Ok(Self::Openai),
            "google" => Ok(Self::Google),
            "google-vertex-ai" => Ok(Self::GoogleVertexAi),
            "volcengine" => Ok(Self::Volcengine),
            "byteplus" => Ok(Self::Byteplus),
            "meituan" => Ok(Self::Meituan),
            "tencent-tokenhub" => Ok(Self::TencentTokenhub),
            "mistral" => Ok(Self::Mistral),
            "cohere" => Ok(Self::Cohere),
            "amazon-bedrock" => Ok(Self::AmazonBedrock),
            "azure" => Ok(Self::Azure),
            "custom" => Ok(Self::Custom),
            other => Err(format!("Unsupported provider: {other}")),
        }
    }
}

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
    #[serde(rename = "groupId", alias = "group_id")]
    pub group_id: String,
    pub name: String,
}

impl ModelRef {
    pub fn empty() -> Self {
        Self {
            group_id: String::new(),
            name: String::new(),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.group_id.trim().is_empty() || self.name.trim().is_empty()
    }
}

pub fn model_refs_equal(a: &ModelRef, b: &ModelRef) -> bool {
    a.group_id == b.group_id && a.name == b.name
}

pub fn model_ref_key(model_ref: &ModelRef) -> String {
    format!("{}::{}", model_ref.group_id, model_ref.name)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelEntry {
    pub name: String,
    #[serde(
        rename = "reasoningEffort",
        alias = "reasoning_effort",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub reasoning_effort: Option<String>,
    #[serde(
        rename = "reasoningMode",
        alias = "reasoning_mode",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub reasoning_mode: Option<String>,
    #[serde(
        rename = "thinkingEnabled",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub thinking_enabled: Option<bool>,
    #[serde(
        rename = "supportedReasoningEfforts",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub supported_reasoning_efforts: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<Vec<String>>,
    #[serde(
        rename = "contextLength",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub context_length: Option<u64>,
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderGroup {
    pub id: String,
    pub provider: ModelProvider,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(rename = "apiBase", alias = "api_base")]
    pub api_base: String,
    #[serde(
        rename = "transportKind",
        alias = "transport_kind",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub transport_kind: Option<String>,
    #[serde(
        rename = "providerSite",
        alias = "provider_site",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub provider_site: Option<String>,
    #[serde(
        rename = "alibabaWorkspaceId",
        alias = "alibaba_workspace_id",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub alibaba_workspace_id: Option<String>,
    #[serde(
        rename = "alibabaBillingMode",
        alias = "alibaba_billing_mode",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub alibaba_billing_mode: Option<String>,
    #[serde(
        rename = "stepfunBillingMode",
        alias = "stepfun_billing_mode",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub stepfun_billing_mode: Option<String>,
    #[serde(
        rename = "zAiBillingMode",
        alias = "z_ai_billing_mode",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub z_ai_billing_mode: Option<String>,
    #[serde(
        rename = "zhipuBillingMode",
        alias = "zhipu_billing_mode",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub zhipu_billing_mode: Option<String>,
    #[serde(
        rename = "awsRegion",
        alias = "aws_region",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub aws_region: Option<String>,
    #[serde(
        rename = "azureResourceName",
        alias = "azure_resource_name",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub azure_resource_name: Option<String>,
    #[serde(
        rename = "cloudflareAccountId",
        alias = "cloudflare_account_id",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub cloudflare_account_id: Option<String>,
    #[serde(
        rename = "cloudflareGatewayId",
        alias = "cloudflare_gateway_id",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub cloudflare_gateway_id: Option<String>,
    #[serde(
        rename = "vertexProject",
        alias = "vertex_project",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub vertex_project: Option<String>,
    #[serde(
        rename = "vertexLocation",
        alias = "vertex_location",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub vertex_location: Option<String>,
    pub models: Vec<ModelEntry>,
}

/// Resolved model profile: provider group connect fields merged with a model entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelProfile {
    #[serde(
        rename = "groupId",
        alias = "group_id",
        default,
        skip_serializing_if = "String::is_empty"
    )]
    pub group_id: String,
    pub name: String,
    #[serde(rename = "apiBase", alias = "api_base")]
    pub api_base: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider: Option<ModelProvider>,
    #[serde(
        rename = "reasoningEffort",
        alias = "reasoning_effort",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub reasoning_effort: Option<String>,
    #[serde(
        rename = "reasoningMode",
        alias = "reasoning_mode",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub reasoning_mode: Option<String>,
    #[serde(
        rename = "contextLength",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub context_length: Option<u64>,
    #[serde(flatten, default, skip_serializing_if = "Map::is_empty")]
    pub extra: Map<String, Value>,
}

impl ModelProfile {
    pub fn transport_kind(&self) -> ModelTransportKind {
        let parsed = self
            .extra
            .get("transportKind")
            .and_then(Value::as_str)
            .or_else(|| self.extra.get("transport_kind").and_then(Value::as_str))
            .and_then(|value| value.parse().ok());
        match self.provider {
            Some(ModelProvider::Openai) => ModelTransportKind::OpenResponses,
            Some(ModelProvider::Azure) => ModelTransportKind::OpenResponses,
            Some(ModelProvider::HuggingFace) => ModelTransportKind::OpenResponses,
            Some(ModelProvider::Anthropic) => parsed.unwrap_or(ModelTransportKind::Anthropic),
            Some(ModelProvider::AmazonBedrock) => parsed.unwrap_or(ModelTransportKind::Bedrock),
            Some(ModelProvider::Minimax) => parsed.unwrap_or(ModelTransportKind::Anthropic),
            _ => parsed.unwrap_or(ModelTransportKind::OpenAiCompatible),
        }
    }

    pub fn supports_image_input(&self) -> bool {
        if let Some(capabilities) = self.explicit_capabilities() {
            return capabilities
                .iter()
                .any(|capability| capability == "image" || capability == "imageInput");
        }

        match self.provider {
            Some(ModelProvider::Deepseek) => false,
            Some(ModelProvider::Moonshot) => false,
            Some(ModelProvider::KimiCode) => false,
            Some(ModelProvider::Xiaomi) => false,
            Some(ModelProvider::Siliconflow) => false,
            Some(ModelProvider::Groq) => false,
            Some(ModelProvider::Deepinfra) => false,
            Some(ModelProvider::Xai)
            | Some(ModelProvider::ZAi)
            | Some(ModelProvider::ZhipuAi)
            | Some(ModelProvider::Minimax)
            | Some(ModelProvider::Alibaba)
            | Some(ModelProvider::Anthropic)
            | Some(ModelProvider::VercelAiGateway)
            | Some(ModelProvider::CloudflareAiGateway)
            | Some(ModelProvider::Openrouter)
            | Some(ModelProvider::FireworksAi)
            | Some(ModelProvider::TogetherAi)
            | Some(ModelProvider::HuggingFace)
            | Some(ModelProvider::Baseten)
            | Some(ModelProvider::Cohere)
            | Some(ModelProvider::Openai)
            | Some(ModelProvider::Google)
            | Some(ModelProvider::GoogleVertexAi)
            | Some(ModelProvider::Volcengine)
            | Some(ModelProvider::Byteplus)
            | Some(ModelProvider::Stepfun)
            | Some(ModelProvider::AmazonBedrock)
            | Some(ModelProvider::Azure)
            | Some(ModelProvider::Meituan)
            | Some(ModelProvider::TencentTokenhub)
            | Some(ModelProvider::Mistral)
            | Some(ModelProvider::Custom)
            | None => true,
        }
    }

    pub fn supports_image_generation(&self) -> bool {
        self.explicit_capabilities().is_some_and(|capabilities| {
            capabilities
                .iter()
                .any(|capability| capability == "imageGeneration")
        })
    }

    pub fn supports_video_generation(&self) -> bool {
        self.explicit_capabilities().is_some_and(|capabilities| {
            capabilities
                .iter()
                .any(|capability| capability == "videoGeneration")
        })
    }

    pub fn supports_chat(&self) -> bool {
        self.explicit_capabilities()
            .is_none_or(|capabilities| capabilities.iter().any(|capability| capability == "chat"))
    }

    pub fn explicit_capabilities(&self) -> Option<Vec<String>> {
        let raw = self.extra.get("capabilities")?.as_array()?;
        let capabilities = raw
            .iter()
            .filter_map(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
            .collect::<Vec<_>>();
        if capabilities.is_empty() {
            None
        } else {
            Some(capabilities)
        }
    }

    pub fn provider_site(&self) -> Option<String> {
        self.extra
            .get("providerSite")
            .or_else(|| self.extra.get("provider_site"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
    }

    pub fn alibaba_workspace_id(&self) -> Option<String> {
        self.extra
            .get("alibabaWorkspaceId")
            .or_else(|| self.extra.get("alibaba_workspace_id"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
    }

    pub fn alibaba_billing_mode(&self) -> Option<String> {
        self.extra
            .get("alibabaBillingMode")
            .or_else(|| self.extra.get("alibaba_billing_mode"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
    }

    pub fn stepfun_billing_mode(&self) -> Option<String> {
        self.extra
            .get("stepfunBillingMode")
            .or_else(|| self.extra.get("stepfun_billing_mode"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
    }

    pub fn z_ai_billing_mode(&self) -> Option<String> {
        self.extra
            .get("zAiBillingMode")
            .or_else(|| self.extra.get("z_ai_billing_mode"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
    }

    pub fn zhipu_billing_mode(&self) -> Option<String> {
        self.extra
            .get("zhipuBillingMode")
            .or_else(|| self.extra.get("zhipu_billing_mode"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
    }

    pub fn aws_region(&self) -> Option<String> {
        self.extra
            .get("awsRegion")
            .or_else(|| self.extra.get("aws_region"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
    }

    pub fn vertex_project(&self) -> Option<String> {
        self.extra
            .get("vertexProject")
            .or_else(|| self.extra.get("vertex_project"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
    }

    pub fn vertex_location(&self) -> Option<String> {
        self.extra
            .get("vertexLocation")
            .or_else(|| self.extra.get("vertex_location"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
    }

    pub fn azure_resource_name(&self) -> Option<String> {
        self.extra
            .get("azureResourceName")
            .or_else(|| self.extra.get("azure_resource_name"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
    }

    pub fn cloudflare_account_id(&self) -> Option<String> {
        self.extra
            .get("cloudflareAccountId")
            .or_else(|| self.extra.get("cloudflare_account_id"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
    }

    pub fn cloudflare_gateway_id(&self) -> Option<String> {
        self.extra
            .get("cloudflareGatewayId")
            .or_else(|| self.extra.get("cloudflare_gateway_id"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    #[serde(
        rename = "schemaVersion",
        alias = "schema_version",
        default = "default_schema_version"
    )]
    pub schema_version: u64,
    #[serde(rename = "providerGroups", alias = "provider_groups", default)]
    pub provider_groups: Vec<ProviderGroup>,
    #[serde(rename = "activeModel", alias = "active_model")]
    pub active_model: ModelRef,
    #[serde(
        rename = "imageGenerationModel",
        alias = "image_generation_model",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub image_generation_model: Option<ModelRef>,
    #[serde(
        rename = "videoGenerationModel",
        alias = "video_generation_model",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub video_generation_model: Option<ModelRef>,
    #[serde(
        rename = "lightweightChatModel",
        alias = "lightweight_chat_model",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub lightweight_chat_model: Option<ModelRef>,
    #[serde(
        rename = "uiLocale",
        alias = "ui_locale",
        default,
        skip_serializing_if = "Option::is_none"
    )]
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
            provider_groups: vec![],
            active_model: ModelRef::empty(),
            image_generation_model: None,
            video_generation_model: None,
            lightweight_chat_model: None,
            ui_locale: None,
            tui: default_tui_mode(),
            networks: NetworksConfig::default(),
            agents: AgentsConfig::default(),
            permission: None,
            extra: Map::new(),
        }
    }
}

pub fn default_preset_provider_group_id(provider: ModelProvider) -> String {
    provider.as_str().to_string()
}

pub fn resolve_model_profile_from_parts(
    group: &ProviderGroup,
    model: &ModelEntry,
) -> Option<ModelProfile> {
    if group.id.trim().is_empty() || model.name.trim().is_empty() {
        return None;
    }

    let mut extra = Map::new();
    if let Some(transport_kind) = group
        .transport_kind
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        extra.insert(
            "transportKind".to_string(),
            Value::String(transport_kind.to_string()),
        );
    }
    if let Some(site) = group
        .provider_site
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        extra.insert("providerSite".to_string(), Value::String(site.to_string()));
    }
    if let Some(workspace_id) = group
        .alibaba_workspace_id
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        extra.insert(
            "alibabaWorkspaceId".to_string(),
            Value::String(workspace_id.to_string()),
        );
    }
    if let Some(billing_mode) = group
        .alibaba_billing_mode
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        extra.insert(
            "alibabaBillingMode".to_string(),
            Value::String(billing_mode.to_string()),
        );
    }
    if let Some(billing_mode) = group
        .stepfun_billing_mode
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        extra.insert(
            "stepfunBillingMode".to_string(),
            Value::String(billing_mode.to_string()),
        );
    }
    if let Some(billing_mode) = group
        .z_ai_billing_mode
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        extra.insert(
            "zAiBillingMode".to_string(),
            Value::String(billing_mode.to_string()),
        );
    }
    if let Some(billing_mode) = group
        .zhipu_billing_mode
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        extra.insert(
            "zhipuBillingMode".to_string(),
            Value::String(billing_mode.to_string()),
        );
    }
    if let Some(region) = group
        .aws_region
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        extra.insert("awsRegion".to_string(), Value::String(region.to_string()));
    }
    if let Some(resource_name) = group
        .azure_resource_name
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        extra.insert(
            "azureResourceName".to_string(),
            Value::String(resource_name.to_string()),
        );
    }
    if let Some(account_id) = group
        .cloudflare_account_id
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        extra.insert(
            "cloudflareAccountId".to_string(),
            Value::String(account_id.to_string()),
        );
    }
    if let Some(gateway_id) = group
        .cloudflare_gateway_id
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        extra.insert(
            "cloudflareGatewayId".to_string(),
            Value::String(gateway_id.to_string()),
        );
    }
    if let Some(project) = group
        .vertex_project
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        extra.insert(
            "vertexProject".to_string(),
            Value::String(project.to_string()),
        );
    }
    if let Some(location) = group
        .vertex_location
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        extra.insert(
            "vertexLocation".to_string(),
            Value::String(location.to_string()),
        );
    }
    if let Some(capabilities) = model.capabilities.as_ref().filter(|caps| !caps.is_empty()) {
        extra.insert(
            "capabilities".to_string(),
            Value::Array(
                capabilities
                    .iter()
                    .map(|cap| Value::String(cap.clone()))
                    .collect(),
            ),
        );
    }
    if let Some(efforts) = model
        .supported_reasoning_efforts
        .as_ref()
        .filter(|efforts| !efforts.is_empty())
    {
        extra.insert(
            "supportedReasoningEfforts".to_string(),
            Value::Array(
                efforts
                    .iter()
                    .map(|effort| Value::String(effort.clone()))
                    .collect(),
            ),
        );
    }
    if model.thinking_enabled == Some(false) {
        extra.insert("thinkingEnabled".to_string(), Value::Bool(false));
    }
    if let Some(thinking_type) = model
        .supports_thinking_type
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        extra.insert(
            "supportsThinkingType".to_string(),
            Value::String(thinking_type.to_string()),
        );
    }
    if model.supports_thinking_switch == Some(true) {
        extra.insert("supportsThinkingSwitch".to_string(), Value::Bool(true));
    }

    Some(ModelProfile {
        group_id: group.id.clone(),
        name: model.name.clone(),
        api_base: group.api_base.clone(),
        provider: Some(group.provider),
        reasoning_effort: model.reasoning_effort.clone(),
        reasoning_mode: model.reasoning_mode.clone(),
        context_length: model.context_length,
        extra,
    })
}

impl AppConfig {
    pub fn active_model_name(&self) -> &str {
        self.active_model.name.as_str()
    }

    pub fn find_provider_group(&self, group_id: &str) -> Option<&ProviderGroup> {
        let normalized = group_id.trim();
        if normalized.is_empty() {
            return None;
        }
        self.provider_groups
            .iter()
            .find(|group| group.id == normalized)
    }

    pub fn find_provider_group_mut(&mut self, group_id: &str) -> Option<&mut ProviderGroup> {
        let normalized = group_id.trim();
        if normalized.is_empty() {
            return None;
        }
        self.provider_groups
            .iter_mut()
            .find(|group| group.id == normalized)
    }

    pub fn find_model_entry_in_group<'a>(
        group: &'a ProviderGroup,
        name: &str,
    ) -> Option<&'a ModelEntry> {
        let normalized = name.trim();
        if normalized.is_empty() {
            return None;
        }
        group.models.iter().find(|model| model.name == normalized)
    }

    pub fn find_model_entry_in_group_mut<'a>(
        group: &'a mut ProviderGroup,
        name: &str,
    ) -> Option<&'a mut ModelEntry> {
        let normalized = name.trim();
        if normalized.is_empty() {
            return None;
        }
        group
            .models
            .iter_mut()
            .find(|model| model.name == normalized)
    }

    pub fn resolve_model_profile(&self, model_ref: &ModelRef) -> Option<ModelProfile> {
        if model_ref.is_empty() {
            return None;
        }
        let group = self.find_provider_group(&model_ref.group_id)?;
        let model = Self::find_model_entry_in_group(group, &model_ref.name)?;
        resolve_model_profile_from_parts(group, model)
    }

    pub fn flatten_models(&self) -> Vec<ModelProfile> {
        let mut resolved = Vec::new();
        for group in &self.provider_groups {
            for model in &group.models {
                if let Some(profile) = resolve_model_profile_from_parts(group, model) {
                    resolved.push(profile);
                }
            }
        }
        resolved
    }

    pub fn list_all_model_refs(&self) -> Vec<ModelRef> {
        let mut refs = Vec::new();
        for group in &self.provider_groups {
            for model in &group.models {
                refs.push(ModelRef {
                    group_id: group.id.clone(),
                    name: model.name.clone(),
                });
            }
        }
        refs
    }

    pub fn first_model_ref(&self) -> ModelRef {
        let Some(group) = self.provider_groups.first() else {
            return ModelRef::empty();
        };
        let Some(model) = group.models.first() else {
            return ModelRef::empty();
        };
        ModelRef {
            group_id: group.id.clone(),
            name: model.name.clone(),
        }
    }

    pub fn find_model_refs_by_name(&self, name: &str) -> Vec<ModelRef> {
        let normalized = name.trim();
        if normalized.is_empty() {
            return Vec::new();
        }
        let mut refs = Vec::new();
        for group in &self.provider_groups {
            for model in &group.models {
                if model.name == normalized {
                    refs.push(ModelRef {
                        group_id: group.id.clone(),
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
        if let Some((group_id, name)) = trimmed.split_once("::") {
            let group_id = group_id.trim();
            let name = name.trim();
            if group_id.is_empty() || name.is_empty() {
                return Err(format!("invalid model id: {}", trimmed));
            }
            let model_ref = ModelRef {
                group_id: group_id.to_string(),
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
                    "ambiguous model name; use groupId::name, e.g. {}",
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

    pub fn has_model_in_group(&self, group_id: &str, name: &str) -> bool {
        let Some(group) = self.find_provider_group(group_id) else {
            return false;
        };
        Self::find_model_entry_in_group(group, name).is_some()
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

    pub fn active_provider_group_mut(&mut self) -> Option<&mut ProviderGroup> {
        let group_id = self.active_model.group_id.clone();
        self.find_provider_group_mut(&group_id)
    }

    pub fn active_model_entry_mut(&mut self) -> Option<&mut ModelEntry> {
        let group_id = self.active_model.group_id.clone();
        let name = self.active_model.name.clone();
        let group = self.find_provider_group_mut(&group_id)?;
        Self::find_model_entry_in_group_mut(group, &name)
    }

    pub fn image_generation_model_profile(&self) -> Option<ModelProfile> {
        let model_ref = self.image_generation_model.as_ref()?;
        self.resolve_model_profile(model_ref)
    }

    pub fn video_generation_model_profile(&self) -> Option<ModelProfile> {
        let model_ref = self.video_generation_model.as_ref()?;
        self.resolve_model_profile(model_ref)
    }

    pub fn lightweight_chat_model_profile(&self) -> Option<ModelProfile> {
        let model_ref = self.lightweight_chat_model.as_ref()?;
        self.resolve_model_profile(model_ref)
    }

    pub fn add_model_to_group(
        &mut self,
        group_id: &str,
        provider: ModelProvider,
        api_base: String,
        connect: ProviderGroupConnectDraft,
        entry: ModelEntry,
    ) {
        let normalized_group_id = group_id.trim().to_string();
        if let Some(group) = self.find_provider_group_mut(&normalized_group_id) {
            group.api_base = api_base;
            connect.apply_to_group(group);
            if !group.models.iter().any(|model| model.name == entry.name) {
                group.models.push(entry);
            }
            return;
        }

        let mut group = ProviderGroup {
            id: normalized_group_id,
            provider,
            label: None,
            api_base,
            transport_kind: None,
            provider_site: None,
            alibaba_workspace_id: None,
            alibaba_billing_mode: None,
            stepfun_billing_mode: None,
            z_ai_billing_mode: None,
            zhipu_billing_mode: None,
            aws_region: None,
            azure_resource_name: None,
            cloudflare_account_id: None,
            cloudflare_gateway_id: None,
            vertex_project: None,
            vertex_location: None,
            models: vec![entry],
        };
        connect.apply_to_group(&mut group);
        self.provider_groups.push(group);
    }

    pub fn remove_model(&mut self, model_ref: &ModelRef) -> bool {
        let Some(group) = self
            .provider_groups
            .iter_mut()
            .find(|group| group.id == model_ref.group_id)
        else {
            return false;
        };
        let before = group.models.len();
        group.models.retain(|model| model.name != model_ref.name);
        if group.models.len() == before {
            return false;
        }
        if group.models.is_empty() {
            let group_id = model_ref.group_id.clone();
            self.provider_groups.retain(|group| group.id != group_id);
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

#[derive(Debug, Clone, Default)]
pub struct ProviderGroupConnectDraft {
    pub transport_kind: Option<String>,
    pub provider_site: Option<String>,
    pub alibaba_workspace_id: Option<String>,
    pub alibaba_billing_mode: Option<String>,
    pub stepfun_billing_mode: Option<String>,
    pub z_ai_billing_mode: Option<String>,
    pub zhipu_billing_mode: Option<String>,
    pub aws_region: Option<String>,
    pub azure_resource_name: Option<String>,
    pub cloudflare_account_id: Option<String>,
    pub cloudflare_gateway_id: Option<String>,
    pub vertex_project: Option<String>,
    pub vertex_location: Option<String>,
}

impl ProviderGroupConnectDraft {
    fn apply_to_group(&self, group: &mut ProviderGroup) {
        if let Some(value) = normalize_optional_string(self.transport_kind.clone()) {
            group.transport_kind = Some(value);
        }
        if let Some(value) = normalize_optional_string(self.provider_site.clone()) {
            group.provider_site = Some(value);
        }
        if let Some(value) = normalize_optional_string(self.alibaba_workspace_id.clone()) {
            group.alibaba_workspace_id = Some(value);
        }
        if let Some(value) = normalize_optional_string(self.alibaba_billing_mode.clone()) {
            group.alibaba_billing_mode = Some(value);
        }
        if let Some(value) = normalize_optional_string(self.stepfun_billing_mode.clone()) {
            group.stepfun_billing_mode = Some(value);
        }
        // Z.ai / Zhipu: standard mode is represented by a missing field; on reconnect, None must clear any existing glm-coding-plan.
        match group.provider {
            ModelProvider::ZAi => {
                group.z_ai_billing_mode = normalize_optional_string(self.z_ai_billing_mode.clone());
            }
            ModelProvider::ZhipuAi => {
                group.zhipu_billing_mode =
                    normalize_optional_string(self.zhipu_billing_mode.clone());
            }
            _ => {
                if let Some(value) = normalize_optional_string(self.z_ai_billing_mode.clone()) {
                    group.z_ai_billing_mode = Some(value);
                }
                if let Some(value) = normalize_optional_string(self.zhipu_billing_mode.clone()) {
                    group.zhipu_billing_mode = Some(value);
                }
            }
        }
        if let Some(value) = normalize_optional_string(self.aws_region.clone()) {
            group.aws_region = Some(value);
        }
        if let Some(value) = normalize_optional_string(self.azure_resource_name.clone()) {
            group.azure_resource_name = Some(value);
        }
        if let Some(value) = normalize_optional_string(self.cloudflare_account_id.clone()) {
            group.cloudflare_account_id = Some(value);
        }
        if let Some(value) = normalize_optional_string(self.cloudflare_gateway_id.clone()) {
            group.cloudflare_gateway_id = Some(value);
        }
        if let Some(value) = normalize_optional_string(self.vertex_project.clone()) {
            group.vertex_project = Some(value);
        }
        if let Some(value) = normalize_optional_string(self.vertex_location.clone()) {
            group.vertex_location = Some(value);
        }
    }
}

pub fn make_test_app_config_with_models(
    group_id: &str,
    provider: ModelProvider,
    api_base: &str,
    model_names: &[&str],
    active_name: &str,
) -> AppConfig {
    let mut cfg = AppConfig::default();
    for name in model_names {
        cfg.add_model_to_group(
            group_id,
            provider,
            api_base.to_string(),
            ProviderGroupConnectDraft::default(),
            ModelEntry {
                name: (*name).to_string(),
                reasoning_effort: None,
                reasoning_mode: None,
                thinking_enabled: None,
                supported_reasoning_efforts: None,
                capabilities: None,
                context_length: None,
                supports_thinking_type: None,
                supports_thinking_switch: None,
            },
        );
    }
    cfg.active_model = ModelRef {
        group_id: group_id.to_string(),
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

    let version = raw
        .get("schemaVersion")
        .or_else(|| raw.get("schema_version"))
        .and_then(Value::as_u64);
    if version != Some(SPIRIT_CONFIG_SCHEMA_VERSION) {
        return Err(anyhow::anyhow!(
            "config.json must be schemaVersion {}; delete the legacy config and reconnect the provider.",
            SPIRIT_CONFIG_SCHEMA_VERSION
        ));
    }

    let mut cfg: AppConfig = serde_json::from_value(raw)
        .with_context(|| format!("Failed to parse config: {}", path.display()))?;
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

    if cfg.provider_groups.is_empty()
        || cfg
            .provider_groups
            .iter()
            .all(|group| group.models.is_empty())
    {
        cfg.active_model = ModelRef::empty();
        cfg.image_generation_model = None;
        cfg.video_generation_model = None;
        cfg.lightweight_chat_model = None;
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
    cfg.lightweight_chat_model =
        normalize_lightweight_chat_model_ref(cfg.lightweight_chat_model.take(), &flattened);

    for group in &mut cfg.provider_groups {
        if group.api_base.trim().is_empty() {
            group.api_base = DEFAULT_API_BASE.to_string();
        }
        let provider = group.provider;
        let transport_kind = group
            .transport_kind
            .as_deref()
            .and_then(|value| value.parse().ok())
            .unwrap_or(match provider {
                ModelProvider::Anthropic => ModelTransportKind::Anthropic,
                ModelProvider::AmazonBedrock => ModelTransportKind::Bedrock,
                ModelProvider::Azure | ModelProvider::Openai => ModelTransportKind::OpenResponses,
                _ => ModelTransportKind::OpenAiCompatible,
            });
        let normalized_transport = normalize_group_transport_kind(provider, transport_kind);
        group.transport_kind = match normalized_transport {
            ModelTransportKind::Anthropic
            | ModelTransportKind::OpenResponses
            | ModelTransportKind::Bedrock => Some(normalized_transport.as_str().to_string()),
            ModelTransportKind::OpenAiCompatible => None,
        };

        for model in &mut group.models {
            model.reasoning_effort = normalize_reasoning_effort_value(
                normalize_optional_string(model.reasoning_effort.take()),
                Some(provider),
                normalized_transport,
                &model.name,
            );
        }
    }
}

fn normalize_group_transport_kind(
    provider: ModelProvider,
    transport_kind: ModelTransportKind,
) -> ModelTransportKind {
    if matches!(provider, ModelProvider::Openai | ModelProvider::Azure) {
        return ModelTransportKind::OpenResponses;
    }
    let mut transport_kind = transport_kind;
    if matches!(
        provider,
        ModelProvider::Google | ModelProvider::GoogleVertexAi
    ) && matches!(
        transport_kind,
        ModelTransportKind::OpenResponses | ModelTransportKind::Anthropic
    ) {
        transport_kind = ModelTransportKind::OpenAiCompatible;
    }
    if provider == ModelProvider::GoogleVertexAi && transport_kind == ModelTransportKind::Bedrock {
        transport_kind = ModelTransportKind::OpenAiCompatible;
    }
    transport_kind
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
        .find(|model| model.group_id == model_ref.group_id && model.name == model_ref.name)?;
    if predicate(profile) {
        Some(model_ref)
    } else {
        None
    }
}

fn normalize_lightweight_chat_model_ref(
    value: Option<ModelRef>,
    models: &[ModelProfile],
) -> Option<ModelRef> {
    let model_ref = value?;
    if model_ref.is_empty() {
        return None;
    }
    let profile = models
        .iter()
        .find(|model| model.group_id == model_ref.group_id && model.name == model_ref.name)?;
    if profile.supports_chat() {
        Some(model_ref)
    } else {
        None
    }
}

pub(crate) fn normalize_reasoning_effort_value(
    value: Option<String>,
    provider: Option<ModelProvider>,
    transport_kind: ModelTransportKind,
    model_name: &str,
) -> Option<String> {
    let normalized = normalize_optional_string(value)?.to_ascii_lowercase();

    Some(match transport_kind {
        ModelTransportKind::Anthropic => match normalized.as_str() {
            "default" | "low" | "medium" | "high" | "xhigh" | "max" => normalized,
            "none" | "minimal" => "default".to_string(),
            _ => "default".to_string(),
        },
        ModelTransportKind::Bedrock
        | ModelTransportKind::OpenResponses
        | ModelTransportKind::OpenAiCompatible => match provider {
            Some(ModelProvider::Deepseek) if is_deepseek_v4_reasoning_model(model_name) => {
                match normalized.as_str() {
                    "default" | "high" | "max" => normalized,
                    "low" | "medium" => "high".to_string(),
                    "xhigh" => "max".to_string(),
                    "none" | "minimal" => "default".to_string(),
                    _ => "default".to_string(),
                }
            }
            Some(ModelProvider::Moonshot | ModelProvider::KimiCode) => match normalized.as_str() {
                "default" | "minimal" | "low" | "medium" | "high" => normalized,
                "none" => "default".to_string(),
                "xhigh" | "max" => "high".to_string(),
                _ => "default".to_string(),
            },
            Some(ModelProvider::Xai) => match normalized.as_str() {
                "default" | "none" | "low" | "medium" | "high" => normalized,
                "minimal" => "low".to_string(),
                "xhigh" | "max" => "high".to_string(),
                _ => "default".to_string(),
            },
            Some(ModelProvider::Google) | Some(ModelProvider::GoogleVertexAi) => {
                match normalized.as_str() {
                    "default" | "none" | "low" | "medium" | "high" => normalized,
                    "minimal" => "low".to_string(),
                    "xhigh" | "max" => "high".to_string(),
                    _ => "default".to_string(),
                }
            }
            _ => match normalized.as_str() {
                "default" | "none" | "low" | "medium" | "high" | "xhigh" => normalized,
                "max" if model_supports_openai_gpt56_reasoning_controls(provider, model_name) => {
                    normalized
                }
                "minimal" => "default".to_string(),
                "max" => "xhigh".to_string(),
                _ => "medium".to_string(),
            },
        },
    })
}

fn normalize_optional_string(value: Option<String>) -> Option<String> {
    let trimmed = value?.trim().to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

fn normalize_gateway_openai_model_id(model: &str) -> Option<String> {
    let trimmed = model.trim();
    let lower = trimmed.to_ascii_lowercase();
    let prefix = "openai/";
    if lower.starts_with(prefix) {
        let id = trimmed[prefix.len()..].trim();
        if !id.is_empty() {
            return Some(id.to_string());
        }
    }
    None
}

fn resolve_openai_model_id_for_version_check(model_id: &str) -> String {
    if let Some(gateway_id) = normalize_gateway_openai_model_id(model_id) {
        return gateway_id;
    }

    let trimmed = model_id.trim();
    let lower = trimmed.to_ascii_lowercase();
    let openrouter_prefix = "openai/";
    if lower.starts_with(openrouter_prefix) {
        return trimmed[openrouter_prefix.len()..].trim().to_string();
    }

    trimmed.to_string()
}

pub(crate) fn parse_openai_gpt_model_version(model_id: &str) -> Option<(u32, u32)> {
    let trimmed = resolve_openai_model_id_for_version_check(model_id).to_ascii_lowercase();

    if let Some(rest) = trimmed.strip_prefix("openai.") {
        return parse_openai_gpt_model_version(rest);
    }

    if let Some(rest) = trimmed.strip_prefix("gpt-") {
        if let Some(dot) = rest.find('.') {
            let major_part = &rest[..dot];
            let minor_part: String = rest[dot + 1..]
                .chars()
                .take_while(|c| c.is_ascii_digit())
                .collect();
            if let (Ok(major), Ok(minor)) = (major_part.parse::<u32>(), minor_part.parse::<u32>()) {
                return Some((major, minor));
            }
        }

        let major_end = rest.find(['-', '_']).unwrap_or(rest.len());
        let major_part = &rest[..major_end];
        if let Ok(major) = major_part.parse::<u32>() {
            return Some((major, 0));
        }
    }

    None
}

pub(crate) fn is_openai_gpt56_or_later_model(model_id: &str) -> bool {
    let Some((major, minor)) = parse_openai_gpt_model_version(model_id) else {
        return false;
    };

    major > 5 || (major == 5 && minor >= 6)
}

fn model_supports_openai_gpt56_reasoning_controls(
    provider: Option<ModelProvider>,
    model_name: &str,
) -> bool {
    let Some(provider) = provider else {
        return false;
    };

    if !matches!(
        provider,
        ModelProvider::Openai
            | ModelProvider::Azure
            | ModelProvider::VercelAiGateway
            | ModelProvider::CloudflareAiGateway
            | ModelProvider::Openrouter
    ) {
        return false;
    }

    is_openai_gpt56_or_later_model(model_name)
}

pub(crate) fn normalize_reasoning_mode_value(
    value: Option<String>,
    provider: Option<ModelProvider>,
    model_name: &str,
) -> Option<String> {
    if !model_supports_openai_gpt56_reasoning_controls(provider, model_name) {
        return None;
    }

    let normalized = normalize_optional_string(value)?.to_ascii_lowercase();
    if normalized == "pro" {
        Some("pro".to_string())
    } else {
        None
    }
}

fn is_deepseek_v4_reasoning_model(model: &str) -> bool {
    let normalized = model.trim().to_ascii_lowercase();
    normalized == "deepseek-v4-pro" || normalized == "deepseek-v4-flash"
}

pub fn keyring_entry() -> Result<keyring::Entry> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT_API_KEY)
        .context("Failed to initialize keyring entry")
}

fn keyring_entry_for_account(account: &str) -> Result<keyring::Entry> {
    keyring::Entry::new(KEYRING_SERVICE, account)
        .with_context(|| format!("Failed to initialize keyring entry: {}", account))
}

fn model_key_account(model_name: &str) -> String {
    format!("model::{}", model_name)
}

fn group_key_account(group_id: &str) -> String {
    format!("group::{}", group_id)
}

fn group_access_key_id_account(group_id: &str) -> String {
    format!("group::{group_id}::access-key-id")
}

fn group_secret_access_key_account(group_id: &str) -> String {
    format!("group::{group_id}::secret-access-key")
}

fn group_vertex_client_email_account(group_id: &str) -> String {
    format!("group::{group_id}::client-email")
}

fn group_vertex_private_key_account(group_id: &str) -> String {
    format!("group::{group_id}::private-key")
}

pub fn load_group_api_key_from_keyring(group_id: &str) -> Result<String> {
    let entry = keyring_entry_for_account(&group_key_account(group_id))?;
    entry
        .get_password()
        .with_context(|| format!("Failed to read API Key for provider group {}", group_id))
}

pub fn load_group_access_key_id_from_keyring(group_id: &str) -> Result<String> {
    let entry = keyring_entry_for_account(&group_access_key_id_account(group_id))?;
    entry
        .get_password()
        .with_context(|| format!("Failed to read IAM Access Key ID for provider group {group_id}"))
}

pub fn load_group_secret_access_key_from_keyring(group_id: &str) -> Result<String> {
    let entry = keyring_entry_for_account(&group_secret_access_key_account(group_id))?;
    entry.get_password().with_context(|| {
        format!("Failed to read IAM Secret Access Key for provider group {group_id}")
    })
}

pub fn has_bedrock_runtime_credentials_in_keyring(group_id: &str) -> Result<bool> {
    if load_group_api_key_from_keyring(group_id)
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
    {
        return Ok(true);
    }

    let access_key_id = load_group_access_key_id_from_keyring(group_id)
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);
    let secret_access_key = load_group_secret_access_key_from_keyring(group_id)
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);
    Ok(access_key_id && secret_access_key)
}

pub fn load_group_vertex_client_email_from_keyring(group_id: &str) -> Result<String> {
    let entry = keyring_entry_for_account(&group_vertex_client_email_account(group_id))?;
    entry.get_password().with_context(|| {
        format!("Failed to read Vertex client email for provider group {group_id}")
    })
}

pub fn load_group_vertex_private_key_from_keyring(group_id: &str) -> Result<String> {
    let entry = keyring_entry_for_account(&group_vertex_private_key_account(group_id))?;
    entry
        .get_password()
        .with_context(|| format!("Failed to read Vertex private key for provider group {group_id}"))
}

pub fn has_google_vertex_service_account_in_keyring(group_id: &str) -> Result<bool> {
    let client_email = load_group_vertex_client_email_from_keyring(group_id)
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);
    let private_key = load_group_vertex_private_key_from_keyring(group_id)
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);
    Ok(client_email && private_key)
}

pub fn has_google_vertex_runtime_credentials(
    api_key: &str,
    vertex_project: Option<&str>,
    vertex_location: Option<&str>,
    group_id: &str,
) -> bool {
    if !api_key.trim().is_empty() {
        return true;
    }
    let has_project_location = vertex_project.is_some_and(|value| !value.trim().is_empty())
        && vertex_location.is_some_and(|value| !value.trim().is_empty());
    if !has_project_location {
        return false;
    }
    if has_google_vertex_service_account_in_keyring(group_id).unwrap_or(false) {
        return true;
    }
    true
}

pub fn save_group_api_key(group_id: &str, api_key: &str) -> Result<()> {
    let entry = keyring_entry_for_account(&group_key_account(group_id))?;
    if api_key.trim().is_empty() {
        match entry.delete_password() {
            Ok(_) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(anyhow::anyhow!(
                "Failed to delete API Key for provider group {group_id}: {err}"
            )),
        }
    } else {
        entry
            .set_password(api_key.trim())
            .with_context(|| format!("Failed to save API Key for provider group {group_id}"))
    }
}

pub fn save_group_vertex_credentials(
    group_id: &str,
    client_email: &str,
    private_key: &str,
) -> Result<()> {
    let client_email = client_email.trim();
    let private_key = private_key.trim();
    let email_entry = keyring_entry_for_account(&group_vertex_client_email_account(group_id))?;
    email_entry.set_password(client_email).with_context(|| {
        format!("Failed to save Vertex client email for provider group {group_id}")
    })?;
    let key_entry = keyring_entry_for_account(&group_vertex_private_key_account(group_id))?;
    key_entry
        .set_password(private_key)
        .with_context(|| format!("Failed to save Vertex private key for provider group {group_id}"))
}

pub fn save_model_api_key(model_name: &str, api_key: &str) -> Result<()> {
    let entry = keyring_entry_for_account(&model_key_account(model_name))?;
    entry
        .set_password(api_key.trim())
        .with_context(|| format!("Failed to save API Key for model {}", model_name))
}

pub fn remove_model_api_key(model_name: &str) -> Result<()> {
    let entry = keyring_entry_for_account(&model_key_account(model_name))?;
    match entry.delete_password() {
        Ok(_) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(anyhow::anyhow!(
            "Failed to delete API Key for model {}: {}",
            model_name,
            err
        )),
    }
}

pub fn has_model_api_key(model_name: &str) -> Result<bool> {
    let entry = keyring_entry_for_account(&model_key_account(model_name))?;
    match entry.get_password() {
        Ok(v) => Ok(!v.trim().is_empty()),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(err) => Err(anyhow::anyhow!(
            "Failed to read API Key for model {}: {}",
            model_name,
            err
        )),
    }
}

pub fn resolve_api_key_for_model(group_id: &str, model_name: &str) -> Result<String> {
    if let Ok(value) = env::var(ENV_API_KEY) {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }

    if let Ok(value) = load_group_api_key_from_keyring(group_id) {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }

    if let Ok(value) = load_model_api_key_from_keyring(model_name) {
        return Ok(value);
    }

    load_api_key_from_keyring()
}

fn load_api_key_from_keyring() -> Result<String> {
    let entry = keyring_entry()?;
    entry
        .get_password()
        .context("Failed to read API Key from keyring")
}

fn load_model_api_key_from_keyring(model_name: &str) -> Result<String> {
    let entry = keyring_entry_for_account(&model_key_account(model_name))?;
    entry
        .get_password()
        .with_context(|| format!("Failed to read API Key for model {}", model_name))
}

#[cfg(test)]
mod tests {
    use super::{
        AppConfig, ModelEntry, ModelProvider, ModelRef, ModelTransportKind, PermissionRuleAction,
        ProviderGroupConnectDraft, SPIRIT_CONFIG_SCHEMA_VERSION, deserialize_config,
        normalize_reasoning_effort_value, normalize_reasoning_mode_value, resolve_cli_attribution,
        serialize_config,
    };
    use serde_json::Value;
    use std::path::Path;

    fn test_profile(
        group_id: &str,
        name: &str,
        api_base: &str,
        provider: ModelProvider,
    ) -> super::ModelProfile {
        super::ModelProfile {
            group_id: group_id.to_string(),
            name: name.to_string(),
            api_base: api_base.to_string(),
            provider: Some(provider),
            reasoning_effort: None,
            reasoning_mode: None,
            context_length: None,
            extra: serde_json::Map::new(),
        }
    }

    #[test]
    fn rejects_non_v2_schema_version() {
        let config = r#"{"schemaVersion":1,"models":[],"activeModel":""}"#;
        let err = deserialize_config(config, Path::new("config.json")).unwrap_err();
        assert!(
            err.to_string()
                .contains(&format!("schemaVersion {SPIRIT_CONFIG_SCHEMA_VERSION}"))
        );
    }

    #[test]
    fn normalize_reasoning_effort_preserves_moonshot_style_for_kimi_code() {
        assert_eq!(
            normalize_reasoning_effort_value(
                Some("minimal".to_string()),
                Some(ModelProvider::KimiCode),
                ModelTransportKind::OpenAiCompatible,
                "kimi-for-coding",
            ),
            Some("minimal".to_string()),
        );
        assert_eq!(
            normalize_reasoning_effort_value(
                Some("max".to_string()),
                Some(ModelProvider::KimiCode),
                ModelTransportKind::OpenAiCompatible,
                "kimi-for-coding",
            ),
            Some("high".to_string()),
        );
    }

    #[test]
    fn normalize_reasoning_effort_preserves_max_for_gpt56_openai() {
        assert_eq!(
            normalize_reasoning_effort_value(
                Some("max".to_string()),
                Some(ModelProvider::Openai),
                ModelTransportKind::OpenResponses,
                "gpt-5.6-sol",
            ),
            Some("max".to_string()),
        );
        assert_eq!(
            normalize_reasoning_effort_value(
                Some("max".to_string()),
                Some(ModelProvider::Openai),
                ModelTransportKind::OpenResponses,
                "gpt-5.5",
            ),
            Some("xhigh".to_string()),
        );
    }

    #[test]
    fn normalize_reasoning_mode_only_for_gpt56_pro() {
        assert_eq!(
            normalize_reasoning_mode_value(
                Some("pro".to_string()),
                Some(ModelProvider::Openai),
                "gpt-5.6-sol",
            ),
            Some("pro".to_string()),
        );
        assert_eq!(
            normalize_reasoning_mode_value(
                Some("pro".to_string()),
                Some(ModelProvider::Openai),
                "gpt-5.5",
            ),
            None,
        );
        assert_eq!(
            normalize_reasoning_mode_value(
                Some("standard".to_string()),
                Some(ModelProvider::Openai),
                "gpt-5.6-sol",
            ),
            None,
        );
    }

    #[test]
    fn preserves_unknown_top_level_and_model_fields() {
        let config = r#"
{
  "schemaVersion": 2,
  "providerGroups": [
    {
      "id": "custom",
      "provider": "custom",
      "apiBase": "https://example.invalid/v1",
      "models": [
        {
          "name": "agent-test-model",
          "reasoningEffort": "minimal"
        }
      ]
    }
  ],
  "activeModel": { "groupId": "custom", "name": "agent-test-model" },
  "imageGenerationModel": { "groupId": "custom", "name": "agent-test-model" },
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
        assert_eq!(
            json.get("providerGroups")
                .and_then(Value::as_array)
                .and_then(|groups| groups.first())
                .and_then(|group| group.get("models"))
                .and_then(Value::as_array)
                .and_then(|models| models.first())
                .and_then(|model| model.get("reasoningEffort"))
                .and_then(Value::as_str),
            Some("default")
        );
        assert_eq!(parsed.image_generation_model, None);
    }

    #[test]
    fn normalizing_empty_models_keeps_unknown_desktop_fields() {
        let config = r#"
{
  "schemaVersion": 2,
  "providerGroups": [],
  "activeModel": { "groupId": "", "name": "" },
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
            json.get("providerGroups")
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
    fn model_profile_supports_image_input_uses_explicit_capabilities_for_moonshot() {
        let kimi_without_capabilities = test_profile(
            "moonshot-ai",
            "kimi-k2.6",
            "https://api.moonshot.cn/v1",
            ModelProvider::Moonshot,
        );
        let mut kimi_with_image = kimi_without_capabilities.clone();
        kimi_with_image.extra.insert(
            "capabilities".to_string(),
            serde_json::json!(["chat", "image"]),
        );
        let deepseek = test_profile(
            "deepseek",
            "deepseek-v4-pro",
            "https://api.deepseek.com/v1",
            ModelProvider::Deepseek,
        );
        let custom = test_profile(
            "custom",
            "my-custom-model",
            "https://example.invalid/v1",
            ModelProvider::Custom,
        );

        assert!(!kimi_without_capabilities.supports_image_input());
        assert!(kimi_with_image.supports_image_input());
        assert!(!deepseek.supports_image_input());
        assert!(custom.supports_image_input());
    }

    #[test]
    fn model_profile_supports_image_input_uses_explicit_capabilities_for_xiaomi() {
        let mimo_without_capabilities = test_profile(
            "xiaomi",
            "mimo-v2-flash",
            "https://api.xiaomimimo.com/v1",
            ModelProvider::Xiaomi,
        );
        let mut mimo_with_image = mimo_without_capabilities.clone();
        mimo_with_image.extra.insert(
            "capabilities".to_string(),
            serde_json::json!(["chat", "image", "video"]),
        );

        assert!(!mimo_without_capabilities.supports_image_input());
        assert!(mimo_with_image.supports_image_input());
    }

    #[test]
    fn model_profile_supports_image_input_uses_explicit_capabilities_for_groq() {
        let groq_without_capabilities = test_profile(
            "groq",
            "llama-3.3-70b-versatile",
            "https://api.groq.com/openai/v1",
            ModelProvider::Groq,
        );
        let mut groq_with_image = groq_without_capabilities.clone();
        groq_with_image.extra.insert(
            "capabilities".to_string(),
            serde_json::json!(["chat", "image"]),
        );

        assert!(!groq_without_capabilities.supports_image_input());
        assert!(groq_with_image.supports_image_input());
    }

    #[test]
    fn explicit_capabilities_override_provider_image_input_inference() {
        let mut deepseek = test_profile(
            "deepseek",
            "deepseek-v4-pro",
            "https://api.deepseek.com/v1",
            ModelProvider::Deepseek,
        );
        deepseek.extra.insert(
            "capabilities".to_string(),
            serde_json::json!(["chat", "image"]),
        );

        let mut custom = test_profile(
            "custom",
            "my-custom-model",
            "https://example.invalid/v1",
            ModelProvider::Custom,
        );
        custom
            .extra
            .insert("capabilities".to_string(), serde_json::json!(["chat"]));

        assert!(deepseek.supports_image_input());
        assert!(!custom.supports_image_input());
    }

    #[test]
    fn image_generation_model_requires_explicit_capability() {
        let config = r#"
{
    "schemaVersion": 2,
    "providerGroups": [
        {
            "id": "custom",
            "provider": "custom",
            "apiBase": "https://example.invalid/v1",
            "models": [
                { "name": "chat-model", "capabilities": ["chat"] },
                { "name": "image-model", "capabilities": ["imageGeneration"] }
            ]
        }
    ],
    "activeModel": { "groupId": "custom", "name": "chat-model" },
    "imageGenerationModel": { "groupId": "custom", "name": "image-model" }
}
"#;

        let parsed = deserialize_config(config, Path::new("config.json")).expect("parse config");
        assert_eq!(
            parsed.image_generation_model,
            Some(ModelRef {
                group_id: "custom".to_string(),
                name: "image-model".to_string(),
            })
        );

        let invalid = config.replace("image-model\"", "chat-model\"");
        let parsed = deserialize_config(&invalid, Path::new("config.json")).expect("parse config");
        assert_eq!(parsed.image_generation_model, None);
    }

    #[test]
    fn video_generation_model_requires_explicit_capability() {
        let config = r#"
{
    "schemaVersion": 2,
    "providerGroups": [
        {
            "id": "custom",
            "provider": "custom",
            "apiBase": "https://example.invalid/v1",
            "models": [
                { "name": "chat-model", "capabilities": ["chat"] },
                { "name": "video-model", "capabilities": ["videoGeneration"] }
            ]
        }
    ],
    "activeModel": { "groupId": "custom", "name": "chat-model" },
    "videoGenerationModel": { "groupId": "custom", "name": "video-model" }
}
"#;

        let parsed = deserialize_config(config, Path::new("config.json")).expect("parse config");
        assert_eq!(
            parsed.video_generation_model,
            Some(ModelRef {
                group_id: "custom".to_string(),
                name: "video-model".to_string(),
            })
        );

        let invalid = config.replace("video-model\"", "chat-model\"");
        let parsed = deserialize_config(&invalid, Path::new("config.json")).expect("parse config");
        assert_eq!(parsed.video_generation_model, None);
    }

    #[test]
    fn deserializes_alibaba_provider_from_desktop_config() {
        let config = r#"
{
    "schemaVersion": 2,
    "providerGroups": [
        {
            "id": "alibaba",
            "provider": "alibaba",
            "apiBase": "https://dashscope.aliyuncs.com/compatible-mode/v1",
            "models": [
                { "name": "qwen3.6-plus", "reasoningEffort": "medium" }
            ]
        }
    ],
    "activeModel": { "groupId": "alibaba", "name": "qwen3.6-plus" }
}
"#;

        let parsed = deserialize_config(config, Path::new("config.json")).expect("parse config");
        let active = parsed.active_model_profile().expect("active model");

        assert_eq!(active.provider, Some(ModelProvider::Alibaba));
        assert_eq!(active.reasoning_effort.as_deref(), Some("medium"));
    }

    #[test]
    fn deserializes_anthropic_transport_kind_from_desktop_config() {
        let config = r#"
{
    "schemaVersion": 2,
    "providerGroups": [
        {
            "id": "anthropic",
            "provider": "anthropic",
            "apiBase": "https://api.anthropic.com/v1",
            "transportKind": "anthropic",
            "models": [
                { "name": "claude-sonnet-4-5", "reasoningEffort": "high" }
            ]
        }
    ],
    "activeModel": { "groupId": "anthropic", "name": "claude-sonnet-4-5" }
}
"#;

        let parsed = deserialize_config(config, Path::new("config.json")).expect("parse config");
        let active = parsed.active_model_profile().expect("active model");

        assert_eq!(active.provider, Some(ModelProvider::Anthropic));
        assert_eq!(active.transport_kind(), ModelTransportKind::Anthropic);
        assert_eq!(active.reasoning_effort.as_deref(), Some("high"));
    }

    #[test]
    fn deserializes_vercel_ai_gateway_provider_from_desktop_config() {
        let config = r#"
{
    "schemaVersion": 2,
    "providerGroups": [
        {
            "id": "vercel-ai-gateway",
            "provider": "vercel-ai-gateway",
            "apiBase": "https://ai-gateway.vercel.sh/v1",
            "transportKind": "open-responses",
            "models": [
                { "name": "gateway-model", "reasoningEffort": "medium" }
            ]
        }
    ],
    "activeModel": { "groupId": "vercel-ai-gateway", "name": "gateway-model" }
}
"#;

        let parsed = deserialize_config(config, Path::new("config.json")).expect("parse config");
        let serialized = serialize_config(&parsed).expect("serialize config");
        let json: Value = serde_json::from_str(&serialized).expect("json value");
        let active = parsed.active_model_profile().expect("active model");

        assert_eq!(active.provider, Some(ModelProvider::VercelAiGateway));
        assert_eq!(
            json.get("providerGroups")
                .and_then(Value::as_array)
                .and_then(|groups| groups.first())
                .and_then(|group| group.get("provider"))
                .and_then(Value::as_str),
            Some("vercel-ai-gateway")
        );
    }

    #[test]
    fn normalizes_custom_openai_reasoning_effort_to_generic_values() {
        let config = r#"
{
    "schemaVersion": 2,
    "providerGroups": [
        {
            "id": "custom",
            "provider": "custom",
            "apiBase": "https://example.invalid/v1",
            "models": [
                { "name": "custom-openai-model", "reasoningEffort": "minimal" }
            ]
        }
    ],
    "activeModel": { "groupId": "custom", "name": "custom-openai-model" }
}
"#;

        let parsed = deserialize_config(config, Path::new("config.json")).expect("parse config");
        let active = parsed.active_model_profile().expect("active model");

        assert_eq!(active.reasoning_effort.as_deref(), Some("default"));
    }

    #[test]
    fn normalizes_custom_anthropic_reasoning_effort_to_anthropic_values() {
        let config = r#"
{
    "schemaVersion": 2,
    "providerGroups": [
        {
            "id": "custom",
            "provider": "custom",
            "apiBase": "https://api.anthropic.com/v1",
            "transportKind": "anthropic",
            "models": [
                { "name": "claude-custom", "reasoningEffort": "max" }
            ]
        }
    ],
    "activeModel": { "groupId": "custom", "name": "claude-custom" }
}
"#;

        let parsed = deserialize_config(config, Path::new("config.json")).expect("parse config");
        let active = parsed.active_model_profile().expect("active model");

        assert_eq!(active.transport_kind(), ModelTransportKind::Anthropic);
        assert_eq!(active.reasoning_effort.as_deref(), Some("max"));
    }

    #[test]
    fn roundtrips_model_context_length_field() {
        let config = r#"
{
  "schemaVersion": 2,
  "providerGroups": [
    {
      "id": "custom",
      "provider": "custom",
      "apiBase": "https://example.invalid/v1",
      "models": [
        { "name": "custom-model", "contextLength": 128000 }
      ]
    }
  ],
  "activeModel": { "groupId": "custom", "name": "custom-model" }
}
"#;

        let parsed = deserialize_config(config, Path::new("config.json")).expect("parse config");
        let active = parsed.active_model_profile().expect("active model");
        assert_eq!(active.context_length, Some(128_000));

        let serialized = serialize_config(&parsed).expect("serialize config");
        let json: Value = serde_json::from_str(&serialized).expect("json value");
        assert_eq!(
            json.get("providerGroups")
                .and_then(Value::as_array)
                .and_then(|groups| groups.first())
                .and_then(|group| group.get("models"))
                .and_then(Value::as_array)
                .and_then(|models| models.first())
                .and_then(|model| model.get("contextLength"))
                .and_then(Value::as_u64),
            Some(128_000)
        );

        let mut cfg = AppConfig::default();
        cfg.add_model_to_group(
            "custom",
            ModelProvider::Custom,
            "https://example.invalid/v1".to_string(),
            ProviderGroupConnectDraft::default(),
            ModelEntry {
                name: "plain".to_string(),
                reasoning_effort: None,
                reasoning_mode: None,
                thinking_enabled: None,
                supported_reasoning_efforts: None,
                capabilities: None,
                context_length: None,
                supports_thinking_type: None,
                supports_thinking_switch: None,
            },
        );
        let serialized_without = serialize_config(&cfg).expect("serialize config");
        let json_without: Value = serde_json::from_str(&serialized_without).expect("json value");
        assert_eq!(
            json_without
                .get("providerGroups")
                .and_then(Value::as_array)
                .and_then(|groups| groups.first())
                .and_then(|group| group.get("models"))
                .and_then(Value::as_array)
                .and_then(|models| models.first())
                .and_then(|model| model.get("contextLength")),
            None
        );
    }

    #[test]
    fn cli_attribution_defaults_off_when_missing() {
        let config = r#"
{
  "schemaVersion": 2,
  "providerGroups": [],
  "activeModel": { "groupId": "", "name": "" }
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
  "schemaVersion": 2,
  "providerGroups": [],
  "activeModel": { "groupId": "", "name": "" },
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
    fn normalize_transport_kind_downgrades_google_open_responses() {
        let config = r#"
{
  "schemaVersion": 2,
  "providerGroups": [
    {
      "id": "google",
      "provider": "google",
      "apiBase": "https://generativelanguage.googleapis.com/v1beta",
      "transportKind": "open-responses",
      "models": [{ "name": "gemini-flash" }]
    }
  ],
  "activeModel": { "groupId": "google", "name": "gemini-flash" }
}
"#;
        let parsed = deserialize_config(config, Path::new("config.json")).expect("parse config");
        let active = parsed.active_model_profile().expect("active model");
        assert_eq!(
            active.transport_kind(),
            ModelTransportKind::OpenAiCompatible
        );
    }

    #[test]
    fn tui_mode_defaults_to_inline_when_omitted() {
        let config = r#"
{
  "schemaVersion": 2,
  "providerGroups": [],
  "activeModel": { "groupId": "", "name": "" }
}
"#;
        let parsed = deserialize_config(config, Path::new("config.json")).expect("parse config");
        assert_eq!(parsed.tui, "inline");
    }

    #[test]
    fn tui_mode_normalizes_unknown_to_inline() {
        let config = r#"
{
  "schemaVersion": 2,
  "providerGroups": [],
  "activeModel": { "groupId": "", "name": "" },
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
  "schemaVersion": 2,
  "providerGroups": [],
  "activeModel": { "groupId": "", "name": "" },
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
    fn openai_transport_kind_forces_open_responses() {
        let config = r#"
{
  "schemaVersion": 2,
  "providerGroups": [
    {
      "id": "openai",
      "provider": "openai",
      "apiBase": "https://api.openai.com/v1",
      "models": [{ "name": "gpt-4o-mini" }]
    }
  ],
  "activeModel": { "groupId": "openai", "name": "gpt-4o-mini" }
}
"#;
        let parsed = deserialize_config(config, Path::new("config.json")).expect("parse config");
        let active = parsed.active_model_profile().expect("active model");
        assert_eq!(active.transport_kind(), ModelTransportKind::OpenResponses);

        let legacy = r#"
{
  "schemaVersion": 2,
  "providerGroups": [
    {
      "id": "openai",
      "provider": "openai",
      "apiBase": "https://api.openai.com/v1",
      "transportKind": "openai-compatible",
      "models": [{ "name": "gpt-4o-mini" }]
    }
  ],
  "activeModel": { "groupId": "openai", "name": "gpt-4o-mini" }
}
"#;
        let legacy_parsed =
            deserialize_config(legacy, Path::new("config.json")).expect("parse legacy config");
        let legacy_active = legacy_parsed.active_model_profile().expect("active model");
        assert_eq!(
            legacy_active.transport_kind(),
            ModelTransportKind::OpenResponses
        );
    }

    #[test]
    fn deserializes_siliconflow_provider_site_from_desktop_config() {
        let raw = r#"{
          "schemaVersion": 2,
          "providerGroups": [{
            "id": "siliconflow",
            "provider": "siliconflow",
            "apiBase": "https://api.siliconflow.cn/v1",
            "providerSite": "cn",
            "transportKind": "anthropic",
            "models": [{ "name": "deepseek-ai/DeepSeek-V3" }]
          }],
          "activeModel": { "groupId": "siliconflow", "name": "deepseek-ai/DeepSeek-V3" }
        }"#;
        let parsed = deserialize_config(raw, Path::new("config.json")).expect("parse config");
        let model = parsed.active_model_profile().expect("model");
        assert_eq!(model.provider, Some(ModelProvider::Siliconflow));
        assert_eq!(model.provider_site().as_deref(), Some("cn"));
        assert_eq!(model.transport_kind(), ModelTransportKind::Anthropic);
    }

    #[test]
    fn deserializes_moonshot_provider_site_from_desktop_config() {
        let raw = r#"{
          "schemaVersion": 2,
          "providerGroups": [{
            "id": "moonshot-ai",
            "provider": "moonshot-ai",
            "apiBase": "https://api.moonshot.ai/v1",
            "providerSite": "intl",
            "models": [{ "name": "kimi-k2" }]
          }],
          "activeModel": { "groupId": "moonshot-ai", "name": "kimi-k2" }
        }"#;
        let parsed = deserialize_config(raw, Path::new("config.json")).expect("parse config");
        let model = parsed.active_model_profile().expect("model");
        assert_eq!(model.provider, Some(ModelProvider::Moonshot));
        assert_eq!(model.provider_site().as_deref(), Some("intl"));
    }

    #[test]
    fn deserializes_minimax_provider_site_from_desktop_config() {
        let raw = r#"{
          "schemaVersion": 2,
          "providerGroups": [{
            "id": "minimax",
            "provider": "minimax",
            "apiBase": "https://api.minimax.io/anthropic/v1",
            "providerSite": "intl",
            "transportKind": "anthropic",
            "models": [{ "name": "MiniMax-M2.5" }]
          }],
          "activeModel": { "groupId": "minimax", "name": "MiniMax-M2.5" }
        }"#;
        let parsed = deserialize_config(raw, Path::new("config.json")).expect("parse config");
        let model = parsed.active_model_profile().expect("model");
        assert_eq!(model.provider, Some(ModelProvider::Minimax));
        assert_eq!(model.provider_site().as_deref(), Some("intl"));
        assert_eq!(model.transport_kind(), ModelTransportKind::Anthropic);
    }

    #[test]
    fn minimax_transport_kind_defaults_to_anthropic_without_explicit_kind() {
        let profile = test_profile(
            "minimax",
            "MiniMax-M3",
            "https://api.minimaxi.com/anthropic/v1",
            ModelProvider::Minimax,
        );
        assert_eq!(profile.transport_kind(), ModelTransportKind::Anthropic);
    }

    #[test]
    fn deserializes_alibaba_provider_site_and_workspace_from_desktop_config() {
        let raw = r#"{
          "schemaVersion": 2,
          "providerGroups": [{
            "id": "alibaba",
            "provider": "alibaba",
            "apiBase": "https://ws123.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
            "providerSite": "ap-southeast-1",
            "alibabaWorkspaceId": "ws123",
            "transportKind": "openai-compatible",
            "models": [{ "name": "qwen3.6-plus" }]
          }],
          "activeModel": { "groupId": "alibaba", "name": "qwen3.6-plus" }
        }"#;
        let parsed = deserialize_config(raw, Path::new("config.json")).expect("parse config");
        let model = parsed.active_model_profile().expect("model");
        assert_eq!(model.provider, Some(ModelProvider::Alibaba));
        assert_eq!(model.provider_site().as_deref(), Some("ap-southeast-1"));
        assert_eq!(model.alibaba_workspace_id().as_deref(), Some("ws123"));
    }

    #[test]
    fn deserializes_alibaba_token_plan_billing_mode_from_desktop_config() {
        let raw = r#"{
          "schemaVersion": 2,
          "providerGroups": [{
            "id": "alibaba",
            "provider": "alibaba",
            "apiBase": "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
            "alibabaBillingMode": "token-plan",
            "transportKind": "openai-compatible",
            "models": [{ "name": "qwen3.6-plus" }]
          }],
          "activeModel": { "groupId": "alibaba", "name": "qwen3.6-plus" }
        }"#;
        let parsed = deserialize_config(raw, Path::new("config.json")).expect("parse config");
        let model = parsed.active_model_profile().expect("model");
        assert_eq!(model.provider, Some(ModelProvider::Alibaba));
        assert_eq!(model.alibaba_billing_mode().as_deref(), Some("token-plan"));
        assert!(model.provider_site().is_none());
        assert!(model.alibaba_workspace_id().is_none());
    }

    #[test]
    fn deserializes_permission_config_and_round_trips() {
        let raw = r#"{
          "schemaVersion": 2,
          "providerGroups": [],
          "activeModel": { "groupId": "g", "name": "m" },
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
    fn reconnect_z_ai_standard_clears_glm_coding_plan_billing_mode() {
        let mut cfg = AppConfig::default();
        cfg.add_model_to_group(
            "z-ai",
            ModelProvider::ZAi,
            "https://api.z.ai/api/coding/paas/v4".to_string(),
            ProviderGroupConnectDraft {
                z_ai_billing_mode: Some("glm-coding-plan".to_string()),
                ..ProviderGroupConnectDraft::default()
            },
            ModelEntry {
                name: "glm-4.7".to_string(),
                reasoning_effort: None,
                reasoning_mode: None,
                thinking_enabled: None,
                supported_reasoning_efforts: None,
                capabilities: None,
                context_length: None,
                supports_thinking_type: None,
                supports_thinking_switch: None,
            },
        );
        assert_eq!(
            cfg.provider_groups[0].z_ai_billing_mode.as_deref(),
            Some("glm-coding-plan")
        );

        cfg.add_model_to_group(
            "z-ai",
            ModelProvider::ZAi,
            "https://api.z.ai/api/paas/v4".to_string(),
            ProviderGroupConnectDraft::default(),
            ModelEntry {
                name: "glm-4.7".to_string(),
                reasoning_effort: None,
                reasoning_mode: None,
                thinking_enabled: None,
                supported_reasoning_efforts: None,
                capabilities: None,
                context_length: None,
                supports_thinking_type: None,
                supports_thinking_switch: None,
            },
        );
        assert!(cfg.provider_groups[0].z_ai_billing_mode.is_none());
        assert_eq!(
            cfg.provider_groups[0].api_base,
            "https://api.z.ai/api/paas/v4"
        );
    }

    #[test]
    fn active_model_profile_merges_group_and_model_entry() {
        let mut cfg = AppConfig::default();
        cfg.add_model_to_group(
            "openai",
            ModelProvider::Openai,
            "https://api.openai.com/v1".to_string(),
            ProviderGroupConnectDraft::default(),
            ModelEntry {
                name: "gpt-4o-mini".to_string(),
                reasoning_effort: Some("medium".to_string()),
                reasoning_mode: None,
                thinking_enabled: None,
                supported_reasoning_efforts: None,
                capabilities: Some(vec!["chat".to_string()]),
                context_length: None,
                supports_thinking_type: None,
                supports_thinking_switch: None,
            },
        );
        cfg.active_model = ModelRef {
            group_id: "openai".to_string(),
            name: "gpt-4o-mini".to_string(),
        };
        let active = cfg.active_model_profile().expect("active model");
        assert_eq!(active.group_id, "openai");
        assert_eq!(active.name, "gpt-4o-mini");
        assert_eq!(active.api_base, "https://api.openai.com/v1");
        assert_eq!(active.provider, Some(ModelProvider::Openai));
    }

    #[test]
    fn has_sendable_active_model_is_false_without_a_profile() {
        let cfg = AppConfig::default();
        assert!(!cfg.has_sendable_active_model());
    }

    #[test]
    fn has_sendable_active_model_is_true_with_a_named_profile() {
        let mut cfg = AppConfig::default();
        cfg.add_model_to_group(
            "openai",
            ModelProvider::Openai,
            "https://api.openai.com/v1".to_string(),
            ProviderGroupConnectDraft::default(),
            ModelEntry {
                name: "gpt-4o-mini".to_string(),
                reasoning_effort: Some("medium".to_string()),
                reasoning_mode: None,
                thinking_enabled: None,
                supported_reasoning_efforts: None,
                capabilities: Some(vec!["chat".to_string()]),
                context_length: None,
                supports_thinking_type: None,
                supports_thinking_switch: None,
            },
        );
        cfg.active_model = ModelRef {
            group_id: "openai".to_string(),
            name: "gpt-4o-mini".to_string(),
        };
        assert!(cfg.has_sendable_active_model());
    }
}
