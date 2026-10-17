use anyhow::{Context, Result, anyhow};
use rust_i18n::t;
use std::fs;
use std::{env, path::PathBuf};

use crate::{
    adapters::{DefaultAppPaths, JsonConfigStore, KeyringSecretStore},
    daemon::DaemonRuntime,
    mcp::{
        example_github_mcp_config, load_mcp_config, save_mcp_config, set_server_enabled,
        user_mcp_config_path, workspace_mcp_config_path,
    },
    model_provider_presets::{
        azure_api_base_from_resource_name, model_add_alibaba_site_api_base,
        model_add_alibaba_site_requires_workspace_id, model_add_default_custom_api_base,
        model_add_kimi_code_api_base, model_add_kimi_code_site_api_base,
        model_add_minimax_site_api_base, model_add_moonshot_site_api_base,
        model_add_preset_api_base, model_add_siliconflow_site_api_base, model_add_stepfun_api_base,
        model_add_tencent_tokenhub_site_api_base, preset_connect_draft,
        validate_azure_resource_name,
    },
    model_registry::{
        AppConfig, DEFAULT_API_BASE, ModelEntry, ModelProfile, ModelProvider, ModelRef,
        ModelTransportKind, default_preset_provider_id, env_channel_value, model_refs_equal,
        resolve_provider_api_key, save_provider_api_key,
    },
    ports::{AppPaths, ConfigStore, SecretStore},
};

const ENV_API_KEY: &str = "SPIRIT_API_KEY";

pub struct ModelAddCommand {
    pub name: String,
    pub api_base: Option<String>,
    pub provider: Option<String>,
    pub transport_kind: Option<String>,
    pub reasoning_effort: Option<String>,
    pub capabilities: Vec<String>,
    pub context_length: Option<u64>,
    pub key: Option<String>,
    pub azure_resource_name: Option<String>,
    pub provider_site: Option<String>,
    pub alibaba_workspace_id: Option<String>,
}

pub enum ModelCommand {
    List,
    Add(Box<ModelAddCommand>),
    Remove { name: String },
    Use { name: String },
    Current,
}

pub enum ConfigCommand {
    Show,
    SetBase { url: String },
    SetImageModel { name: String },
    ClearImageModel,
    SetVideoModel { name: String },
    ClearVideoModel,
    Key { action: KeyCommand },
}

pub enum KeyCommand {
    Set { value: Option<String> },
    Remove,
    Status,
}

pub enum McpCommand {
    List,
    Show,
    Init {
        force: bool,
    },
    Enable {
        name: String,
    },
    Disable {
        name: String,
    },
    Inspect {
        name: String,
    },
    Tools {
        name: String,
    },
    CallTool {
        name: String,
        tool: String,
        args_json: Option<String>,
    },
    Resources {
        name: String,
    },
    Prompts {
        name: String,
    },
    ReadResource {
        name: String,
        uri: String,
    },
    GetPrompt {
        name: String,
        prompt: String,
        args_json: Option<String>,
    },
}

pub use crate::hooks::HookCommand;

pub fn handle_hooks_cli(action: HookCommand) -> Result<()> {
    crate::hooks::handle_hooks_cli(action)
}

pub use crate::permissions::PermissionCommand;

pub fn handle_permissions_cli(action: PermissionCommand) -> Result<()> {
    crate::permissions::handle_permissions_cli(action)
}

pub enum ExtensionCommand {
    List,
    Import {
        archive: String,
    },
    Remove {
        id: String,
    },
    Install {
        name: String,
        marketplace: Option<String>,
        review_acknowledged: bool,
    },
    Update {
        name: String,
        review_acknowledged: bool,
    },
    Marketplace {
        action: ExtensionMarketplaceCommand,
    },
}

pub enum ExtensionMarketplaceCommand {
    Add {
        locator: String,
        git_ref: Option<String>,
    },
    List,
    Remove {
        name: String,
    },
}

pub fn handle_model_cli(action: ModelCommand) -> Result<()> {
    let config_store = JsonConfigStore;
    let secret_store = KeyringSecretStore;
    let mut cfg = config_store.load()?;

    match action {
        ModelCommand::List => {
            println!(
                "{}",
                t!("cli.model.current", model = cfg.active_model_name())
            );
            println!("{}", t!("cli.model.list_header"));
            for model in cfg.flatten_models() {
                let key_saved = model_key_resolves(&secret_store, &model);
                println!(
                    "{}",
                    t!(
                        "cli.model.list_entry",
                        name = model.name,
                        provider_id = model.provider_id,
                        api_base = model.api_base,
                        reasoning_effort = model
                            .reasoning_effort
                            .as_deref()
                            .map(str::to_string)
                            .unwrap_or_else(|| t!("cli.common.unset").into_owned()),
                        capabilities = format_model_capabilities(&model),
                        key_status = common_key_status(key_saved),
                    )
                );
            }
        }
        ModelCommand::Add(add) => {
            let ModelAddCommand {
                name,
                api_base,
                provider,
                transport_kind,
                reasoning_effort,
                capabilities,
                context_length,
                key,
                azure_resource_name,
                provider_site,
                alibaba_workspace_id,
            } = *add;
            if cfg.has_model_name(&name) {
                println!("{}", t!("cli.model.already_exists", name = name));
            } else {
                let provider = parse_model_provider(provider)?;
                let transport_kind = parse_model_transport_kind(transport_kind, provider)?;
                let azure_resource_name = azure_resource_name
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(ToOwned::to_owned);
                if provider == Some(ModelProvider::Azure) && azure_resource_name.is_none() {
                    return Err(anyhow!(
                        "{}",
                        t!("cli.model.error.azure_resource_name_required")
                    ));
                }
                if provider == Some(ModelProvider::Azure)
                    && let Some(resource_name) = azure_resource_name.as_deref()
                {
                    validate_azure_resource_name(resource_name).map_err(anyhow::Error::msg)?;
                }
                let reasoning_effort = parse_model_reasoning_effort(reasoning_effort)?;
                if provider == Some(ModelProvider::Custom)
                    && api_base.as_deref().map(str::trim).is_none_or(str::is_empty)
                {
                    return Err(anyhow!("{}", t!("cli.model.error.endpoint_empty")));
                }
                if provider == Some(ModelProvider::Alibaba)
                    && let Some(site) = provider_site
                        .as_deref()
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                    && model_add_alibaba_site_requires_workspace_id(site)
                    && alibaba_workspace_id
                        .as_deref()
                        .map(str::trim)
                        .is_none_or(str::is_empty)
                {
                    return Err(anyhow!(
                        "{}",
                        t!("cli.model.error.alibaba_workspace_id_required")
                    ));
                }
                let api_base = api_base.unwrap_or_else(|| {
                    if provider == Some(ModelProvider::Azure) {
                        return azure_api_base_from_resource_name(
                            azure_resource_name.as_deref().unwrap_or(""),
                        );
                    }
                    if provider == Some(ModelProvider::Siliconflow)
                        && let Some(site) = provider_site
                            .as_deref()
                            .map(str::trim)
                            .filter(|value| !value.is_empty())
                        && let Some(base) = model_add_siliconflow_site_api_base(site)
                    {
                        return base;
                    }
                    if provider == Some(ModelProvider::Moonshot)
                        && let Some(site) = provider_site
                            .as_deref()
                            .map(str::trim)
                            .filter(|value| !value.is_empty())
                        && let Some(base) = model_add_moonshot_site_api_base(site)
                    {
                        return base;
                    }
                    if provider == Some(ModelProvider::TencentTokenhub)
                        && let Some(site) = provider_site
                            .as_deref()
                            .map(str::trim)
                            .filter(|value| !value.is_empty())
                        && let Some(base) = model_add_tencent_tokenhub_site_api_base(site)
                    {
                        return base;
                    }
                    if provider == Some(ModelProvider::KimiCode) {
                        if let Some(site) = provider_site
                            .as_deref()
                            .map(str::trim)
                            .filter(|value| !value.is_empty())
                            && let Some(base) =
                                model_add_kimi_code_site_api_base(site, transport_kind)
                        {
                            return base;
                        }
                        if let Some(base) = model_add_kimi_code_api_base(transport_kind) {
                            return base;
                        }
                    }
                    if provider == Some(ModelProvider::Minimax)
                        && let Some(site) = provider_site
                            .as_deref()
                            .map(str::trim)
                            .filter(|value| !value.is_empty())
                        && let Some(base) = model_add_minimax_site_api_base(site, transport_kind)
                    {
                        return base;
                    }
                    if provider == Some(ModelProvider::Alibaba)
                        && let Some(site) = provider_site
                            .as_deref()
                            .map(str::trim)
                            .filter(|value| !value.is_empty())
                        && let Some(base) = model_add_alibaba_site_api_base(
                            site,
                            alibaba_workspace_id.as_deref().unwrap_or(""),
                            transport_kind,
                        )
                    {
                        return base;
                    }
                    if provider == Some(ModelProvider::Stepfun)
                        && let Some(site) = provider_site
                            .as_deref()
                            .map(str::trim)
                            .filter(|value| !value.is_empty())
                        && let Some(base) =
                            model_add_stepfun_api_base(transport_kind, false, Some(site))
                    {
                        return base;
                    }
                    if let Some(provider) = provider
                        && let Some(preset) = model_add_preset_api_base(provider, transport_kind)
                    {
                        return preset;
                    }
                    match transport_kind {
                        ModelTransportKind::Anthropic => {
                            model_add_default_custom_api_base(ModelTransportKind::Anthropic)
                        }
                        ModelTransportKind::Bedrock => {
                            if let Some(provider) = provider
                                && let Some(preset) =
                                    model_add_preset_api_base(provider, transport_kind)
                            {
                                return preset;
                            }
                            "https://bedrock.us-east-1.amazonaws.com".to_string()
                        }
                        ModelTransportKind::OpenResponses
                        | ModelTransportKind::OpenAiCompatible => DEFAULT_API_BASE.to_string(),
                    }
                });
                let capabilities = normalize_model_capabilities(capabilities);
                let key_value = match key {
                    Some(v) => v,
                    None => rpassword::prompt_password(&t!("cli.model.prompt_api_key"))
                        .context(t!("cli.model.api_key_read_failed").into_owned())?,
                };
                let resolved_provider = provider.unwrap_or(ModelProvider::Custom);
                if key_value.trim().is_empty() && resolved_provider != ModelProvider::Custom {
                    return Err(anyhow!("{}", t!("cli.model.error.api_key_empty")));
                }
                let context_length = match context_length {
                    None => None,
                    Some(0) => {
                        return Err(anyhow!("{}", t!("cli.model.error.context_length_positive")));
                    }
                    Some(value) => Some(value),
                };

                let provider_id = default_preset_provider_id(resolved_provider);
                let connect = preset_connect_draft(resolved_provider, transport_kind);
                let entry = ModelEntry {
                    name: name.clone(),
                    reasoning_effort: reasoning_effort.clone(),
                    capabilities: if capabilities.is_empty() {
                        None
                    } else {
                        Some(capabilities.clone())
                    },
                    context_length,
                    ..ModelEntry::default()
                };
                cfg.add_model_to_provider(&provider_id, api_base.clone(), connect, entry);
                let model_ref = ModelRef {
                    provider_id: provider_id.clone(),
                    name: name.clone(),
                };
                if cfg.image_generation_model.is_none()
                    && cfg
                        .resolve_model_profile(&model_ref)
                        .is_some_and(|profile| profile.supports_image_generation())
                {
                    cfg.image_generation_model = Some(model_ref.clone());
                }
                if cfg.video_generation_model.is_none()
                    && cfg
                        .resolve_model_profile(&model_ref)
                        .is_some_and(|profile| profile.supports_video_generation())
                {
                    cfg.video_generation_model = Some(model_ref.clone());
                }
                cfg.active_model = model_ref;
                if !key_value.trim().is_empty() {
                    save_provider_api_key(&provider_id, &key_value)?;
                }
                config_store.save(&cfg)?;
                println!("{}", t!("cli.model.added_and_active", name = name));
                println!("api_base: {}", api_base);
                println!(
                    "provider: {}",
                    format_model_provider(Some(resolved_provider))
                );
                println!(
                    "reasoning_effort: {}",
                    reasoning_effort
                        .as_deref()
                        .map(str::to_string)
                        .unwrap_or_else(|| t!("cli.common.unset").into_owned())
                );
                println!(
                    "capabilities: {}",
                    cfg.resolve_model_profile(&ModelRef {
                        provider_id,
                        name: name.clone(),
                    })
                    .map(|profile| format_model_capabilities(&profile))
                    .unwrap_or_else(|| t!("cli.common.unset").into_owned())
                );
            }
        }
        ModelCommand::Remove { name } => {
            let model_ref = cfg
                .parse_model_ref_selector(&name)
                .map_err(|err| anyhow!(err))?;
            if !cfg.remove_model(&model_ref) {
                println!("{}", t!("cli.model.not_found_name", name = name));
            } else {
                if model_refs_equal(&cfg.active_model, &model_ref) {
                    cfg.active_model = cfg.first_model_ref();
                }
                if cfg
                    .image_generation_model
                    .as_ref()
                    .is_some_and(|slot| model_refs_equal(slot, &model_ref))
                {
                    cfg.image_generation_model = None;
                }
                if cfg
                    .video_generation_model
                    .as_ref()
                    .is_some_and(|slot| model_refs_equal(slot, &model_ref))
                {
                    cfg.video_generation_model = None;
                }
                config_store.save(&cfg)?;
                // When the removal emptied the provider entry, drop its internal keyring
                // accounts (`provider::{id}` plus the wizard-written Vertex slot pair).
                if cfg.find_provider_entry(&model_ref.provider_id).is_none() {
                    let _ = secret_store.remove_provider_secret(
                        &crate::model_registry::provider_key_account(&model_ref.provider_id),
                    );
                    for slot in ["clientEmail", "privateKey"] {
                        let _ = secret_store.remove_provider_secret(
                            &crate::model_registry::provider_slot_account(
                                &model_ref.provider_id,
                                slot,
                            ),
                        );
                    }
                }
                println!("{}", t!("cli.model.removed", name = name));
            }
        }
        ModelCommand::Use { name } => {
            crate::cli_bootstrap::apply_active_model(&name, &mut cfg, &config_store)?;
            println!("{}", t!("cli.model.switched", name = name));
        }
        ModelCommand::Current => {
            println!(
                "{}",
                t!("cli.model.current", model = cfg.active_model_name())
            );
        }
    }

    Ok(())
}

pub fn handle_config_cli(action: ConfigCommand) -> Result<()> {
    let config_store = JsonConfigStore;
    let secret_store = KeyringSecretStore;
    let app_paths = DefaultAppPaths::new();
    let mut cfg = config_store.load()?;

    match action {
        ConfigCommand::Show => {
            println!(
                "{}",
                t!(
                    "cli.config.file",
                    path = app_paths.config_file().display().to_string()
                )
            );
            println!(
                "{}",
                t!("cli.config.active_model", model = cfg.active_model_name())
            );
            println!(
                "{}",
                t!(
                    "cli.config.image_generation_model",
                    model = cfg
                        .image_generation_model
                        .as_ref()
                        .map(|model_ref| model_ref.name.as_str())
                        .unwrap_or(t!("cli.common.unset").as_ref())
                )
            );
            println!(
                "{}",
                t!(
                    "cli.config.video_generation_model",
                    model = cfg
                        .video_generation_model
                        .as_ref()
                        .map(|model_ref| model_ref.name.as_str())
                        .unwrap_or(t!("cli.common.unset").as_ref())
                )
            );
            println!("{}", t!("cli.config.models_header"));
            for model in cfg.flatten_models() {
                let key_saved = model_key_resolves(&secret_store, &model);
                println!(
                    "{}",
                    t!(
                        "cli.model.list_entry",
                        name = model.name,
                        provider_id = model.provider_id,
                        api_base = model.api_base,
                        reasoning_effort = model
                            .reasoning_effort
                            .as_deref()
                            .map(str::to_string)
                            .unwrap_or_else(|| t!("cli.common.unset").into_owned()),
                        capabilities = format_model_capabilities(&model),
                        key_status = common_key_status(key_saved),
                    )
                );
            }
            println!(
                "{}",
                t!(
                    "cli.config.env_var",
                    name = ENV_API_KEY,
                    status = if env::var(ENV_API_KEY).is_ok() {
                        t!("cli.common.set").into_owned()
                    } else {
                        t!("cli.common.unset_env").into_owned()
                    }
                )
            );
            let keyring_saved = secret_store
                .load_global_api_key()
                .map(|v| v.is_some())
                .unwrap_or(false);
            println!(
                "{}",
                t!(
                    "cli.config.keyring",
                    status = common_key_status(keyring_saved)
                )
            );
            println!(
                "{}",
                t!("cli.config.api_key_priority", env_var = ENV_API_KEY)
            );
        }
        ConfigCommand::SetBase { url } => {
            if let Some(provider) = cfg.active_provider_entry_mut() {
                provider.api_base = url.clone();
            }
            config_store.save(&cfg)?;
            println!("{}", t!("cli.config.api_base_updated", url = url));
        }
        ConfigCommand::SetImageModel { name } => {
            let model_ref = cfg
                .parse_model_ref_selector(&name)
                .map_err(|err| anyhow!(err))?;
            let Some(profile) = cfg.resolve_model_profile(&model_ref) else {
                return Err(anyhow!(
                    "{}",
                    crate::cli_bootstrap::model_not_found_message(&name, &cfg)
                ));
            };
            if !profile.supports_image_generation() {
                return Err(anyhow!(
                    "{}",
                    t!("cli.model.error.no_image_generation", name = name)
                ));
            }
            cfg.image_generation_model = Some(model_ref);
            config_store.save(&cfg)?;
            println!("{}", t!("cli.config.image_model_set", name = name));
        }
        ConfigCommand::ClearImageModel => {
            cfg.image_generation_model = None;
            config_store.save(&cfg)?;
            println!("{}", t!("cli.config.image_model_cleared"));
        }
        ConfigCommand::SetVideoModel { name } => {
            let model_ref = cfg
                .parse_model_ref_selector(&name)
                .map_err(|err| anyhow!(err))?;
            let Some(profile) = cfg.resolve_model_profile(&model_ref) else {
                return Err(anyhow!(
                    "{}",
                    crate::cli_bootstrap::model_not_found_message(&name, &cfg)
                ));
            };
            if !profile.supports_video_generation() {
                return Err(anyhow!(
                    "{}",
                    t!("cli.model.error.no_video_generation", name = name)
                ));
            }
            cfg.video_generation_model = Some(model_ref);
            config_store.save(&cfg)?;
            println!("{}", t!("cli.config.video_model_set", name = name));
        }
        ConfigCommand::ClearVideoModel => {
            cfg.video_generation_model = None;
            config_store.save(&cfg)?;
            println!("{}", t!("cli.config.video_model_cleared"));
        }
        ConfigCommand::Key { action } => handle_key_cli(action, &secret_store)?,
    }

    Ok(())
}

fn parse_model_provider(value: Option<String>) -> Result<Option<ModelProvider>> {
    match normalize_choice_arg(value) {
        Some(provider) => provider
            .parse()
            .map(Some)
            .map_err(|err: String| anyhow!(err)),
        None => Ok(None),
    }
}

fn parse_model_transport_kind(
    value: Option<String>,
    provider: Option<ModelProvider>,
) -> Result<ModelTransportKind> {
    let parsed = match normalize_choice_arg(value) {
        Some(transport_kind) => transport_kind.parse().map_err(|err: String| anyhow!(err))?,
        // The preset manifest's `defaultTransport` is the unflagged default.
        None => match provider {
            Some(provider) => {
                crate::model_provider_presets::preset_default_transport_kind(provider)
            }
            None => ModelTransportKind::OpenAiCompatible,
        },
    };

    match (provider, parsed) {
        (Some(ModelProvider::AmazonBedrock), transport_kind)
            if transport_kind != ModelTransportKind::Bedrock =>
        {
            Err(anyhow!("{}", t!("cli.model.error.transport.bedrock_only")))
        }
        (Some(ModelProvider::Custom) | None, ModelTransportKind::Bedrock) => Err(anyhow!(
            "{}",
            t!("cli.model.error.transport.bedrock_exclusive")
        )),
        // The preset manifest's `transports` keys are the provider's supported set; custom
        // endpoints accept any non-bedrock transport.
        (Some(provider), transport_kind)
            if provider != ModelProvider::Custom
                && !crate::model_provider_presets::preset_supports_transport(
                    provider,
                    transport_kind,
                ) =>
        {
            Err(anyhow!(
                "{}",
                t!(
                    "cli.model.error.transport.provider_transport_unsupported",
                    provider = provider.as_str(),
                    transport = transport_kind.as_str()
                )
            ))
        }
        _ => Ok(parsed),
    }
}

/// `model add --reasoning-effort` accepts any schemaVersion-1 effort token; whether the value
/// reaches the wire is decided by the daemon from the model's declared
/// `supportedReasoningEfforts` (absent = trusted pass-through), not by the CLI.
fn parse_model_reasoning_effort(value: Option<String>) -> Result<Option<String>> {
    let normalized = match normalize_choice_arg(value) {
        Some(reasoning_effort) => reasoning_effort.to_ascii_lowercase(),
        None => return Ok(None),
    };

    const ALLOWED: [&str; 8] = [
        "default", "none", "minimal", "low", "medium", "high", "xhigh", "max",
    ];
    if ALLOWED.contains(&normalized.as_str()) {
        return Ok(Some(normalized));
    }

    let expected = ALLOWED.join("|");
    Err(anyhow!(
        "{}",
        t!(
            "cli.model.error.reasoning_effort_invalid",
            expected = expected,
            received = normalized
        )
    ))
}

fn normalize_choice_arg(value: Option<String>) -> Option<String> {
    let trimmed = value?.trim().to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

/// Whether any credential channel (flat keys, env, keyring references, or the internal
/// `provider::{id}` account) resolves to a key for this model's provider entry.
fn model_key_resolves(secret_store: &KeyringSecretStore, model: &ModelProfile) -> bool {
    resolve_provider_api_key(
        &model.key_channels(),
        env_channel_value,
        |service, account| {
            secret_store
                .read_keyring_secret(service, account)
                .ok()
                .flatten()
        },
    )
    .is_some()
}

fn format_model_provider(provider: Option<ModelProvider>) -> String {
    provider
        .map(|value| value.as_str().to_string())
        .unwrap_or_else(|| t!("cli.common.unset").into_owned())
}

fn normalize_model_capabilities(capabilities: Vec<String>) -> Vec<String> {
    let mut normalized = Vec::new();
    for capability in capabilities {
        let trimmed = capability.trim();
        if !trimmed.is_empty() && !normalized.iter().any(|value| value == trimmed) {
            normalized.push(trimmed.to_string());
        }
    }
    normalized
}

fn format_model_capabilities(model: &ModelProfile) -> String {
    model
        .capabilities
        .as_ref()
        .filter(|capabilities| !capabilities.is_empty())
        .map(|capabilities| capabilities.join(", "))
        .unwrap_or_else(|| t!("cli.common.unset").into_owned())
}

pub fn handle_mcp_cli(action: McpCommand) -> Result<()> {
    let app_paths = DefaultAppPaths::new();
    let workspace_root = app_paths.workspace_root();

    match action {
        McpCommand::List => {
            let mut runtime = new_mcp_cli_runtime(workspace_root.clone())?;
            let servers = runtime.list_mcp_servers()?;

            println!(
                "{}",
                t!(
                    "cli.mcp.user_config",
                    path = user_mcp_config_path().display().to_string()
                )
            );
            println!(
                "{}",
                t!(
                    "cli.mcp.workspace_config",
                    path = workspace_mcp_config_path(&workspace_root)
                        .display()
                        .to_string()
                )
            );

            if servers.is_empty() {
                print!("{}", t!("cli.mcp.empty"));
                println!("{}", t!("cli.mcp.empty_hint"));
                return Ok(());
            }

            println!("{}", t!("cli.mcp.servers_header"));
            for server in servers {
                println!(
                    "{}",
                    t!(
                        "cli.mcp.server_entry",
                        name = server.name,
                        display = server.display_name,
                        state = server.state.label(),
                        capabilities = server.capability_summary(),
                        transport = server.transport_summary(),
                    )
                );
            }
        }
        McpCommand::Show => {
            let loaded = load_mcp_config(&workspace_root)?;

            println!(
                "{}",
                t!(
                    "cli.mcp.user_config",
                    path = loaded.user_path.display().to_string()
                )
            );
            println!(
                "{}",
                t!(
                    "cli.mcp.workspace_config",
                    path = loaded.workspace_path.display().to_string()
                )
            );
            println!();
            println!(
                "{}",
                t!("cli.mcp.server_count", count = loaded.config.servers.len())
            );
            println!();
            println!("{}", t!("cli.mcp.config_header"));
            println!("{}", serde_json::to_string_pretty(&loaded.config)?);
        }
        McpCommand::Init { force } => {
            let path = user_mcp_config_path();

            save_mcp_config(&path, &example_github_mcp_config(), force)?;
            println!(
                "{}",
                t!("cli.mcp.init_created", path = path.display().to_string())
            );
            println!("{}", t!("cli.mcp.init_hint"));
        }
        McpCommand::Enable { name } => {
            let path = set_server_enabled(&workspace_root, &name, true)?;
            println!(
                "{}",
                t!(
                    "cli.mcp.enabled",
                    name = name,
                    path = path.display().to_string()
                )
            );
        }
        McpCommand::Disable { name } => {
            let path = set_server_enabled(&workspace_root, &name, false)?;
            println!(
                "{}",
                t!(
                    "cli.mcp.disabled",
                    name = name,
                    path = path.display().to_string()
                )
            );
        }
        McpCommand::Inspect { name } => {
            let mut runtime = new_mcp_cli_runtime(workspace_root)?;
            let inspection = runtime.inspect_mcp_server(&name)?;
            println!("server: {}", inspection.name);
            println!("display: {}", inspection.display_name);
            println!("protocol_version: {}", inspection.protocol_version);
            println!("peer.name: {}", inspection.server_name);
            println!("peer.version: {}", inspection.server_version);
            if let Some(title) = inspection.server_title {
                println!("peer.title: {}", title);
            }
            if let Some(description) = inspection.server_description {
                println!("peer.description: {}", description);
            }
            if let Some(instructions) = inspection.instructions {
                println!("instructions:\n{}", instructions);
            }
            println!("capabilities:");
            println!("  tools: {}", yes_no(inspection.supports_tools));
            println!("  resources: {}", yes_no(inspection.supports_resources));
            println!("  prompts: {}", yes_no(inspection.supports_prompts));
            println!("  logging: {}", yes_no(inspection.supports_logging));
            println!("  completions: {}", yes_no(inspection.supports_completions));
            println!(
                "  tools.listChanged: {}",
                yes_no(inspection.tools_list_changed)
            );
            println!(
                "  resources.listChanged: {}",
                yes_no(inspection.resources_list_changed)
            );
            println!(
                "  prompts.listChanged: {}",
                yes_no(inspection.prompts_list_changed)
            );
            println!("counts:");
            println!("  tools: {}", inspection.tools_count);
            println!("  resources: {}", inspection.resources_count);
            println!(
                "  resource_templates: {}",
                inspection.resource_templates_count
            );
            println!("  prompts: {}", inspection.prompts_count);
        }
        McpCommand::Tools { name } => {
            let mut runtime = new_mcp_cli_runtime(workspace_root)?;
            let tools = runtime.list_mcp_tools(&name)?;
            if tools.is_empty() {
                println!("{}", t!("cli.mcp.tools_empty", name = name));
            } else {
                println!("{}", t!("cli.mcp.tools_header", count = tools.len()));
                for tool in tools {
                    println!("  - {}", tool.name);
                    if let Some(title) = tool.title {
                        println!("    title: {}", title);
                    }
                    if let Some(description) = tool.description {
                        println!("    description: {}", description);
                    }
                }
            }
        }
        McpCommand::CallTool {
            name,
            tool,
            args_json,
        } => {
            let mut runtime = new_mcp_cli_runtime(workspace_root)?;
            let value = runtime.call_mcp_tool_value(&name, &tool, args_json.as_deref())?;
            println!("{}", serde_json::to_string_pretty(&value)?);
        }
        McpCommand::Resources { name } => {
            let mut runtime = new_mcp_cli_runtime(workspace_root)?;
            let resources = runtime.list_mcp_resources(&name)?;
            if resources.is_empty() {
                println!("{}", t!("cli.mcp.resources_empty", name = name));
            } else {
                println!(
                    "{}",
                    t!("cli.mcp.resources_header", count = resources.len())
                );
                for resource in resources {
                    println!("  - {}", resource.uri);
                    println!("    name: {}", resource.name);
                    if let Some(title) = resource.title {
                        println!("    title: {}", title);
                    }
                    if let Some(description) = resource.description {
                        println!("    description: {}", description);
                    }
                    if let Some(mime) = resource.mime_type {
                        println!("    mime: {}", mime);
                    }
                    if let Some(size) = resource.size {
                        println!("    size: {}", size);
                    }
                }
            }
        }
        McpCommand::Prompts { name } => {
            let mut runtime = new_mcp_cli_runtime(workspace_root)?;
            let prompts = runtime.list_mcp_prompts(&name)?;
            if prompts.is_empty() {
                println!("{}", t!("cli.mcp.prompts_empty", name = name));
            } else {
                println!("{}", t!("cli.mcp.prompts_header", count = prompts.len()));
                for prompt in prompts {
                    println!("  - {}", prompt.name);
                    if let Some(title) = prompt.title {
                        println!("    title: {}", title);
                    }
                    if let Some(description) = prompt.description {
                        println!("    description: {}", description);
                    }
                    if !prompt.arguments.is_empty() {
                        println!("    arguments:");
                        for arg in prompt.arguments {
                            println!(
                                "      - {}{}",
                                arg.name,
                                if arg.required { " (required)" } else { "" }
                            );
                            if let Some(title) = arg.title {
                                println!("        title: {}", title);
                            }
                            if let Some(description) = arg.description {
                                println!("        description: {}", description);
                            }
                        }
                    }
                }
            }
        }
        McpCommand::ReadResource { name, uri } => {
            let mut runtime = new_mcp_cli_runtime(workspace_root)?;
            let value = runtime.read_mcp_resource_value(&name, &uri)?;
            println!("{}", serde_json::to_string_pretty(&value)?);
        }
        McpCommand::GetPrompt {
            name,
            prompt,
            args_json,
        } => {
            let mut runtime = new_mcp_cli_runtime(workspace_root)?;
            let value = runtime.get_mcp_prompt_value(&name, &prompt, args_json.as_deref())?;
            println!("{}", serde_json::to_string_pretty(&value)?);
        }
    }

    Ok(())
}

pub fn handle_extension_cli(action: ExtensionCommand) -> Result<()> {
    let app_paths = DefaultAppPaths::new();
    let workspace_root = app_paths.workspace_root();

    match action {
        ExtensionCommand::List => {
            let mut runtime = new_extension_cli_runtime(workspace_root)?;
            let extensions = runtime.list_extensions()?;

            if extensions.is_empty() {
                println!("{}", t!("cli.extensions.none_installed"));
                return Ok(());
            }

            println!("{}", t!("cli.extensions.list_header"));
            for extension in extensions {
                println!(
                    "  - {}\n    id: {}\n    version: {}\n    installed_at: {}",
                    extension.display_name,
                    extension.id,
                    extension.version,
                    extension.installed_at_unix_ms,
                );
                if let Some(description) = extension.description {
                    println!("    description: {}", description);
                }
                if let Some(author) = extension.author {
                    println!("    author: {}", author.name);
                }
                if let Some(main) = extension.main {
                    println!("    main: {}", main);
                }
                if let Some(file_name) = extension.archive_file_name {
                    println!("    source: {}", file_name);
                }
            }
        }
        ExtensionCommand::Import { archive } => {
            let archive_path = PathBuf::from(&archive);
            let archive_bytes = fs::read(&archive_path).with_context(|| {
                t!(
                    "cli.extensions.import_read_failed",
                    path = archive_path.display().to_string()
                )
                .into_owned()
            })?;
            let file_name = archive_path
                .file_name()
                .and_then(|value| value.to_str())
                .map(|value| value.to_string());

            let mut runtime = new_extension_cli_runtime(workspace_root)?;
            let extension =
                runtime.import_extension_archive(&archive_bytes, file_name.as_deref())?;
            println!(
                "{}",
                t!("cli.extensions.imported", name = extension.display_name)
            );
            println!("id: {}", extension.id);
            println!("version: {}", extension.version);
            if let Some(description) = extension.description {
                println!("description: {}", description);
            }
            if let Some(main) = extension.main {
                println!("main: {}", main);
            }
        }
        ExtensionCommand::Remove { id } => {
            let trimmed_id = id.trim();
            if trimmed_id.is_empty() {
                return Err(anyhow!("{}", t!("cli.extensions.id_empty")));
            }

            let mut runtime = new_extension_cli_runtime(workspace_root)?;
            runtime.delete_extension(trimmed_id)?;
            println!("{}", t!("cli.extensions.removed", id = trimmed_id));
        }
        ExtensionCommand::Install {
            name,
            marketplace,
            review_acknowledged,
        } => {
            let trimmed = name.trim();
            if trimmed.is_empty() {
                return Err(anyhow!("{}", t!("cli.extensions.name_empty")));
            }

            let mut runtime = new_extension_cli_runtime(workspace_root)?;
            let result = runtime.install_marketplace_extension(
                trimmed,
                marketplace.as_deref(),
                review_acknowledged,
            )?;
            match result.status.as_str() {
                "installed" => {
                    let extension = result.extension.context("missing installed extension")?;
                    println!(
                        "{}",
                        t!("cli.marketplace.installed", name = extension.display_name)
                    );
                    println!("id: {}", extension.id);
                    println!("version: {}", extension.version);
                }
                "review-required" => {
                    println!(
                        "{}",
                        t!(
                            "cli.marketplace.review_required",
                            id = result.extension_id.unwrap_or_default(),
                            status = result.review_status.unwrap_or_default()
                        )
                    );
                }
                other => return Err(anyhow!("unexpected install status: {}", other)),
            }
        }
        ExtensionCommand::Update {
            name,
            review_acknowledged,
        } => {
            let trimmed = name.trim();
            if trimmed.is_empty() {
                return Err(anyhow!("{}", t!("cli.extensions.name_empty")));
            }

            let mut runtime = new_extension_cli_runtime(workspace_root)?;
            let extensions = runtime.list_extensions()?;
            let id = resolve_installed_extension_id(&extensions, trimmed)?;
            let result = runtime.update_extension(&id, review_acknowledged)?;
            match result.status.as_str() {
                "updated" => {
                    let extension = result.extension.context("missing updated extension")?;
                    println!(
                        "{}",
                        t!("cli.marketplace.updated", name = extension.display_name)
                    );
                    println!("id: {}", extension.id);
                    println!("version: {}", extension.version);
                }
                "up-to-date" => {
                    println!("{}", t!("cli.marketplace.up_to_date", id = id));
                }
                "review-required" => {
                    println!(
                        "{}",
                        t!(
                            "cli.marketplace.review_required",
                            id = result.extension_id.unwrap_or_default(),
                            status = result.review_status.unwrap_or_default()
                        )
                    );
                }
                other => return Err(anyhow!("unexpected update status: {}", other)),
            }
        }
        ExtensionCommand::Marketplace { action } => {
            return handle_extension_marketplace_cli(action);
        }
    }

    Ok(())
}

pub fn handle_extension_marketplace_cli(action: ExtensionMarketplaceCommand) -> Result<()> {
    let app_paths = DefaultAppPaths::new();
    let workspace_root = app_paths.workspace_root();

    match action {
        ExtensionMarketplaceCommand::Add { locator, git_ref } => {
            let trimmed = locator.trim();
            if trimmed.is_empty() {
                return Err(anyhow!("{}", t!("cli.marketplace.locator_empty")));
            }
            // Local paths resolve client-side: the daemon's cwd differs from the user's.
            let resolved = if trimmed.contains("://") || trimmed.starts_with("git@") {
                trimmed.to_string()
            } else {
                std::fs::canonicalize(trimmed)
                    .with_context(|| t!("cli.marketplace.locator_missing").into_owned())?
                    .to_string_lossy()
                    .into_owned()
            };

            let mut runtime = new_extension_cli_runtime(workspace_root)?;
            let source = runtime.add_marketplace_source(&resolved, git_ref.as_deref())?;
            println!(
                "{}",
                t!("cli.marketplace.source_added", name = source.display_name)
            );
            println!("id: {}", source.id);
            println!("kind: {}", source.kind);
        }
        ExtensionMarketplaceCommand::List => {
            let mut runtime = new_extension_cli_runtime(workspace_root)?;
            let sources = runtime.list_marketplace_sources()?;

            println!("{}", t!("cli.marketplace.sources_header"));
            for source in sources {
                println!(
                    "  - {}\n    id: {}\n    kind: {}\n    locator: {}",
                    source.display_name, source.name, source.kind, source.locator,
                );
                if let Some(git_ref) = source.git_ref {
                    println!("    ref: {}", git_ref);
                }
            }
        }
        ExtensionMarketplaceCommand::Remove { name } => {
            let trimmed = name.trim();
            if trimmed.is_empty() {
                return Err(anyhow!("{}", t!("cli.marketplace.name_empty")));
            }

            let mut runtime = new_extension_cli_runtime(workspace_root)?;
            let removed = runtime.remove_marketplace_source(trimmed)?;
            println!(
                "{}",
                t!(
                    "cli.marketplace.source_removed",
                    name = removed.display_name
                )
            );
        }
    }

    Ok(())
}

/// Resolve an `extension update <name>` argument to a composite install id:
/// exact id match first, then the `<sourceId>/<name>` suffix form.
fn resolve_installed_extension_id(
    extensions: &[crate::host_protocol::CliExtensionEntry],
    name: &str,
) -> Result<String> {
    if let Some(entry) = extensions.iter().find(|entry| entry.id == name) {
        return Ok(entry.id.clone());
    }
    let suffix = format!("/{name}");
    let matches = extensions
        .iter()
        .filter(|entry| entry.id.ends_with(&suffix))
        .map(|entry| entry.id.clone())
        .collect::<Vec<_>>();
    match matches.as_slice() {
        [only] => Ok(only.clone()),
        [] => Err(anyhow!("{}", t!("cli.extensions.not_installed", id = name))),
        many => Err(anyhow!(
            "{}",
            t!(
                "cli.extensions.ambiguous",
                id = name,
                matches = many.join(", ")
            )
        )),
    }
}

fn new_mcp_cli_runtime(workspace_root: PathBuf) -> Result<DaemonRuntime> {
    DaemonRuntime::new_host_only(workspace_root)
}

fn new_extension_cli_runtime(workspace_root: PathBuf) -> Result<DaemonRuntime> {
    new_mcp_cli_runtime(workspace_root)
}

fn yes_no(flag: bool) -> &'static str {
    if flag { "yes" } else { "no" }
}

fn common_key_status(saved: bool) -> String {
    if saved {
        t!("cli.common.saved").into_owned()
    } else {
        t!("cli.common.unsaved").into_owned()
    }
}

fn handle_key_cli(action: KeyCommand, secret_store: &KeyringSecretStore) -> Result<()> {
    match action {
        KeyCommand::Set { value } => {
            let key = match value {
                Some(v) => v,
                None => rpassword::prompt_password(&t!("cli.key.prompt_api_key"))
                    .context(t!("cli.key.api_key_read_failed").into_owned())?,
            };

            if key.trim().is_empty() {
                return Err(anyhow!("{}", t!("cli.key.api_key_empty")));
            }

            secret_store.save_global_api_key(key.trim())?;
            println!("{}", t!("cli.key.saved", env_var = ENV_API_KEY));
        }
        KeyCommand::Remove => {
            secret_store.remove_global_api_key()?;
            println!("{}", t!("cli.key.removed"));
        }
        KeyCommand::Status => {
            let env_set = env::var(ENV_API_KEY)
                .ok()
                .map(|s| !s.trim().is_empty())
                .unwrap_or(false);

            let keyring_set = secret_store
                .load_global_api_key()
                .map(|v| v.is_some())
                .unwrap_or(false);

            println!(
                "{}",
                t!(
                    "cli.key.env_var",
                    name = ENV_API_KEY,
                    status = if env_set {
                        t!("cli.common.set").into_owned()
                    } else {
                        t!("cli.common.unset_env").into_owned()
                    }
                )
            );
            println!(
                "{}",
                t!("cli.key.keyring", status = common_key_status(keyring_set))
            );
            println!("{}", t!("cli.key.priority", env_var = ENV_API_KEY));
        }
    }

    Ok(())
}

pub fn load_or_default_config() -> AppConfig {
    JsonConfigStore
        .load()
        .unwrap_or_else(|_| AppConfig::default())
}

#[cfg(test)]
mod tests {
    use super::parse_model_reasoning_effort;

    #[test]
    fn parse_model_reasoning_effort_accepts_v1_tokens_verbatim() {
        assert_eq!(
            parse_model_reasoning_effort(Some("minimal".to_string())).expect("parse"),
            Some("minimal".to_string())
        );
        assert_eq!(
            parse_model_reasoning_effort(Some("max".to_string())).expect("parse"),
            Some("max".to_string())
        );
        assert_eq!(parse_model_reasoning_effort(None).expect("parse"), None);
        assert!(parse_model_reasoning_effort(Some("extreme".to_string())).is_err());
    }
}
