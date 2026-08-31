pub mod adapters;
pub mod ask_questions;
pub mod bedrock_mantle;
pub mod chat_archive;
pub mod chat_store;
pub mod chat_timeline;
pub mod cli;
pub mod cli_bootstrap;
#[cfg(feature = "tui")]
pub mod conversation_select;
pub mod daemon;
pub mod fork;
#[cfg(feature = "tui")]
pub mod headless;
pub mod hooks;
pub mod hooks_types;
pub mod host_protocol;
pub mod host_runtime;
pub mod llm_types;
#[cfg(feature = "tui")]
pub mod locale;
pub mod logging;
pub mod mcp;
pub mod mcp_types;
pub mod model_catalog_display;
pub mod model_provider_presets;
pub mod model_registry;
pub mod openai_models_list;
pub mod permissions;
pub mod permissions_types;
pub mod plan;
pub mod ports;
#[cfg(feature = "tui")]
pub mod relative_time;
pub mod rewind;
pub mod rules;
pub mod runtime_handle;
pub mod runtime_sync;
pub mod serve;
pub mod session;
#[cfg(feature = "tui")]
pub mod shell;
pub mod skills;
pub mod subagent_display;
#[cfg(test)]
pub(crate) mod test_support;
pub mod tool_ui;
pub mod transport_config;
#[cfg(feature = "tui")]
pub mod tui;
#[cfg(feature = "tui")]
pub mod ui;
pub mod vertex_models_list;
pub mod view;
#[cfg(feature = "tui")]
mod word_wrap;

#[cfg(feature = "tui")]
rust_i18n::i18n!("locales", fallback = "en");

pub use cli::{
    ConfigCommand, ExtensionCommand, HookCommand, KeyCommand, McpCommand, ModelAddCommand,
    ModelCommand, PermissionCommand, handle_config_cli, handle_extension_cli, handle_hooks_cli,
    handle_mcp_cli, handle_model_cli, handle_permissions_cli,
};
pub use cli_bootstrap::{
    GlobalCliOptions, bootstrap_config, print_skills_stub, resolve_session_tui_mode,
};
#[cfg(feature = "tui")]
pub use headless::run_headless_prompt;
pub use serve::run_serve;
#[cfg(feature = "tui")]
pub use tui::TuiShell;
pub use view::{ChatMessage, MessageRole, ToolUiBlock, ToolUiPhase, TuiViewModel};
