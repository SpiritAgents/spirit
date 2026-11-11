use anyhow::{Context, Result, anyhow};
use rust_i18n::t;
use std::fs;
use std::{env, path::PathBuf};

use crate::{
    adapters::{DefaultAppPaths, JsonConfigStore},
    daemon::{DaemonRuntime, config::call_config_rpc},
    mcp::{example_github_mcp_config, user_mcp_config_path, workspace_mcp_config_path},
    model_registry::{AppConfig, ModelProfile, ModelRef},
    ports::{AppPaths, ConfigStore},
};

const ENV_API_KEY: &str = "SPIRIT_API_KEY";

use crate::daemon::params::compact_json;

pub struct ModelAddCommand {
    pub name: String,
    pub api_base: Option<String>,
    /// Preset id from the presets manifest (`provider_presets`), or `custom`.
    pub provider: Option<String>,
    pub transport_kind: Option<String>,
    pub reasoning_effort: Option<String>,
    pub effort: Option<String>,
    pub capabilities: Vec<String>,
    pub context_length: Option<u64>,
    pub key: Option<String>,
    pub azure_resource_name: Option<String>,
    pub provider_site: Option<String>,
    pub billing_plan: Option<String>,
    /// `{workspaceId}` template value (e.g. Alibaba MaaS business space id).
    pub workspace_id: Option<String>,
    pub vertex_project: Option<String>,
    pub vertex_location: Option<String>,
    pub vertex_client_email: Option<String>,
    pub vertex_private_key: Option<String>,
    pub aws_region: Option<String>,
    pub aws_access_key_id: Option<String>,
    pub aws_secret_access_key: Option<String>,
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
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RemoteCommand {
    Enable {
        host: Option<String>,
        port: Option<u16>,
    },
    Disable,
    Status,
    Config {
        host: Option<String>,
        port: Option<u16>,
    },
    Pair {
        name: Option<String>,
        origin: Option<String>,
    },
    List,
    Rename {
        device_id: String,
        name: String,
    },
    Revoke {
        device_id: String,
    },
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
    let mut cfg = config_store.load()?;

    match action {
        ModelCommand::List => {
            println!(
                "{}",
                t!("cli.model.current", model = cfg.active_model_name())
            );
            println!("{}", t!("cli.model.list_header"));
            for model in cfg.flatten_models() {
                let key_saved = model_key_resolves(&model);
                let (effort_label, effort) = model_effort_display(&model);
                println!(
                    "{}",
                    t!(
                        "cli.model.list_entry",
                        name = model.name,
                        provider_id = model.provider_id,
                        api_base = model.api_base,
                        effort_label = effort_label,
                        effort = effort,
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
                effort,
                capabilities,
                context_length,
                key,
                azure_resource_name,
                provider_site,
                billing_plan,
                workspace_id,
                vertex_project,
                vertex_location,
                vertex_client_email,
                vertex_private_key,
                aws_region,
                aws_access_key_id,
                aws_secret_access_key,
            } = *add;
            if cfg.has_model_name(&name) {
                println!("{}", t!("cli.model.already_exists", name = name));
            } else {
                let workspace_root = env::current_dir()?;
                let request = compact_json(serde_json::json!({
                    "name": name,
                    "apiBase": api_base.unwrap_or_default(),
                    "apiKey": key.unwrap_or_default(),
                    "provider": provider,
                    "transportKind": transport_kind,
                    "reasoningEffort": reasoning_effort,
                    "effort": effort,
                    "capabilities": capabilities,
                    "contextLength": context_length,
                    "azureResourceName": azure_resource_name,
                    "siteId": provider_site,
                    "billingPlanId": billing_plan,
                    "workspaceId": workspace_id,
                    "vertexProject": vertex_project,
                    "vertexLocation": vertex_location,
                    "vertexClientEmail": vertex_client_email,
                    "vertexPrivateKey": vertex_private_key,
                    "awsRegion": aws_region,
                    "accessKeyId": aws_access_key_id,
                    "secretAccessKey": aws_secret_access_key,
                }));
                let updated = call_config_rpc(
                    &workspace_root,
                    "host.addModel",
                    serde_json::json!({
                        "workspaceRoot": workspace_root.to_string_lossy(),
                        "request": request
                    }),
                )?;
                cfg = serde_json::from_value(updated)?;
                let entry_id = cfg.active_model.provider_id.clone();
                let model_ref = ModelRef {
                    provider_id: entry_id.clone(),
                    name: name.clone(),
                };
                let api_base = cfg
                    .resolve_model_profile(&model_ref)
                    .map(|profile| profile.api_base.clone())
                    .unwrap_or_default();
                println!("{}", t!("cli.model.added_and_active", name = name));
                println!("api_base: {}", api_base);
                println!("provider: {}", entry_id);
                if effort.is_some() {
                    println!(
                        "effort: {}",
                        effort
                            .as_deref()
                            .map(str::to_string)
                            .unwrap_or_else(|| t!("cli.common.unset").into_owned())
                    );
                } else {
                    println!(
                        "reasoning_effort: {}",
                        reasoning_effort
                            .as_deref()
                            .map(str::to_string)
                            .unwrap_or_else(|| t!("cli.common.unset").into_owned())
                    );
                }
                println!(
                    "capabilities: {}",
                    cfg.resolve_model_profile(&model_ref)
                        .map(|profile| format_model_capabilities(&profile))
                        .unwrap_or_else(|| t!("cli.common.unset").into_owned())
                );
            }
        }
        ModelCommand::Remove { name } => {
            let model_ref = cfg
                .parse_model_ref_selector(&name)
                .map_err(|err| anyhow!(err))?;
            if cfg.resolve_model_profile(&model_ref).is_none() {
                println!("{}", t!("cli.model.not_found_name", name = name));
            } else {
                let workspace_root = env::current_dir()?;
                call_config_rpc(
                    &workspace_root,
                    "host.removeModel",
                    serde_json::json!({
                        "workspaceRoot": workspace_root.to_string_lossy(),
                        "request": { "ref": model_ref },
                    }),
                )?;
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
    let app_paths = DefaultAppPaths::new();
    let cfg = config_store.load()?;

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
                let key_saved = model_key_resolves(&model);
                let (effort_label, effort) = model_effort_display(&model);
                println!(
                    "{}",
                    t!(
                        "cli.model.list_entry",
                        name = model.name,
                        provider_id = model.provider_id,
                        api_base = model.api_base,
                        effort_label = effort_label,
                        effort = effort,
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
            println!(
                "{}",
                t!("cli.config.api_key_priority", env_var = ENV_API_KEY)
            );
        }
        ConfigCommand::SetBase { url } => {
            update_config_cli(&cfg, serde_json::json!({ "apiBase": url }))?;
            println!("{}", t!("cli.config.api_base_updated", url = url));
        }
        ConfigCommand::SetImageModel { name } => {
            let model_ref = cfg
                .parse_model_ref_selector(&name)
                .map_err(|err| anyhow!(err))?;
            let Some(_profile) = cfg.resolve_model_profile(&model_ref) else {
                return Err(anyhow!(
                    "{}",
                    crate::cli_bootstrap::model_not_found_message(&name, &cfg)
                ));
            };
            update_config_cli(
                &cfg,
                serde_json::json!({ "imageGenerationModel": model_ref }),
            )?;
            println!("{}", t!("cli.config.image_model_set", name = name));
        }
        ConfigCommand::ClearImageModel => {
            update_config_cli(
                &cfg,
                serde_json::json!({ "imageGenerationModel": ModelRef::empty() }),
            )?;
            println!("{}", t!("cli.config.image_model_cleared"));
        }
        ConfigCommand::SetVideoModel { name } => {
            let model_ref = cfg
                .parse_model_ref_selector(&name)
                .map_err(|err| anyhow!(err))?;
            let Some(_profile) = cfg.resolve_model_profile(&model_ref) else {
                return Err(anyhow!(
                    "{}",
                    crate::cli_bootstrap::model_not_found_message(&name, &cfg)
                ));
            };
            update_config_cli(
                &cfg,
                serde_json::json!({ "videoGenerationModel": model_ref }),
            )?;
            println!("{}", t!("cli.config.video_model_set", name = name));
        }
        ConfigCommand::ClearVideoModel => {
            update_config_cli(
                &cfg,
                serde_json::json!({ "videoGenerationModel": ModelRef::empty() }),
            )?;
            println!("{}", t!("cli.config.video_model_cleared"));
        }
    }

    Ok(())
}

fn update_config_cli(config: &AppConfig, updates: serde_json::Value) -> Result<AppConfig> {
    let workspace_root = env::current_dir()?;
    let mut request = serde_json::json!({
        "activeModel": config.active_model,
        "apiBase": config
            .active_model_profile()
            .map(|profile| profile.api_base)
            .unwrap_or_default(),
    });
    if let (Some(request), Some(updates)) = (request.as_object_mut(), updates.as_object()) {
        request.extend(updates.clone());
    }
    let value = call_config_rpc(
        &workspace_root,
        "host.updateConfig",
        serde_json::json!({
            "workspaceRoot": workspace_root.to_string_lossy(),
            "request": request,
        }),
    )?;
    Ok(serde_json::from_value(value)?)
}

/// `model add --provider` names a preset id from the presets manifest (or `custom`).
fn model_effort_display(model: &ModelProfile) -> (&'static str, String) {
    let output = model.effort_semantics.as_deref() == Some("output");
    let value = if output {
        model.effort.as_deref()
    } else {
        model.reasoning_effort.as_deref()
    }
    .map(str::to_string)
    .unwrap_or_else(|| t!("cli.common.unset").into_owned());
    (if output { "effort" } else { "reasoning_effort" }, value)
}

/// Whether any credential channel (flat keys, env, keyring references, or the internal
/// `provider::{id}` account) resolves to a key for this model's provider entry.
fn model_key_resolves(model: &ModelProfile) -> bool {
    env::current_dir()
        .ok()
        .and_then(|workspace_root| {
            let provider = serde_json::to_value(model.key_channels())
                .map(compact_json)
                .unwrap_or(serde_json::Value::Null);
            call_config_rpc(
                &workspace_root,
                "host.hasProviderCredential",
                serde_json::json!({ "provider": provider }),
            )
            .ok()
        })
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
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
            let mut runtime = new_mcp_cli_runtime(workspace_root.clone())?;
            let loaded = runtime.read_mcp_config()?;

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
            let mut runtime = new_mcp_cli_runtime(workspace_root)?;
            let path = runtime
                .initialize_mcp_config(force, serde_json::to_value(example_github_mcp_config())?)?;
            println!(
                "{}",
                t!("cli.mcp.init_created", path = path.display().to_string())
            );
            println!("{}", t!("cli.mcp.init_hint"));
        }
        McpCommand::Enable { name } => {
            let mut runtime = new_mcp_cli_runtime(workspace_root)?;
            let path = runtime.set_mcp_server_enabled(&name, true)?;
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
            let mut runtime = new_mcp_cli_runtime(workspace_root)?;
            let path = runtime.set_mcp_server_enabled(&name, false)?;
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

pub fn load_or_default_config() -> AppConfig {
    JsonConfigStore
        .load()
        .unwrap_or_else(|_| AppConfig::default())
}
