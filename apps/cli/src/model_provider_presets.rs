//! Same source as `packages/host-internal/src/model-provider-presets.json` (TUI preset root URLs and order).

use crate::model_registry::ModelTransportKind;
use serde::Deserialize;
use std::sync::OnceLock;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelProviderPresetsFile {
    #[allow(dead_code)]
    default_custom_api_base: String,
    preset_api_base_by_provider: std::collections::BTreeMap<String, String>,
    picker_order: Vec<String>,
}

static PRESETS: OnceLock<ModelProviderPresetsFile> = OnceLock::new();

fn presets() -> &'static ModelProviderPresetsFile {
    PRESETS.get_or_init(|| {
        serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../packages/host-internal/src/model-provider-presets.json"
        )))
        .expect("parse packages/host-internal/src/model-provider-presets.json")
    })
}

/// `selected` matches the bottom form "Provider" option index and aligns with `pickerOrder` in the JSON.
pub(crate) fn model_add_preset_api_base_by_choice_index(selected: usize) -> Option<String> {
    let p = presets();
    let id = p.picker_order.get(selected)?;
    if id == "custom" {
        return None;
    }
    p.preset_api_base_by_provider.get(id).cloned()
}

pub(crate) fn model_add_preset_api_base_by_provider(
    provider: crate::model_registry::ModelProvider,
) -> Option<String> {
    if provider == crate::model_registry::ModelProvider::Custom {
        return None;
    }
    presets()
        .preset_api_base_by_provider
        .get(provider.as_str())
        .cloned()
}

/// Aligned with `presetApiBaseByTransport.kimi-code` / `providerSiteSelection.kimi-code`.
pub(crate) fn model_add_kimi_code_site_api_base(
    site: &str,
    transport_kind: ModelTransportKind,
) -> Option<String> {
    let origin = match site.trim().to_ascii_lowercase().as_str() {
        "cn" => "https://api.kimi.com",
        "intl" => "https://api.kimi.ai",
        _ => return None,
    };
    match transport_kind {
        ModelTransportKind::Anthropic => Some(format!("{origin}/coding")),
        ModelTransportKind::OpenAiCompatible => Some(format!("{origin}/coding/v1")),
        _ => None,
    }
}

pub(crate) fn model_add_kimi_code_api_base(transport_kind: ModelTransportKind) -> Option<String> {
    model_add_kimi_code_site_api_base("intl", transport_kind)
}

pub(crate) fn model_add_kimi_code_site_id_from_choice(selected: usize) -> &'static str {
    if selected == 0 { "cn" } else { "intl" }
}

pub(crate) fn model_add_kimi_code_site_id_from_api_base(api_base: &str) -> Option<&'static str> {
    let after_scheme = api_base
        .trim()
        .strip_prefix("https://")
        .or_else(|| api_base.trim().strip_prefix("http://"))?;
    let host = after_scheme.split('/').next()?.split(':').next()?;
    match host {
        "api.kimi.com" => Some("cn"),
        "api.kimi.ai" => Some("intl"),
        _ => None,
    }
}

pub(crate) fn model_add_default_custom_api_base(transport_kind: ModelTransportKind) -> String {
    let p = presets();
    match transport_kind {
        ModelTransportKind::OpenAiCompatible | ModelTransportKind::OpenResponses => {
            p.default_custom_api_base.clone()
        }
        ModelTransportKind::Anthropic => p
            .preset_api_base_by_provider
            .get("anthropic")
            .cloned()
            .unwrap_or_else(|| p.default_custom_api_base.clone()),
        ModelTransportKind::Bedrock => p
            .preset_api_base_by_provider
            .get("amazon-bedrock")
            .cloned()
            .unwrap_or_else(|| p.default_custom_api_base.clone()),
    }
}

pub(crate) fn is_valid_azure_resource_name(resource_name: &str) -> bool {
    let trimmed = resource_name.trim();
    if trimmed.len() < 2 || trimmed.len() > 64 {
        return false;
    }
    let bytes = trimmed.as_bytes();
    if !bytes[0].is_ascii_alphanumeric() || !bytes[bytes.len() - 1].is_ascii_alphanumeric() {
        return false;
    }
    trimmed
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

pub(crate) fn validate_azure_resource_name(resource_name: &str) -> Result<String, String> {
    let trimmed = resource_name.trim().to_string();
    if is_valid_azure_resource_name(&trimmed) {
        Ok(trimmed)
    } else {
        Err("Azure resource name must be 2–64 characters and contain only letters, numbers, and hyphens; it cannot start or end with a hyphen.".to_string())
    }
}

pub(crate) fn azure_api_base_from_resource_name(resource_name: &str) -> String {
    let trimmed = resource_name.trim();
    if trimmed.is_empty() {
        return "https://YOUR_RESOURCE_NAME.openai.azure.com/openai/v1".to_string();
    }
    if let Ok(validated) = validate_azure_resource_name(trimmed) {
        return format!("https://{validated}.openai.azure.com/openai/v1");
    }
    format!("https://{trimmed}.openai.azure.com/openai/v1")
}

pub(crate) fn extract_azure_resource_name_from_api_base(base_url: &str) -> Option<String> {
    let normalized = base_url.trim().trim_end_matches('/');
    let lower = normalized.to_ascii_lowercase();
    if !lower.starts_with("https://") {
        return None;
    }
    let after_scheme = &normalized[8..];
    let host_end = after_scheme.find('/').unwrap_or(after_scheme.len());
    let host = &after_scheme[..host_end];
    const SUFFIX: &str = ".openai.azure.com";
    if !host.to_ascii_lowercase().ends_with(SUFFIX) {
        return None;
    }
    let resource = host[..host.len() - SUFFIX.len()].trim();
    if resource.is_empty() || !is_valid_azure_resource_name(resource) {
        None
    } else {
        Some(resource.to_string())
    }
}

pub(crate) fn resolve_azure_resource_name(
    explicit: Option<String>,
    api_base: &str,
) -> Option<String> {
    explicit.or_else(|| extract_azure_resource_name_from_api_base(api_base))
}

pub(crate) fn is_valid_cloudflare_account_id(account_id: &str) -> bool {
    let trimmed = account_id.trim();
    trimmed.len() == 32 && trimmed.bytes().all(|byte| byte.is_ascii_hexdigit())
}

pub(crate) fn is_valid_cloudflare_gateway_id(gateway_id: &str) -> bool {
    let trimmed = gateway_id.trim();
    if trimmed.is_empty() || trimmed.len() > 64 {
        return false;
    }
    let bytes = trimmed.as_bytes();
    if !bytes[0].is_ascii_alphanumeric() || !bytes[bytes.len() - 1].is_ascii_alphanumeric() {
        return false;
    }
    trimmed
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

pub(crate) fn cloudflare_ai_gateway_api_base_from_account_id(account_id: &str) -> String {
    let trimmed = account_id.trim();
    if trimmed.is_empty() || !is_valid_cloudflare_account_id(trimmed) {
        return format!(
            "https://api.cloudflare.com/client/v4/accounts/{}/ai/v1",
            "YOUR_ACCOUNT_ID"
        );
    }
    format!("https://api.cloudflare.com/client/v4/accounts/{trimmed}/ai/v1")
}

pub(crate) fn model_add_picker_order_ids() -> &'static [String] {
    &presets().picker_order
}

/// Aligned with `providerSiteSelection.siliconflow` in `model-provider-presets.json`.
pub(crate) fn model_add_siliconflow_site_api_base(site: &str) -> Option<String> {
    match site.trim().to_ascii_lowercase().as_str() {
        "cn" => Some("https://api.siliconflow.cn/v1".to_string()),
        "intl" => Some("https://api.siliconflow.com/v1".to_string()),
        _ => None,
    }
}

pub(crate) fn model_add_siliconflow_site_id_from_choice(selected: usize) -> &'static str {
    if selected == 0 { "cn" } else { "intl" }
}

/// Aligned with `providerSiteSelection.moonshot-ai` in `model-provider-presets.json`.
pub(crate) fn model_add_moonshot_site_api_base(site: &str) -> Option<String> {
    match site.trim().to_ascii_lowercase().as_str() {
        "cn" => Some("https://api.moonshot.cn/v1".to_string()),
        "intl" => Some("https://api.moonshot.ai/v1".to_string()),
        _ => None,
    }
}

pub(crate) fn model_add_moonshot_site_id_from_choice(selected: usize) -> &'static str {
    if selected == 0 { "cn" } else { "intl" }
}

/// Aligned with `providerSiteSelection.tencent-tokenhub` in `model-provider-presets.json`.
pub(crate) fn model_add_tencent_tokenhub_site_api_base(site: &str) -> Option<String> {
    match site.trim().to_ascii_lowercase().as_str() {
        "cn" => Some("https://tokenhub.tencentmaas.com/v1".to_string()),
        "intl" => Some("https://tokenhub-intl.tencentmaas.com/v1".to_string()),
        _ => None,
    }
}

pub(crate) fn model_add_tencent_tokenhub_site_id_from_choice(selected: usize) -> &'static str {
    if selected == 0 { "cn" } else { "intl" }
}

/// Aligned with `providerSiteSelection.minimax` in `model-provider-presets.json`.
pub(crate) fn model_add_minimax_site_api_base(
    site: &str,
    transport_kind: ModelTransportKind,
) -> Option<String> {
    let origin = match site.trim().to_ascii_lowercase().as_str() {
        "cn" => "https://api.minimaxi.com",
        "intl" => "https://api.minimax.io",
        _ => return None,
    };
    match transport_kind {
        ModelTransportKind::Anthropic => Some(format!("{origin}/anthropic/v1")),
        _ => Some(format!("{origin}/v1")),
    }
}

pub(crate) fn model_add_minimax_site_id_from_choice(selected: usize) -> &'static str {
    if selected == 0 { "cn" } else { "intl" }
}

/// Aligned with `providerSiteSelection.alibaba` in `model-provider-presets.json`.
pub(crate) fn model_add_alibaba_site_ids() -> &'static [&'static str] {
    &[
        "cn-beijing",
        "ap-southeast-1",
        "us-virginia",
        "eu-central-1",
    ]
}

pub(crate) fn model_add_alibaba_site_id_from_choice(selected: usize) -> &'static str {
    model_add_alibaba_site_ids()
        .get(selected.min(model_add_alibaba_site_ids().len().saturating_sub(1)))
        .copied()
        .unwrap_or("cn-beijing")
}

pub(crate) fn model_add_alibaba_site_requires_workspace_id(site: &str) -> bool {
    matches!(
        site.trim(),
        "cn-beijing" | "ap-southeast-1" | "eu-central-1"
    )
}

/// Aligned with `alibabaTokenPlan.compatibleApiBase` in `model-provider-presets.json`.
const ALIBABA_TOKEN_PLAN_COMPATIBLE_API_BASE: &str =
    "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1";

/// Aligned with `zAiGlmCodingPlan.compatibleApiBase` in `model-provider-presets.json`.
const Z_AI_GLM_CODING_PLAN_COMPATIBLE_API_BASE: &str = "https://api.z.ai/api/coding/paas/v4";

/// Aligned with `zhipuAiGlmCodingPlan.compatibleApiBase` in `model-provider-presets.json`.
const ZHIPU_AI_GLM_CODING_PLAN_COMPATIBLE_API_BASE: &str =
    "https://open.bigmodel.cn/api/coding/paas/v4";

/// Aligned with `providerSiteSelection.stepfun` in `model-provider-presets.json`.
pub(crate) fn model_add_stepfun_site_id_from_choice(selected: usize) -> &'static str {
    if selected == 0 { "cn" } else { "intl" }
}

pub(crate) fn model_add_stepfun_api_base(
    transport_kind: ModelTransportKind,
    step_plan: bool,
    site: Option<&str>,
) -> Option<String> {
    let origin = match site.unwrap_or("cn").trim().to_ascii_lowercase().as_str() {
        "cn" => "https://api.stepfun.com",
        "intl" => "https://api.stepfun.ai",
        _ => return None,
    };
    if step_plan {
        return match transport_kind {
            ModelTransportKind::Anthropic => Some(format!("{origin}/step_plan")),
            ModelTransportKind::OpenAiCompatible | ModelTransportKind::OpenResponses => {
                Some(format!("{origin}/step_plan/v1"))
            }
            _ => None,
        };
    }

    match transport_kind {
        ModelTransportKind::Anthropic => Some(origin.to_string()),
        ModelTransportKind::OpenAiCompatible | ModelTransportKind::OpenResponses => {
            Some(format!("{origin}/v1"))
        }
        _ => None,
    }
}

pub(crate) fn model_add_z_ai_api_base(glm_coding_plan: bool) -> Option<String> {
    if glm_coding_plan {
        return Some(Z_AI_GLM_CODING_PLAN_COMPATIBLE_API_BASE.to_string());
    }
    model_add_preset_api_base_by_provider(crate::model_registry::ModelProvider::ZAi)
}

pub(crate) fn model_add_zhipu_ai_api_base(glm_coding_plan: bool) -> Option<String> {
    if glm_coding_plan {
        return Some(ZHIPU_AI_GLM_CODING_PLAN_COMPATIBLE_API_BASE.to_string());
    }
    model_add_preset_api_base_by_provider(crate::model_registry::ModelProvider::ZhipuAi)
}

pub(crate) fn model_add_alibaba_token_plan_api_base(
    transport_kind: ModelTransportKind,
) -> Option<String> {
    match transport_kind {
        ModelTransportKind::Anthropic => {
            model_add_alibaba_anthropic_site_api_base(ALIBABA_TOKEN_PLAN_COMPATIBLE_API_BASE)
        }
        ModelTransportKind::OpenAiCompatible | ModelTransportKind::OpenResponses => {
            Some(ALIBABA_TOKEN_PLAN_COMPATIBLE_API_BASE.to_string())
        }
        _ => None,
    }
}

fn model_add_alibaba_compatible_site_api_base(site: &str, workspace_id: &str) -> Option<String> {
    match site.trim() {
        "cn-beijing" => {
            let workspace = workspace_id.trim();
            if workspace.is_empty() {
                return None;
            }
            Some(format!(
                "https://{workspace}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"
            ))
        }
        "us-virginia" => Some("https://dashscope-us.aliyuncs.com/compatible-mode/v1".to_string()),
        "ap-southeast-1" => {
            let workspace = workspace_id.trim();
            if workspace.is_empty() {
                return None;
            }
            Some(format!(
                "https://{workspace}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1"
            ))
        }
        "eu-central-1" => {
            let workspace = workspace_id.trim();
            if workspace.is_empty() {
                return None;
            }
            Some(format!(
                "https://{workspace}.eu-central-1.maas.aliyuncs.com/compatible-mode/v1"
            ))
        }
        _ => None,
    }
}

fn model_add_alibaba_anthropic_site_api_base(compatible_base: &str) -> Option<String> {
    let trimmed = compatible_base.trim().trim_end_matches('/');
    let origin = trimmed.strip_suffix("/compatible-mode/v1")?;
    Some(format!("{origin}/apps/anthropic"))
}

pub(crate) fn model_add_alibaba_site_api_base(
    site: &str,
    workspace_id: &str,
    transport_kind: ModelTransportKind,
) -> Option<String> {
    let compatible_base = model_add_alibaba_compatible_site_api_base(site, workspace_id)?;
    match transport_kind {
        ModelTransportKind::Anthropic => {
            model_add_alibaba_anthropic_site_api_base(&compatible_base)
        }
        ModelTransportKind::OpenAiCompatible | ModelTransportKind::OpenResponses => {
            Some(compatible_base)
        }
        _ => None,
    }
}

pub(crate) fn model_add_provider_id_at_choice_index(selected: usize) -> Option<&'static str> {
    presets().picker_order.get(selected).map(String::as_str)
}

pub(crate) fn model_add_provider_at_choice_index(
    selected: usize,
) -> Option<crate::model_registry::ModelProvider> {
    let id = model_add_provider_id_at_choice_index(selected)?;
    if id == "custom" {
        return Some(crate::model_registry::ModelProvider::Custom);
    }
    id.parse().ok()
}

pub(crate) fn model_add_requires_manual_single_provider(
    provider: crate::model_registry::ModelProvider,
) -> bool {
    matches!(
        provider,
        crate::model_registry::ModelProvider::Azure
            | crate::model_registry::ModelProvider::CloudflareAiGateway
    )
}

/// Aligned with Desktop `resolveProfileApiBase`: hosted providers recompute the endpoint from `providerSite` etc. instead of blindly reading `apiBase`.
pub(crate) fn resolve_profile_api_base(profile: &crate::model_registry::ModelProfile) -> String {
    use crate::model_registry::{DEFAULT_API_BASE, ModelProvider};

    if profile.provider == Some(ModelProvider::AmazonBedrock)
        && let Some(region) = profile.aws_region()
    {
        if crate::bedrock_mantle::is_bedrock_mantle_openai_model(&profile.name) {
            return crate::bedrock_mantle::bedrock_mantle_api_base_from_region(&region);
        }
        return bedrock_api_base_from_region(&region);
    }

    if profile.provider == Some(ModelProvider::GoogleVertexAi) {
        if let (Some(project), Some(location)) =
            (profile.vertex_project(), profile.vertex_location())
        {
            return crate::vertex_models_list::vertex_api_base_from_project_and_location(
                &project, &location,
            );
        }
        let trimmed = profile.api_base.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
        return String::new();
    }

    if profile.provider == Some(ModelProvider::Azure) {
        if let Some(resource_name) = profile.azure_resource_name() {
            return azure_api_base_from_resource_name(&resource_name);
        }
        let trimmed = profile.api_base.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
        return azure_api_base_from_resource_name("");
    }

    if profile.provider == Some(ModelProvider::CloudflareAiGateway) {
        if let Some(account_id) = profile.cloudflare_account_id() {
            return cloudflare_ai_gateway_api_base_from_account_id(&account_id);
        }
        let trimmed = profile.api_base.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
        return cloudflare_ai_gateway_api_base_from_account_id("");
    }

    if profile.provider == Some(ModelProvider::Alibaba)
        && profile.alibaba_billing_mode().as_deref() == Some("token-plan")
        && let Some(base) = model_add_alibaba_token_plan_api_base(profile.transport_kind())
    {
        return base;
    }

    if profile.provider == Some(ModelProvider::Stepfun) {
        let step_plan = profile.stepfun_billing_mode().as_deref() == Some("step-plan");
        if let Some(base) = model_add_stepfun_api_base(
            profile.transport_kind(),
            step_plan,
            profile.provider_site().as_deref(),
        ) {
            return base;
        }
    }

    if profile.provider == Some(ModelProvider::ZAi) {
        let glm_coding_plan = profile.z_ai_billing_mode().as_deref() == Some("glm-coding-plan");
        if let Some(base) = model_add_z_ai_api_base(glm_coding_plan) {
            return base;
        }
    }

    if profile.provider == Some(ModelProvider::ZhipuAi) {
        let glm_coding_plan = profile.zhipu_billing_mode().as_deref() == Some("glm-coding-plan");
        if let Some(base) = model_add_zhipu_ai_api_base(glm_coding_plan) {
            return base;
        }
    }

    if let Some(provider) = profile.provider
        && provider != ModelProvider::Custom
    {
        let inferred_kimi_site = (provider == ModelProvider::KimiCode)
            .then(|| model_add_kimi_code_site_id_from_api_base(&profile.api_base))
            .flatten();
        return default_api_base_for_transport(
            provider,
            profile.transport_kind(),
            profile.provider_site().as_deref().or(inferred_kimi_site),
            profile.alibaba_workspace_id().as_deref().unwrap_or(""),
        );
    }

    let trimmed = profile.api_base.trim();
    if trimmed.is_empty() {
        DEFAULT_API_BASE.to_string()
    } else {
        trimmed.to_string()
    }
}

fn bedrock_api_base_from_region(region: &str) -> String {
    format!("https://bedrock.{}.amazonaws.com", region.trim())
}

fn default_api_base_for_transport(
    provider: crate::model_registry::ModelProvider,
    transport_kind: ModelTransportKind,
    site: Option<&str>,
    workspace_id: &str,
) -> String {
    if let Some(site) = site
        && let Some(base) = resolve_site_api_base(provider, transport_kind, site, workspace_id)
    {
        return base;
    }
    if provider == crate::model_registry::ModelProvider::KimiCode
        && let Some(base) = model_add_kimi_code_api_base(transport_kind)
    {
        return base;
    }
    model_add_preset_api_base_by_provider(provider)
        .unwrap_or_else(|| model_add_default_custom_api_base(transport_kind))
}

fn resolve_site_api_base(
    provider: crate::model_registry::ModelProvider,
    transport_kind: ModelTransportKind,
    site: &str,
    workspace_id: &str,
) -> Option<String> {
    match provider {
        crate::model_registry::ModelProvider::Moonshot => model_add_moonshot_site_api_base(site),
        crate::model_registry::ModelProvider::Siliconflow => {
            model_add_siliconflow_site_api_base(site)
        }
        crate::model_registry::ModelProvider::Minimax => {
            model_add_minimax_site_api_base(site, transport_kind)
        }
        crate::model_registry::ModelProvider::Alibaba => {
            model_add_alibaba_site_api_base(site, workspace_id, transport_kind)
        }
        crate::model_registry::ModelProvider::TencentTokenhub => {
            model_add_tencent_tokenhub_site_api_base(site)
        }
        crate::model_registry::ModelProvider::KimiCode => {
            model_add_kimi_code_site_api_base(site, transport_kind)
        }
        crate::model_registry::ModelProvider::Stepfun => {
            model_add_stepfun_api_base(transport_kind, false, Some(site))
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preset_bases_match_canonical_order() {
        assert_eq!(
            model_add_preset_api_base_by_choice_index(0).as_deref(),
            Some("https://api.openai.com/v1")
        );
        assert_eq!(
            model_add_preset_api_base_by_choice_index(1).as_deref(),
            Some("https://api.anthropic.com/v1")
        );
        assert_eq!(
            model_add_preset_api_base_by_choice_index(2).as_deref(),
            Some("https://generativelanguage.googleapis.com/v1beta")
        );
        assert_eq!(
            model_add_preset_api_base_by_choice_index(3).as_deref(),
            Some("https://api.x.ai/v1")
        );
        assert_eq!(
            model_add_preset_api_base_by_choice_index(4).as_deref(),
            Some("https://ai-gateway.vercel.sh/v1")
        );
        assert_eq!(
            model_add_preset_api_base_by_choice_index(5).as_deref(),
            Some("https://api.cloudflare.com/client/v4/accounts/YOUR_ACCOUNT_ID/ai/v1")
        );
        assert_eq!(
            model_add_preset_api_base_by_choice_index(6).as_deref(),
            Some("https://api.deepseek.com/v1")
        );
        assert_eq!(
            model_add_preset_api_base_by_choice_index(7).as_deref(),
            Some("https://openrouter.ai/api/v1")
        );
        assert_eq!(
            model_add_preset_api_base_by_choice_index(8).as_deref(),
            Some("https://api.fireworks.ai/inference/v1")
        );
        assert_eq!(
            model_add_preset_api_base_by_choice_index(9).as_deref(),
            Some("https://api.together.ai/v1")
        );
        assert_eq!(
            model_add_preset_api_base_by_choice_index(10).as_deref(),
            Some("https://api.groq.com/openai/v1")
        );
        assert_eq!(
            model_add_preset_api_base_by_choice_index(11).as_deref(),
            Some("https://api.deepinfra.com/v1/openai")
        );
        assert_eq!(
            model_add_preset_api_base_by_choice_index(12).as_deref(),
            Some("https://inference.baseten.co/v1")
        );
        assert_eq!(
            model_add_preset_api_base_by_choice_index(13).as_deref(),
            Some("https://router.huggingface.co/v1")
        );
        assert_eq!(
            model_add_preset_api_base_by_choice_index(14).as_deref(),
            Some("https://api.moonshot.ai/v1")
        );
        assert_eq!(
            model_add_preset_api_base_by_choice_index(15).as_deref(),
            Some("https://api.kimi.ai/coding/v1")
        );
        assert_eq!(
            model_add_preset_api_base_by_choice_index(16).as_deref(),
            Some("https://api.z.ai/api/paas/v4")
        );
        assert_eq!(
            model_add_preset_api_base_by_choice_index(17).as_deref(),
            Some("https://open.bigmodel.cn/api/paas/v4")
        );
        assert_eq!(
            model_add_preset_api_base_by_choice_index(18).as_deref(),
            Some("https://dashscope.aliyuncs.com/compatible-mode/v1")
        );
        assert_eq!(
            model_add_preset_api_base_by_choice_index(19).as_deref(),
            Some("https://api.minimax.io/anthropic/v1")
        );
        assert_eq!(
            model_add_preset_api_base_by_choice_index(20).as_deref(),
            Some("https://api.xiaomimimo.com/v1")
        );
        assert_eq!(
            model_add_preset_api_base_by_choice_index(21).as_deref(),
            Some("https://api.siliconflow.com/v1")
        );
        assert_eq!(
            model_add_preset_api_base_by_choice_index(22).as_deref(),
            Some("https://api.stepfun.com/v1")
        );
        assert_eq!(
            model_add_preset_api_base_by_choice_index(23).as_deref(),
            Some("https://ark.cn-beijing.volces.com/api/v3")
        );
        assert_eq!(
            model_add_preset_api_base_by_choice_index(24).as_deref(),
            Some("https://ark.ap-southeast.bytepluses.com/api/v3")
        );
        assert_eq!(
            model_add_preset_api_base_by_choice_index(25).as_deref(),
            Some("https://api.longcat.chat/openai/v1")
        );
        assert_eq!(
            model_add_preset_api_base_by_choice_index(26).as_deref(),
            Some("https://tokenhub.tencentmaas.com/v1")
        );
        assert_eq!(
            model_add_preset_api_base_by_choice_index(27).as_deref(),
            Some("https://api.mistral.ai/v1")
        );
        assert_eq!(
            model_add_preset_api_base_by_choice_index(28).as_deref(),
            Some("https://api.cohere.com/v2")
        );
        assert_eq!(
            model_add_preset_api_base_by_choice_index(29).as_deref(),
            Some("https://YOUR_RESOURCE_NAME.openai.azure.com/openai/v1")
        );
        assert_eq!(
            model_add_preset_api_base_by_choice_index(30).as_deref(),
            Some("https://bedrock.us-east-1.amazonaws.com")
        );
        assert_eq!(
            model_add_preset_api_base_by_choice_index(31).as_deref(),
            Some(
                "https://us-central1-aiplatform.googleapis.com/v1/projects/YOUR_PROJECT_ID/locations/us-central1"
            )
        );
        assert!(model_add_preset_api_base_by_choice_index(32).is_none());
    }

    #[test]
    fn kimi_code_api_base_resolves_openai_and_anthropic_transports() {
        assert_eq!(
            super::model_add_kimi_code_api_base(ModelTransportKind::OpenAiCompatible).as_deref(),
            Some("https://api.kimi.ai/coding/v1")
        );
        assert_eq!(
            super::model_add_kimi_code_api_base(ModelTransportKind::Anthropic).as_deref(),
            Some("https://api.kimi.ai/coding")
        );
        assert!(super::model_add_kimi_code_api_base(ModelTransportKind::OpenResponses).is_none());
    }

    #[test]
    fn kimi_code_site_api_base_resolves_cn_and_intl_with_transport() {
        assert_eq!(
            super::model_add_kimi_code_site_api_base("cn", ModelTransportKind::OpenAiCompatible)
                .as_deref(),
            Some("https://api.kimi.com/coding/v1")
        );
        assert_eq!(
            super::model_add_kimi_code_site_api_base("cn", ModelTransportKind::Anthropic)
                .as_deref(),
            Some("https://api.kimi.com/coding")
        );
        assert_eq!(
            super::model_add_kimi_code_site_api_base("intl", ModelTransportKind::OpenAiCompatible)
                .as_deref(),
            Some("https://api.kimi.ai/coding/v1")
        );
        assert_eq!(
            super::model_add_kimi_code_site_api_base("intl", ModelTransportKind::Anthropic)
                .as_deref(),
            Some("https://api.kimi.ai/coding")
        );
    }

    #[test]
    fn kimi_code_site_id_from_api_base_matches_host() {
        assert_eq!(
            super::model_add_kimi_code_site_id_from_api_base("https://api.kimi.com/coding/v1"),
            Some("cn")
        );
        assert_eq!(
            super::model_add_kimi_code_site_id_from_api_base("https://api.kimi.ai/coding"),
            Some("intl")
        );
        assert_eq!(
            super::model_add_kimi_code_site_id_from_api_base("https://api.example.com/v1"),
            None
        );
    }

    #[test]
    fn resolve_profile_api_base_prefers_kimi_code_cn_site_over_stored_api_base() {
        let profile: crate::model_registry::ModelProfile =
            serde_json::from_value(serde_json::json!({
                "name": "kimi-for-coding",
                "apiBase": "https://api.kimi.ai/coding/v1",
                "provider": "kimi-code",
                "providerSite": "cn"
            }))
            .expect("parse model profile");
        assert_eq!(
            resolve_profile_api_base(&profile),
            "https://api.kimi.com/coding/v1"
        );
    }

    #[test]
    fn resolve_profile_api_base_infers_kimi_code_cn_site_from_stored_api_base() {
        let profile: crate::model_registry::ModelProfile =
            serde_json::from_value(serde_json::json!({
                "name": "kimi-for-coding",
                "apiBase": "https://api.kimi.com/coding/v1",
                "provider": "kimi-code"
            }))
            .expect("parse model profile");
        assert_eq!(
            resolve_profile_api_base(&profile),
            "https://api.kimi.com/coding/v1"
        );
    }

    #[test]
    fn stepfun_api_base_resolves_site_and_step_plan() {
        assert_eq!(
            super::model_add_stepfun_api_base(ModelTransportKind::OpenAiCompatible, false, None)
                .as_deref(),
            Some("https://api.stepfun.com/v1")
        );
        assert_eq!(
            super::model_add_stepfun_api_base(ModelTransportKind::Anthropic, false, Some("intl"))
                .as_deref(),
            Some("https://api.stepfun.ai")
        );
        assert_eq!(
            super::model_add_stepfun_api_base(
                ModelTransportKind::OpenAiCompatible,
                true,
                Some("intl")
            )
            .as_deref(),
            Some("https://api.stepfun.ai/step_plan/v1")
        );
        assert_eq!(
            super::model_add_stepfun_api_base(ModelTransportKind::Anthropic, true, Some("cn"))
                .as_deref(),
            Some("https://api.stepfun.com/step_plan")
        );
    }

    #[test]
    fn siliconflow_site_api_base_resolves_cn_and_intl() {
        assert_eq!(
            super::model_add_siliconflow_site_api_base("cn").as_deref(),
            Some("https://api.siliconflow.cn/v1")
        );
        assert_eq!(
            super::model_add_siliconflow_site_api_base("intl").as_deref(),
            Some("https://api.siliconflow.com/v1")
        );
    }

    #[test]
    fn moonshot_site_api_base_resolves_cn_and_intl() {
        assert_eq!(
            super::model_add_moonshot_site_api_base("cn").as_deref(),
            Some("https://api.moonshot.cn/v1")
        );
        assert_eq!(
            super::model_add_moonshot_site_api_base("intl").as_deref(),
            Some("https://api.moonshot.ai/v1")
        );
    }

    #[test]
    fn tencent_tokenhub_site_api_base_resolves_cn_and_intl() {
        assert_eq!(
            super::model_add_tencent_tokenhub_site_api_base("cn").as_deref(),
            Some("https://tokenhub.tencentmaas.com/v1")
        );
        assert_eq!(
            super::model_add_tencent_tokenhub_site_api_base("intl").as_deref(),
            Some("https://tokenhub-intl.tencentmaas.com/v1")
        );
    }

    #[test]
    fn resolve_profile_api_base_prefers_moonshot_cn_site_over_stored_api_base() {
        let profile: crate::model_registry::ModelProfile =
            serde_json::from_value(serde_json::json!({
                "name": "kimi-k2.7-code",
                "apiBase": "https://api.moonshot.ai/v1",
                "provider": "moonshot-ai",
                "providerSite": "cn"
            }))
            .expect("parse model profile");
        assert_eq!(
            resolve_profile_api_base(&profile),
            "https://api.moonshot.cn/v1"
        );
    }

    #[test]
    fn minimax_site_api_base_resolves_cn_and_intl_with_transport() {
        assert_eq!(
            super::model_add_minimax_site_api_base("cn", ModelTransportKind::OpenAiCompatible)
                .as_deref(),
            Some("https://api.minimaxi.com/v1")
        );
        assert_eq!(
            super::model_add_minimax_site_api_base("cn", ModelTransportKind::Anthropic).as_deref(),
            Some("https://api.minimaxi.com/anthropic/v1")
        );
        assert_eq!(
            super::model_add_minimax_site_api_base("intl", ModelTransportKind::OpenAiCompatible)
                .as_deref(),
            Some("https://api.minimax.io/v1")
        );
        assert_eq!(
            super::model_add_minimax_site_api_base("intl", ModelTransportKind::Anthropic)
                .as_deref(),
            Some("https://api.minimax.io/anthropic/v1")
        );
    }

    #[test]
    fn alibaba_site_api_base_resolves_regions_and_transports() {
        assert_eq!(
            super::model_add_alibaba_site_api_base(
                "cn-beijing",
                "ws-cn",
                ModelTransportKind::OpenAiCompatible,
            )
            .as_deref(),
            Some("https://ws-cn.cn-beijing.maas.aliyuncs.com/compatible-mode/v1")
        );
        assert_eq!(
            super::model_add_alibaba_site_api_base(
                "cn-beijing",
                "ws-cn",
                ModelTransportKind::Anthropic,
            )
            .as_deref(),
            Some("https://ws-cn.cn-beijing.maas.aliyuncs.com/apps/anthropic")
        );
        assert!(
            super::model_add_alibaba_site_api_base(
                "cn-beijing",
                "",
                ModelTransportKind::OpenAiCompatible,
            )
            .is_none()
        );
        assert_eq!(
            super::model_add_alibaba_site_api_base(
                "ap-southeast-1",
                "ws-123",
                ModelTransportKind::Anthropic,
            )
            .as_deref(),
            Some("https://ws-123.ap-southeast-1.maas.aliyuncs.com/apps/anthropic")
        );
        assert!(
            super::model_add_alibaba_site_api_base(
                "ap-southeast-1",
                "",
                ModelTransportKind::OpenAiCompatible,
            )
            .is_none()
        );
    }

    #[test]
    fn alibaba_token_plan_api_base_resolves_transports() {
        assert_eq!(
            super::model_add_alibaba_token_plan_api_base(ModelTransportKind::OpenAiCompatible)
                .as_deref(),
            Some("https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1")
        );
        assert_eq!(
            super::model_add_alibaba_token_plan_api_base(ModelTransportKind::Anthropic).as_deref(),
            Some("https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic")
        );
        assert_eq!(
            super::model_add_alibaba_token_plan_api_base(ModelTransportKind::OpenResponses)
                .as_deref(),
            Some("https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1")
        );
    }

    #[test]
    fn preset_api_base_by_provider_returns_google_api_base() {
        assert_eq!(
            super::model_add_preset_api_base_by_provider(
                crate::model_registry::ModelProvider::Google
            )
            .as_deref(),
            Some("https://generativelanguage.googleapis.com/v1beta")
        );
        assert!(
            super::model_add_preset_api_base_by_provider(
                crate::model_registry::ModelProvider::Custom
            )
            .is_none()
        );
    }

    #[test]
    fn custom_default_base_follows_transport_kind() {
        assert_eq!(
            model_add_default_custom_api_base(ModelTransportKind::OpenAiCompatible),
            "https://api.openai.com/v1"
        );
        assert_eq!(
            model_add_default_custom_api_base(ModelTransportKind::Anthropic),
            "https://api.anthropic.com/v1"
        );
    }

    #[test]
    fn extract_azure_resource_name_from_api_base_parses_host() {
        assert_eq!(
            super::extract_azure_resource_name_from_api_base(
                "https://my-openai-resource.openai.azure.com/openai/v1"
            )
            .as_deref(),
            Some("my-openai-resource")
        );
        assert!(
            super::extract_azure_resource_name_from_api_base("https://api.openai.com/v1").is_none()
        );
    }

    #[test]
    fn resolve_azure_resource_name_prefers_explicit_value() {
        assert_eq!(
            super::resolve_azure_resource_name(
                Some("explicit".to_string()),
                "https://other.openai.azure.com/openai/v1"
            )
            .as_deref(),
            Some("explicit")
        );
    }

    #[test]
    fn is_valid_azure_resource_name_rejects_invalid_values() {
        assert!(super::is_valid_azure_resource_name("my-openai-resource"));
        assert!(!super::is_valid_azure_resource_name("-bad"));
        assert!(!super::is_valid_azure_resource_name("bad@host"));
    }

    #[test]
    fn cloudflare_ai_gateway_api_base_from_account_id_builds_rest_base() {
        assert_eq!(
            super::cloudflare_ai_gateway_api_base_from_account_id(
                "0123456789abcdef0123456789abcdef"
            ),
            "https://api.cloudflare.com/client/v4/accounts/0123456789abcdef0123456789abcdef/ai/v1"
        );
    }

    #[test]
    fn cloudflare_ai_gateway_api_base_from_account_id_uses_placeholder_for_invalid_account() {
        assert_eq!(
            super::cloudflare_ai_gateway_api_base_from_account_id("not-valid"),
            "https://api.cloudflare.com/client/v4/accounts/YOUR_ACCOUNT_ID/ai/v1"
        );
    }

    #[test]
    fn is_valid_cloudflare_gateway_id_rejects_invalid_values() {
        assert!(super::is_valid_cloudflare_gateway_id("my-gateway"));
        assert!(!super::is_valid_cloudflare_gateway_id("-bad"));
        assert!(!super::is_valid_cloudflare_gateway_id("bad@host"));
    }

    #[test]
    fn z_ai_and_zhipu_api_base_follow_glm_coding_plan() {
        assert_eq!(
            super::model_add_z_ai_api_base(false).as_deref(),
            Some("https://api.z.ai/api/paas/v4")
        );
        assert_eq!(
            super::model_add_z_ai_api_base(true).as_deref(),
            Some("https://api.z.ai/api/coding/paas/v4")
        );
        assert_eq!(
            super::model_add_zhipu_ai_api_base(false).as_deref(),
            Some("https://open.bigmodel.cn/api/paas/v4")
        );
        assert_eq!(
            super::model_add_zhipu_ai_api_base(true).as_deref(),
            Some("https://open.bigmodel.cn/api/coding/paas/v4")
        );
    }
}
