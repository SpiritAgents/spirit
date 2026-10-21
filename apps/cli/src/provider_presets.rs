//! Reads `packages/agent-core/src/provider-presets/provider-presets.json` (TUI preset endpoints and picker order).
//!
//! Preset identity is the manifest's string `id`; there is no vendor enum. The wizard reads
//! `transports` / `sites` / `billingPlans` / `credentials` / `expressApiBase` as data and
//! materializes the public config declarations (`apiBase`, `sdk`, `providerTools`, …) at
//! connect time, mirroring agent-core `resolvePresetApiBase` + `materializeProviderPreset`.

use crate::model_registry::{ModelTransportKind, ProviderConnectDraft};
use serde::Deserialize;
use serde_json::{Map, Value};
use std::collections::BTreeMap;
use std::sync::OnceLock;

/// The wizard-only pseudo preset id for a fully custom connection.
pub(crate) const CUSTOM_PROVIDER_PRESET_ID: &str = "custom";

/// The preset's default credential form when `credentials.kind` is absent.
pub(crate) const CREDENTIAL_KIND_API_KEY: &str = "apiKey";

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
pub(crate) struct ProviderPresetEntry {
    id: String,
    /// Fallback display label; the apps' i18n key mapping wins when present.
    pub(crate) label: Option<String>,
    default_transport: String,
    sdk: Option<String>,
    transports: BTreeMap<String, String>,
    sites: Option<ProviderPresetSites>,
    billing_plans: Option<Vec<ProviderPresetBillingPlan>>,
    credentials: Option<ProviderPresetCredentials>,
    /// Materialization templates copied verbatim onto the config entry at connect time
    /// (`providers[].providerTools` / `fileUpload` / `body` / `thinkingSwitch` /
    /// `imageApi` / `videoApi` / `options`).
    provider_tools: Option<Vec<Value>>,
    file_upload: Option<Value>,
    body: Option<Map<String, Value>>,
    thinking_switch: Option<Value>,
    image_api: Option<String>,
    video_api: Option<String>,
    /// Mechanism option flags materialized onto the entry (e.g. `toolsRejectReasoningEffort`).
    options: Option<Map<String, Value>>,
    /// apiKey-only express connect base (e.g. Vertex Express), used when the wizard collects
    /// the plain apiKey credential form for a preset whose default credential kind differs.
    express_api_base: Option<String>,
    catalog: Option<ProviderPresetCatalog>,
}

impl ProviderPresetEntry {
    /// The wizard credential form driver (`apiKey` / `bedrock` / `vertex`).
    pub(crate) fn credential_kind(&self) -> &str {
        self.credentials
            .as_ref()
            .map(|credentials| credentials.kind.as_str())
            .unwrap_or(CREDENTIAL_KIND_API_KEY)
    }

    pub(crate) fn sites(&self) -> &[ProviderPresetSite] {
        self.sites
            .as_ref()
            .map(|sites| sites.items.as_slice())
            .unwrap_or(&[])
    }

    pub(crate) fn default_site_id(&self) -> Option<&str> {
        self.sites.as_ref().map(|sites| sites.default.as_str())
    }

    pub(crate) fn billing_plans(&self) -> &[ProviderPresetBillingPlan] {
        self.billing_plans.as_deref().unwrap_or(&[])
    }

    /// The preset's transport set: `defaultTransport` first, then the remaining
    /// `transports` keys.
    pub(crate) fn transport_kinds(&self) -> Vec<ModelTransportKind> {
        let mut kinds = Vec::new();
        if let Ok(default) = self.default_transport.parse::<ModelTransportKind>() {
            kinds.push(default);
        }
        for key in self.transports.keys() {
            if let Ok(kind) = key.parse::<ModelTransportKind>()
                && !kinds.contains(&kind)
            {
                kinds.push(kind);
            }
        }
        kinds
    }

    pub(crate) fn catalog(&self) -> Option<&ProviderPresetCatalog> {
        self.catalog.as_ref()
    }

    pub(crate) fn express_api_base(&self) -> Option<&str> {
        self.express_api_base
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
    }
}

#[derive(Debug, Deserialize)]
struct ProviderPresetSites {
    default: String,
    items: Vec<ProviderPresetSite>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderPresetSite {
    pub(crate) id: String,
    pub(crate) label: Option<String>,
    api_base: Option<String>,
    transports: Option<BTreeMap<String, String>>,
    /// Per-site upload channel override (e.g. a region-pinned upload host).
    file_upload: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderPresetBillingPlan {
    pub(crate) id: String,
    pub(crate) label: Option<String>,
    api_base: Option<String>,
    transports: Option<BTreeMap<String, String>>,
}

#[derive(Debug, Deserialize)]
struct ProviderPresetCredentials {
    kind: String,
}

/// Model catalog descriptor: a parser named by API shape and the listing endpoint joined
/// onto the materialized `apiBase` (absent when the listing is not HTTP-off-the-base).
#[derive(Debug, Deserialize)]
pub(crate) struct ProviderPresetCatalog {
    pub(crate) parser: String,
    pub(crate) endpoint: Option<String>,
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
            .chain(std::iter::once(CUSTOM_PROVIDER_PRESET_ID.to_string()))
            .collect();
        Presets { file, picker_order }
    })
}

pub(crate) fn preset_entry(preset_id: &str) -> Option<&'static ProviderPresetEntry> {
    presets()
        .file
        .providers
        .iter()
        .find(|provider| provider.id == preset_id)
}

/// The preset's wizard credential form driver (`credentials.kind`, default `apiKey`).
pub(crate) fn preset_credential_kind(preset_id: &str) -> &'static str {
    preset_entry(preset_id)
        .map(ProviderPresetEntry::credential_kind)
        .unwrap_or(CREDENTIAL_KIND_API_KEY)
}

/// Whether `preset_id` names a manifest preset or the `custom` pseudo preset.
pub(crate) fn is_known_preset_id(preset_id: &str) -> bool {
    preset_id == CUSTOM_PROVIDER_PRESET_ID || preset_entry(preset_id).is_some()
}

pub(crate) fn model_add_picker_order_ids() -> &'static [String] {
    &presets().picker_order
}

pub(crate) fn model_add_provider_id_at_choice_index(selected: usize) -> Option<&'static str> {
    presets().picker_order.get(selected).map(String::as_str)
}

pub(crate) fn preset_default_transport_kind(preset_id: &str) -> ModelTransportKind {
    preset_entry(preset_id)
        .and_then(|preset| preset.default_transport.parse().ok())
        .unwrap_or(ModelTransportKind::OpenAiCompatible)
}

/// The preset manifest's `transports` keys declare the provider's supported transport set.
pub(crate) fn preset_supports_transport(
    preset_id: &str,
    transport_kind: ModelTransportKind,
) -> bool {
    preset_entry(preset_id)
        .is_some_and(|preset| preset.transports.contains_key(transport_kind.as_str()))
}

/// Wizard selections that materialize into the final `apiBase`, mirroring the TS
/// `resolvePresetApiBase` / `materializeProviderPreset` inputs. Sites, billing plans, and
/// `{placeholder}` template values are write-time inputs only; they never land in config.json.
#[derive(Debug, Clone, Default)]
pub(crate) struct PresetConnectSelections<'a> {
    /// Defaults to the preset's `defaultTransport`.
    pub transport_kind: Option<ModelTransportKind>,
    pub site_id: Option<&'a str>,
    /// Selecting a billing plan overrides the site; the plan id never enters config.
    pub billing_plan_id: Option<&'a str>,
    /// `{placeholder}` substitutions collected by the wizard (`resourceName`, `accountId`,
    /// `workspaceId`, `project`, `location`, `awsRegion`, …).
    pub template_values: BTreeMap<String, String>,
    /// The credential form the wizard collected. `"apiKey"` on a preset whose default
    /// credential kind differs (Vertex Express) selects the preset's `expressApiBase`.
    pub credential_kind: Option<&'a str>,
}

/// Whether the credential form is the plain apiKey shortcut on a non-apiKey preset
/// (Vertex Express), which materializes `expressApiBase` instead of the templated base.
fn is_express_credential_form(preset: &ProviderPresetEntry, credential_kind: Option<&str>) -> bool {
    credential_kind == Some(CREDENTIAL_KIND_API_KEY)
        && preset.credential_kind() != CREDENTIAL_KIND_API_KEY
        && preset.express_api_base().is_some()
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

/// The raw (unsubstituted) base template for the selection: express shortcut, then billing
/// plan override, then the selected site (`site.transports[transport]` falling back to the
/// provider slots), then the provider-level `transports[transport] ?? transports[default]`.
/// Unknown providers / sites / plans resolve to None (the TS resolver throws instead).
fn resolve_preset_base_template(
    preset: &ProviderPresetEntry,
    selections: &PresetConnectSelections<'_>,
) -> Option<String> {
    if is_express_credential_form(preset, selections.credential_kind) {
        return preset.express_api_base().map(str::to_string);
    }
    let transport_kind = selections.transport_kind.unwrap_or_else(|| {
        preset
            .default_transport
            .parse()
            .unwrap_or(ModelTransportKind::OpenAiCompatible)
    });
    if let Some(plan_id) = selections.billing_plan_id {
        let plan = preset
            .billing_plans
            .as_ref()?
            .iter()
            .find(|plan| plan.id == plan_id)?;
        return match &plan.transports {
            Some(transports) => {
                pick_transport_base(transports, transport_kind, &preset.default_transport)
                    .or_else(|| plan.api_base.clone())
            }
            None => plan.api_base.clone(),
        };
    }
    if let Some(site_id) = selections.site_id {
        let site = preset.sites().iter().find(|site| site.id == site_id)?;
        return match &site.transports {
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
        };
    }
    pick_transport_base(
        &preset.transports,
        transport_kind,
        &preset.default_transport,
    )
}

/// `{placeholder}` names in a base template, in order of first appearance (mirrors the TS
/// `listUnresolvedApiBaseTemplateKeys` pattern).
pub(crate) fn list_base_template_keys(base: &str) -> Vec<String> {
    let mut keys = Vec::new();
    let mut rest = base;
    while let Some(start) = rest.find('{') {
        let Some(end_offset) = rest[start..].find('}') else {
            break;
        };
        let key = &rest[start + 1..start + end_offset];
        if !key.is_empty()
            && key.bytes().all(|byte| byte.is_ascii_alphanumeric())
            && !keys.iter().any(|known| known == key)
        {
            keys.push(key.to_string());
        }
        rest = &rest[start + end_offset + 1..];
    }
    keys
}

/// The raw base template for the current wizard selection (placeholder discovery for the
/// connect form; express connects have none).
pub(crate) fn preset_connect_base_template(
    preset_id: &str,
    selections: &PresetConnectSelections<'_>,
) -> Option<String> {
    resolve_preset_base_template(preset_entry(preset_id)?, selections)
}

/// Substitutes `{placeholder}` occurrences from `template_values`; unresolved placeholders
/// stay literal (mirrors the TS `applyApiBaseTemplateValues`).
pub(crate) fn substitute_base_templates(
    base: &str,
    template_values: &BTreeMap<String, String>,
) -> String {
    let mut resolved = String::with_capacity(base.len());
    let mut rest = base;
    while let Some(start) = rest.find('{') {
        let Some(end_offset) = rest[start..].find('}') else {
            break;
        };
        let end = start + end_offset;
        let key = &rest[start + 1..end];
        resolved.push_str(&rest[..start]);
        match template_values.get(key).map(|value| value.trim()) {
            Some(value) if !value.is_empty() => resolved.push_str(value),
            _ => resolved.push_str(&rest[start..=end]),
        }
        rest = &rest[end + 1..];
    }
    resolved.push_str(rest);
    resolved
}

/// The final `apiBase` for a connect: the resolved template with the wizard-collected
/// `{placeholder}` values substituted.
pub(crate) fn preset_connect_api_base(
    preset_id: &str,
    selections: &PresetConnectSelections<'_>,
) -> Option<String> {
    let template = preset_connect_base_template(preset_id, selections)?;
    Some(substitute_base_templates(
        &template,
        &selections.template_values,
    ))
}

/// The provider's endpoint for a transport, without site, billing-plan, or credential-form
/// overrides (the preset's plain transport slot with templates left literal).
#[cfg(test)]
pub(crate) fn model_add_preset_api_base(
    preset_id: &str,
    transport_kind: ModelTransportKind,
) -> Option<String> {
    preset_connect_api_base(
        preset_id,
        &PresetConnectSelections {
            transport_kind: Some(transport_kind),
            ..PresetConnectSelections::default()
        },
    )
}

/// The provider's default-transport endpoint (the preset's `defaultTransport` slot).
pub(crate) fn model_add_preset_default_api_base(preset_id: &str) -> Option<String> {
    preset_connect_api_base(preset_id, &PresetConnectSelections::default())
}

pub(crate) fn model_add_default_custom_api_base(transport_kind: ModelTransportKind) -> String {
    let p = presets();
    match transport_kind {
        ModelTransportKind::OpenAiCompatible | ModelTransportKind::OpenResponses => {
            p.file.custom.default_api_base.clone()
        }
        // Reasonable endpoint defaults for the custom form: the canonical preset of the
        // same transport shape.
        ModelTransportKind::Anthropic => model_add_preset_default_api_base("anthropic")
            .unwrap_or_else(|| p.file.custom.default_api_base.clone()),
        ModelTransportKind::Bedrock => model_add_preset_default_api_base("amazon-bedrock")
            .unwrap_or_else(|| p.file.custom.default_api_base.clone()),
    }
}

/// Azure resource name validation (the azure preset's `{resourceName}` template value).
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

/// Cloudflare account id validation (the cloudflare preset's `{accountId}` template value).
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

/// SDK adapter fallback when the wizard picks a non-default transport: the preset's `sdk`
/// names its default transport's adapter; alternates use the transport's generic adapter
/// (bedrock is a self-held implementation with no adapter). Mirrors agent-core
/// `fallbackSdkPackageName`.
fn fallback_sdk_package_name(transport_kind: ModelTransportKind) -> Option<&'static str> {
    match transport_kind {
        ModelTransportKind::OpenAiCompatible => Some("@ai-sdk/openai-compatible"),
        ModelTransportKind::OpenResponses => Some("@ai-sdk/open-responses"),
        ModelTransportKind::Anthropic => Some("@ai-sdk/anthropic"),
        ModelTransportKind::Bedrock => None,
    }
}

/// The wizard-owned declarations a connect writes onto the provider entry, mirroring
/// agent-core `materializeProviderPreset`: `transportKind` is omitted for the default
/// transport, `sdk` follows the preset (or the transport fallback), and the
/// `providerTools` / `fileUpload` / `body` / `thinkingSwitch` / `imageApi` / `videoApi` /
/// `options` templates are copied verbatim (options keys scoped to a different transport
/// are dropped). `custom` connections declare nothing beyond a non-default transport.
pub(crate) fn preset_connect_draft(
    preset_id: &str,
    transport_kind: ModelTransportKind,
    site_id: Option<&str>,
) -> ProviderConnectDraft {
    let declared_transport = (transport_kind != ModelTransportKind::OpenAiCompatible)
        .then(|| transport_kind.as_str().to_string());
    let Some(preset) = preset_entry(preset_id) else {
        return ProviderConnectDraft {
            transport_kind: declared_transport,
            ..ProviderConnectDraft::default()
        };
    };
    let sdk = if transport_kind.as_str() == preset.default_transport {
        preset.sdk.clone()
    } else {
        fallback_sdk_package_name(transport_kind).map(str::to_string)
    };
    // A site can pin its own upload channel (e.g. a region-pinned upload host).
    let file_upload = site_id
        .or_else(|| preset.default_site_id())
        .and_then(|id| preset.sites().iter().find(|site| site.id == id))
        .and_then(|site| site.file_upload.clone())
        .or_else(|| preset.file_upload.clone());
    // Host-executed helper endpoints (tool executes, file uploads) live on the provider's
    // openai-compatible root; a non-default transport bakes them as absolute URLs (mirrors
    // agent-core materializeProviderPreset).
    let baking_base = if transport_kind == ModelTransportKind::OpenAiCompatible {
        None
    } else {
        openai_compatible_base(preset, site_id)
    };
    let provider_tools = preset
        .provider_tools
        .clone()
        .map(|tools| match baking_base {
            Some(base) => rewrite_execute_paths_as_absolute(tools, base),
            None => tools,
        });
    let file_upload = file_upload.map(|upload| match baking_base {
        Some(base) => rewrite_file_upload_path_as_absolute(upload, base),
        None => upload,
    });
    ProviderConnectDraft {
        label: preset.label.clone(),
        transport_kind: declared_transport,
        sdk,
        provider_tools,
        file_upload,
        body: preset.body.clone(),
        thinking_switch: preset.thinking_switch.clone(),
        image_api: preset.image_api.clone(),
        video_api: preset.video_api.clone(),
        options: preset_options_for_transport(preset, transport_kind),
        ..ProviderConnectDraft::default()
    }
}

/// Mechanism option keys whose transport scope differs from the selected one are dropped
/// (mirrors agent-core `PRESET_OPTIONS_TRANSPORT_SCOPE`); unknown keys pass through.
fn preset_options_for_transport(
    preset: &ProviderPresetEntry,
    transport_kind: ModelTransportKind,
) -> Option<Map<String, Value>> {
    let options = preset.options.as_ref()?;
    let scoped: Map<String, Value> = options
        .iter()
        .filter(|(key, _)| match key.as_str() {
            "toolsRejectReasoningEffort" | "maxInlineMediaBytes" => {
                transport_kind == ModelTransportKind::OpenAiCompatible
            }
            "echoServerToolCalls"
            | "defaultInputItemStatus"
            | "applyPatch"
            | "reasoningSummary"
            | "storedState" => transport_kind == ModelTransportKind::OpenResponses,
            // OpenRouter's unified anthropic-route reasoning shape applies to both OpenAI-family
            // surfaces; the anthropic transport speaks native Messages and does not take it.
            "openRouterAnthropicReasoning" => matches!(
                transport_kind,
                ModelTransportKind::OpenAiCompatible | ModelTransportKind::OpenResponses
            ),
            _ => true,
        })
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect();
    (!scoped.is_empty()).then_some(scoped)
}

/// The provider's openai-compatible base for the selected site (site transports, site base, then
/// the provider's transports map) — the root the host-executed helper endpoints live on.
fn openai_compatible_base<'a>(
    preset: &'a ProviderPresetEntry,
    site_id: Option<&str>,
) -> Option<&'a str> {
    let site = site_id
        .or_else(|| preset.default_site_id())
        .and_then(|id| preset.sites().iter().find(|site| site.id == id));
    site.and_then(|site| {
        site.transports
            .as_ref()
            .and_then(|transports| transports.get("openai-compatible"))
            .or(site.api_base.as_ref())
            .map(String::as_str)
    })
    .or_else(|| {
        preset
            .transports
            .get("openai-compatible")
            .map(String::as_str)
    })
    .or_else(|| {
        preset
            .transports
            .get(preset.default_transport.as_str())
            .map(String::as_str)
    })
}

/// Rewrites each entry's relative `execute.path` into an absolute `execute.url` joined onto
/// `api_base` (mirrors agent-core `resolveProviderEndpointUrl`).
fn rewrite_execute_paths_as_absolute(tools: Vec<Value>, api_base: &str) -> Vec<Value> {
    let base = api_base.trim_end_matches('/');
    tools
        .into_iter()
        .map(|mut tool| {
            let Some(execute) = tool.get_mut("execute").and_then(Value::as_object_mut) else {
                return tool;
            };
            if execute.contains_key("url") {
                return tool;
            }
            let Some(path) = execute
                .get("path")
                .and_then(Value::as_str)
                .map(|path| path.trim_start_matches('/').to_string())
            else {
                return tool;
            };
            execute.remove("path");
            execute.insert("url".to_string(), Value::String(format!("{base}/{path}")));
            tool
        })
        .collect()
}

/// Rewrites a relative `fileUpload.path` into an absolute `fileUpload.url` joined onto
/// `api_base` (mirrors agent-core `resolveProviderEndpointUrl`).
fn rewrite_file_upload_path_as_absolute(mut upload: Value, api_base: &str) -> Value {
    let base = api_base.trim_end_matches('/');
    let Some(object) = upload.as_object_mut() else {
        return upload;
    };
    if object.contains_key("url") {
        return upload;
    }
    let Some(path) = object
        .get("path")
        .and_then(Value::as_str)
        .map(|path| path.trim_start_matches('/').to_string())
    else {
        return upload;
    };
    object.remove("path");
    object.insert("url".to_string(), Value::String(format!("{base}/{path}")));
    upload
}

/// Whether the wizard can bulk-import the model list for this connection: the preset's
/// catalog descriptor declares an HTTP listing endpoint and the credential form supports
/// listing (Vertex Express apiKey connects can't list; the Vertex listing needs a service
/// account). Manual single-model entry otherwise.
pub(crate) fn preset_supports_bulk_listing(preset_id: &str, credential_kind: &str) -> bool {
    let Some(preset) = preset_entry(preset_id) else {
        return false;
    };
    if is_express_credential_form(preset, Some(credential_kind)) {
        return false;
    }
    preset
        .catalog
        .as_ref()
        .is_some_and(|catalog| catalog.endpoint.is_some())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base(preset_id: &str, transport_kind: ModelTransportKind) -> Option<String> {
        model_add_preset_api_base(preset_id, transport_kind)
    }

    fn base_with_site(
        preset_id: &str,
        site_id: &str,
        transport_kind: ModelTransportKind,
    ) -> Option<String> {
        preset_connect_api_base(
            preset_id,
            &PresetConnectSelections {
                transport_kind: Some(transport_kind),
                site_id: Some(site_id),
                ..PresetConnectSelections::default()
            },
        )
    }

    fn base_with_plan(
        preset_id: &str,
        plan_id: &str,
        transport_kind: ModelTransportKind,
    ) -> Option<String> {
        preset_connect_api_base(
            preset_id,
            &PresetConnectSelections {
                transport_kind: Some(transport_kind),
                billing_plan_id: Some(plan_id),
                ..PresetConnectSelections::default()
            },
        )
    }

    #[test]
    fn picker_order_is_manifest_order_with_custom_last() {
        let ids = model_add_picker_order_ids();
        assert_eq!(ids.len(), 33);
        assert_eq!(ids[0], "openai");
        assert_eq!(ids[31], "google-vertex-ai");
        assert_eq!(ids[32], "custom");
        assert_eq!(model_add_provider_id_at_choice_index(32), Some("custom"));
        assert!(model_add_provider_id_at_choice_index(33).is_none());
        assert!(is_known_preset_id("kimi-code"));
        assert!(is_known_preset_id("custom"));
        assert!(!is_known_preset_id("acme-unknown"));
    }

    #[test]
    fn default_bases_come_from_the_manifest_default_transport_slot() {
        let expected: [(&str, &str); 32] = [
            ("openai", "https://api.openai.com/v1"),
            ("anthropic", "https://api.anthropic.com/v1"),
            ("google", "https://generativelanguage.googleapis.com/v1beta"),
            ("xai", "https://api.x.ai/v1"),
            ("vercel-ai-gateway", "https://ai-gateway.vercel.sh/v1"),
            (
                "cloudflare-ai-gateway",
                "https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/v1",
            ),
            // deepseek's default transport is open-responses; the default slot is the Responses base.
            ("deepseek", "https://api.deepseek.com"),
            ("openrouter", "https://openrouter.ai/api/v1"),
            ("fireworks-ai", "https://api.fireworks.ai/inference/v1"),
            ("together-ai", "https://api.together.ai/v1"),
            ("groq", "https://api.groq.com/openai/v1"),
            ("deepinfra", "https://api.deepinfra.com/v1/openai"),
            ("baseten", "https://inference.baseten.co/v1"),
            ("hugging-face", "https://router.huggingface.co/v1"),
            ("moonshot-ai", "https://api.moonshot.ai/v1"),
            ("kimi-code", "https://api.kimi.ai/coding/v1"),
            ("z-ai", "https://api.z.ai/api/paas/v4"),
            ("zhipu-ai", "https://open.bigmodel.cn/api/paas/v4"),
            (
                "alibaba",
                "https://dashscope.aliyuncs.com/compatible-mode/v1",
            ),
            ("minimax", "https://api.minimax.io/anthropic/v1"),
            ("xiaomi", "https://api.xiaomimimo.com/v1"),
            ("siliconflow", "https://api.siliconflow.com/v1"),
            ("stepfun", "https://api.stepfun.com/v1"),
            ("volcengine", "https://ark.cn-beijing.volces.com/api/v3"),
            ("byteplus", "https://ark.ap-southeast.bytepluses.com/api/v3"),
            ("meituan", "https://api.longcat.chat/openai/v1"),
            ("tencent-tokenhub", "https://tokenhub.tencentmaas.com/v1"),
            ("mistral", "https://api.mistral.ai/v1"),
            ("cohere", "https://api.cohere.com/v2"),
            ("azure", "https://{resourceName}.openai.azure.com/openai/v1"),
            (
                "amazon-bedrock",
                "https://bedrock.{awsRegion}.amazonaws.com",
            ),
            (
                "google-vertex-ai",
                "https://{location}-aiplatform.googleapis.com/v1/projects/{project}/locations/{location}",
            ),
        ];
        for (preset_id, expected_base) in expected {
            assert_eq!(
                model_add_preset_default_api_base(preset_id).as_deref(),
                Some(expected_base),
                "default base for {preset_id}"
            );
        }
        assert!(model_add_preset_default_api_base("custom").is_none());
    }

    #[test]
    fn preset_api_base_resolves_per_transport_from_the_manifest() {
        assert_eq!(
            base("deepseek", ModelTransportKind::OpenAiCompatible).as_deref(),
            Some("https://api.deepseek.com/v1")
        );
        assert_eq!(
            base("deepseek", ModelTransportKind::Anthropic).as_deref(),
            Some("https://api.deepseek.com/anthropic")
        );
        assert_eq!(
            base("kimi-code", ModelTransportKind::Anthropic).as_deref(),
            Some("https://api.kimi.ai/coding")
        );
        // Undeclared transports fall back to the default transport slot.
        assert_eq!(
            base("kimi-code", ModelTransportKind::OpenResponses).as_deref(),
            Some("https://api.kimi.ai/coding/v1")
        );
    }

    #[test]
    fn site_bases_resolve_per_site_and_transport() {
        assert_eq!(
            base_with_site("kimi-code", "cn", ModelTransportKind::OpenAiCompatible).as_deref(),
            Some("https://api.kimi.com/coding/v1")
        );
        assert_eq!(
            base_with_site("kimi-code", "cn", ModelTransportKind::Anthropic).as_deref(),
            Some("https://api.kimi.com/coding")
        );
        assert_eq!(
            base_with_site("kimi-code", "intl", ModelTransportKind::OpenAiCompatible).as_deref(),
            Some("https://api.kimi.ai/coding/v1")
        );
        assert_eq!(
            base_with_site("siliconflow", "cn", ModelTransportKind::OpenAiCompatible).as_deref(),
            Some("https://api.siliconflow.cn/v1")
        );
        assert_eq!(
            base_with_site("moonshot-ai", "intl", ModelTransportKind::OpenAiCompatible).as_deref(),
            Some("https://api.moonshot.ai/v1")
        );
        assert_eq!(
            base_with_site(
                "tencent-tokenhub",
                "intl",
                ModelTransportKind::OpenAiCompatible
            )
            .as_deref(),
            Some("https://tokenhub-intl.tencentmaas.com/v1")
        );
        assert_eq!(
            base_with_site("minimax", "cn", ModelTransportKind::Anthropic).as_deref(),
            Some("https://api.minimax.cn/anthropic/v1")
        );
        // A site without per-transport slots falls back to the provider-level slots.
        assert_eq!(
            base_with_site("stepfun", "intl", ModelTransportKind::Anthropic).as_deref(),
            Some("https://api.stepfun.ai")
        );
        // Unknown sites resolve to None.
        assert!(
            base_with_site("kimi-code", "unknown", ModelTransportKind::OpenAiCompatible).is_none()
        );
    }

    #[test]
    fn billing_plan_bases_override_sites() {
        assert_eq!(
            base_with_plan(
                "z-ai",
                "glm-coding-plan",
                ModelTransportKind::OpenAiCompatible
            )
            .as_deref(),
            Some("https://api.z.ai/api/coding/paas/v4")
        );
        assert_eq!(
            base_with_plan(
                "zhipu-ai",
                "glm-coding-plan",
                ModelTransportKind::OpenAiCompatible
            )
            .as_deref(),
            Some("https://open.bigmodel.cn/api/coding/paas/v4")
        );
        // The step-plan billing plan pins the China host regardless of the selected site.
        let selections = PresetConnectSelections {
            transport_kind: Some(ModelTransportKind::OpenAiCompatible),
            site_id: Some("intl"),
            billing_plan_id: Some("step-plan"),
            ..PresetConnectSelections::default()
        };
        assert_eq!(
            preset_connect_api_base("stepfun", &selections).as_deref(),
            Some("https://api.stepfun.com/step_plan/v1")
        );
        assert_eq!(
            base_with_plan("alibaba", "token-plan", ModelTransportKind::Anthropic).as_deref(),
            Some("https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic")
        );
        // Unknown plans resolve to None.
        assert!(
            base_with_plan("z-ai", "unknown-plan", ModelTransportKind::OpenAiCompatible).is_none()
        );
    }

    #[test]
    fn template_values_substitute_and_stay_literal_when_missing() {
        let mut values = BTreeMap::new();
        values.insert("workspaceId".to_string(), "ws-cn".to_string());
        let selections = PresetConnectSelections {
            transport_kind: Some(ModelTransportKind::OpenAiCompatible),
            site_id: Some("cn-beijing"),
            template_values: values,
            ..PresetConnectSelections::default()
        };
        assert_eq!(
            preset_connect_api_base("alibaba", &selections).as_deref(),
            Some("https://ws-cn.cn-beijing.maas.aliyuncs.com/compatible-mode/v1")
        );

        // Missing template values keep the `{placeholder}` literal for the wizard to collect.
        let unresolved = preset_connect_api_base(
            "alibaba",
            &PresetConnectSelections {
                site_id: Some("cn-beijing"),
                ..PresetConnectSelections::default()
            },
        )
        .expect("template");
        assert_eq!(
            list_base_template_keys(&unresolved),
            vec!["workspaceId".to_string()]
        );
        assert_eq!(
            list_base_template_keys(
                &preset_connect_base_template(
                    "google-vertex-ai",
                    &PresetConnectSelections::default()
                )
                .expect("vertex template")
            ),
            vec!["location".to_string(), "project".to_string()]
        );
        assert_eq!(
            list_base_template_keys(
                &preset_connect_base_template(
                    "amazon-bedrock",
                    &PresetConnectSelections::default()
                )
                .expect("bedrock template")
            ),
            vec!["awsRegion".to_string()]
        );
    }

    #[test]
    fn vertex_express_api_base_comes_from_the_api_key_credential_form() {
        // Plain apiKey credential form on the vertex preset materializes expressApiBase.
        let express = preset_connect_api_base(
            "google-vertex-ai",
            &PresetConnectSelections {
                credential_kind: Some(CREDENTIAL_KIND_API_KEY),
                ..PresetConnectSelections::default()
            },
        );
        assert_eq!(
            express.as_deref(),
            Some("https://aiplatform.googleapis.com/v1/publishers/google")
        );

        // The service-account form keeps the templated project/location base.
        let mut values = BTreeMap::new();
        values.insert("project".to_string(), "my-gcp-project".to_string());
        values.insert("location".to_string(), "us-central1".to_string());
        let service_account = preset_connect_api_base(
            "google-vertex-ai",
            &PresetConnectSelections {
                credential_kind: Some("vertex"),
                template_values: values,
                ..PresetConnectSelections::default()
            },
        );
        assert_eq!(
            service_account.as_deref(),
            Some(
                "https://us-central1-aiplatform.googleapis.com/v1/projects/my-gcp-project/locations/us-central1"
            )
        );

        // apiKey presets never take the express shortcut.
        assert_eq!(
            preset_connect_api_base(
                "kimi-code",
                &PresetConnectSelections {
                    credential_kind: Some(CREDENTIAL_KIND_API_KEY),
                    ..PresetConnectSelections::default()
                },
            )
            .as_deref(),
            Some("https://api.kimi.ai/coding/v1")
        );
    }

    #[test]
    fn transport_kinds_list_default_first() {
        let kinds = preset_entry("deepseek")
            .expect("deepseek")
            .transport_kinds();
        assert_eq!(
            kinds,
            vec![
                ModelTransportKind::OpenResponses,
                ModelTransportKind::Anthropic,
                ModelTransportKind::OpenAiCompatible,
            ]
        );
        assert_eq!(
            preset_entry("amazon-bedrock")
                .expect("bedrock")
                .transport_kinds(),
            vec![ModelTransportKind::Bedrock]
        );
    }

    #[test]
    fn supports_transport_reads_the_manifest_keys() {
        assert!(preset_supports_transport(
            "kimi-code",
            ModelTransportKind::Anthropic
        ));
        assert!(!preset_supports_transport(
            "kimi-code",
            ModelTransportKind::Bedrock
        ));
        assert!(preset_supports_transport(
            "amazon-bedrock",
            ModelTransportKind::Bedrock
        ));
        assert!(!preset_supports_transport(
            "amazon-bedrock",
            ModelTransportKind::OpenAiCompatible
        ));
    }

    #[test]
    fn credential_kind_drives_bulk_listing_support() {
        assert_eq!(
            preset_entry("amazon-bedrock")
                .expect("bedrock")
                .credential_kind(),
            "bedrock"
        );
        assert_eq!(
            preset_entry("google-vertex-ai")
                .expect("vertex")
                .credential_kind(),
            "vertex"
        );
        assert!(preset_supports_bulk_listing("kimi-code", "apiKey"));
        // Vertex lists models only with the service-account form.
        assert!(preset_supports_bulk_listing("google-vertex-ai", "vertex"));
        assert!(!preset_supports_bulk_listing("google-vertex-ai", "apiKey"));
        // No HTTP listing endpoint: bedrock (no endpoint) and azure (no catalog).
        assert!(!preset_supports_bulk_listing("amazon-bedrock", "bedrock"));
        assert!(!preset_supports_bulk_listing("azure", "apiKey"));
        assert!(!preset_supports_bulk_listing(
            "cloudflare-ai-gateway",
            "apiKey"
        ));
    }

    #[test]
    fn connect_draft_copies_materialization_templates() {
        let draft = preset_connect_draft("kimi-code", ModelTransportKind::OpenAiCompatible, None);
        assert!(draft.transport_kind.is_none());
        assert_eq!(draft.sdk.as_deref(), Some("@ai-sdk/openai-compatible"));
        assert!(draft.provider_tools.is_some());
        assert!(draft.file_upload.is_some());
        assert_eq!(
            draft
                .body
                .as_ref()
                .and_then(|body| body.get("stream_options")),
            Some(&serde_json::json!({ "include_usage": true }))
        );

        // A non-default transport declares transportKind and falls back to the generic adapter.
        let draft = preset_connect_draft("kimi-code", ModelTransportKind::Anthropic, None);
        assert_eq!(draft.transport_kind.as_deref(), Some("anthropic"));
        assert_eq!(draft.sdk.as_deref(), Some("@ai-sdk/anthropic"));

        // thinkingSwitch templates (meituan) materialize onto the entry.
        let draft = preset_connect_draft("meituan", ModelTransportKind::OpenAiCompatible, None);
        assert!(draft.thinking_switch.is_some());

        // Ark presets carry the stream_options usage template.
        for preset_id in ["volcengine", "byteplus"] {
            let draft = preset_connect_draft(preset_id, ModelTransportKind::OpenAiCompatible, None);
            assert_eq!(
                draft
                    .body
                    .as_ref()
                    .and_then(|body| body.get("stream_options")),
                Some(&serde_json::json!({ "include_usage": true })),
                "{preset_id}"
            );
        }

        // Bedrock declares no sdk (self-held transport implementation).
        let draft = preset_connect_draft("amazon-bedrock", ModelTransportKind::Bedrock, None);
        assert_eq!(draft.transport_kind.as_deref(), Some("bedrock"));
        assert!(draft.sdk.is_none());

        // Custom connections declare nothing beyond a non-default transport.
        let draft = preset_connect_draft("custom", ModelTransportKind::Anthropic, None);
        assert_eq!(draft.transport_kind.as_deref(), Some("anthropic"));
        assert!(draft.sdk.is_none());
        assert!(draft.provider_tools.is_none());

        // Mechanism option templates materialize with transport scoping.
        let draft = preset_connect_draft(
            "cloudflare-ai-gateway",
            ModelTransportKind::OpenAiCompatible,
            None,
        );
        assert_eq!(
            draft
                .options
                .as_ref()
                .and_then(|options| options.get("toolsRejectReasoningEffort")),
            Some(&serde_json::json!(true))
        );
        let draft = preset_connect_draft("deepseek", ModelTransportKind::OpenResponses, None);
        assert_eq!(
            draft
                .options
                .as_ref()
                .and_then(|options| options.get("echoServerToolCalls")),
            Some(&serde_json::json!(true))
        );
        // volcengine's default transport is openai-compatible: the open-responses-scoped key drops.
        let draft = preset_connect_draft("volcengine", ModelTransportKind::OpenAiCompatible, None);
        assert!(
            draft
                .options
                .as_ref()
                .is_none_or(|options| !options.contains_key("defaultInputItemStatus"))
        );
        // storedState is open-responses-scoped too: ark and alibaba carry it only there.
        let draft = preset_connect_draft("volcengine", ModelTransportKind::OpenResponses, None);
        assert_eq!(
            draft
                .options
                .as_ref()
                .and_then(|options| options.get("storedState")),
            Some(&serde_json::json!(true))
        );
        let draft = preset_connect_draft("byteplus", ModelTransportKind::OpenResponses, None);
        assert_eq!(
            draft
                .options
                .as_ref()
                .and_then(|options| options.get("storedState")),
            Some(&serde_json::json!(true))
        );
        let draft = preset_connect_draft("alibaba", ModelTransportKind::OpenResponses, None);
        assert_eq!(
            draft
                .options
                .as_ref()
                .and_then(|options| options.get("storedState")),
            Some(&serde_json::json!(true))
        );
        let draft = preset_connect_draft("alibaba", ModelTransportKind::OpenAiCompatible, None);
        assert!(
            draft
                .options
                .as_ref()
                .is_none_or(|options| !options.contains_key("storedState"))
        );
        let draft = preset_connect_draft("xiaomi", ModelTransportKind::OpenAiCompatible, None);
        assert_eq!(
            draft
                .options
                .as_ref()
                .and_then(|options| options.get("maxInlineMediaBytes")),
            Some(&serde_json::json!(52428800))
        );
        // apply_patch declarations: pinned open-responses presets always carry the key; presets
        // defaulting to openai-compatible only carry it over the open-responses transport.
        let draft = preset_connect_draft("openai", ModelTransportKind::OpenResponses, None);
        assert_eq!(
            draft
                .options
                .as_ref()
                .and_then(|options| options.get("applyPatch")),
            Some(&serde_json::json!(true))
        );
        let draft = preset_connect_draft("openrouter", ModelTransportKind::OpenAiCompatible, None);
        assert!(
            draft
                .options
                .as_ref()
                .is_none_or(|options| !options.contains_key("applyPatch"))
        );
        let draft = preset_connect_draft("openrouter", ModelTransportKind::OpenResponses, None);
        assert_eq!(
            draft
                .options
                .as_ref()
                .and_then(|options| options.get("applyPatch")),
            Some(&serde_json::json!(true))
        );
        // openRouterAnthropicReasoning spans both OpenAI-family surfaces; the anthropic transport
        // (native Messages) drops it.
        let draft = preset_connect_draft("openrouter", ModelTransportKind::OpenAiCompatible, None);
        assert_eq!(
            draft
                .options
                .as_ref()
                .and_then(|options| options.get("openRouterAnthropicReasoning")),
            Some(&serde_json::json!(true))
        );
        let draft = preset_connect_draft("openrouter", ModelTransportKind::OpenResponses, None);
        assert_eq!(
            draft
                .options
                .as_ref()
                .and_then(|options| options.get("openRouterAnthropicReasoning")),
            Some(&serde_json::json!(true))
        );
        let draft = preset_connect_draft("openrouter", ModelTransportKind::Anthropic, None);
        assert!(
            draft
                .options
                .as_ref()
                .is_none_or(|options| !options.contains_key("openRouterAnthropicReasoning"))
        );
    }

    #[test]
    fn connect_draft_applies_per_site_file_upload_override() {
        // MiniMax's cn site pins the upload channel to the regional host.
        let draft = preset_connect_draft("minimax", ModelTransportKind::Anthropic, Some("cn"));
        let file_upload = draft.file_upload.expect("fileUpload");
        assert_eq!(
            file_upload.get("url").and_then(Value::as_str),
            Some("https://api.minimax.cn/v1/files/upload")
        );

        let draft = preset_connect_draft("minimax", ModelTransportKind::Anthropic, Some("intl"));
        let file_upload = draft.file_upload.expect("fileUpload");
        assert_eq!(
            file_upload.get("url").and_then(Value::as_str),
            Some("https://api.minimax.io/v1/files/upload")
        );
    }

    #[test]
    fn connect_draft_bakes_execute_urls_for_non_default_transports() {
        // kimi-code on anthropic: the search endpoint stays on the openai-compatible root.
        let draft = preset_connect_draft("kimi-code", ModelTransportKind::Anthropic, Some("cn"));
        let tools = draft.provider_tools.expect("providerTools");
        let execute = tools[0].get("execute").expect("execute");
        assert_eq!(
            execute.get("url").and_then(Value::as_str),
            Some("https://api.kimi.com/coding/v1/search")
        );
        assert!(execute.get("path").is_none());

        // The fileUpload path bakes onto the same openai-compatible root.
        let file_upload = draft.file_upload.expect("fileUpload");
        assert_eq!(
            file_upload.get("url").and_then(Value::as_str),
            Some("https://api.kimi.com/coding/v1/files")
        );
        assert!(file_upload.get("path").is_none());

        // The default transport keeps the relative path (joined against the chat base at runtime).
        let draft = preset_connect_draft(
            "kimi-code",
            ModelTransportKind::OpenAiCompatible,
            Some("cn"),
        );
        let tools = draft.provider_tools.expect("providerTools");
        assert_eq!(
            tools[0]
                .get("execute")
                .and_then(|execute| execute.get("path"))
                .and_then(Value::as_str),
            Some("/search")
        );
        let file_upload = draft.file_upload.expect("fileUpload");
        assert_eq!(
            file_upload.get("path").and_then(Value::as_str),
            Some("/files")
        );
        assert!(file_upload.get("url").is_none());
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
    fn is_valid_azure_resource_name_rejects_invalid_values() {
        assert!(is_valid_azure_resource_name("my-openai-resource"));
        assert!(!is_valid_azure_resource_name("-bad"));
        assert!(!is_valid_azure_resource_name("bad@host"));
    }

    #[test]
    fn is_valid_cloudflare_gateway_id_rejects_invalid_values() {
        assert!(is_valid_cloudflare_gateway_id("my-gateway"));
        assert!(!is_valid_cloudflare_gateway_id("-bad"));
        assert!(!is_valid_cloudflare_gateway_id("bad@host"));
    }
}
