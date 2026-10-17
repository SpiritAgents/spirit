//! Reads `packages/agent-core/src/provider-presets/provider-presets.json` (TUI preset endpoints and picker order).

use crate::model_registry::ModelTransportKind;
use serde::Deserialize;
use std::collections::BTreeMap;
use std::sync::OnceLock;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProviderPresetsFile {
    custom: CustomProviderPreset,
    providers: Vec<ProviderPresetEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CustomProviderPreset {
    default_api_base: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProviderPresetEntry {
    id: String,
    default_transport: String,
    transports: BTreeMap<String, String>,
    sites: Option<ProviderPresetSites>,
    billing_plans: Option<Vec<ProviderPresetBillingPlan>>,
}

#[derive(Debug, Deserialize)]
struct ProviderPresetSites {
    #[allow(dead_code)]
    default: String,
    items: Vec<ProviderPresetSite>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProviderPresetSite {
    id: String,
    api_base: Option<String>,
    transports: Option<BTreeMap<String, String>>,
    requires_workspace_id: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProviderPresetBillingPlan {
    id: String,
    api_base: Option<String>,
    transports: Option<BTreeMap<String, String>>,
}

struct Presets {
    file: ProviderPresetsFile,
    /// Picker order is the manifest array order; `custom` is the wizard-only last row.
    picker_order: Vec<String>,
}

static PRESETS: OnceLock<Presets> = OnceLock::new();

fn presets() -> &'static Presets {
    PRESETS.get_or_init(|| {
        let file: ProviderPresetsFile = serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../packages/agent-core/src/provider-presets/provider-presets.json"
        )))
        .expect("parse packages/agent-core/src/provider-presets/provider-presets.json");
        let picker_order = file
            .providers
            .iter()
            .map(|provider| provider.id.clone())
            .chain(std::iter::once("custom".to_string()))
            .collect();
        Presets { file, picker_order }
    })
}

fn preset_entry(provider_id: &str) -> Option<&'static ProviderPresetEntry> {
    presets()
        .file
        .providers
        .iter()
        .find(|provider| provider.id == provider_id)
}

fn pick_transport_base(
    transports: &BTreeMap<String, String>,
    transport_kind: ModelTransportKind,
    default_transport: &str,
) -> Option<String> {
    transports
        .get(transport_kind.as_str())
        .or_else(|| transports.get(default_transport))
        .cloned()
}

/// Legacy display placeholders: the old flat preset bases carried `YOUR_*` sentinel text shown in
/// wizard default endpoints; the manifest now carries `{placeholder}` templates. The CLI keeps
/// resolving the old literals until the runtime flip (the v1 wizard substitutes real values).
fn legacy_template_value(key: &str) -> Option<&'static str> {
    match key {
        "resourceName" => Some("YOUR_RESOURCE_NAME"),
        "accountId" => Some("YOUR_ACCOUNT_ID"),
        "awsRegion" => Some("us-east-1"),
        "project" => Some("YOUR_PROJECT_ID"),
        "location" => Some("us-central1"),
        _ => None,
    }
}

/// Substitutes `{placeholder}` occurrences: the wizard workspace id wins for `{workspaceId}`, then
/// the legacy display placeholders. A `{workspaceId}` without a non-empty value fails the
/// resolution (None); unknown placeholders stay literal.
fn substitute_templates(base: &str, workspace_id: Option<&str>) -> Option<String> {
    let mut resolved = String::with_capacity(base.len());
    let mut rest = base;
    while let Some(start) = rest.find('{') {
        let Some(end_offset) = rest[start..].find('}') else {
            break;
        };
        let end = start + end_offset;
        let key = &rest[start + 1..end];
        resolved.push_str(&rest[..start]);
        let value = if key == "workspaceId" {
            workspace_id
                .map(str::trim)
                .filter(|value| !value.is_empty())
        } else {
            legacy_template_value(key)
        };
        match value {
            Some(value) => resolved.push_str(value),
            None if key == "workspaceId" => return None,
            None => resolved.push_str(&rest[start..=end]),
        }
        rest = &rest[end + 1..];
    }
    resolved.push_str(rest);
    Some(resolved)
}

/// Mirrors `resolvePresetApiBase` in agent-core: billing plan override, then the selected site
/// (`site.transports[transport]` falling back to the default transport slot, then the provider
/// slots), then the provider-level `transports[transport] ?? transports[defaultTransport]`, then
/// `{placeholder}` substitution. Unknown providers / sites / plans resolve to None.
fn resolve_preset_api_base(
    preset: &ProviderPresetEntry,
    transport_kind: ModelTransportKind,
    site: Option<&str>,
    billing_plan: Option<&str>,
    workspace_id: Option<&str>,
) -> Option<String> {
    let raw = if let Some(plan_id) = billing_plan {
        let plan = preset
            .billing_plans
            .as_ref()?
            .iter()
            .find(|plan| plan.id == plan_id)?;
        match &plan.transports {
            Some(transports) => {
                pick_transport_base(transports, transport_kind, &preset.default_transport)
                    .or_else(|| plan.api_base.clone())
            }
            None => plan.api_base.clone(),
        }
    } else if let Some(site_id) = site {
        let site = preset
            .sites
            .as_ref()?
            .items
            .iter()
            .find(|site| site.id == site_id)?;
        match &site.transports {
            Some(transports) => {
                pick_transport_base(transports, transport_kind, &preset.default_transport).or_else(
                    || {
                        pick_transport_base(
                            &preset.transports,
                            transport_kind,
                            &preset.default_transport,
                        )
                    },
                )
            }
            None => site.api_base.clone(),
        }
    } else {
        pick_transport_base(
            &preset.transports,
            transport_kind,
            &preset.default_transport,
        )
    }?;
    substitute_templates(&raw, workspace_id)
}

fn resolve_site_api_base(
    provider: crate::model_registry::ModelProvider,
    transport_kind: ModelTransportKind,
    site: &str,
    workspace_id: &str,
) -> Option<String> {
    resolve_preset_api_base(
        preset_entry(provider.as_str())?,
        transport_kind,
        Some(site),
        None,
        Some(workspace_id),
    )
}

/// The provider's endpoint for a transport, without site or billing-plan overrides.
pub(crate) fn model_add_preset_api_base(
    provider: crate::model_registry::ModelProvider,
    transport_kind: ModelTransportKind,
) -> Option<String> {
    if provider == crate::model_registry::ModelProvider::Custom {
        return None;
    }
    resolve_preset_api_base(
        preset_entry(provider.as_str())?,
        transport_kind,
        None,
        None,
        None,
    )
}

/// `selected` matches the bottom form "Provider" option index (manifest array order, then `custom`).
#[cfg(test)]
pub(crate) fn model_add_preset_api_base_by_choice_index(selected: usize) -> Option<String> {
    let provider = model_add_provider_at_choice_index(selected)?;
    model_add_preset_api_base_by_provider(provider)
}

/// The provider's default-transport endpoint (the preset's `defaultTransport` slot).
pub(crate) fn model_add_preset_api_base_by_provider(
    provider: crate::model_registry::ModelProvider,
) -> Option<String> {
    if provider == crate::model_registry::ModelProvider::Custom {
        return None;
    }
    let preset = preset_entry(provider.as_str())?;
    let default_transport = preset
        .default_transport
        .parse()
        .unwrap_or(ModelTransportKind::OpenAiCompatible);
    resolve_preset_api_base(preset, default_transport, None, None, None)
}

pub(crate) fn model_add_kimi_code_site_api_base(
    site: &str,
    transport_kind: ModelTransportKind,
) -> Option<String> {
    resolve_preset_api_base(
        preset_entry("kimi-code")?,
        transport_kind,
        Some(site),
        None,
        None,
    )
}

pub(crate) fn model_add_kimi_code_api_base(transport_kind: ModelTransportKind) -> Option<String> {
    model_add_kimi_code_site_api_base("intl", transport_kind)
}

fn model_add_site_id_from_choice(provider_id: &str, selected: usize) -> &'static str {
    let sites = preset_entry(provider_id).and_then(|preset| preset.sites.as_ref());
    match sites {
        Some(sites) if !sites.items.is_empty() => {
            let index = selected.min(sites.items.len() - 1);
            &sites.items[index].id
        }
        _ => "",
    }
}

fn host_of(api_base: &str) -> Option<&str> {
    let after_scheme = api_base
        .trim()
        .strip_prefix("https://")
        .or_else(|| api_base.trim().strip_prefix("http://"))?;
    after_scheme.split('/').next()?.split(':').next()
}

fn model_add_site_id_from_api_base(provider_id: &str, api_base: &str) -> Option<&'static str> {
    let host = host_of(api_base)?;
    let sites = &preset_entry(provider_id)?.sites.as_ref()?.items;
    sites
        .iter()
        .find(|site| {
            site.api_base
                .as_deref()
                .into_iter()
                .chain(
                    site.transports
                        .as_ref()
                        .map(|transports| transports.values().map(String::as_str))
                        .into_iter()
                        .flatten(),
                )
                .any(|base| host_of(base) == Some(host))
        })
        .map(|site| site.id.as_str())
}

pub(crate) fn model_add_kimi_code_site_id_from_choice(selected: usize) -> &'static str {
    model_add_site_id_from_choice("kimi-code", selected)
}

pub(crate) fn model_add_kimi_code_site_id_from_api_base(api_base: &str) -> Option<&'static str> {
    model_add_site_id_from_api_base("kimi-code", api_base)
}

pub(crate) fn model_add_default_custom_api_base(transport_kind: ModelTransportKind) -> String {
    let p = presets();
    match transport_kind {
        ModelTransportKind::OpenAiCompatible | ModelTransportKind::OpenResponses => {
            p.file.custom.default_api_base.clone()
        }
        ModelTransportKind::Anthropic => {
            model_add_preset_api_base_by_provider(crate::model_registry::ModelProvider::Anthropic)
                .unwrap_or_else(|| p.file.custom.default_api_base.clone())
        }
        ModelTransportKind::Bedrock => model_add_preset_api_base_by_provider(
            crate::model_registry::ModelProvider::AmazonBedrock,
        )
        .unwrap_or_else(|| p.file.custom.default_api_base.clone()),
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

pub(crate) fn model_add_siliconflow_site_api_base(site: &str) -> Option<String> {
    resolve_preset_api_base(
        preset_entry("siliconflow")?,
        ModelTransportKind::OpenAiCompatible,
        Some(site),
        None,
        None,
    )
}

pub(crate) fn model_add_siliconflow_site_id_from_choice(selected: usize) -> &'static str {
    model_add_site_id_from_choice("siliconflow", selected)
}

pub(crate) fn model_add_moonshot_site_api_base(site: &str) -> Option<String> {
    resolve_preset_api_base(
        preset_entry("moonshot-ai")?,
        ModelTransportKind::OpenAiCompatible,
        Some(site),
        None,
        None,
    )
}

pub(crate) fn model_add_moonshot_site_id_from_choice(selected: usize) -> &'static str {
    model_add_site_id_from_choice("moonshot-ai", selected)
}

pub(crate) fn model_add_tencent_tokenhub_site_api_base(site: &str) -> Option<String> {
    resolve_preset_api_base(
        preset_entry("tencent-tokenhub")?,
        ModelTransportKind::OpenAiCompatible,
        Some(site),
        None,
        None,
    )
}

pub(crate) fn model_add_tencent_tokenhub_site_id_from_choice(selected: usize) -> &'static str {
    model_add_site_id_from_choice("tencent-tokenhub", selected)
}

pub(crate) fn model_add_minimax_site_api_base(
    site: &str,
    transport_kind: ModelTransportKind,
) -> Option<String> {
    resolve_preset_api_base(
        preset_entry("minimax")?,
        transport_kind,
        Some(site),
        None,
        None,
    )
}

pub(crate) fn model_add_minimax_site_id_from_choice(selected: usize) -> &'static str {
    model_add_site_id_from_choice("minimax", selected)
}

static ALIBABA_SITE_IDS: OnceLock<Vec<&'static str>> = OnceLock::new();

pub(crate) fn model_add_alibaba_site_ids() -> &'static [&'static str] {
    ALIBABA_SITE_IDS.get_or_init(|| {
        preset_entry("alibaba")
            .and_then(|preset| preset.sites.as_ref())
            .map(|sites| sites.items.iter().map(|site| site.id.as_str()).collect())
            .unwrap_or_default()
    })
}

pub(crate) fn model_add_alibaba_site_id_from_choice(selected: usize) -> &'static str {
    model_add_alibaba_site_ids()
        .get(selected.min(model_add_alibaba_site_ids().len().saturating_sub(1)))
        .copied()
        .unwrap_or("cn-beijing")
}

pub(crate) fn model_add_alibaba_site_requires_workspace_id(site: &str) -> bool {
    let Some(site) = preset_entry("alibaba")
        .and_then(|preset| preset.sites.as_ref())
        .and_then(|sites| sites.items.iter().find(|item| item.id == site.trim()))
    else {
        return false;
    };
    if site.requires_workspace_id == Some(true) {
        return true;
    }
    site.api_base
        .as_deref()
        .into_iter()
        .chain(
            site.transports
                .as_ref()
                .map(|transports| transports.values().map(String::as_str))
                .into_iter()
                .flatten(),
        )
        .any(|base| base.contains("{workspaceId}"))
}

pub(crate) fn model_add_stepfun_site_id_from_choice(selected: usize) -> &'static str {
    model_add_site_id_from_choice("stepfun", selected)
}

pub(crate) fn model_add_stepfun_api_base(
    transport_kind: ModelTransportKind,
    step_plan: bool,
    site: Option<&str>,
) -> Option<String> {
    let preset = preset_entry("stepfun")?;
    if step_plan {
        // The plan pins its own per-transport bases; the selected site no longer influences them.
        return resolve_preset_api_base(preset, transport_kind, None, Some("step-plan"), None);
    }
    resolve_preset_api_base(preset, transport_kind, site, None, None)
}

pub(crate) fn model_add_z_ai_api_base(glm_coding_plan: bool) -> Option<String> {
    if glm_coding_plan {
        return resolve_preset_api_base(
            preset_entry("z-ai")?,
            ModelTransportKind::OpenAiCompatible,
            None,
            Some("glm-coding-plan"),
            None,
        );
    }
    model_add_preset_api_base_by_provider(crate::model_registry::ModelProvider::ZAi)
}

pub(crate) fn model_add_zhipu_ai_api_base(glm_coding_plan: bool) -> Option<String> {
    if glm_coding_plan {
        return resolve_preset_api_base(
            preset_entry("zhipu-ai")?,
            ModelTransportKind::OpenAiCompatible,
            None,
            Some("glm-coding-plan"),
            None,
        );
    }
    model_add_preset_api_base_by_provider(crate::model_registry::ModelProvider::ZhipuAi)
}

pub(crate) fn model_add_alibaba_token_plan_api_base(
    transport_kind: ModelTransportKind,
) -> Option<String> {
    resolve_preset_api_base(
        preset_entry("alibaba")?,
        transport_kind,
        None,
        Some("token-plan"),
        None,
    )
}

pub(crate) fn model_add_alibaba_site_api_base(
    site: &str,
    workspace_id: &str,
    transport_kind: ModelTransportKind,
) -> Option<String> {
    resolve_preset_api_base(
        preset_entry("alibaba")?,
        transport_kind,
        Some(site),
        None,
        Some(workspace_id),
    )
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
    model_add_preset_api_base(provider, transport_kind)
        .unwrap_or_else(|| model_add_default_custom_api_base(transport_kind))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picker_order_is_manifest_order_with_custom_last() {
        let ids = model_add_picker_order_ids();
        assert_eq!(ids.len(), 33);
        assert_eq!(ids[0], "openai");
        assert_eq!(ids[31], "google-vertex-ai");
        assert_eq!(ids[32], "custom");
        assert_eq!(model_add_provider_id_at_choice_index(32), Some("custom"));
        assert!(model_add_provider_id_at_choice_index(33).is_none());
    }

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
        // deepseek's default transport is open-responses; the default slot is the Responses base.
        assert_eq!(
            model_add_preset_api_base_by_choice_index(6).as_deref(),
            Some("https://api.deepseek.com")
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
    fn preset_api_base_resolves_per_transport_from_the_manifest() {
        assert_eq!(
            model_add_preset_api_base(
                crate::model_registry::ModelProvider::Deepseek,
                ModelTransportKind::OpenAiCompatible,
            )
            .as_deref(),
            Some("https://api.deepseek.com/v1")
        );
        assert_eq!(
            model_add_preset_api_base(
                crate::model_registry::ModelProvider::Deepseek,
                ModelTransportKind::Anthropic,
            )
            .as_deref(),
            Some("https://api.deepseek.com/anthropic")
        );
        assert_eq!(
            model_add_preset_api_base(
                crate::model_registry::ModelProvider::KimiCode,
                ModelTransportKind::Anthropic,
            )
            .as_deref(),
            Some("https://api.kimi.ai/coding")
        );
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
        // Undeclared transports fall back to the default transport slot.
        assert_eq!(
            super::model_add_kimi_code_api_base(ModelTransportKind::OpenResponses).as_deref(),
            Some("https://api.kimi.ai/coding/v1")
        );
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
        // The step-plan billing plan pins the China host regardless of the selected site.
        assert_eq!(
            super::model_add_stepfun_api_base(
                ModelTransportKind::OpenAiCompatible,
                true,
                Some("intl")
            )
            .as_deref(),
            Some("https://api.stepfun.com/step_plan/v1")
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
            Some("https://api.minimax.cn/v1")
        );
        assert_eq!(
            super::model_add_minimax_site_api_base("cn", ModelTransportKind::Anthropic).as_deref(),
            Some("https://api.minimax.cn/anthropic/v1")
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
