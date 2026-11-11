//! Reads `packages/agent-core/src/provider-presets/provider-presets.json` (TUI preset endpoints and picker order).
//!
//! Preset identity is the manifest's string `id`; there is no vendor enum. The wizard reads
//! `transports` / `sites` / `billingPlans` / `credentials` / `expressApiBase` as data and
//! materializes the public config declarations (`apiBase`, `sdk`, `providerTools`, …) at
//! connect time, mirroring agent-core `resolvePresetApiBase` + `materializeProviderPreset`.

use crate::model_registry::ModelTransportKind;
use serde::Deserialize;
use std::collections::BTreeMap;
use std::sync::OnceLock;

/// The wizard-only pseudo preset id for a fully custom connection.
pub(crate) const CUSTOM_PROVIDER_PRESET_ID: &str = "custom";

/// The preset's default credential form when `credentials.kind` is absent.
pub(crate) const CREDENTIAL_KIND_API_KEY: &str = "apiKey";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProviderPresetsFile {
    providers: Vec<ProviderPresetEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderPresetEntry {
    id: String,
    /// Fallback display label; the apps' i18n key mapping wins when present.
    pub(crate) label: Option<String>,
    default_transport: String,
    transports: BTreeMap<String, String>,
    sites: Option<ProviderPresetSites>,
    billing_plans: Option<Vec<ProviderPresetBillingPlan>>,
    credentials: Option<ProviderPresetCredentials>,
    /// Materialization templates copied verbatim onto the config entry at connect time
    /// (`providers[].providerTools` / `fileUpload` / `body` / `thinkingSwitch` /
    /// `imageApi` / `videoApi` / `options`).
    /// Mechanism option flags materialized onto the entry (e.g. `toolsRejectReasoningEffort`).
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

/// The final `apiBase` for a connect: the resolved template with the wizard-collected
/// `{placeholder}` values substituted.
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
