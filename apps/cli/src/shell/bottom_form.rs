//! TUI bottom-form helpers.

use std::collections::{BTreeMap, HashMap};

use rust_i18n::t;
use serde_json::{Map, Value};

use crate::{
    host_protocol::CliExtensionEntry,
    mcp::{McpCapabilityToggles, McpScope, McpServerConfig, McpTransportConfig},
    mcp_types::McpDiscoveredPrompt,
    model_registry::ModelTransportKind,
    provider_presets::{
        CUSTOM_PROVIDER_PRESET_ID, PresetConnectSelections, ProviderPresetSite,
        is_valid_azure_resource_name, is_valid_cloudflare_account_id,
        is_valid_cloudflare_gateway_id, list_base_template_keys, model_add_picker_order_ids,
        model_add_provider_id_at_choice_index, preset_connect_api_base,
        preset_connect_base_template, preset_default_transport_kind, preset_entry,
        preset_supports_bulk_listing,
    },
    rules::{RuleEntry, RuleScope},
    skills::{SkillEntry, SkillScope},
    view::{
        BottomFormFieldEditorView, BottomFormFieldView, BottomFormKind, BottomFormView,
        McpPromptArgumentBinding,
    },
};

const MCP_ADD_FIELD_NAME: usize = 0;
const MCP_ADD_FIELD_SCOPE: usize = 1;
const MCP_ADD_FIELD_TRANSPORT: usize = 2;
const MCP_ADD_FIELD_ENDPOINT: usize = 3;
const MCP_ADD_FIELD_METADATA: usize = 4;

const HOOK_ADD_FIELD_SCOPE: usize = 0;
const HOOK_ADD_FIELD_EVENT: usize = 1;
const HOOK_ADD_FIELD_COMMAND: usize = 2;
const HOOK_ADD_FIELD_TIMEOUT: usize = 3;
const HOOK_ADD_FIELD_MATCHER: usize = 4;
const HOOK_ADD_FIELD_FAIL_CLOSED: usize = 5;

const HOOK_EVENTS: &[&str] = &[
    "sessionStart",
    "sessionEnd",
    "submitPrompt",
    "preToolUse",
    "postToolUse",
    "subagentStart",
    "subagentEnd",
];

const DEFAULT_HOOK_COMMAND: &str = "hooks/log-hook.sh";
const DEFAULT_HOOK_TIMEOUT: &str = "30";
const HOOK_EVENT_PRE_TOOL_USE_INDEX: usize = 3;

const MODEL_ADD_FIELD_PROVIDER: usize = 0;

#[cfg(test)]
fn model_add_picker_index_of(preset_id: &str) -> usize {
    model_add_picker_order_ids()
        .iter()
        .position(|id| id == preset_id)
        .unwrap_or(0)
}

const MCP_DEFAULT_TIMEOUT_MS: u64 = 20_000;

pub(crate) fn new_mcp_add_form() -> BottomFormView {
    let mut form = BottomFormView {
        kind: BottomFormKind::McpAdd,
        title: t!("form.mcp.title").into_owned(),
        fields: vec![
            BottomFormFieldView {
                label: t!("form.mcp.field.name.label").into_owned(),
                help: String::new(),
                editor: BottomFormFieldEditorView::Text {
                    value: String::new(),
                    placeholder: t!("form.mcp.field.name.placeholder").into_owned(),
                    cursor: 0,
                    mask: false,
                    disabled: false,
                },
            },
            BottomFormFieldView {
                label: t!("form.mcp.field.scope.label").into_owned(),
                help: String::new(),
                editor: BottomFormFieldEditorView::Choice {
                    options: vec![
                        crate::locale::product_text("form.mcp.field.scope.workspace").into_owned(),
                        t!("form.mcp.field.scope.user").into_owned(),
                    ],
                    selected: 0,
                },
            },
            BottomFormFieldView {
                label: t!("form.mcp.field.transport.label").into_owned(),
                help: String::new(),
                editor: BottomFormFieldEditorView::Choice {
                    options: vec![
                        t!("form.mcp.field.transport.stdio").into_owned(),
                        t!("form.mcp.field.transport.http").into_owned(),
                    ],
                    selected: 0,
                },
            },
            BottomFormFieldView {
                label: String::new(),
                help: String::new(),
                editor: BottomFormFieldEditorView::Text {
                    value: String::new(),
                    placeholder: String::new(),
                    cursor: 0,
                    mask: false,
                    disabled: false,
                },
            },
            BottomFormFieldView {
                label: String::new(),
                help: String::new(),
                editor: BottomFormFieldEditorView::Text {
                    value: String::new(),
                    placeholder: String::new(),
                    cursor: 0,
                    mask: false,
                    disabled: false,
                },
            },
        ],
        selected_field: MCP_ADD_FIELD_NAME,
        scroll_offset: 0,
        footer_hint: t!("form.mcp.footer_hint").into_owned(),
    };
    sync_mcp_add_form_fields(&mut form);
    form
}

pub(crate) fn new_hook_add_form(workspace_scope_available: bool) -> BottomFormView {
    let scope_options = if workspace_scope_available {
        vec![
            crate::locale::product_text("form.hooks.field.scope.workspace").into_owned(),
            t!("form.hooks.field.scope.user").into_owned(),
        ]
    } else {
        vec![t!("form.hooks.field.scope.user").into_owned()]
    };

    BottomFormView {
        kind: BottomFormKind::HookAdd,
        title: t!("form.hooks.title").into_owned(),
        fields: vec![
            BottomFormFieldView {
                label: t!("form.hooks.field.scope.label").into_owned(),
                help: String::new(),
                editor: BottomFormFieldEditorView::Choice {
                    options: scope_options,
                    selected: 0,
                },
            },
            BottomFormFieldView {
                label: t!("form.hooks.field.event.label").into_owned(),
                help: String::new(),
                editor: BottomFormFieldEditorView::Choice {
                    options: HOOK_EVENTS
                        .iter()
                        .map(|event| (*event).to_string())
                        .collect(),
                    selected: HOOK_EVENT_PRE_TOOL_USE_INDEX,
                },
            },
            BottomFormFieldView {
                label: t!("form.hooks.field.command.label").into_owned(),
                help: String::new(),
                editor: BottomFormFieldEditorView::Text {
                    value: DEFAULT_HOOK_COMMAND.to_string(),
                    placeholder: t!("form.hooks.field.command.placeholder").into_owned(),
                    cursor: DEFAULT_HOOK_COMMAND.chars().count(),
                    mask: false,
                    disabled: false,
                },
            },
            BottomFormFieldView {
                label: t!("form.hooks.field.timeout.label").into_owned(),
                help: String::new(),
                editor: BottomFormFieldEditorView::Text {
                    value: DEFAULT_HOOK_TIMEOUT.to_string(),
                    placeholder: t!("form.hooks.field.timeout.placeholder").into_owned(),
                    cursor: DEFAULT_HOOK_TIMEOUT.chars().count(),
                    mask: false,
                    disabled: false,
                },
            },
            BottomFormFieldView {
                label: t!("form.hooks.field.matcher.label").into_owned(),
                help: String::new(),
                editor: BottomFormFieldEditorView::Text {
                    value: String::new(),
                    placeholder: t!("form.hooks.field.matcher.placeholder").into_owned(),
                    cursor: 0,
                    mask: false,
                    disabled: false,
                },
            },
            BottomFormFieldView {
                label: t!("form.hooks.field.fail_closed.label").into_owned(),
                help: String::new(),
                editor: BottomFormFieldEditorView::Checkbox {
                    id: "failClosed".to_string(),
                    checked: false,
                    disabled: false,
                    path: None,
                },
            },
        ],
        selected_field: HOOK_ADD_FIELD_COMMAND,
        scroll_offset: 0,
        footer_hint: t!("form.hooks.footer_hint").into_owned(),
    }
}

/// Runtime i18n lookup for keys composed from preset data; a missing key falls back instead
/// of rendering `{locale}.{key}`.
fn try_translate(key: &str) -> Option<String> {
    crate::_rust_i18n_try_translate(rust_i18n::locale().as_ref(), key)
        .map(std::borrow::Cow::into_owned)
}

fn localized_or(key: &str, fallback: &str) -> String {
    try_translate(key).unwrap_or_else(|| fallback.to_string())
}

/// The provider picker's display label: the app's i18n mapping wins, then the preset's
/// manifest `label` (fallback semantics), then the raw id.
fn model_add_provider_label(id: &str) -> String {
    let fallback = preset_entry(id)
        .and_then(|preset| preset.label.clone())
        .unwrap_or_else(|| id.to_string());
    if let Some(text) = try_translate(&format!("form.model.provider.{id}")) {
        return text;
    }
    localized_or(
        &format!("form.model.provider.{}", id.replace('-', "_")),
        &fallback,
    )
}

fn model_add_provider_choice_labels() -> Vec<String> {
    model_add_picker_order_ids()
        .iter()
        .map(|id| model_add_provider_label(id))
        .collect()
}

/// The site picker's display label: the app's i18n mapping wins, then the manifest label.
fn model_add_site_label(provider_id: &str, site: &ProviderPresetSite) -> String {
    let key = format!("form.model.provider.{provider_id}.site.{}", site.id);
    localized_or(&key, site.label.as_deref().unwrap_or(site.id.as_str()))
}

fn model_add_transport_kind_label(kind: ModelTransportKind) -> String {
    localized_or(
        &format!("form.model.api_kind.{}", kind.as_str().replace('-', "_")),
        kind.as_str(),
    )
}

fn model_add_provider_option_count() -> usize {
    model_add_provider_choice_labels().len()
}

fn model_add_provider_selected(form: &BottomFormView) -> Option<usize> {
    match form.fields.get(MODEL_ADD_FIELD_PROVIDER).map(|f| &f.editor) {
        Some(BottomFormFieldEditorView::Choice { selected, options }) if !options.is_empty() => {
            Some((*selected).min(options.len().saturating_sub(1)))
        }
        _ => None,
    }
}

fn model_add_choice_selected(form: &BottomFormView, label: &str) -> Option<usize> {
    form.fields
        .iter()
        .find(|field| field.label == label)
        .and_then(|field| match &field.editor {
            BottomFormFieldEditorView::Choice { selected, options } if !options.is_empty() => {
                Some((*selected).min(options.len() - 1))
            }
            _ => None,
        })
}

/// Text values keyed by field label: the form rebuilds on every choice change, and values
/// survive by label (slots move as sections appear/disappear with the selected preset).
fn model_add_text_values_by_label(form: &BottomFormView) -> HashMap<String, String> {
    form.fields
        .iter()
        .filter_map(|field| match &field.editor {
            BottomFormFieldEditorView::Text { value, .. } if !field.label.is_empty() => {
                Some((field.label.clone(), value.clone()))
            }
            _ => None,
        })
        .collect()
}

fn model_add_saved_text(texts: &HashMap<String, String>, labels: &[String]) -> String {
    labels
        .iter()
        .find_map(|label| texts.get(label))
        .cloned()
        .unwrap_or_default()
}

/// Current choice selections of the model-add form, keyed by field label.
#[derive(Default)]
struct ModelAddChoiceSelections {
    mode: Option<usize>,
    credential_kind: Option<usize>,
    billing_plan: Option<usize>,
    site: Option<usize>,
    transport: Option<usize>,
}

fn model_add_choice_selections(form: &BottomFormView) -> ModelAddChoiceSelections {
    ModelAddChoiceSelections {
        mode: model_add_choice_selected(form, t!("form.model.field.mode.label").as_ref()),
        credential_kind: model_add_choice_selected(
            form,
            t!("form.model.field.credential_kind.label").as_ref(),
        ),
        billing_plan: model_add_choice_selected(
            form,
            t!("form.model.field.billing_mode.label").as_ref(),
        ),
        site: model_add_choice_selected(form, t!("form.model.field.site.label").as_ref()),
        transport: model_add_choice_selected(form, t!("form.model.field.api_kind.label").as_ref()),
    }
}

/// Which credential form the wizard collects, driven by the preset's `credentials.kind`
/// (the vertex preset additionally offers the apiKey Express shortcut).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum CredentialForm {
    ApiKey,
    BedrockIam,
    VertexServiceAccount,
}

impl CredentialForm {
    fn kind_str(self) -> &'static str {
        match self {
            Self::ApiKey => "apiKey",
            Self::BedrockIam => "bedrock",
            Self::VertexServiceAccount => "vertex",
        }
    }
}

/// The model-add form's field layout, computed from the selected preset's manifest data
/// (`transports` / `sites` / `billingPlans` / `credentials.kind` / `expressApiBase` /
/// `catalog`) plus the current choice selections. Both the form builder and the parser read
/// this plan, so fields are located by label instead of positional indices.
#[derive(Debug)]
struct ModelAddFormPlan {
    provider_id: String,
    /// Bulk import of the catalog listing (vs single-model manual entry).
    bulk: bool,
    credential_form: CredentialForm,
    transport_kind: ModelTransportKind,
    transport_options: Vec<ModelTransportKind>,
    site_id: Option<String>,
    billing_plan_id: Option<String>,
    /// `{placeholder}` template values to collect for the resolved base.
    template_keys: Vec<String>,
    /// The cloudflare wizard additionally collects the gateway id (materialized into the
    /// literal `cf-aig-gateway-id` header).
    collect_gateway_id: bool,
    /// Manual single-model entry: model name + context length fields.
    manual_single: bool,
    has_mode_field: bool,
    has_credential_choice: bool,
    has_billing_field: bool,
    has_site_field: bool,
    has_transport_field: bool,
    has_api_base_field: bool,
    mode_selected: usize,
    credential_selected: usize,
    billing_selected: usize,
    site_selected: usize,
    transport_selected: usize,
}

impl ModelAddFormPlan {
    fn resolve(provider_id: &str, choices: &ModelAddChoiceSelections) -> Self {
        if provider_id == CUSTOM_PROVIDER_PRESET_ID {
            let mode_selected = choices.mode.unwrap_or(0).min(1);
            let bulk = mode_selected == 1;
            let transport_options = vec![
                ModelTransportKind::OpenAiCompatible,
                ModelTransportKind::OpenResponses,
                ModelTransportKind::Anthropic,
            ];
            let transport_selected = choices
                .transport
                .unwrap_or(0)
                .min(transport_options.len() - 1);
            return Self {
                provider_id: provider_id.to_string(),
                bulk,
                credential_form: CredentialForm::ApiKey,
                transport_kind: transport_options[transport_selected],
                transport_options,
                site_id: None,
                billing_plan_id: None,
                template_keys: Vec::new(),
                collect_gateway_id: false,
                manual_single: !bulk,
                has_mode_field: true,
                has_credential_choice: false,
                has_billing_field: false,
                has_site_field: false,
                has_transport_field: true,
                has_api_base_field: true,
                mode_selected,
                credential_selected: 0,
                billing_selected: 0,
                site_selected: 0,
                transport_selected,
            };
        }

        let preset = preset_entry(provider_id);

        // Credential form: the preset's `credentials.kind`; the vertex preset also offers
        // the apiKey (Express) shortcut when it declares `expressApiBase`.
        let preset_credential_kind = preset
            .map(|entry| entry.credential_kind())
            .unwrap_or("apiKey");
        let has_credential_choice = preset_credential_kind == "vertex"
            && preset.is_some_and(|entry| entry.express_api_base().is_some());
        let credential_selected = choices.credential_kind.unwrap_or(0).min(1);
        let credential_form = match preset_credential_kind {
            "bedrock" => CredentialForm::BedrockIam,
            "vertex" if has_credential_choice && credential_selected == 1 => CredentialForm::ApiKey,
            "vertex" => CredentialForm::VertexServiceAccount,
            _ => CredentialForm::ApiKey,
        };

        // Billing plans: option 0 is the standard connection; a selected plan overrides
        // the site selection (the plan pins its own bases).
        let plans = preset.map(|entry| entry.billing_plans()).unwrap_or(&[]);
        let has_billing_field = !plans.is_empty();
        let billing_selected = choices.billing_plan.unwrap_or(0).min(plans.len());
        let billing_plan_id = (has_billing_field && billing_selected > 0)
            .then(|| plans[billing_selected - 1].id.clone());

        // Sites from the preset's `sites.items`, defaulting to `sites.default`.
        let sites = preset.map(|entry| entry.sites()).unwrap_or(&[]);
        let has_site_field = !sites.is_empty() && billing_plan_id.is_none();
        let default_site = preset
            .and_then(|entry| entry.default_site_id())
            .and_then(|default| sites.iter().position(|site| site.id == default))
            .unwrap_or(0);
        let site_selected = choices
            .site
            .unwrap_or(default_site)
            .min(sites.len().saturating_sub(1));
        let site_id = has_site_field.then(|| sites[site_selected].id.clone());

        // Transports from the preset's `transports` keys (pinned when only one).
        let transport_options = preset
            .map(|entry| entry.transport_kinds())
            .unwrap_or_default();
        let has_transport_field = transport_options.len() > 1;
        let transport_selected = choices
            .transport
            .unwrap_or(0)
            .min(transport_options.len().saturating_sub(1));
        let transport_kind = transport_options
            .get(transport_selected)
            .copied()
            .unwrap_or_else(|| preset_default_transport_kind(provider_id));

        // Bulk import requires a catalog listing endpoint and a listable credential form.
        let bulk = preset_supports_bulk_listing(provider_id, credential_form.kind_str());

        // Template fields: the `{placeholder}` keys of the raw base for this selection.
        let selections = PresetConnectSelections {
            transport_kind: Some(transport_kind),
            site_id: site_id.as_deref(),
            billing_plan_id: billing_plan_id.as_deref(),
            template_values: BTreeMap::new(),
            credential_kind: Some(credential_form.kind_str()),
        };
        let mut template_keys = preset_connect_base_template(provider_id, &selections)
            .map(|template| list_base_template_keys(&template))
            .unwrap_or_default();
        template_keys.sort_by_key(|key| template_key_order(key));

        Self {
            provider_id: provider_id.to_string(),
            bulk,
            credential_form,
            transport_kind,
            transport_options,
            site_id,
            billing_plan_id,
            template_keys,
            collect_gateway_id: provider_id == "cloudflare-ai-gateway",
            manual_single: !bulk,
            has_mode_field: bulk,
            has_credential_choice,
            has_billing_field,
            has_site_field,
            has_transport_field,
            has_api_base_field: false,
            mode_selected: 0,
            credential_selected,
            billing_selected,
            site_selected,
            transport_selected,
        }
    }

    fn build_fields(
        &self,
        provider_idx: usize,
        texts: &HashMap<String, String>,
    ) -> Vec<BottomFormFieldView> {
        let mut fields = vec![model_add_provider_field(provider_idx)];
        let is_custom = self.provider_id == CUSTOM_PROVIDER_PRESET_ID;

        if self.has_mode_field {
            let options = if is_custom {
                vec![
                    t!("form.model.mode.single").into_owned(),
                    t!("form.model.mode.bulk").into_owned(),
                ]
            } else {
                vec![t!("form.model.mode.bulk_only").into_owned()]
            };
            fields.push(model_add_choice_field(
                t!("form.model.field.mode.label").into_owned(),
                options,
                self.mode_selected,
            ));
        }

        if self.has_credential_choice {
            fields.push(model_add_choice_field(
                t!("form.model.field.credential_kind.label").into_owned(),
                vec![
                    t!("form.model.credential_kind.service_account").into_owned(),
                    t!("form.model.credential_kind.api_key").into_owned(),
                ],
                self.credential_selected,
            ));
        }

        if self.has_billing_field {
            let plans = preset_entry(&self.provider_id)
                .map(|entry| entry.billing_plans())
                .unwrap_or(&[]);
            let mut options = vec![t!("form.model.billing_mode.standard").into_owned()];
            options.extend(
                plans
                    .iter()
                    .map(|plan| plan.label.clone().unwrap_or_else(|| plan.id.clone())),
            );
            fields.push(model_add_choice_field(
                t!("form.model.field.billing_mode.label").into_owned(),
                options,
                self.billing_selected,
            ));
        }

        if self.has_site_field {
            let sites = preset_entry(&self.provider_id)
                .map(|entry| entry.sites())
                .unwrap_or(&[]);
            let options = sites
                .iter()
                .map(|site| model_add_site_label(&self.provider_id, site))
                .collect();
            fields.push(model_add_choice_field(
                t!("form.model.field.site.label").into_owned(),
                options,
                self.site_selected,
            ));
        }

        if self.has_transport_field {
            let options = self
                .transport_options
                .iter()
                .map(|kind| model_add_transport_kind_label(*kind))
                .collect();
            fields.push(model_add_choice_field(
                t!("form.model.field.api_kind.label").into_owned(),
                options,
                self.transport_selected,
            ));
        }

        for key in &self.template_keys {
            let (label, help, placeholder) = model_add_template_field_copy(key);
            let default_value = if key == "awsRegion" { "us-east-1" } else { "" };
            let value = texts
                .get(&label)
                .map(String::as_str)
                .unwrap_or(default_value);
            fields.push(model_add_text_field(label, help, placeholder, value, false));
        }

        if self.collect_gateway_id {
            let label = t!("form.model.field.cloudflare_gateway_id.label").into_owned();
            let value = model_add_saved_text(texts, std::slice::from_ref(&label));
            fields.push(model_add_text_field(
                label,
                t!("form.model.field.cloudflare_gateway_id.help").into_owned(),
                t!("form.model.field.cloudflare_gateway_id.placeholder").into_owned(),
                &value,
                false,
            ));
        }

        if self.manual_single {
            let (label, help, placeholder) = model_add_model_name_field_copy(&self.provider_id);
            let value = model_add_saved_text(texts, &model_add_model_name_field_labels());
            fields.push(model_add_text_field(
                label,
                help,
                placeholder,
                &value,
                false,
            ));
        }

        if self.has_api_base_field {
            let label = t!("form.model.field.api_base.label").into_owned();
            let value = model_add_saved_text(texts, std::slice::from_ref(&label));
            fields.push(model_add_text_field(
                label,
                String::new(),
                t!("form.model.field.api_base.placeholder").into_owned(),
                &value,
                false,
            ));
        }

        if self.manual_single {
            let label = t!("form.model.field.context_length.label").into_owned();
            let value = model_add_saved_text(texts, std::slice::from_ref(&label));
            fields.push(model_add_text_field(
                label,
                t!("form.model.field.context_length.help").into_owned(),
                t!("form.model.field.context_length.placeholder").into_owned(),
                &value,
                false,
            ));
        }

        match self.credential_form {
            CredentialForm::ApiKey => {
                let (label, help, placeholder) = model_add_api_key_field_copy(&self.provider_id);
                let value = model_add_saved_text(texts, &model_add_api_key_field_labels());
                fields.push(model_add_text_field(label, help, placeholder, &value, true));
            }
            CredentialForm::BedrockIam => {
                let access_label = t!("form.model.field.bedrock_access_key_id.label").into_owned();
                let access_value = model_add_saved_text(texts, std::slice::from_ref(&access_label));
                fields.push(model_add_text_field(
                    access_label,
                    String::new(),
                    t!("form.model.field.bedrock_access_key_id.placeholder").into_owned(),
                    &access_value,
                    false,
                ));
                let secret_label =
                    t!("form.model.field.bedrock_secret_access_key.label").into_owned();
                let secret_value = model_add_saved_text(texts, std::slice::from_ref(&secret_label));
                fields.push(model_add_text_field(
                    secret_label,
                    String::new(),
                    t!("form.model.field.bedrock_secret_access_key.placeholder").into_owned(),
                    &secret_value,
                    true,
                ));
            }
            CredentialForm::VertexServiceAccount => {
                let email_label = t!("form.model.field.vertex_client_email.label").into_owned();
                let email_value = model_add_saved_text(texts, std::slice::from_ref(&email_label));
                fields.push(model_add_text_field(
                    email_label,
                    t!("form.model.field.vertex_client_email.help").into_owned(),
                    t!("form.model.field.vertex_client_email.placeholder").into_owned(),
                    &email_value,
                    false,
                ));
                let key_label = t!("form.model.field.vertex_private_key.label").into_owned();
                let key_value = model_add_saved_text(texts, std::slice::from_ref(&key_label));
                fields.push(model_add_text_field(
                    key_label,
                    t!("form.model.field.vertex_private_key.help").into_owned(),
                    t!("form.model.field.vertex_private_key.placeholder").into_owned(),
                    &key_value,
                    true,
                ));
            }
        }

        fields
    }
}

/// Canonical display order for `{placeholder}` template fields (unknown keys last, in
/// appearance order).
fn template_key_order(key: &str) -> usize {
    [
        "resourceName",
        "accountId",
        "workspaceId",
        "project",
        "location",
        "awsRegion",
    ]
    .iter()
    .position(|known| *known == key)
    .unwrap_or(usize::MAX)
}

/// Label/help/placeholder copy for a `{placeholder}` template field, keyed by the
/// placeholder name from the preset data.
fn model_add_template_field_copy(key: &str) -> (String, String, String) {
    match key {
        "resourceName" => (
            t!("form.model.field.azure_resource_name.label").into_owned(),
            t!("form.model.field.azure_resource_name.help").into_owned(),
            t!("form.model.field.azure_resource_name.placeholder").into_owned(),
        ),
        "accountId" => (
            t!("form.model.field.cloudflare_account_id.label").into_owned(),
            t!("form.model.field.cloudflare_account_id.help").into_owned(),
            t!("form.model.field.cloudflare_account_id.placeholder").into_owned(),
        ),
        "workspaceId" => (
            t!("form.model.field.alibaba_workspace_id.label").into_owned(),
            t!("form.model.field.alibaba_workspace_id.help").into_owned(),
            t!("form.model.field.alibaba_workspace_id.placeholder").into_owned(),
        ),
        "project" => (
            t!("form.model.field.vertex_project.label").into_owned(),
            String::new(),
            t!("form.model.field.vertex_project.placeholder").into_owned(),
        ),
        "location" => (
            t!("form.model.field.vertex_location.label").into_owned(),
            String::new(),
            t!("form.model.field.vertex_location.placeholder").into_owned(),
        ),
        "awsRegion" => (
            t!("form.model.field.aws_region.label").into_owned(),
            String::new(),
            t!("form.model.field.aws_region.placeholder").into_owned(),
        ),
        _ => (key.to_string(), String::new(), String::new()),
    }
}

fn validate_template_value(key: &str, value: &str) -> Result<(), String> {
    match key {
        "resourceName" if value.is_empty() => {
            Err(t!("form.model.validation.azure_resource_name_empty").into_owned())
        }
        "resourceName" if !is_valid_azure_resource_name(value) => {
            Err(t!("form.model.validation.azure_resource_name_invalid").into_owned())
        }
        "accountId" if value.is_empty() => {
            Err(t!("form.model.validation.cloudflare_account_id_empty").into_owned())
        }
        "accountId" if !is_valid_cloudflare_account_id(value) => {
            Err(t!("form.model.validation.cloudflare_account_id_invalid").into_owned())
        }
        "project" | "location" if value.is_empty() => {
            Err(t!("form.model.validation.vertex_project_location_required").into_owned())
        }
        _ if value.is_empty() => {
            let (label, _, _) = model_add_template_field_copy(key);
            Err(t!("form.model.validation.field_required", label = label).into_owned())
        }
        _ => Ok(()),
    }
}

/// The model-name field's label variants (deployment / gateway model id wordings); all map
/// to the same slot so the value survives provider switches.
fn model_add_model_name_field_labels() -> Vec<String> {
    vec![
        t!("form.model.field.model_name.label").into_owned(),
        t!("form.model.field.deployment_name.label").into_owned(),
        t!("form.model.field.cloudflare_model_name.label").into_owned(),
    ]
}

fn model_add_model_name_field_copy(provider_id: &str) -> (String, String, String) {
    match provider_id {
        "azure" => (
            t!("form.model.field.deployment_name.label").into_owned(),
            String::new(),
            t!("form.model.field.deployment_name.placeholder").into_owned(),
        ),
        "cloudflare-ai-gateway" => (
            t!("form.model.field.cloudflare_model_name.label").into_owned(),
            t!("form.model.field.cloudflare_model_name.help").into_owned(),
            t!("form.model.field.cloudflare_model_name.placeholder").into_owned(),
        ),
        _ => (
            t!("form.model.field.model_name.label").into_owned(),
            String::new(),
            t!("form.model.field.model_name.placeholder").into_owned(),
        ),
    }
}

fn model_add_api_key_field_labels() -> Vec<String> {
    vec![
        t!("form.model.field.api_key.label").into_owned(),
        t!("form.model.field.cloudflare_api_token.label").into_owned(),
    ]
}

fn model_add_api_key_field_copy(provider_id: &str) -> (String, String, String) {
    match provider_id {
        "cloudflare-ai-gateway" => (
            t!("form.model.field.cloudflare_api_token.label").into_owned(),
            t!("form.model.field.cloudflare_api_token.help").into_owned(),
            t!("form.model.field.cloudflare_api_token.placeholder").into_owned(),
        ),
        _ => (
            t!("form.model.field.api_key.label").into_owned(),
            t!("form.model.field.api_key.help").into_owned(),
            t!("form.model.field.api_key.placeholder").into_owned(),
        ),
    }
}

fn model_add_choice_field(
    label: String,
    options: Vec<String>,
    selected: usize,
) -> BottomFormFieldView {
    let selected = if options.is_empty() {
        0
    } else {
        selected.min(options.len() - 1)
    };
    BottomFormFieldView {
        label,
        help: String::new(),
        editor: BottomFormFieldEditorView::Choice { options, selected },
    }
}

fn model_add_text_field(
    label: String,
    help: String,
    placeholder: String,
    value: &str,
    mask: bool,
) -> BottomFormFieldView {
    let value = value.to_string();
    let cursor = value.chars().count();
    BottomFormFieldView {
        label,
        help,
        editor: BottomFormFieldEditorView::Text {
            value,
            placeholder,
            cursor,
            mask,
            disabled: false,
        },
    }
}

fn model_add_provider_field(selected: usize) -> BottomFormFieldView {
    BottomFormFieldView {
        label: t!("form.model.field.provider.label").into_owned(),
        help: String::new(),
        editor: BottomFormFieldEditorView::Choice {
            options: model_add_provider_choice_labels(),
            selected: selected.min(model_add_provider_option_count().saturating_sub(1)),
        },
    }
}

fn sync_model_add_form_fields(form: &mut BottomFormView) {
    if !matches!(form.kind, BottomFormKind::ModelAdd) {
        return;
    }
    let Some(provider_idx) = model_add_provider_selected(form) else {
        return;
    };
    let Some(provider_id) = model_add_provider_id_at_choice_index(provider_idx) else {
        return;
    };
    let texts = model_add_text_values_by_label(form);
    let choices = model_add_choice_selections(form);
    let plan = ModelAddFormPlan::resolve(provider_id, &choices);
    form.fields = plan.build_fields(provider_idx, &texts);
    form.selected_field = form.selected_field.min(form.fields.len().saturating_sub(1));
    ensure_selectable_field(form);
}

pub(crate) fn new_model_add_form() -> BottomFormView {
    let mut form = BottomFormView {
        kind: BottomFormKind::ModelAdd,
        title: t!("form.model.title").into_owned(),
        fields: vec![model_add_provider_field(0)],
        selected_field: MODEL_ADD_FIELD_PROVIDER,
        scroll_offset: 0,
        footer_hint: t!("form.model.footer_hint").into_owned(),
    };
    sync_model_add_form_fields(&mut form);
    form
}

/// How the bulk import lists models for a parsed connection.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ModelAddListing {
    /// `GET {api_base}/models` with the transport's listing shape.
    Http {
        api_base: String,
        transport_kind: ModelTransportKind,
    },
    /// Vertex publisher listing via host-internal (service account project/location).
    VertexServiceAccount,
}

/// Parses the "connect provider" bottom form; semantics are aligned with the Desktop settings page (single / bulk).
/// Sites, billing plans, and `{placeholder}` template values are materialized into `api_base`
/// here; only values that land in config.json (`options`) or the internal keyring are carried
/// on the result.
#[derive(Debug, Clone)]
pub(crate) struct ParsedModelAddForm {
    /// Preset id from the presets manifest, or `custom`.
    pub provider_id: String,
    pub transport_kind: ModelTransportKind,
    /// Selected preset site; per-site templates resolve against it.
    pub site_id: Option<String>,
    pub bulk: bool,
    pub model_name: Option<String>,
    pub api_base: String,
    pub api_key: String,
    pub context_length: Option<u64>,
    /// Materializes into the literal `cf-aig-gateway-id` header.
    pub cloudflare_gateway_id: Option<String>,
    /// Transport `options` declarations materialized from template values (bedrock
    /// `awsRegion`, vertex `project` / `location`).
    pub options: BTreeMap<String, String>,
    /// Non-apiKey credential slots to store in the internal keyring
    /// (`provider::{id}::{slot}`).
    pub credential_slots: Vec<(String, String)>,
    /// The bulk listing endpoint; `None` for manual single-model entry.
    pub listing: Option<ModelAddListing>,
}

pub(crate) fn parse_model_add_connection(
    form: &BottomFormView,
) -> std::result::Result<ParsedModelAddForm, String> {
    if !matches!(form.kind, BottomFormKind::ModelAdd) {
        return Err(t!("form.model.validation.invalid_form_kind").into_owned());
    }

    let Some(provider_idx) = model_add_provider_selected(form) else {
        return Err(t!("form.model.validation.provider_invalid").into_owned());
    };
    let Some(provider_id) = model_add_provider_id_at_choice_index(provider_idx) else {
        return Err(t!("form.model.validation.provider_invalid").into_owned());
    };
    let plan = ModelAddFormPlan::resolve(provider_id, &model_add_choice_selections(form));
    let texts = model_add_text_values_by_label(form);

    // `{placeholder}` template values with per-placeholder validation.
    let mut template_values = BTreeMap::new();
    for key in &plan.template_keys {
        let (label, _, _) = model_add_template_field_copy(key);
        let value = model_add_saved_text(&texts, &[label]).trim().to_string();
        validate_template_value(key, &value)?;
        template_values.insert(key.clone(), value);
    }

    let cloudflare_gateway_id = if plan.collect_gateway_id {
        let value = model_add_saved_text(
            &texts,
            &[t!("form.model.field.cloudflare_gateway_id.label").into_owned()],
        )
        .trim()
        .to_string();
        if value.is_empty() {
            return Err(t!("form.model.validation.cloudflare_gateway_id_empty").into_owned());
        }
        if !is_valid_cloudflare_gateway_id(&value) {
            return Err(t!("form.model.validation.cloudflare_gateway_id_invalid").into_owned());
        }
        Some(value)
    } else {
        None
    };

    let model_name = if plan.manual_single {
        let name = model_add_saved_text(&texts, &model_add_model_name_field_labels())
            .trim()
            .to_string();
        if name.is_empty() {
            return Err(t!("form.model.validation.name_empty").into_owned());
        }
        if name.chars().any(char::is_whitespace) {
            return Err(t!("form.model.validation.name_whitespace").into_owned());
        }
        Some(name)
    } else {
        None
    };

    let api_base = if plan.has_api_base_field {
        let value = model_add_saved_text(
            &texts,
            &[t!("form.model.field.api_base.label").into_owned()],
        )
        .trim()
        .to_string();
        if value.is_empty() {
            return Err(t!("form.model.validation.api_base_empty").into_owned());
        }
        value
    } else {
        preset_connect_api_base(
            &plan.provider_id,
            &PresetConnectSelections {
                transport_kind: Some(plan.transport_kind),
                site_id: plan.site_id.as_deref(),
                billing_plan_id: plan.billing_plan_id.as_deref(),
                template_values: template_values.clone(),
                credential_kind: Some(plan.credential_form.kind_str()),
            },
        )
        .ok_or_else(|| t!("form.model.validation.site_invalid").into_owned())?
    };

    let context_length = if plan.manual_single {
        let raw = model_add_saved_text(
            &texts,
            &[t!("form.model.field.context_length.label").into_owned()],
        );
        parse_model_context_length_field(&raw)?
    } else {
        None
    };

    let api_key = match plan.credential_form {
        CredentialForm::ApiKey => {
            let key = model_add_saved_text(&texts, &model_add_api_key_field_labels())
                .trim()
                .to_string();
            if key.is_empty() && plan.provider_id != CUSTOM_PROVIDER_PRESET_ID {
                return Err(t!("form.model.validation.api_key_empty").into_owned());
            }
            key
        }
        CredentialForm::BedrockIam | CredentialForm::VertexServiceAccount => String::new(),
    };

    let mut credential_slots: Vec<(String, String)> = Vec::new();
    match plan.credential_form {
        CredentialForm::BedrockIam => {
            let access_key_id = model_add_saved_text(
                &texts,
                &[t!("form.model.field.bedrock_access_key_id.label").into_owned()],
            )
            .trim()
            .to_string();
            let secret_access_key = model_add_saved_text(
                &texts,
                &[t!("form.model.field.bedrock_secret_access_key.label").into_owned()],
            )
            .trim()
            .to_string();
            if access_key_id.is_empty() || secret_access_key.is_empty() {
                return Err(t!("form.model.validation.bedrock_credentials_incomplete").into_owned());
            }
            credential_slots.push(("accessKeyId".to_string(), access_key_id));
            credential_slots.push(("secretAccessKey".to_string(), secret_access_key));
        }
        CredentialForm::VertexServiceAccount => {
            let client_email = model_add_saved_text(
                &texts,
                &[t!("form.model.field.vertex_client_email.label").into_owned()],
            )
            .trim()
            .to_string();
            let private_key = model_add_saved_text(
                &texts,
                &[t!("form.model.field.vertex_private_key.label").into_owned()],
            )
            .trim()
            .to_string();
            if client_email.is_empty() != private_key.is_empty() {
                return Err(
                    t!("form.model.validation.vertex_service_account_incomplete").into_owned(),
                );
            }
            if !client_email.is_empty() {
                credential_slots.push(("clientEmail".to_string(), client_email));
                credential_slots.push(("privateKey".to_string(), private_key));
            }
        }
        CredentialForm::ApiKey => {}
    }

    // Transport options materialized from template values (bedrock `awsRegion`, vertex
    // `project` / `location`); express connects write none.
    let options: BTreeMap<String, String> = template_values
        .iter()
        .filter(|(key, _)| matches!(key.as_str(), "awsRegion" | "project" | "location"))
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect();

    let listing = if !plan.bulk {
        None
    } else if plan.provider_id == CUSTOM_PROVIDER_PRESET_ID {
        Some(ModelAddListing::Http {
            api_base: api_base.clone(),
            transport_kind: plan.transport_kind,
        })
    } else {
        match preset_entry(&plan.provider_id)
            .and_then(|entry| entry.catalog())
            .map(|catalog| catalog.parser.as_str())
        {
            Some("google-vertex-models") => Some(ModelAddListing::VertexServiceAccount),
            // The minimax catalog parser lists via the openai-compatible endpoint on the
            // same site, not the anthropic connect base.
            Some("minimax-models") if plan.transport_kind == ModelTransportKind::Anthropic => {
                let listing_base = preset_connect_api_base(
                    &plan.provider_id,
                    &PresetConnectSelections {
                        transport_kind: Some(ModelTransportKind::OpenAiCompatible),
                        site_id: plan.site_id.as_deref(),
                        billing_plan_id: plan.billing_plan_id.as_deref(),
                        template_values: template_values.clone(),
                        credential_kind: Some(plan.credential_form.kind_str()),
                    },
                )
                .ok_or_else(|| t!("form.model.validation.site_invalid").into_owned())?;
                Some(ModelAddListing::Http {
                    api_base: listing_base,
                    transport_kind: ModelTransportKind::OpenAiCompatible,
                })
            }
            _ => Some(ModelAddListing::Http {
                api_base: api_base.clone(),
                transport_kind: plan.transport_kind,
            }),
        }
    };

    Ok(ParsedModelAddForm {
        provider_id: plan.provider_id,
        transport_kind: plan.transport_kind,
        site_id: plan.site_id.clone(),
        bulk: plan.bulk,
        model_name,
        api_base,
        api_key,
        context_length,
        cloudflare_gateway_id,
        options,
        credential_slots,
        listing,
    })
}

pub(crate) fn new_rules_form(entries: &[RuleEntry]) -> BottomFormView {
    let mut fields = Vec::new();
    push_rules_section(
        &mut fields,
        t!("form.rules.section.workspace").as_ref(),
        RuleScope::Workspace,
        entries,
    );
    push_rules_section(
        &mut fields,
        t!("form.rules.section.user").as_ref(),
        RuleScope::User,
        entries,
    );

    let mut form = BottomFormView {
        kind: BottomFormKind::Rules,
        title: t!("form.rules.title").into_owned(),
        fields,
        selected_field: 0,
        scroll_offset: 0,
        footer_hint: t!("form.rules.footer_hint").into_owned(),
    };
    ensure_selectable_field(&mut form);
    form
}

pub(crate) fn new_skills_form(entries: &[SkillEntry]) -> BottomFormView {
    let mut fields = Vec::new();
    push_skills_section(
        &mut fields,
        t!("form.skills.section.workspace").as_ref(),
        SkillScope::Workspace,
        entries,
    );
    push_skills_section(
        &mut fields,
        t!("form.skills.section.user").as_ref(),
        SkillScope::User,
        entries,
    );

    let mut form = BottomFormView {
        kind: BottomFormKind::Skills,
        title: t!("form.skills.title").into_owned(),
        fields,
        selected_field: 0,
        scroll_offset: 0,
        footer_hint: t!("form.skills.footer_hint").into_owned(),
    };
    ensure_selectable_field(&mut form);
    form
}

pub(crate) fn new_extensions_form(entries: &[CliExtensionEntry]) -> BottomFormView {
    let mut fields = Vec::new();
    push_extensions_section(
        &mut fields,
        t!("form.extensions.section.installed").as_ref(),
        entries,
    );

    let mut form = BottomFormView {
        kind: BottomFormKind::Extensions,
        title: t!("form.extensions.title").into_owned(),
        fields,
        selected_field: 0,
        scroll_offset: 0,
        footer_hint: t!("form.extensions.footer_hint").into_owned(),
    };
    ensure_selectable_field(&mut form);
    form
}

pub(crate) fn new_mcp_prompt_form(
    server: &str,
    prompt: &McpDiscoveredPrompt,
    initial_user_message: Option<&str>,
) -> BottomFormView {
    let arguments = prompt
        .arguments
        .iter()
        .map(|argument| McpPromptArgumentBinding {
            name: argument.name.clone(),
            required: argument.required,
        })
        .collect::<Vec<_>>();
    let mut fields = prompt
        .arguments
        .iter()
        .map(|argument| {
            let label_suffix = if argument.required {
                t!("form.prompt.field.required_suffix").into_owned()
            } else {
                t!("form.prompt.field.optional_suffix").into_owned()
            };
            let mut help_lines = Vec::new();
            if let Some(title) = argument
                .title
                .as_ref()
                .filter(|title| *title != &argument.name)
            {
                help_lines.push(title.clone());
            }
            if let Some(description) = argument
                .description
                .as_ref()
                .filter(|value| !value.is_empty())
            {
                help_lines.push(description.clone());
            }

            BottomFormFieldView {
                label: format!("{}{}", argument.name, label_suffix),
                help: help_lines.join("\n"),
                editor: BottomFormFieldEditorView::Text {
                    value: String::new(),
                    placeholder: if argument.required {
                        t!("form.prompt.field.required.placeholder").into_owned()
                    } else {
                        t!("form.prompt.field.optional.placeholder").into_owned()
                    },
                    cursor: 0,
                    mask: false,
                    disabled: false,
                },
            }
        })
        .collect::<Vec<_>>();

    fields.push(BottomFormFieldView {
        label: t!("form.prompt.field.user_message.label").into_owned(),
        help: t!("form.prompt.field.user_message.help").into_owned(),
        editor: BottomFormFieldEditorView::Text {
            value: initial_user_message.unwrap_or_default().to_string(),
            placeholder: t!("form.prompt.field.user_message.placeholder").into_owned(),
            cursor: initial_user_message.unwrap_or_default().chars().count(),
            mask: false,
            disabled: false,
        },
    });

    let mut form = BottomFormView {
        kind: BottomFormKind::McpPrompt {
            server: server.to_string(),
            prompt: prompt.name.clone(),
            arguments,
        },
        title: format!("{} · {} / {}", t!("form.prompt.title"), server, prompt.name),
        fields,
        selected_field: 0,
        scroll_offset: 0,
        footer_hint: t!("form.prompt.footer_hint").into_owned(),
    };
    ensure_selectable_field(&mut form);
    form
}

pub(crate) fn select_next_field(form: &mut BottomFormView) {
    if form.fields.is_empty() || !has_selectable_field(form) {
        return;
    }
    let start = form.selected_field.min(form.fields.len().saturating_sub(1));
    let mut next = start;
    loop {
        next = (next + 1) % form.fields.len();
        if is_field_selectable(&form.fields[next]) {
            form.selected_field = next;
            return;
        }
        if next == start {
            return;
        }
    }
}

pub(crate) fn select_prev_field(form: &mut BottomFormView) {
    if form.fields.is_empty() || !has_selectable_field(form) {
        return;
    }
    let start = form.selected_field.min(form.fields.len().saturating_sub(1));
    let mut next = start;
    loop {
        next = if next == 0 {
            form.fields.len() - 1
        } else {
            next - 1
        };
        if is_field_selectable(&form.fields[next]) {
            form.selected_field = next;
            return;
        }
        if next == start {
            return;
        }
    }
}

pub(crate) fn move_left(form: &mut BottomFormView) {
    let selected = form.selected_field.min(form.fields.len().saturating_sub(1));
    let Some(field) = form.fields.get_mut(selected) else {
        return;
    };

    match &mut field.editor {
        BottomFormFieldEditorView::Section { .. } => {}
        BottomFormFieldEditorView::Text {
            value,
            cursor,
            disabled,
            ..
        } => {
            if *disabled {
                return;
            }
            *cursor = (*cursor).min(value.chars().count());
            if *cursor > 0 {
                *cursor -= 1;
            }
        }
        BottomFormFieldEditorView::Choice { options, selected } => {
            if options.is_empty() {
                return;
            }
            if *selected == 0 {
                *selected = options.len() - 1;
            } else {
                *selected -= 1;
            }
            sync_mcp_add_form_fields(form);
            sync_model_add_form_fields(form);
        }
        BottomFormFieldEditorView::Checkbox {
            checked, disabled, ..
        } => {
            if !*disabled && matches!(form.kind, BottomFormKind::HookAdd) {
                *checked = !*checked;
            }
        }
        BottomFormFieldEditorView::AskQuestion { .. } => {}
    }
}

pub(crate) fn move_right(form: &mut BottomFormView) {
    let selected = form.selected_field.min(form.fields.len().saturating_sub(1));
    let Some(field) = form.fields.get_mut(selected) else {
        return;
    };

    match &mut field.editor {
        BottomFormFieldEditorView::Section { .. } => {}
        BottomFormFieldEditorView::Text {
            value,
            cursor,
            disabled,
            ..
        } => {
            if *disabled {
                return;
            }
            *cursor = (*cursor + 1).min(value.chars().count());
        }
        BottomFormFieldEditorView::Choice { options, selected } => {
            if options.is_empty() {
                return;
            }
            *selected = (*selected + 1) % options.len();
            sync_mcp_add_form_fields(form);
            sync_model_add_form_fields(form);
        }
        BottomFormFieldEditorView::Checkbox {
            checked, disabled, ..
        } => {
            if !*disabled && matches!(form.kind, BottomFormKind::HookAdd) {
                *checked = !*checked;
            }
        }
        BottomFormFieldEditorView::AskQuestion { .. } => {}
    }
}

pub(crate) fn activate(form: &mut BottomFormView) {
    let selected = form.selected_field.min(form.fields.len().saturating_sub(1));
    let Some(field) = form.fields.get_mut(selected) else {
        return;
    };

    if let BottomFormFieldEditorView::Checkbox {
        checked, disabled, ..
    } = &mut field.editor
        && !*disabled
    {
        *checked = !*checked;
    }
}

pub(crate) fn hook_add_form_enter_toggles_checkbox(form: &BottomFormView) -> bool {
    if !matches!(form.kind, BottomFormKind::HookAdd) {
        return false;
    }

    let selected = form.selected_field.min(form.fields.len().saturating_sub(1));
    matches!(
        form.fields.get(selected).map(|field| &field.editor),
        Some(BottomFormFieldEditorView::Checkbox { disabled, .. }) if !*disabled
    )
}

pub(crate) fn move_home(form: &mut BottomFormView) {
    let Some(BottomFormFieldEditorView::Text {
        cursor, disabled, ..
    }) = selected_editor_mut(form)
    else {
        return;
    };
    if *disabled {
        return;
    }
    *cursor = 0;
}

pub(crate) fn move_end(form: &mut BottomFormView) {
    let Some(BottomFormFieldEditorView::Text {
        value,
        cursor,
        disabled,
        ..
    }) = selected_editor_mut(form)
    else {
        return;
    };
    if *disabled {
        return;
    }
    *cursor = value.chars().count();
}

pub(crate) fn insert_char(form: &mut BottomFormView, ch: char) {
    let Some(BottomFormFieldEditorView::Text {
        value,
        cursor,
        disabled,
        ..
    }) = selected_editor_mut(form)
    else {
        return;
    };
    if *disabled {
        return;
    }
    let idx = char_cursor_to_byte_index(value, *cursor);
    value.insert(idx, ch);
    *cursor += 1;
}

pub(crate) fn insert_text(form: &mut BottomFormView, text: &str) {
    let normalized = normalize_inserted_text(form, text);
    if normalized.is_empty() {
        return;
    }

    let Some(BottomFormFieldEditorView::Text {
        value,
        cursor,
        disabled,
        ..
    }) = selected_editor_mut(form)
    else {
        return;
    };
    if *disabled {
        return;
    }
    let idx = char_cursor_to_byte_index(value, *cursor);
    value.insert_str(idx, normalized.as_str());
    *cursor += normalized.chars().count();
}

pub(crate) fn backspace(form: &mut BottomFormView) {
    let Some(BottomFormFieldEditorView::Text {
        value,
        cursor,
        disabled,
        ..
    }) = selected_editor_mut(form)
    else {
        return;
    };
    if *disabled {
        return;
    }
    if *cursor == 0 {
        return;
    }
    let end = char_cursor_to_byte_index(value, *cursor);
    let start = char_cursor_to_byte_index(value, cursor.saturating_sub(1));
    value.replace_range(start..end, "");
    *cursor -= 1;
}

pub(crate) fn delete(form: &mut BottomFormView) {
    let Some(BottomFormFieldEditorView::Text {
        value,
        cursor,
        disabled,
        ..
    }) = selected_editor_mut(form)
    else {
        return;
    };
    if *disabled {
        return;
    }
    if *cursor >= value.chars().count() {
        return;
    }
    let start = char_cursor_to_byte_index(value, *cursor);
    let end = char_cursor_to_byte_index(value, cursor.saturating_add(1));
    value.replace_range(start..end, "");
}

pub(crate) fn to_config(
    form: &BottomFormView,
) -> std::result::Result<(String, McpScope, McpServerConfig), String> {
    let server_name = bottom_form_text_value(form, MCP_ADD_FIELD_NAME)
        .trim()
        .to_string();
    if server_name.is_empty() {
        return Err(t!("form.mcp.validation.server_name_empty").into_owned());
    }
    if server_name.chars().any(char::is_whitespace) {
        return Err(t!("form.mcp.validation.server_name_whitespace").into_owned());
    }

    let scope = selected_mcp_scope(form).unwrap_or(McpScope::Workspace);

    let endpoint = bottom_form_text_value(form, MCP_ADD_FIELD_ENDPOINT)
        .trim()
        .to_string();
    if endpoint.is_empty() {
        let label = form
            .fields
            .get(MCP_ADD_FIELD_ENDPOINT)
            .map(|field| field.label.clone())
            .unwrap_or_else(|| t!("form.mcp.field.endpoint.fallback_label").into_owned());
        return Err(t!("form.mcp.validation.field_required", label = label).into_owned());
    }

    let metadata_text = bottom_form_text_value(form, MCP_ADD_FIELD_METADATA);
    let transport = match selected_transport_kind(form).unwrap_or(McpAddTransportKind::Stdio) {
        McpAddTransportKind::Stdio => {
            let tokens = split_command_line(&endpoint)?;
            let Some((command, args)) = tokens.split_first() else {
                return Err(t!("form.mcp.validation.command_empty").into_owned());
            };
            McpTransportConfig::Stdio {
                command: command.clone(),
                args: args.to_vec(),
                env: parse_metadata_map(metadata_text, MetadataFieldKind::Env)?,
                cwd: None,
                timeout_ms: Some(MCP_DEFAULT_TIMEOUT_MS),
            }
        }
        McpAddTransportKind::Http => McpTransportConfig::Http {
            url: endpoint,
            headers: parse_metadata_map(metadata_text, MetadataFieldKind::Header)?,
            timeout_ms: Some(MCP_DEFAULT_TIMEOUT_MS),
        },
    };

    Ok((
        server_name.clone(),
        scope,
        McpServerConfig {
            display_name: Some(server_name),
            enabled: true,
            capabilities: McpCapabilityToggles::default(),
            transport,
        },
    ))
}

fn selected_hook_scope(form: &BottomFormView) -> Option<&'static str> {
    match form
        .fields
        .get(HOOK_ADD_FIELD_SCOPE)
        .map(|field| &field.editor)
    {
        Some(BottomFormFieldEditorView::Choice { options, selected }) => {
            let option = options.get((*selected).min(options.len().saturating_sub(1)))?;
            // Options are built from the localized scope labels, so compare against the
            // current locale's "user" label instead of hardcoding any single language.
            if option.as_str() == t!("form.hooks.field.scope.user").as_ref() {
                Some("user")
            } else {
                Some("workspace")
            }
        }
        _ => None,
    }
}

fn selected_hook_event(form: &BottomFormView) -> Option<String> {
    match form
        .fields
        .get(HOOK_ADD_FIELD_EVENT)
        .map(|field| &field.editor)
    {
        Some(BottomFormFieldEditorView::Choice { options, selected }) => options
            .get((*selected).min(options.len().saturating_sub(1)))
            .cloned(),
        _ => None,
    }
}

fn hook_fail_closed_checked(form: &BottomFormView) -> bool {
    match form
        .fields
        .get(HOOK_ADD_FIELD_FAIL_CLOSED)
        .map(|field| &field.editor)
    {
        Some(BottomFormFieldEditorView::Checkbox { checked, .. }) => *checked,
        _ => false,
    }
}

fn parse_hook_timeout_field(raw: &str) -> std::result::Result<Option<u64>, String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return Ok(None);
    }
    let parsed = raw
        .parse::<u64>()
        .map_err(|_| t!("form.hooks.validation.timeout_invalid").into_owned())?;
    if parsed == 0 {
        return Err(t!("form.hooks.validation.timeout_invalid").into_owned());
    }
    Ok(Some(parsed))
}

pub(crate) fn to_hook_save_request(
    form: &BottomFormView,
) -> std::result::Result<crate::hooks_types::SaveHookEntryRequest, String> {
    if !matches!(form.kind, BottomFormKind::HookAdd) {
        return Err(t!("form.hooks.validation.invalid_form_kind").into_owned());
    }

    let scope = selected_hook_scope(form)
        .ok_or_else(|| t!("form.hooks.validation.scope_required").into_owned())?
        .to_string();
    let event = selected_hook_event(form)
        .ok_or_else(|| t!("form.hooks.validation.event_required").into_owned())?;

    let command = bottom_form_text_value(form, HOOK_ADD_FIELD_COMMAND)
        .trim()
        .to_string();
    if command.is_empty() {
        return Err(t!("form.hooks.validation.command_required").into_owned());
    }

    let timeout = parse_hook_timeout_field(bottom_form_text_value(form, HOOK_ADD_FIELD_TIMEOUT))?;
    let matcher_raw = bottom_form_text_value(form, HOOK_ADD_FIELD_MATCHER).trim();
    let matcher = if matcher_raw.is_empty() {
        None
    } else {
        Some(matcher_raw.to_string())
    };
    let fail_closed = hook_fail_closed_checked(form);

    Ok(crate::hooks_types::SaveHookEntryRequest {
        scope,
        event,
        command,
        timeout,
        fail_closed: if fail_closed { Some(true) } else { None },
        matcher,
    })
}

fn parse_model_context_length_field(raw: &str) -> std::result::Result<Option<u64>, String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return Ok(None);
    }
    let parsed = raw
        .parse::<u64>()
        .map_err(|_| t!("form.model.validation.context_length_invalid").into_owned())?;
    if parsed == 0 {
        return Err(t!("form.model.validation.context_length_invalid").into_owned());
    }
    Ok(Some(parsed))
}

pub(crate) fn to_prompt_args_json(
    form: &BottomFormView,
) -> std::result::Result<Option<String>, String> {
    let BottomFormKind::McpPrompt { arguments, .. } = &form.kind else {
        return Err(t!("form.prompt.validation.invalid_form_kind").into_owned());
    };

    let mut args = Map::new();
    for (index, argument) in arguments.iter().enumerate() {
        let value = bottom_form_text_value(form, index);
        if value.trim().is_empty() {
            if argument.required {
                let label = form
                    .fields
                    .get(index)
                    .map(|field| field.label.clone())
                    .unwrap_or_else(|| argument.name.clone());
                return Err(t!("form.prompt.validation.required", label = label).into_owned());
            }
            continue;
        }

        args.insert(argument.name.clone(), Value::String(value.to_string()));
    }

    if args.is_empty() {
        Ok(None)
    } else {
        Ok(Some(Value::Object(args).to_string()))
    }
}

pub(crate) fn prompt_user_message(
    form: &BottomFormView,
) -> std::result::Result<Option<String>, String> {
    let BottomFormKind::McpPrompt { arguments, .. } = &form.kind else {
        return Err(t!("form.prompt.validation.invalid_form_kind").into_owned());
    };

    let value = bottom_form_text_value(form, arguments.len())
        .trim()
        .to_string();
    if value.is_empty() {
        Ok(None)
    } else {
        Ok(Some(value))
    }
}

pub(crate) fn rules_form_overrides(form: &BottomFormView) -> Vec<(String, bool)> {
    form.fields
        .iter()
        .filter_map(|field| match &field.editor {
            BottomFormFieldEditorView::Checkbox {
                id,
                checked,
                disabled,
                ..
            } if !disabled => Some((id.clone(), *checked)),
            _ => None,
        })
        .collect()
}

pub(crate) fn skills_form_overrides(form: &BottomFormView) -> Vec<(String, bool)> {
    rules_form_overrides(form)
}

pub(crate) fn extensions_form_toggles(form: &BottomFormView) -> Vec<(String, bool)> {
    rules_form_overrides(form)
}

fn sync_mcp_add_form_fields(form: &mut BottomFormView) {
    if !matches!(form.kind, BottomFormKind::McpAdd) {
        return;
    }
    let transport = selected_transport_kind(form).unwrap_or(McpAddTransportKind::Stdio);

    if let Some(field) = form.fields.get_mut(MCP_ADD_FIELD_ENDPOINT) {
        match transport {
            McpAddTransportKind::Stdio => {
                field.label = t!("form.mcp.field.endpoint.command.label").into_owned();
                field.help = String::new();
                if let BottomFormFieldEditorView::Text { placeholder, .. } = &mut field.editor {
                    *placeholder = t!("form.mcp.field.endpoint.command.placeholder").into_owned();
                }
            }
            McpAddTransportKind::Http => {
                field.label = t!("form.mcp.field.endpoint.url.label").into_owned();
                field.help = String::new();
                if let BottomFormFieldEditorView::Text { placeholder, .. } = &mut field.editor {
                    *placeholder = t!("form.mcp.field.endpoint.url.placeholder").into_owned();
                }
            }
        }
    }

    if let Some(field) = form.fields.get_mut(MCP_ADD_FIELD_METADATA) {
        match transport {
            McpAddTransportKind::Stdio => {
                field.label = t!("form.mcp.field.metadata.env.label").into_owned();
                field.help = String::new();
                if let BottomFormFieldEditorView::Text { placeholder, .. } = &mut field.editor {
                    *placeholder = t!("form.mcp.field.metadata.env.placeholder").into_owned();
                }
            }
            McpAddTransportKind::Http => {
                field.label = t!("form.mcp.field.metadata.headers.label").into_owned();
                field.help = String::new();
                if let BottomFormFieldEditorView::Text { placeholder, .. } = &mut field.editor {
                    *placeholder = t!("form.mcp.field.metadata.headers.placeholder").into_owned();
                }
            }
        }
    }

    ensure_selectable_field(form);
}

fn push_rules_section(
    fields: &mut Vec<BottomFormFieldView>,
    title: &str,
    scope: RuleScope,
    entries: &[RuleEntry],
) {
    fields.push(BottomFormFieldView {
        label: String::new(),
        help: String::new(),
        editor: BottomFormFieldEditorView::Section {
            text: title.to_string(),
        },
    });

    for entry in entries.iter().filter(|entry| entry.source.scope == scope) {
        fields.push(BottomFormFieldView {
            label: entry.source.short_label.clone(),
            help: String::new(),
            editor: BottomFormFieldEditorView::Checkbox {
                id: entry.source.id.clone(),
                checked: entry.enabled,
                disabled: !entry.exists,
                path: Some(entry.source.path.display().to_string()),
            },
        });
    }
}

fn push_skills_section(
    fields: &mut Vec<BottomFormFieldView>,
    title: &str,
    scope: SkillScope,
    entries: &[SkillEntry],
) {
    fields.push(BottomFormFieldView {
        label: String::new(),
        help: String::new(),
        editor: BottomFormFieldEditorView::Section {
            text: title.to_string(),
        },
    });

    for entry in entries.iter().filter(|entry| entry.source.scope == scope) {
        fields.push(BottomFormFieldView {
            label: entry.source.name.clone(),
            help: entry.source.description.clone(),
            editor: BottomFormFieldEditorView::Checkbox {
                id: entry.source.id.clone(),
                checked: entry.enabled,
                disabled: false,
                path: Some(entry.source.path.display().to_string()),
            },
        });
    }
}

fn push_extensions_section(
    fields: &mut Vec<BottomFormFieldView>,
    title: &str,
    entries: &[CliExtensionEntry],
) {
    fields.push(BottomFormFieldView {
        label: String::new(),
        help: String::new(),
        editor: BottomFormFieldEditorView::Section {
            text: title.to_string(),
        },
    });

    if entries.is_empty() {
        fields.push(BottomFormFieldView {
            label: t!("form.extensions.empty").into_owned(),
            help: t!("form.extensions.empty_help").into_owned(),
            editor: BottomFormFieldEditorView::Checkbox {
                id: "__empty__".to_string(),
                checked: false,
                disabled: true,
                path: None,
            },
        });
        return;
    }

    for entry in entries {
        fields.push(BottomFormFieldView {
            label: format!("{} v{}", entry.display_name, entry.version),
            help: extension_help_text(entry),
            editor: BottomFormFieldEditorView::Checkbox {
                id: entry.id.clone(),
                checked: entry.enabled,
                disabled: false,
                path: Some(entry.id.clone()),
            },
        });
    }
}

fn extension_help_text(entry: &CliExtensionEntry) -> String {
    let mut lines = Vec::new();
    if let Some(description) = entry
        .description
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        lines.push(description.clone());
    }
    if let Some(author) = entry
        .author
        .as_ref()
        .map(|value| value.name.trim())
        .filter(|value| !value.is_empty())
    {
        lines.push(format!("author: {}", author));
    }
    if let Some(main) = entry.main.as_ref().filter(|value| !value.trim().is_empty()) {
        lines.push(format!("main: {}", main));
    }
    if let Some(file_name) = entry
        .archive_file_name
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        lines.push(format!("source: {}", file_name));
    }
    if let Some(contributions) = entry.instruction_contributions.as_ref() {
        if let Some(mcp) = contributions.mcp.as_ref() {
            let summary = mcp
                .iter()
                .map(|server| format!("{} ({})", server.name, server.transport))
                .collect::<Vec<_>>()
                .join(", ");
            lines.push(format!(
                "mcp: {}",
                if summary.is_empty() { "—" } else { &summary }
            ));
        }
        if let Some(hooks) = contributions.hooks.as_ref() {
            lines.push(format!(
                "hooks: {}",
                if hooks.is_empty() {
                    "—".to_string()
                } else {
                    hooks.join(", ")
                }
            ));
        }
        if let Some(skills) = contributions.skills.as_ref() {
            lines.push(format!(
                "skills: {}",
                if skills.is_empty() {
                    "—".to_string()
                } else {
                    skills
                        .iter()
                        .map(|skill| skill.name.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                }
            ));
        }
        if contributions.rules.is_some() {
            lines.push("rules: yes".to_string());
        }
    }
    lines.join("\n")
}

fn is_field_selectable(field: &BottomFormFieldView) -> bool {
    match &field.editor {
        BottomFormFieldEditorView::Section { .. } => false,
        BottomFormFieldEditorView::Checkbox { disabled, .. } => !*disabled,
        BottomFormFieldEditorView::Text { disabled, .. } => !*disabled,
        BottomFormFieldEditorView::Choice { .. }
        | BottomFormFieldEditorView::AskQuestion { .. } => true,
    }
}

fn has_selectable_field(form: &BottomFormView) -> bool {
    form.fields.iter().any(is_field_selectable)
}

fn ensure_selectable_field(form: &mut BottomFormView) {
    if form.fields.is_empty() {
        form.selected_field = 0;
        return;
    }

    let selected = form.selected_field.min(form.fields.len().saturating_sub(1));
    if form.fields.get(selected).is_some_and(is_field_selectable) {
        form.selected_field = selected;
        return;
    }

    form.selected_field = form
        .fields
        .iter()
        .position(is_field_selectable)
        .unwrap_or(0);
}

fn selected_editor_mut(form: &mut BottomFormView) -> Option<&mut BottomFormFieldEditorView> {
    let selected = form.selected_field.min(form.fields.len().saturating_sub(1));
    form.fields.get_mut(selected).map(|field| &mut field.editor)
}

fn normalize_inserted_text(form: &BottomFormView, text: &str) -> String {
    match form.kind {
        BottomFormKind::McpPrompt { .. } => text.replace("\r\n", "\n").replace('\r', "\n"),
        BottomFormKind::McpAdd
        | BottomFormKind::HookAdd
        | BottomFormKind::AskQuestions { .. }
        | BottomFormKind::WorkspaceCapabilityTrust { .. }
        | BottomFormKind::ModelAdd
        | BottomFormKind::Rules
        | BottomFormKind::Skills
        | BottomFormKind::Extensions => text.replace("\r\n", " ").replace(['\r', '\n'], " "),
    }
}

fn bottom_form_text_value(form: &BottomFormView, index: usize) -> &str {
    match form.fields.get(index).map(|field| &field.editor) {
        Some(BottomFormFieldEditorView::Text { value, .. }) => value.as_str(),
        _ => "",
    }
}

fn selected_mcp_scope(form: &BottomFormView) -> Option<McpScope> {
    match form
        .fields
        .get(MCP_ADD_FIELD_SCOPE)
        .map(|field| &field.editor)
    {
        Some(BottomFormFieldEditorView::Choice { options, selected }) => options
            .get((*selected).min(options.len().saturating_sub(1)))
            .map(|value| {
                // Options are built from the localized scope labels, so compare against the
                // current locale's "user" label instead of hardcoding any single language.
                if value.as_str() == t!("form.mcp.field.scope.user").as_ref() {
                    McpScope::User
                } else {
                    McpScope::Workspace
                }
            }),
        _ => None,
    }
}

fn selected_transport_kind(form: &BottomFormView) -> Option<McpAddTransportKind> {
    match form
        .fields
        .get(MCP_ADD_FIELD_TRANSPORT)
        .map(|field| &field.editor)
    {
        Some(BottomFormFieldEditorView::Choice { options, selected }) => options
            .get((*selected).min(options.len().saturating_sub(1)))
            .map(|value| {
                if value.eq_ignore_ascii_case("http") {
                    McpAddTransportKind::Http
                } else {
                    McpAddTransportKind::Stdio
                }
            }),
        _ => None,
    }
}

fn parse_metadata_map(
    input: &str,
    kind: MetadataFieldKind,
) -> std::result::Result<BTreeMap<String, String>, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Ok(BTreeMap::new());
    }

    let mut result = BTreeMap::new();
    for item in trimmed.split(';') {
        let pair = item.trim();
        if pair.is_empty() {
            continue;
        }

        let parsed = match kind {
            MetadataFieldKind::Env => pair.split_once('='),
            MetadataFieldKind::Header => pair.split_once(':').or_else(|| pair.split_once('=')),
        };

        let Some((key, value)) = parsed else {
            return Err(match kind {
                MetadataFieldKind::Env => t!("form.mcp.validation.env_format").into_owned(),
                MetadataFieldKind::Header => t!("form.mcp.validation.header_format").into_owned(),
            });
        };

        let key = key.trim();
        if key.is_empty() {
            return Err(match kind {
                MetadataFieldKind::Env => t!("form.mcp.validation.env_empty_key").into_owned(),
                MetadataFieldKind::Header => {
                    t!("form.mcp.validation.header_empty_key").into_owned()
                }
            });
        }
        result.insert(key.to_string(), value.trim().to_string());
    }
    Ok(result)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum MetadataFieldKind {
    Env,
    Header,
}

fn split_command_line(input: &str) -> std::result::Result<Vec<String>, String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut chars = input.chars().peekable();
    let mut quote: Option<char> = None;

    while let Some(ch) = chars.next() {
        match quote {
            Some(active_quote) if ch == active_quote => {
                quote = None;
            }
            Some(_) => {
                current.push(ch);
            }
            None if ch == '\'' || ch == '"' => {
                quote = Some(ch);
            }
            None if ch.is_whitespace() => {
                if !current.is_empty() {
                    tokens.push(std::mem::take(&mut current));
                }
                while chars.next_if(|c| c.is_whitespace()).is_some() {}
            }
            None => {
                current.push(ch);
            }
        }
    }

    if quote.is_some() {
        return Err(t!("form.mcp.validation.command_unclosed_quote").into_owned());
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    if tokens.is_empty() {
        return Err(t!("form.mcp.validation.command_empty").into_owned());
    }
    Ok(tokens)
}

fn char_cursor_to_byte_index(value: &str, cursor: usize) -> usize {
    if cursor == 0 {
        return 0;
    }
    value
        .char_indices()
        .nth(cursor)
        .map(|(idx, _)| idx)
        .unwrap_or(value.len())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum McpAddTransportKind {
    Stdio,
    Http,
}

#[cfg(test)]
mod tests {
    use super::{
        HOOK_ADD_FIELD_COMMAND, HOOK_ADD_FIELD_FAIL_CLOSED, HOOK_ADD_FIELD_TIMEOUT,
        MetadataFieldKind, activate, hook_add_form_enter_toggles_checkbox, insert_text,
        model_add_picker_index_of, move_right, new_extensions_form, new_hook_add_form,
        new_mcp_add_form, new_mcp_prompt_form, new_model_add_form, new_rules_form, new_skills_form,
        parse_metadata_map, parse_model_add_connection, prompt_user_message, rules_form_overrides,
        select_next_field, skills_form_overrides, sync_model_add_form_fields, to_hook_save_request,
        to_prompt_args_json,
    };
    use crate::model_registry::ModelTransportKind;
    use rust_i18n::t;
    use std::path::PathBuf;

    use crate::{
        host_protocol::{
            CliExtensionEntry, CliExtensionInstructionContributions,
            CliExtensionMcpContributionSummary, CliExtensionRuleContributionSummary,
            CliExtensionSkillContributionSummary,
        },
        mcp_types::{McpDiscoveredPrompt, McpDiscoveredPromptArgument},
        rules::{RuleEntry, RulePreview, RuleScope, RuleSource},
        skills::{SkillEntry, SkillPreview, SkillRootKind, SkillScope, SkillSource},
        view::{BottomFormFieldEditorView, BottomFormView},
    };

    #[test]
    fn parse_header_metadata_supports_colon_syntax() {
        let parsed = parse_metadata_map(
            "Authorization: Bearer ${env:GITHUB_TOKEN}; X-Client: spirit",
            MetadataFieldKind::Header,
        )
        .expect("headers parse");

        assert_eq!(
            parsed.get("Authorization"),
            Some(&"Bearer ${env:GITHUB_TOKEN}".to_string())
        );
        assert_eq!(parsed.get("X-Client"), Some(&"spirit".to_string()));
    }

    #[test]
    fn parse_header_metadata_allows_empty_input() {
        let parsed = parse_metadata_map("   ", MetadataFieldKind::Header).expect("empty ok");
        assert!(parsed.is_empty());
    }

    #[test]
    fn new_form_defaults_to_stdio_command_placeholders() {
        let form = new_mcp_add_form();

        assert_eq!(
            form.fields[3].label,
            t!("form.mcp.field.endpoint.command.label")
        );
        assert_eq!(
            form.fields[4].label,
            t!("form.mcp.field.metadata.env.label")
        );
    }

    #[test]
    fn new_rules_form_selects_first_available_checkbox() {
        let form = new_rules_form(&[sample_rule_entry(RuleScope::Workspace, true, true)]);

        assert_eq!(form.selected_field, 1);
    }

    #[test]
    fn select_next_field_skips_sections_and_disabled_checkboxes() {
        let mut form = new_rules_form(&[
            sample_rule_entry(RuleScope::Workspace, true, true),
            sample_rule_entry(RuleScope::User, false, false),
        ]);

        select_next_field(&mut form);

        assert_eq!(form.selected_field, 1);
    }

    #[test]
    fn activate_toggles_selected_checkbox() {
        let mut form = new_rules_form(&[sample_rule_entry(RuleScope::Workspace, true, true)]);

        activate(&mut form);

        assert_eq!(
            rules_form_overrides(&form),
            vec![("workspace-rule".to_string(), false)]
        );
    }

    #[test]
    fn new_skills_form_selects_first_available_checkbox() {
        let form = new_skills_form(&[sample_skill_entry(SkillScope::Workspace, true)]);

        assert_eq!(form.selected_field, 1);
    }

    #[test]
    fn skills_activate_toggles_selected_checkbox() {
        let mut form = new_skills_form(&[sample_skill_entry(SkillScope::Workspace, true)]);

        activate(&mut form);

        assert_eq!(
            skills_form_overrides(&form),
            vec![("workspace-skill".to_string(), false)]
        );
    }

    #[test]
    fn new_extensions_form_selects_first_extension_checkbox() {
        let form = new_extensions_form(&[sample_extension_entry()]);

        assert_eq!(form.selected_field, 1);
    }

    #[test]
    fn extensions_activate_toggles_selected_checkbox() {
        let mut form = new_extensions_form(&[sample_extension_entry()]);

        activate(&mut form);

        match &form.fields[1].editor {
            BottomFormFieldEditorView::Checkbox { checked, .. } => assert!(!*checked),
            _ => panic!("expected checkbox"),
        }
    }

    #[test]
    fn extensions_form_checkbox_reflects_enabled_state() {
        let mut disabled_entry = sample_extension_entry();
        disabled_entry.enabled = false;
        let form = new_extensions_form(&[disabled_entry]);

        match &form.fields[1].editor {
            BottomFormFieldEditorView::Checkbox { checked, .. } => assert!(!*checked),
            _ => panic!("expected checkbox"),
        }
    }

    #[test]
    fn extensions_form_help_lists_instruction_contributions() {
        let mut entry = sample_extension_entry();
        entry.instruction_contributions = Some(CliExtensionInstructionContributions {
            mcp: Some(vec![CliExtensionMcpContributionSummary {
                name: "bundled".to_string(),
                display_name: None,
                transport: "stdio".to_string(),
            }]),
            hooks: Some(vec!["sessionStart".to_string()]),
            skills: Some(vec![CliExtensionSkillContributionSummary {
                name: "demo-skill".to_string(),
                description: "A bundled demo skill.".to_string(),
            }]),
            rules: Some(CliExtensionRuleContributionSummary {
                content: "# Rules".to_string(),
            }),
        });
        let form = new_extensions_form(&[entry]);
        assert!(form.fields[1].help.contains("mcp: bundled (stdio)"));
        assert!(form.fields[1].help.contains("hooks: sessionStart"));
        assert!(form.fields[1].help.contains("skills: demo-skill"));
        assert!(form.fields[1].help.contains("rules: yes"));
    }

    #[test]
    fn existing_rule_does_not_render_preview_help() {
        let mut entry = sample_rule_entry(RuleScope::Workspace, true, true);
        entry.preview = Some(RulePreview {
            excerpt: "line1\nline2".to_string(),
            truncated: true,
        });

        let form = new_rules_form(&[entry]);
        let help = &form.fields[1].help;
        let path = match &form.fields[1].editor {
            crate::view::BottomFormFieldEditorView::Checkbox { path, .. } => {
                path.as_deref().unwrap_or("")
            }
            _ => "",
        };

        assert!(help.is_empty());
        assert!(path.contains(".spirit") && path.ends_with("rule.md"));
    }

    #[test]
    fn missing_rule_keeps_disabled_row_without_extra_hint() {
        let form = new_rules_form(&[sample_rule_entry(RuleScope::User, false, false)]);
        let help = &form.fields[2].help;
        let disabled = match &form.fields[2].editor {
            crate::view::BottomFormFieldEditorView::Checkbox { disabled, .. } => *disabled,
            _ => false,
        };

        assert!(disabled);
        assert!(help.is_empty());
    }

    #[test]
    fn prompt_form_marks_required_arguments() {
        let form = new_mcp_prompt_form("github", &sample_prompt(true), None);

        assert_eq!(
            form.fields[0].label,
            format!("issue{}", t!("form.prompt.field.required_suffix"))
        );
        assert_eq!(
            form.fields[1].label,
            format!("style{}", t!("form.prompt.field.optional_suffix"))
        );
    }

    #[test]
    fn prompt_form_args_json_requires_required_fields() {
        let form = new_mcp_prompt_form("github", &sample_prompt(true), None);

        let err = to_prompt_args_json(&form).expect_err("missing required field should fail");
        assert!(err.contains("issue"));
    }

    #[test]
    fn prompt_form_args_json_omits_empty_optional_fields() {
        let mut form = new_mcp_prompt_form("github", &sample_prompt(true), None);
        insert_text(&mut form, "123");

        let json = to_prompt_args_json(&form)
            .expect("args json")
            .expect("non-empty args json");

        assert_eq!(json, r#"{"issue":"123"}"#);
    }

    #[test]
    fn prompt_form_preserves_multiline_paste() {
        let mut form = new_mcp_prompt_form("github", &sample_prompt(false), None);

        insert_text(&mut form, "line1\r\nline2");

        let json = to_prompt_args_json(&form)
            .expect("args json")
            .expect("non-empty args json");
        assert_eq!(json, r#"{"issue":"line1\nline2"}"#);
    }

    #[test]
    fn prompt_form_user_message_round_trips() {
        let mut form =
            new_mcp_prompt_form("github", &sample_prompt(true), Some("check what this does"));

        form.selected_field = 2;
        insert_text(&mut form, "\nand give examples");

        let user_message = prompt_user_message(&form)
            .expect("user message")
            .expect("non-empty user message");

        assert_eq!(user_message, "check what this does\nand give examples");
    }

    #[test]
    fn mcp_add_form_normalizes_multiline_paste_to_spaces() {
        let mut form = new_mcp_add_form();

        insert_text(&mut form, "line1\r\nline2");

        let value = match &form.fields[0].editor {
            crate::view::BottomFormFieldEditorView::Text { value, .. } => value,
            _ => panic!("expected text field"),
        };
        assert_eq!(value, "line1 line2");
    }

    fn model_add_pick_provider(form: &mut BottomFormView, preset_id: &str) {
        let idx = form
            .fields
            .iter()
            .position(|field| field.label == t!("form.model.field.provider.label"))
            .expect("provider field");
        if let BottomFormFieldEditorView::Choice { selected, .. } = &mut form.fields[idx].editor {
            *selected = model_add_picker_index_of(preset_id);
        }
        sync_model_add_form_fields(form);
    }

    fn model_add_set_choice(form: &mut BottomFormView, label: &str, selected: usize) {
        let idx = form
            .fields
            .iter()
            .position(|field| field.label == label)
            .unwrap_or_else(|| panic!("choice field: {label}"));
        if let BottomFormFieldEditorView::Choice {
            selected: current, ..
        } = &mut form.fields[idx].editor
        {
            *current = selected;
        }
        sync_model_add_form_fields(form);
    }

    fn model_add_set_text(form: &mut BottomFormView, label: &str, text: &str) {
        let idx = form
            .fields
            .iter()
            .position(|field| field.label == label)
            .unwrap_or_else(|| panic!("text field: {label}"));
        form.selected_field = idx;
        insert_text(form, text);
    }

    fn model_add_field_labels(form: &BottomFormView) -> Vec<String> {
        form.fields
            .iter()
            .map(|field| field.label.clone())
            .collect()
    }

    #[test]
    fn model_add_form_parses_preset_connection() {
        let mut form = new_model_add_form();
        assert!(matches!(form.kind, crate::view::BottomFormKind::ModelAdd));
        model_add_pick_provider(&mut form, "deepseek");
        model_add_set_text(
            &mut form,
            &t!("form.model.field.api_key.label"),
            "sk-secret",
        );
        let parsed = parse_model_add_connection(&form).expect("parse");
        assert_eq!(parsed.provider_id, "deepseek");
        assert!(parsed.bulk);
        // DeepSeek's preset default transport is openai-compatible; the form materializes its base.
        assert_eq!(parsed.transport_kind, ModelTransportKind::OpenAiCompatible);
        assert_eq!(parsed.api_base, "https://api.deepseek.com/v1");
        assert_eq!(parsed.api_key, "sk-secret");
        assert!(parsed.model_name.is_none());
        assert_eq!(
            parsed.listing,
            Some(super::ModelAddListing::Http {
                api_base: "https://api.deepseek.com/v1".to_string(),
                transport_kind: ModelTransportKind::OpenAiCompatible,
            })
        );
    }

    #[test]
    fn model_add_provider_choice_does_not_overwrite_api_key_with_mcp_command_label() {
        let mut form = new_model_add_form();
        let expected_key_label = t!("form.model.field.api_key.label").into_owned();
        move_right(&mut form);
        assert_eq!(form.fields[2].label, expected_key_label);
    }

    #[test]
    fn model_add_form_shows_transport_choices_from_the_manifest() {
        // kimi-code declares two transports: the wizard offers the choice with the preset's
        // defaultTransport selected first.
        let mut form = new_model_add_form();
        model_add_pick_provider(&mut form, "kimi-code");
        let transport_idx = form
            .fields
            .iter()
            .position(|field| field.label == t!("form.model.field.api_kind.label"))
            .expect("transport field");
        match &form.fields[transport_idx].editor {
            BottomFormFieldEditorView::Choice { options, selected } => {
                assert_eq!(options.len(), 2);
                assert_eq!(*selected, 0);
            }
            _ => panic!("expected transport choice"),
        }
        // Single-transport presets (moonshot-ai) pin the transport: no choice field.
        let mut form = new_model_add_form();
        model_add_pick_provider(&mut form, "moonshot-ai");
        assert!(
            !form
                .fields
                .iter()
                .any(|field| field.label == t!("form.model.field.api_kind.label"))
        );
    }

    #[test]
    fn model_add_form_parses_custom_connection() {
        let mut form = new_model_add_form();
        model_add_pick_provider(&mut form, "custom");
        model_add_set_text(
            &mut form,
            &t!("form.model.field.model_name.label"),
            "my-model",
        );
        model_add_set_text(
            &mut form,
            &t!("form.model.field.api_base.label"),
            "https://custom.example/v1",
        );
        model_add_set_text(&mut form, &t!("form.model.field.api_key.label"), "sk-c");
        let parsed = parse_model_add_connection(&form).expect("parse");
        assert_eq!(parsed.provider_id, "custom");
        assert_eq!(parsed.transport_kind, ModelTransportKind::OpenAiCompatible);
        assert!(!parsed.bulk);
        assert_eq!(parsed.model_name.as_deref(), Some("my-model"));
        assert_eq!(parsed.api_base, "https://custom.example/v1");
        assert_eq!(parsed.api_key, "sk-c");
        assert_eq!(parsed.context_length, None);
        assert!(parsed.listing.is_none());
    }

    #[test]
    fn model_add_form_parses_custom_connection_context_length() {
        let mut form = new_model_add_form();
        model_add_pick_provider(&mut form, "custom");
        model_add_set_text(
            &mut form,
            &t!("form.model.field.model_name.label"),
            "my-model",
        );
        model_add_set_text(
            &mut form,
            &t!("form.model.field.api_base.label"),
            "https://custom.example/v1",
        );
        model_add_set_text(
            &mut form,
            &t!("form.model.field.context_length.label"),
            "128000",
        );
        model_add_set_text(&mut form, &t!("form.model.field.api_key.label"), "sk-c");
        let parsed = parse_model_add_connection(&form).expect("parse");
        assert_eq!(parsed.context_length, Some(128_000));
    }

    #[test]
    fn model_add_custom_bulk_hides_model_name_field() {
        let mut form = new_model_add_form();
        model_add_pick_provider(&mut form, "custom");
        assert_eq!(form.fields.len(), 7);
        model_add_set_choice(&mut form, &t!("form.model.field.mode.label"), 1);
        assert_eq!(form.fields.len(), 5);
        assert!(
            !form
                .fields
                .iter()
                .any(|f| f.label == t!("form.model.field.model_name.label").into_owned())
        );
        model_add_set_text(
            &mut form,
            &t!("form.model.field.api_base.label"),
            "https://bulk.example/v1",
        );
        model_add_set_text(&mut form, &t!("form.model.field.api_key.label"), "sk-bulk");
        let parsed = parse_model_add_connection(&form).expect("parse");
        assert_eq!(parsed.provider_id, "custom");
        assert_eq!(parsed.transport_kind, ModelTransportKind::OpenAiCompatible);
        assert!(parsed.bulk);
        assert!(parsed.model_name.is_none());
        assert_eq!(parsed.api_base, "https://bulk.example/v1");
        assert_eq!(parsed.api_key, "sk-bulk");
        assert_eq!(
            parsed.listing,
            Some(super::ModelAddListing::Http {
                api_base: "https://bulk.example/v1".to_string(),
                transport_kind: ModelTransportKind::OpenAiCompatible,
            })
        );
    }

    #[test]
    fn model_add_form_parses_custom_anthropic_connection() {
        let mut form = new_model_add_form();
        model_add_pick_provider(&mut form, "custom");
        model_add_set_choice(&mut form, &t!("form.model.field.api_kind.label"), 2);
        model_add_set_text(
            &mut form,
            &t!("form.model.field.model_name.label"),
            "claude-custom",
        );
        model_add_set_text(
            &mut form,
            &t!("form.model.field.api_base.label"),
            "https://api.anthropic.com/v1",
        );
        model_add_set_text(
            &mut form,
            &t!("form.model.field.api_key.label"),
            "sk-anthropic",
        );
        let parsed = parse_model_add_connection(&form).expect("parse");
        assert_eq!(parsed.provider_id, "custom");
        assert_eq!(parsed.transport_kind, ModelTransportKind::Anthropic);
        assert_eq!(parsed.model_name.as_deref(), Some("claude-custom"));
        assert_eq!(parsed.api_base, "https://api.anthropic.com/v1");
    }

    #[test]
    fn model_add_form_parses_alibaba_preset_connection() {
        let mut form = new_model_add_form();
        model_add_pick_provider(&mut form, "alibaba");
        // provider, mode, billing, site, transport, workspace id, key
        assert_eq!(form.fields.len(), 7);
        model_add_set_text(
            &mut form,
            &t!("form.model.field.alibaba_workspace_id.label"),
            "ws-cn",
        );
        model_add_set_text(&mut form, &t!("form.model.field.api_key.label"), "sk-ali");

        let parsed = parse_model_add_connection(&form).expect("parse");
        assert_eq!(parsed.provider_id, "alibaba");
        assert_eq!(parsed.transport_kind, ModelTransportKind::OpenAiCompatible);
        assert!(parsed.bulk);
        assert!(parsed.model_name.is_none());
        assert_eq!(
            parsed.api_base,
            "https://ws-cn.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"
        );
        assert_eq!(parsed.api_key, "sk-ali");
    }

    #[test]
    fn model_add_form_parses_alibaba_token_plan_connection() {
        let mut form = new_model_add_form();
        model_add_pick_provider(&mut form, "alibaba");
        model_add_set_choice(&mut form, &t!("form.model.field.billing_mode.label"), 1);
        // A selected billing plan pins its own bases: the site and workspace fields hide.
        assert_eq!(form.fields.len(), 5);
        model_add_set_text(
            &mut form,
            &t!("form.model.field.api_key.label"),
            "sk-ali-token",
        );

        let parsed = parse_model_add_connection(&form).expect("parse");
        assert_eq!(parsed.provider_id, "alibaba");
        assert_eq!(parsed.transport_kind, ModelTransportKind::OpenAiCompatible);
        assert!(parsed.bulk);
        assert_eq!(
            parsed.api_base,
            "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"
        );
        assert_eq!(parsed.api_key, "sk-ali-token");
    }

    #[test]
    fn model_add_form_parses_anthropic_preset_connection() {
        let mut form = new_model_add_form();
        model_add_pick_provider(&mut form, "anthropic");
        assert_eq!(form.fields.len(), 3);
        model_add_set_text(
            &mut form,
            &t!("form.model.field.api_key.label"),
            "sk-anthropic",
        );

        let parsed = parse_model_add_connection(&form).expect("parse");
        assert_eq!(parsed.provider_id, "anthropic");
        assert!(parsed.bulk);
        assert!(parsed.model_name.is_none());
        assert_eq!(parsed.api_base, "https://api.anthropic.com/v1");
        assert_eq!(parsed.api_key, "sk-anthropic");
    }

    #[test]
    fn model_add_form_parses_stepfun_step_plan_connection() {
        let mut form = new_model_add_form();
        model_add_pick_provider(&mut form, "stepfun");
        model_add_set_choice(&mut form, &t!("form.model.field.billing_mode.label"), 1);
        model_add_set_text(
            &mut form,
            &t!("form.model.field.api_key.label"),
            "sk-stepfun",
        );

        let parsed = parse_model_add_connection(&form).expect("parse");
        assert_eq!(parsed.provider_id, "stepfun");
        assert_eq!(parsed.transport_kind, ModelTransportKind::OpenAiCompatible);
        assert!(parsed.bulk);
        assert_eq!(parsed.api_base, "https://api.stepfun.com/step_plan/v1");
        assert_eq!(parsed.api_key, "sk-stepfun");
    }

    #[test]
    fn model_add_form_parses_stepfun_international_connection() {
        let mut form = new_model_add_form();
        model_add_pick_provider(&mut form, "stepfun");
        model_add_set_choice(&mut form, &t!("form.model.field.site.label"), 1);
        model_add_set_text(
            &mut form,
            &t!("form.model.field.api_key.label"),
            "sk-stepfun-intl",
        );

        let parsed = parse_model_add_connection(&form).expect("parse");
        assert_eq!(parsed.provider_id, "stepfun");
        assert_eq!(parsed.transport_kind, ModelTransportKind::OpenAiCompatible);
        assert!(parsed.bulk);
        assert_eq!(parsed.api_base, "https://api.stepfun.ai/v1");
        assert_eq!(parsed.api_key, "sk-stepfun-intl");
    }

    #[test]
    fn model_add_form_parses_stepfun_international_step_plan_connection() {
        let mut form = new_model_add_form();
        model_add_pick_provider(&mut form, "stepfun");
        model_add_set_choice(&mut form, &t!("form.model.field.billing_mode.label"), 1);
        model_add_set_text(
            &mut form,
            &t!("form.model.field.api_key.label"),
            "sk-stepfun-intl-plan",
        );

        let parsed = parse_model_add_connection(&form).expect("parse");
        assert_eq!(parsed.provider_id, "stepfun");
        assert_eq!(parsed.transport_kind, ModelTransportKind::OpenAiCompatible);
        assert!(parsed.bulk);
        // The step-plan billing plan pins the China host regardless of the selected site.
        assert_eq!(parsed.api_base, "https://api.stepfun.com/step_plan/v1");
        assert_eq!(parsed.api_key, "sk-stepfun-intl-plan");
    }

    #[test]
    fn model_add_form_parses_z_ai_glm_coding_plan_connection() {
        let mut form = new_model_add_form();
        model_add_pick_provider(&mut form, "z-ai");
        assert_eq!(form.fields.len(), 4);
        model_add_set_choice(&mut form, &t!("form.model.field.billing_mode.label"), 1);
        model_add_set_text(&mut form, &t!("form.model.field.api_key.label"), "sk-zai");

        let parsed = parse_model_add_connection(&form).expect("parse");
        assert_eq!(parsed.provider_id, "z-ai");
        assert!(parsed.bulk);
        assert_eq!(parsed.api_base, "https://api.z.ai/api/coding/paas/v4");
        assert_eq!(parsed.api_key, "sk-zai");
    }

    #[test]
    fn model_add_form_parses_zhipu_glm_coding_plan_connection() {
        let mut form = new_model_add_form();
        model_add_pick_provider(&mut form, "zhipu-ai");
        assert_eq!(form.fields.len(), 4);
        model_add_set_choice(&mut form, &t!("form.model.field.billing_mode.label"), 1);
        model_add_set_text(&mut form, &t!("form.model.field.api_key.label"), "sk-zhipu");

        let parsed = parse_model_add_connection(&form).expect("parse");
        assert_eq!(parsed.provider_id, "zhipu-ai");
        assert!(parsed.bulk);
        assert_eq!(
            parsed.api_base,
            "https://open.bigmodel.cn/api/coding/paas/v4"
        );
        assert_eq!(parsed.api_key, "sk-zhipu");
    }

    #[test]
    fn model_add_form_parses_volcengine_preset_connection() {
        let mut form = new_model_add_form();
        model_add_pick_provider(&mut form, "volcengine");
        assert_eq!(form.fields.len(), 4);
        model_add_set_choice(&mut form, &t!("form.model.field.api_kind.label"), 1);
        model_add_set_text(&mut form, &t!("form.model.field.api_key.label"), "sk-volc");

        let parsed = parse_model_add_connection(&form).expect("parse");
        assert_eq!(parsed.provider_id, "volcengine");
        assert_eq!(parsed.transport_kind, ModelTransportKind::OpenResponses);
        assert!(parsed.bulk);
        assert!(parsed.model_name.is_none());
        assert_eq!(parsed.api_base, "https://ark.cn-beijing.volces.com/api/v3");
        assert_eq!(parsed.api_key, "sk-volc");
    }

    #[test]
    fn model_add_form_parses_byteplus_preset_connection() {
        let mut form = new_model_add_form();
        model_add_pick_provider(&mut form, "byteplus");
        assert_eq!(form.fields.len(), 4);
        model_add_set_choice(&mut form, &t!("form.model.field.api_kind.label"), 1);
        model_add_set_text(
            &mut form,
            &t!("form.model.field.api_key.label"),
            "sk-byteplus",
        );

        let parsed = parse_model_add_connection(&form).expect("parse");
        assert_eq!(parsed.provider_id, "byteplus");
        assert_eq!(parsed.transport_kind, ModelTransportKind::OpenResponses);
        assert!(parsed.bulk);
        assert!(parsed.model_name.is_none());
        assert_eq!(
            parsed.api_base,
            "https://ark.ap-southeast.bytepluses.com/api/v3"
        );
        assert_eq!(parsed.api_key, "sk-byteplus");
    }

    #[test]
    fn model_add_form_parses_siliconflow_preset_connection() {
        let mut form = new_model_add_form();
        model_add_pick_provider(&mut form, "siliconflow");
        assert_eq!(form.fields.len(), 5);
        model_add_set_choice(&mut form, &t!("form.model.field.api_kind.label"), 1);
        model_add_set_text(&mut form, &t!("form.model.field.api_key.label"), "sk-sf");

        let parsed = parse_model_add_connection(&form).expect("parse");
        assert_eq!(parsed.provider_id, "siliconflow");
        assert_eq!(parsed.transport_kind, ModelTransportKind::Anthropic);
        assert!(parsed.bulk);
        assert!(parsed.model_name.is_none());
        assert_eq!(parsed.api_base, "https://api.siliconflow.com/v1");
        assert_eq!(parsed.api_key, "sk-sf");
    }

    #[test]
    fn model_add_form_parses_moonshot_preset_connection() {
        let mut form = new_model_add_form();
        model_add_pick_provider(&mut form, "moonshot-ai");
        assert_eq!(form.fields.len(), 4);
        model_add_set_choice(&mut form, &t!("form.model.field.site.label"), 0);
        model_add_set_text(&mut form, &t!("form.model.field.api_key.label"), "sk-moon");

        let parsed = parse_model_add_connection(&form).expect("parse");
        assert_eq!(parsed.provider_id, "moonshot-ai");
        assert_eq!(parsed.transport_kind, ModelTransportKind::OpenAiCompatible);
        assert!(parsed.bulk);
        assert!(parsed.model_name.is_none());
        assert_eq!(parsed.api_base, "https://api.moonshot.cn/v1");
        assert_eq!(parsed.api_key, "sk-moon");
    }

    #[test]
    fn model_add_form_parses_kimi_code_preset_connection() {
        let mut form = new_model_add_form();
        model_add_pick_provider(&mut form, "kimi-code");
        model_add_set_text(
            &mut form,
            &t!("form.model.field.api_key.label"),
            "sk-kimi-code",
        );

        let parsed = parse_model_add_connection(&form).expect("parse");
        assert_eq!(parsed.provider_id, "kimi-code");
        assert_eq!(parsed.transport_kind, ModelTransportKind::OpenAiCompatible);
        assert!(parsed.bulk);
        assert!(parsed.model_name.is_none());
        assert_eq!(parsed.api_base, "https://api.kimi.ai/coding/v1");
        assert_eq!(parsed.api_key, "sk-kimi-code");
    }

    #[test]
    fn model_add_form_parses_kimi_code_china_site_connection() {
        let mut form = new_model_add_form();
        model_add_pick_provider(&mut form, "kimi-code");
        model_add_set_choice(&mut form, &t!("form.model.field.site.label"), 0);
        model_add_set_text(
            &mut form,
            &t!("form.model.field.api_key.label"),
            "sk-kimi-code",
        );

        let parsed = parse_model_add_connection(&form).expect("parse");
        assert_eq!(parsed.provider_id, "kimi-code");
        assert_eq!(parsed.api_base, "https://api.kimi.com/coding/v1");
        assert_eq!(parsed.api_key, "sk-kimi-code");
    }

    #[test]
    fn model_add_form_parses_minimax_preset_connection() {
        let mut form = new_model_add_form();
        model_add_pick_provider(&mut form, "minimax");
        model_add_set_choice(&mut form, &t!("form.model.field.site.label"), 1);
        model_add_set_text(&mut form, &t!("form.model.field.api_key.label"), "sk-mm");

        let parsed = parse_model_add_connection(&form).expect("parse");
        assert_eq!(parsed.provider_id, "minimax");
        // The preset's defaultTransport is anthropic.
        assert_eq!(parsed.transport_kind, ModelTransportKind::Anthropic);
        assert!(parsed.bulk);
        assert!(parsed.model_name.is_none());
        assert_eq!(parsed.api_base, "https://api.minimax.io/anthropic/v1");
        assert_eq!(parsed.api_key, "sk-mm");
        // The minimax catalog parser lists via the openai-compatible endpoint on the same site.
        assert_eq!(
            parsed.listing,
            Some(super::ModelAddListing::Http {
                api_base: "https://api.minimax.io/v1".to_string(),
                transport_kind: ModelTransportKind::OpenAiCompatible,
            })
        );
    }

    #[test]
    fn model_add_form_parses_azure_connection() {
        let mut form = new_model_add_form();
        model_add_pick_provider(&mut form, "azure");
        assert_eq!(form.fields.len(), 5);
        model_add_set_text(
            &mut form,
            &t!("form.model.field.azure_resource_name.label"),
            "my-openai-resource",
        );
        model_add_set_text(
            &mut form,
            &t!("form.model.field.deployment_name.label"),
            "my-gpt4o-deploy",
        );
        model_add_set_text(
            &mut form,
            &t!("form.model.field.api_key.label"),
            "azure-key",
        );
        let parsed = parse_model_add_connection(&form).expect("parse");
        assert_eq!(parsed.provider_id, "azure");
        assert_eq!(parsed.transport_kind, ModelTransportKind::OpenResponses);
        assert!(!parsed.bulk);
        assert_eq!(parsed.model_name.as_deref(), Some("my-gpt4o-deploy"));
        assert_eq!(
            parsed.api_base,
            "https://my-openai-resource.openai.azure.com/openai/v1"
        );
        assert_eq!(parsed.api_key, "azure-key");
    }

    #[test]
    fn model_add_form_parses_cloudflare_ai_gateway_connection() {
        let mut form = new_model_add_form();
        model_add_pick_provider(&mut form, "cloudflare-ai-gateway");
        assert_eq!(form.fields.len(), 7);
        model_add_set_choice(&mut form, &t!("form.model.field.api_kind.label"), 1);
        model_add_set_text(
            &mut form,
            &t!("form.model.field.cloudflare_account_id.label"),
            "0123456789abcdef0123456789abcdef",
        );
        model_add_set_text(
            &mut form,
            &t!("form.model.field.cloudflare_gateway_id.label"),
            "my-gateway",
        );
        model_add_set_text(
            &mut form,
            &t!("form.model.field.cloudflare_model_name.label"),
            "openai/gpt-4.1-mini",
        );
        model_add_set_text(
            &mut form,
            &t!("form.model.field.cloudflare_api_token.label"),
            "cf-token",
        );
        let parsed = parse_model_add_connection(&form).expect("parse");
        assert_eq!(parsed.provider_id, "cloudflare-ai-gateway");
        assert_eq!(parsed.transport_kind, ModelTransportKind::Anthropic);
        assert!(!parsed.bulk);
        assert_eq!(parsed.model_name.as_deref(), Some("openai/gpt-4.1-mini"));
        assert_eq!(
            parsed.api_base,
            "https://api.cloudflare.com/client/v4/accounts/0123456789abcdef0123456789abcdef/ai/v1"
        );
        assert_eq!(parsed.api_key, "cf-token");
        assert_eq!(parsed.cloudflare_gateway_id.as_deref(), Some("my-gateway"));
    }

    #[test]
    fn model_add_form_parses_vertex_service_account_connection() {
        let mut form = new_model_add_form();
        model_add_pick_provider(&mut form, "google-vertex-ai");
        // provider, mode, credential form, project, location, client email, private key
        assert_eq!(
            model_add_field_labels(&form),
            vec![
                t!("form.model.field.provider.label").into_owned(),
                t!("form.model.field.mode.label").into_owned(),
                t!("form.model.field.credential_kind.label").into_owned(),
                t!("form.model.field.vertex_project.label").into_owned(),
                t!("form.model.field.vertex_location.label").into_owned(),
                t!("form.model.field.vertex_client_email.label").into_owned(),
                t!("form.model.field.vertex_private_key.label").into_owned(),
            ]
        );
        model_add_set_text(
            &mut form,
            &t!("form.model.field.vertex_project.label"),
            "my-gcp-project",
        );
        model_add_set_text(
            &mut form,
            &t!("form.model.field.vertex_location.label"),
            "us-central1",
        );
        model_add_set_text(
            &mut form,
            &t!("form.model.field.vertex_client_email.label"),
            "sa@example.invalid",
        );
        model_add_set_text(
            &mut form,
            &t!("form.model.field.vertex_private_key.label"),
            "-----BEGIN PRIVATE KEY-----",
        );

        let parsed = parse_model_add_connection(&form).expect("parse");
        assert_eq!(parsed.provider_id, "google-vertex-ai");
        assert!(parsed.bulk);
        assert_eq!(
            parsed.api_base,
            "https://us-central1-aiplatform.googleapis.com/v1/projects/my-gcp-project/locations/us-central1"
        );
        assert!(parsed.api_key.is_empty());
        assert_eq!(
            parsed.options.get("project").map(String::as_str),
            Some("my-gcp-project")
        );
        assert_eq!(
            parsed.options.get("location").map(String::as_str),
            Some("us-central1")
        );
        assert_eq!(
            parsed.credential_slots,
            vec![
                ("clientEmail".to_string(), "sa@example.invalid".to_string()),
                (
                    "privateKey".to_string(),
                    "-----BEGIN PRIVATE KEY-----".to_string()
                ),
            ]
        );
        assert_eq!(
            parsed.listing,
            Some(super::ModelAddListing::VertexServiceAccount)
        );
    }

    #[test]
    fn model_add_form_parses_vertex_express_api_key_connection() {
        let mut form = new_model_add_form();
        model_add_pick_provider(&mut form, "google-vertex-ai");
        // The apiKey credential form selects the Vertex Express shortcut.
        model_add_set_choice(&mut form, &t!("form.model.field.credential_kind.label"), 1);
        // provider, credential form, model name, context length, api key
        assert_eq!(
            model_add_field_labels(&form),
            vec![
                t!("form.model.field.provider.label").into_owned(),
                t!("form.model.field.credential_kind.label").into_owned(),
                t!("form.model.field.model_name.label").into_owned(),
                t!("form.model.field.context_length.label").into_owned(),
                t!("form.model.field.api_key.label").into_owned(),
            ]
        );
        model_add_set_text(
            &mut form,
            &t!("form.model.field.model_name.label"),
            "publishers/google/models/gemini-2.5-flash",
        );
        model_add_set_text(&mut form, &t!("form.model.field.api_key.label"), "aq-key");

        let parsed = parse_model_add_connection(&form).expect("parse");
        assert_eq!(parsed.provider_id, "google-vertex-ai");
        assert!(!parsed.bulk);
        // Vertex Express materializes the preset's expressApiBase and writes no options.
        assert_eq!(
            parsed.api_base,
            "https://aiplatform.googleapis.com/v1/publishers/google"
        );
        assert!(parsed.options.is_empty());
        assert_eq!(parsed.api_key, "aq-key");
        assert_eq!(
            parsed.model_name.as_deref(),
            Some("publishers/google/models/gemini-2.5-flash")
        );
        assert!(parsed.credential_slots.is_empty());
        assert!(parsed.listing.is_none());
    }

    #[test]
    fn model_add_form_vertex_service_account_requires_the_pair() {
        let mut form = new_model_add_form();
        model_add_pick_provider(&mut form, "google-vertex-ai");
        model_add_set_text(
            &mut form,
            &t!("form.model.field.vertex_project.label"),
            "my-gcp-project",
        );
        model_add_set_text(
            &mut form,
            &t!("form.model.field.vertex_location.label"),
            "us-central1",
        );
        model_add_set_text(
            &mut form,
            &t!("form.model.field.vertex_client_email.label"),
            "sa@example.invalid",
        );

        let err = parse_model_add_connection(&form).expect_err("incomplete service account");
        assert_eq!(
            err,
            t!("form.model.validation.vertex_service_account_incomplete")
        );
    }

    #[test]
    fn model_add_form_parses_bedrock_connection() {
        let mut form = new_model_add_form();
        model_add_pick_provider(&mut form, "amazon-bedrock");
        // provider, region, model name, context length, access key id, secret access key
        assert_eq!(
            model_add_field_labels(&form),
            vec![
                t!("form.model.field.provider.label").into_owned(),
                t!("form.model.field.aws_region.label").into_owned(),
                t!("form.model.field.model_name.label").into_owned(),
                t!("form.model.field.context_length.label").into_owned(),
                t!("form.model.field.bedrock_access_key_id.label").into_owned(),
                t!("form.model.field.bedrock_secret_access_key.label").into_owned(),
            ]
        );
        model_add_set_text(
            &mut form,
            &t!("form.model.field.model_name.label"),
            "anthropic.claude-opus-5-5-v1",
        );
        model_add_set_text(
            &mut form,
            &t!("form.model.field.bedrock_access_key_id.label"),
            "AKIAEXAMPLE",
        );
        model_add_set_text(
            &mut form,
            &t!("form.model.field.bedrock_secret_access_key.label"),
            "secret",
        );

        let parsed = parse_model_add_connection(&form).expect("parse");
        assert_eq!(parsed.provider_id, "amazon-bedrock");
        assert_eq!(parsed.transport_kind, ModelTransportKind::Bedrock);
        assert!(!parsed.bulk);
        // The region field defaults to us-east-1 and materializes into the endpoint + options.
        assert_eq!(parsed.api_base, "https://bedrock.us-east-1.amazonaws.com");
        assert_eq!(
            parsed.options.get("awsRegion").map(String::as_str),
            Some("us-east-1")
        );
        assert!(parsed.api_key.is_empty());
        assert_eq!(
            parsed.credential_slots,
            vec![
                ("accessKeyId".to_string(), "AKIAEXAMPLE".to_string()),
                ("secretAccessKey".to_string(), "secret".to_string()),
            ]
        );
        assert!(parsed.listing.is_none());
    }

    #[test]
    fn model_add_form_bedrock_requires_both_iam_fields() {
        let mut form = new_model_add_form();
        model_add_pick_provider(&mut form, "amazon-bedrock");
        model_add_set_text(
            &mut form,
            &t!("form.model.field.model_name.label"),
            "anthropic.claude-opus-5-5-v1",
        );
        model_add_set_text(
            &mut form,
            &t!("form.model.field.bedrock_access_key_id.label"),
            "AKIAEXAMPLE",
        );

        let err = parse_model_add_connection(&form).expect_err("incomplete IAM pair");
        assert_eq!(
            err,
            t!("form.model.validation.bedrock_credentials_incomplete")
        );
    }

    fn sample_rule_entry(scope: RuleScope, exists: bool, enabled: bool) -> RuleEntry {
        let (id, title, short_label, path) = match scope {
            RuleScope::Workspace => (
                "workspace-rule",
                "Workspace Rule",
                ".spirit/rule.md",
                PathBuf::from("C:/workspace/.spirit/rule.md"),
            ),
            RuleScope::User => (
                "user-rule",
                "User Rule",
                "rule.md",
                PathBuf::from("C:/users/demo/AppData/Roaming/Spirit/rule.md"),
            ),
        };

        RuleEntry {
            source: RuleSource {
                id: id.to_string(),
                scope,
                title: title.to_string(),
                short_label: short_label.to_string(),
                path,
            },
            exists,
            enabled,
            content: exists.then(|| "body".to_string()),
            preview: exists.then(|| RulePreview {
                excerpt: "body".to_string(),
                truncated: false,
            }),
        }
    }

    fn sample_prompt(required: bool) -> McpDiscoveredPrompt {
        McpDiscoveredPrompt {
            name: "issue-summary".to_string(),
            title: Some("Issue Summary".to_string()),
            description: Some("Summarize an issue with extra context".to_string()),
            arguments: vec![
                McpDiscoveredPromptArgument {
                    name: "issue".to_string(),
                    title: Some("Issue Number".to_string()),
                    description: Some("The issue number to summarize".to_string()),
                    required,
                },
                McpDiscoveredPromptArgument {
                    name: "style".to_string(),
                    title: Some("Style".to_string()),
                    description: Some("Optional style hint".to_string()),
                    required: false,
                },
            ],
        }
    }

    fn sample_skill_entry(scope: SkillScope, enabled: bool) -> SkillEntry {
        let (id, name, description, short_label, path, root_kind) = match scope {
            SkillScope::Workspace => (
                "workspace-skill",
                "code-review",
                "Review code when the user asks for diff analysis.",
                ".spirit/skills/code-review/SKILL.md",
                PathBuf::from("C:/workspace/.spirit/skills/code-review/SKILL.md"),
                SkillRootKind::WorkspaceSpirit,
            ),
            SkillScope::User => (
                "user-skill",
                "data-analysis",
                "Analyze datasets and summarize findings.",
                "skills/data-analysis/SKILL.md",
                PathBuf::from("C:/users/demo/AppData/Roaming/Spirit/skills/data-analysis/SKILL.md"),
                SkillRootKind::User,
            ),
            SkillScope::Extension => (
                "extension-skill",
                "bundled-skill",
                "A skill bundled by an extension.",
                "extension/skills/bundled-skill/SKILL.md",
                PathBuf::from("/extensions/demo/skills/bundled-skill/SKILL.md"),
                SkillRootKind::Extension,
            ),
        };

        SkillEntry {
            source: SkillSource {
                id: id.to_string(),
                scope,
                root_kind,
                name: name.to_string(),
                description: description.to_string(),
                short_label: short_label.to_string(),
                path,
            },
            enabled,
            content: "# Skill body".to_string(),
            preview: SkillPreview {
                excerpt: "# Skill body".to_string(),
                truncated: false,
            },
        }
    }

    fn sample_extension_entry() -> CliExtensionEntry {
        CliExtensionEntry {
            id: "basic-metadata-demo".to_string(),
            display_name: "Basic Metadata Demo".to_string(),
            version: "0.1.0".to_string(),
            enabled: true,
            description: Some("A metadata-only extension fixture.".to_string()),
            author: Some(crate::host_protocol::cli_public::CliExtensionAuthor {
                name: "Spirit".to_string(),
                email: None,
                url: None,
            }),
            main: Some("dist/index.js".to_string()),
            supported_hosts: vec!["cli".to_string(), "desktop".to_string()],
            activation_events: None,
            requested_capabilities: None,
            contributes: None,
            settings_schema: None,
            secret_slots: None,
            archive_file_name: Some("basic-metadata-demo.zip".to_string()),
            instruction_contributions: None,
            installed_at_unix_ms: 0,
            installed: true,
            install_source: Some("archive".to_string()),
        }
    }

    #[test]
    fn hook_add_form_defaults_match_desktop() {
        let form = new_hook_add_form(true);

        assert!(matches!(form.kind, crate::view::BottomFormKind::HookAdd));
        assert_eq!(
            match &form.fields[HOOK_ADD_FIELD_COMMAND].editor {
                BottomFormFieldEditorView::Text { value, .. } => value.as_str(),
                _ => panic!("expected command text field"),
            },
            "hooks/log-hook.sh"
        );
        assert_eq!(
            match &form.fields[HOOK_ADD_FIELD_TIMEOUT].editor {
                BottomFormFieldEditorView::Text { value, .. } => value.as_str(),
                _ => panic!("expected timeout text field"),
            },
            "30"
        );
    }

    #[test]
    fn hook_add_form_rejects_empty_command() {
        let mut form = new_hook_add_form(true);
        form.selected_field = HOOK_ADD_FIELD_COMMAND;
        if let BottomFormFieldEditorView::Text { value, cursor, .. } =
            &mut form.fields[HOOK_ADD_FIELD_COMMAND].editor
        {
            value.clear();
            *cursor = 0;
        }

        let err = to_hook_save_request(&form).expect_err("empty command");
        assert_eq!(err, t!("form.hooks.validation.command_required"));
    }

    #[test]
    fn hook_add_form_rejects_invalid_timeout() {
        let mut form = new_hook_add_form(true);
        form.selected_field = HOOK_ADD_FIELD_TIMEOUT;
        if let BottomFormFieldEditorView::Text { value, cursor, .. } =
            &mut form.fields[HOOK_ADD_FIELD_TIMEOUT].editor
        {
            *value = "not-a-number".to_string();
            *cursor = value.chars().count();
        }

        let err = to_hook_save_request(&form).expect_err("invalid timeout");
        assert_eq!(err, t!("form.hooks.validation.timeout_invalid"));
    }

    #[test]
    fn hook_add_form_parses_request_with_optional_fields() {
        let mut form = new_hook_add_form(true);
        form.selected_field = HOOK_ADD_FIELD_FAIL_CLOSED;
        move_right(&mut form);

        let request = to_hook_save_request(&form).expect("parse hook request");
        assert_eq!(request.scope, "workspace");
        assert_eq!(request.event, "preToolUse");
        assert_eq!(request.command, "hooks/log-hook.sh");
        assert_eq!(request.timeout, Some(30));
        assert_eq!(request.fail_closed, Some(true));
        assert!(request.matcher.is_none());
    }

    #[test]
    fn hook_add_form_without_workspace_scope_forces_user() {
        let form = new_hook_add_form(false);
        let request = to_hook_save_request(&form).expect("parse hook request");
        assert_eq!(request.scope, "user");
    }

    #[test]
    fn hook_add_enter_on_fail_closed_checkbox_toggles_instead_of_submit() {
        let mut form = new_hook_add_form(true);
        form.selected_field = HOOK_ADD_FIELD_FAIL_CLOSED;

        assert!(hook_add_form_enter_toggles_checkbox(&form));
        activate(&mut form);

        match &form.fields[HOOK_ADD_FIELD_FAIL_CLOSED].editor {
            BottomFormFieldEditorView::Checkbox { checked, .. } => assert!(*checked),
            _ => panic!("expected fail closed checkbox"),
        }
    }
}
