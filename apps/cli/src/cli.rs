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
        model_add_preset_api_base_by_provider, model_add_siliconflow_site_api_base,
        model_add_stepfun_api_base, model_add_tencent_tokenhub_site_api_base,
        validate_azure_resource_name,
    },
    model_registry::{
        AppConfig, DEFAULT_API_BASE, ModelEntry, ModelProfile, ModelProvider, ModelRef,
        ModelTransportKind, ProviderGroupConnectDraft, default_preset_provider_group_id,
        model_refs_equal, save_group_api_key,
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
                let key_saved =
                    crate::model_registry::load_group_api_key_from_keyring(&model.group_id)
                        .map(|value| !value.trim().is_empty())
                        .unwrap_or_else(|_| {
                            secret_store.has_model_api_key(&model.name).unwrap_or(false)
                        });
                println!(
                    "{}",
                    t!(
                        "cli.model.list_entry",
                        name = model.name,
                        group_id = model.group_id,
                        api_base = model.api_base,
                        provider = format_model_provider(model.provider),
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
                if provider == Some(ModelProvider::Azure)
                    && transport_kind != ModelTransportKind::OpenResponses
                {
                    return Err(anyhow!("{}", t!("cli.model.error.azure_transport_only")));
                }
                let reasoning_effort = parse_model_reasoning_effort(
                    &name,
                    reasoning_effort,
                    provider,
                    transport_kind,
                )?;
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
                        && let Some(preset) = model_add_preset_api_base_by_provider(provider)
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
                                    model_add_preset_api_base_by_provider(provider)
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

                let group_id = default_preset_provider_group_id(resolved_provider);
                let connect = ProviderGroupConnectDraft {
                    transport_kind: (transport_kind == ModelTransportKind::Anthropic
                        || transport_kind == ModelTransportKind::OpenResponses
                        || transport_kind == ModelTransportKind::Bedrock)
                        .then(|| transport_kind.as_str().to_string()),
                    provider_site: provider_site
                        .as_deref()
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(ToOwned::to_owned),
                    alibaba_workspace_id: alibaba_workspace_id
                        .as_deref()
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(ToOwned::to_owned),
                    azure_resource_name,
                    ..ProviderGroupConnectDraft::default()
                };
                let entry = ModelEntry {
                    name: name.clone(),
                    reasoning_effort: reasoning_effort.clone(),
                    reasoning_mode: None,
                    thinking_enabled: None,
                    supported_reasoning_efforts: None,
                    capabilities: if capabilities.is_empty() {
                        None
                    } else {
                        Some(capabilities.clone())
                    },
                    context_length,
                    supports_thinking_type: None,
                    supports_thinking_switch: None,
                };
                cfg.add_model_to_group(
                    &group_id,
                    resolved_provider,
                    api_base.clone(),
                    connect,
                    entry,
                );
                let model_ref = ModelRef {
                    group_id: group_id.clone(),
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
                    save_group_api_key(&group_id, &key_value)?;
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
                        group_id,
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
                let _ = secret_store.remove_model_api_key(&model_ref.name);
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
                let key_saved =
                    crate::model_registry::load_group_api_key_from_keyring(&model.group_id)
                        .map(|value| !value.trim().is_empty())
                        .unwrap_or_else(|_| {
                            secret_store.has_model_api_key(&model.name).unwrap_or(false)
                        });
                println!(
                    "{}",
                    t!(
                        "cli.model.list_entry",
                        name = model.name,
                        group_id = model.group_id,
                        api_base = model.api_base,
                        provider = format_model_provider(model.provider),
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
            if let Some(group) = cfg.active_provider_group_mut() {
                group.api_base = url.clone();
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
        None => match provider {
            Some(ModelProvider::Anthropic) => ModelTransportKind::Anthropic,
            Some(ModelProvider::AmazonBedrock) => ModelTransportKind::Bedrock,
            Some(ModelProvider::Azure | ModelProvider::Openai | ModelProvider::HuggingFace) => {
                ModelTransportKind::OpenResponses
            }
            _ => ModelTransportKind::OpenAiCompatible,
        },
    };

    match (provider, parsed) {
        (
            Some(ModelProvider::Anthropic),
            ModelTransportKind::OpenAiCompatible | ModelTransportKind::OpenResponses,
        ) => Err(anyhow!(
            "{}",
            t!("cli.model.error.transport.anthropic_invalid")
        )),
        (
            Some(
                ModelProvider::Deepseek
                | ModelProvider::Xai
                | ModelProvider::Minimax
                | ModelProvider::KimiCode
                | ModelProvider::Meituan
                | ModelProvider::Mistral
                | ModelProvider::Cohere
                | ModelProvider::TogetherAi
                | ModelProvider::Groq
                | ModelProvider::Deepinfra
                | ModelProvider::Xiaomi
                | ModelProvider::Alibaba
                | ModelProvider::Stepfun
                | ModelProvider::Moonshot
                | ModelProvider::ZAi
                | ModelProvider::ZhipuAi,
            ),
            ModelTransportKind::Anthropic
            | ModelTransportKind::OpenResponses
            | ModelTransportKind::Bedrock,
        ) => Err(anyhow!(
            "{}",
            t!("cli.model.error.transport.provider_openai_compatible_only")
        )),
        (
            Some(ModelProvider::Siliconflow),
            ModelTransportKind::OpenResponses | ModelTransportKind::Bedrock,
        ) => Err(anyhow!(
            "{}",
            t!("cli.model.error.transport.siliconflow_invalid")
        )),
        (Some(ModelProvider::Openai), ModelTransportKind::Anthropic) => Err(anyhow!(
            "{}",
            t!("cli.model.error.transport.openai_no_anthropic")
        )),
        (Some(ModelProvider::Openai), ModelTransportKind::OpenAiCompatible) => Err(anyhow!(
            "{}",
            t!("cli.model.error.transport.openai_open_responses_only")
        )),
        (
            Some(ModelProvider::Google),
            ModelTransportKind::OpenResponses | ModelTransportKind::Anthropic,
        ) => Err(anyhow!(
            "{}",
            t!("cli.model.error.transport.google_openai_compatible_only")
        )),
        (Some(ModelProvider::AmazonBedrock), transport_kind)
            if transport_kind != ModelTransportKind::Bedrock =>
        {
            Err(anyhow!("{}", t!("cli.model.error.transport.bedrock_only")))
        }
        (Some(ModelProvider::Azure), transport_kind)
            if transport_kind != ModelTransportKind::OpenResponses =>
        {
            Err(anyhow!("{}", t!("cli.model.error.azure_transport_only")))
        }
        (Some(ModelProvider::HuggingFace), transport_kind)
            if transport_kind != ModelTransportKind::OpenResponses =>
        {
            Err(anyhow!(
                "{}",
                t!("cli.model.error.transport.hugging_face_open_responses_only")
            ))
        }
        (
            Some(
                ModelProvider::Anthropic
                | ModelProvider::Openai
                | ModelProvider::Google
                | ModelProvider::VercelAiGateway
                | ModelProvider::Openrouter
                | ModelProvider::FireworksAi
                | ModelProvider::HuggingFace
                | ModelProvider::Baseten
                | ModelProvider::Volcengine
                | ModelProvider::Byteplus
                | ModelProvider::Custom
                | ModelProvider::CloudflareAiGateway
                | ModelProvider::TencentTokenhub,
            ),
            ModelTransportKind::Bedrock,
        ) => Err(anyhow!(
            "{}",
            t!("cli.model.error.transport.bedrock_exclusive")
        )),
        (None, ModelTransportKind::Anthropic) => Err(anyhow!(
            "{}",
            t!("cli.model.error.transport.anthropic_requires_provider")
        )),
        (None, ModelTransportKind::OpenResponses) => Err(anyhow!(
            "{}",
            t!("cli.model.error.transport.open_responses_requires_provider")
        )),
        _ => Ok(parsed),
    }
}

fn parse_model_reasoning_effort(
    model_name: &str,
    value: Option<String>,
    provider: Option<ModelProvider>,
    transport_kind: ModelTransportKind,
) -> Result<Option<String>> {
    let normalized = match normalize_choice_arg(value) {
        Some(reasoning_effort) => reasoning_effort.to_ascii_lowercase(),
        None => return Ok(None),
    };

    let allowed: &[&str] = match transport_kind {
        ModelTransportKind::Anthropic => &["default", "low", "medium", "high", "xhigh", "max"][..],
        ModelTransportKind::Bedrock
        | ModelTransportKind::OpenResponses
        | ModelTransportKind::OpenAiCompatible => match provider {
            Some(ModelProvider::Deepseek) if is_deepseek_v4_reasoning_model(model_name) => {
                &["default", "high", "max"]
            }
            Some(ModelProvider::Moonshot | ModelProvider::KimiCode) => {
                &["default", "minimal", "low", "medium", "high"]
            }
            _ => &["default", "none", "low", "medium", "high", "xhigh"],
        },
    };

    if allowed.iter().any(|candidate| *candidate == normalized) {
        return Ok(Some(normalized));
    }

    let expected = allowed.join("|");
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

fn is_deepseek_v4_reasoning_model(model_name: &str) -> bool {
    let normalized = model_name.trim().to_ascii_lowercase();
    normalized == "deepseek-v4-pro" || normalized == "deepseek-v4-flash"
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
        .explicit_capabilities()
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
    use super::{ModelProvider, ModelTransportKind, parse_model_reasoning_effort};

    #[test]
    fn parse_model_reasoning_effort_accepts_moonshot_style_for_kimi_code() {
        let effort = parse_model_reasoning_effort(
            "kimi-for-coding",
            Some("minimal".to_string()),
            Some(ModelProvider::KimiCode),
            ModelTransportKind::OpenAiCompatible,
        )
        .expect("parse reasoning effort");
        assert_eq!(effort, Some("minimal".to_string()));
    }
}
