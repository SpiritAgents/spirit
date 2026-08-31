use anyhow::{Context, Result, anyhow};
use rust_i18n::t;
use std::{
    collections::{BTreeMap, HashMap},
    env, fs,
    fs::OpenOptions,
    path::Path,
    process::Command,
    sync::Arc,
    time::{Instant, SystemTime, UNIX_EPOCH},
};

use crate::{
    adapters::{DefaultAppPaths, JsonChatRepository, JsonConfigStore, KeyringSecretStore},
    ask_questions::AskQuestionsResult,
    chat_store,
    chat_timeline::project_live_chat_from_llm_history,
    host_protocol::{CliExtensionCliUiHookEntry, CliExtensionEntry, CliExtensionSkillSlashEntry},
    host_runtime::{RuntimeEvent, ToolUiRequest, build_tool_result_block, format_tool_ui_message},
    locale, logging,
    mcp_types::{ManagedMcpServer, McpDiscoveredPrompt},
    model_registry::{DEFAULT_API_BASE, ModelProvider},
    openai_models_list,
    plan::{self, PlanMetadata},
    ports::{
        AppPaths, AssistantAuxArchiveEntry, AttachChatSessionOutcome, ChatArchive, ChatRepository,
        ChatSessionListItem, ConfigStore, SecretStore, SubagentSessionArchiveEntry,
        SubagentSessionSummary,
    },
    rewind::{self, ConversationMessageSnapshot, DesktopRewindCheckpointSnapshot},
    rules::RuleEntry,
    runtime_handle::RuntimeHandle,
    shell::{
        ask_questions, bottom_form, file_reference, manual_shell, slash,
        workspace_trust as workspace_trust_form,
    },
    skills::{self, SkillEntry, SkillPreview, SkillRootKind, SkillScope, SkillSource},
    subagent_display::parse_pending_subagent_status_text,
    ui::UiRuntimeState,
    view::{
        AssistantAuxData, BottomFormKind, ChatMessage, CliUiHookSlot, CliUiHookTokenRole,
        CliUiHookTokensView, CliUiHookVariant, CliUiHookView, InputSuggestion, InputSuggestionKind,
        MainInputMode, MessageRole, PendingAssistantAux, PendingSubagentApprovalView,
        SubagentApprovalInputView, SubagentSessionDetailView, SubagentSessionSummaryView,
        TuiViewModel,
    },
};

mod commands;
mod conversation;
mod forms;
mod hooks_actions;
mod host_actions;
mod image_paths;
mod inline;
mod input;
mod mcp_actions;
mod pickers;
mod projection;
mod runtime_events;
mod subagent;
mod workspace_trust;

pub use inline::{INLINE_BOOTSTRAP_HEIGHT, InlineBackend, InlineRecreate, leave_inline_prompt};

use conversation::ConversationUiState;
use forms::BottomFormUiState;
use input::InputState;
use subagent::SubagentUiState;

const VIEW_MODEL_MESSAGE_LIMIT: usize = 180;

pub struct TuiShell {
    input: InputState,
    messages: Vec<ChatMessage>,
    assistant_aux_by_message: HashMap<usize, AssistantAuxData>,
    persisted_standalone_pending_aux: Option<PendingAssistantAux>,
    persisted_standalone_pending_aux_anchor: Option<usize>,
    show_aux_details: bool,
    pending_assistant_msg_index: Option<usize>,
    thinking_spinner_index: u8,
    last_completed_assistant_msg_index: Option<usize>,
    last_mcp_status_revision: u64,
    slash: slash::SlashState,
    rewind_picker_active: bool,
    rewind_picker_index: usize,
    rewind_aux_details_before_picker: Option<bool>,
    fork_picker_active: bool,
    fork_picker_index: usize,
    session_display_name: Option<String>,
    session_title_source: Option<String>,
    model_picker_active: bool,
    model_picker_index: usize,
    model_display_titles: HashMap<String, String>,
    language_picker_active: bool,
    language_picker_index: usize,
    approval_picker_active: bool,
    approval_picker_index: usize,
    network_picker_active: bool,
    network_picker_index: usize,
    tui_picker_active: bool,
    tui_picker_index: usize,
    chat_picker_active: bool,
    chat_picker_index: usize,
    chat_picker_sessions: Vec<ChatSessionListItem>,
    subagent: SubagentUiState,
    image_picker_active: bool,
    image_picker_index: usize,
    image_picker_files: Vec<String>,
    forms: BottomFormUiState,
    conversation: ConversationUiState,
    interrupt_escape_armed_at: Option<Instant>,
    last_turn_can_continue: bool,
    todo_strip_expanded: bool,
    todo_items: Vec<rewind::HostTodoRecord>,
    should_quit: bool,
    runtime: RuntimeHandle,
    config_store: Box<dyn ConfigStore>,
    chat_repository: Box<dyn ChatRepository>,
    secret_store: Arc<dyn SecretStore>,
    app_paths: Arc<dyn AppPaths>,
    plan_metadata: PlanMetadata,
    rule_entries: Vec<RuleEntry>,
    skill_entries: Vec<SkillEntry>,
    extension_skill_entries: Vec<SkillEntry>,
    extension_entries: Vec<CliExtensionEntry>,
    cli_ui_hooks: Vec<CliUiHookView>,
    ui_runtime_state: UiRuntimeState,
    /// Mirrors Desktop `workspaceBinding`; CLI defaults to project.
    workspace_binding: String,
    file_reference_index_loading: bool,
    /// Session lifecycle notices (save/load/fork confirmations); re-appended
    /// after a live desktop timeline resync rebuilds the conversation.
    session_notices: Vec<ChatMessage>,
    inline_mode: bool,
    inline_scrollback: inline::InlineScrollback,
    pending_tui_mode: Option<String>,
}

pub(crate) struct ApplyModelAddParams<'a> {
    pub name: &'a str,
    pub api_base: &'a str,
    pub api_key: &'a str,
    pub provider: Option<ModelProvider>,
    pub transport_kind: crate::model_registry::ModelTransportKind,
    pub context_length: Option<u64>,
    pub azure_resource_name: Option<&'a str>,
    pub cloudflare_account_id: Option<&'a str>,
    pub cloudflare_gateway_id: Option<&'a str>,
    pub provider_site: Option<&'a str>,
    pub alibaba_workspace_id: Option<&'a str>,
}

impl TuiShell {
    pub fn apply_cli_approval_level(&mut self, raw: &str) -> Result<()> {
        crate::cli_bootstrap::apply_approval_level(&mut self.runtime, raw)
    }

    pub fn new_with_mode(inline: bool) -> Result<Self> {
        Self::create(inline)
    }

    fn create(inline_mode: bool) -> Result<Self> {
        let app_paths: Arc<dyn AppPaths> = Arc::new(DefaultAppPaths::new());
        let secret_store: Arc<dyn SecretStore> = Arc::new(KeyringSecretStore);
        let config_store: Box<dyn ConfigStore> = Box::new(JsonConfigStore);
        let chat_repository: Box<dyn ChatRepository> = Box::new(JsonChatRepository);
        let config_path = app_paths.config_file();
        let config = config_store.load().with_context(|| {
            t!("tui.config.read_failed", path = config_path.display()).into_owned()
        })?;
        locale::apply_ui_locale(&config);
        let workspace_root = app_paths.workspace_root();
        let mut runtime = RuntimeHandle::new(
            config.clone(),
            Arc::clone(&secret_store),
            workspace_root.clone(),
        )
        .context("Failed to initialize TypeScript runtime bridge")?;
        let cli_metadata = runtime
            .load_cli_host_metadata("agent")
            .context("Failed to read shared host metadata")?;
        let rule_entries = cli_metadata.rule_entries;
        let skill_entries = cli_metadata.skill_entries;
        let extension_skill_entries = cli_metadata
            .extension_skill_entries
            .into_iter()
            .map(skill_entry_from_extension_slash)
            .collect();
        let plan_metadata = cli_metadata.plan_metadata;
        let extension_entries = runtime.list_extensions().unwrap_or_else(|err| {
            logging::log_event(&format!("[extensions] failed to initialize list: {err:#}"));
            Vec::new()
        });
        let cli_ui_hooks = compile_cli_ui_hooks(&extension_entries);
        let initial_mcp_status = runtime.mcp_status_snapshot();

        let mut shell = Self {
            input: InputState::new(),
            messages: Vec::new(),
            assistant_aux_by_message: HashMap::new(),
            persisted_standalone_pending_aux: None,
            persisted_standalone_pending_aux_anchor: None,
            show_aux_details: true,
            pending_assistant_msg_index: None,
            thinking_spinner_index: 0,
            last_completed_assistant_msg_index: None,
            last_mcp_status_revision: initial_mcp_status.revision,
            slash: slash::SlashState::new(),
            rewind_picker_active: false,
            rewind_picker_index: 0,
            rewind_aux_details_before_picker: None,
            fork_picker_active: false,
            fork_picker_index: 0,
            session_display_name: None,
            session_title_source: None,
            model_picker_active: false,
            model_picker_index: 0,
            model_display_titles: HashMap::new(),
            language_picker_active: false,
            language_picker_index: 0,
            approval_picker_active: false,
            approval_picker_index: 0,
            network_picker_active: false,
            network_picker_index: 0,
            tui_picker_active: false,
            tui_picker_index: 0,
            chat_picker_active: false,
            chat_picker_index: 0,
            chat_picker_sessions: vec![],
            subagent: SubagentUiState::default(),
            image_picker_active: false,
            image_picker_index: 0,
            image_picker_files: vec![],
            forms: BottomFormUiState::default(),
            conversation: ConversationUiState::default(),
            interrupt_escape_armed_at: None,
            last_turn_can_continue: false,
            todo_strip_expanded: false,
            todo_items: Vec::new(),
            should_quit: false,
            runtime,
            config_store,
            chat_repository,
            secret_store,
            app_paths,
            plan_metadata,
            rule_entries,
            skill_entries,
            extension_skill_entries,
            extension_entries,
            cli_ui_hooks,
            // The inline TUI draws on the main screen and must not probe image protocols (that would emit kitty/sixel queries to stdout).
            ui_runtime_state: if inline_mode {
                UiRuntimeState::default()
            } else {
                UiRuntimeState::from_terminal_query()
            },
            workspace_binding: "project".to_string(),
            file_reference_index_loading: false,
            session_notices: Vec::new(),
            inline_mode,
            inline_scrollback: inline::InlineScrollback::new(),
            pending_tui_mode: None,
        };

        if let Err(err) = shell.runtime.prime_workspace_file_reference_index() {
            logging::log_event(&format!(
                "[file-reference] failed to warm up index: {err:#}"
            ));
        }

        shell.refresh_prompt_slash_commands(&initial_mcp_status);
        Ok(shell)
    }

    pub fn ui_runtime_state_mut(&mut self) -> &mut UiRuntimeState {
        &mut self.ui_runtime_state
    }

    pub fn rule_entries(&self) -> &[RuleEntry] {
        &self.rule_entries
    }

    pub fn skill_entries(&self) -> &[SkillEntry] {
        &self.skill_entries
    }

    pub fn extension_entries(&self) -> &[CliExtensionEntry] {
        &self.extension_entries
    }

    pub(crate) fn enabled_skill_entries(&self) -> impl Iterator<Item = &SkillEntry> {
        self.skill_entries
            .iter()
            .filter(|entry| entry.enabled)
            .chain(self.extension_skill_entries.iter())
    }

    pub(crate) fn find_enabled_skill_entry(&self, name: &str) -> Option<&SkillEntry> {
        self.enabled_skill_entries()
            .find(|entry| entry.source.name == name)
    }

    pub fn refresh_rules_from_disk(&mut self) -> Result<()> {
        self.runtime
            .reload_host_metadata(self.agent_mode())
            .context("Failed to refresh shared rule runtime metadata")?;
        let metadata = self
            .runtime
            .load_cli_host_metadata(self.agent_mode())
            .context("Failed to read shared rule metadata")?;
        self.rule_entries = metadata.rule_entries;
        self.skill_entries = metadata.skill_entries;
        self.extension_skill_entries = metadata
            .extension_skill_entries
            .into_iter()
            .map(skill_entry_from_extension_slash)
            .collect();
        self.plan_metadata = metadata.plan_metadata;
        Ok(())
    }

    pub fn refresh_skills_from_disk(&mut self) -> Result<()> {
        self.runtime
            .reload_host_metadata(self.agent_mode())
            .context("Failed to refresh shared skill runtime metadata")?;
        let metadata = self
            .runtime
            .load_cli_host_metadata(self.agent_mode())
            .context("Failed to read shared skill metadata")?;
        self.rule_entries = metadata.rule_entries;
        self.skill_entries = metadata.skill_entries;
        self.extension_skill_entries = metadata
            .extension_skill_entries
            .into_iter()
            .map(skill_entry_from_extension_slash)
            .collect();
        self.plan_metadata = metadata.plan_metadata;
        if self.current_slash_query().is_some() {
            self.refresh_suggestions();
        }
        Ok(())
    }

    pub fn refresh_extensions_from_disk(&mut self) -> Result<()> {
        self.extension_entries = self
            .runtime
            .list_extensions()
            .context("Failed to read extension list")?;
        self.cli_ui_hooks = compile_cli_ui_hooks(&self.extension_entries);
        if let Ok(metadata) = self.runtime.load_cli_host_metadata(self.agent_mode()) {
            self.extension_skill_entries = metadata
                .extension_skill_entries
                .into_iter()
                .map(skill_entry_from_extension_slash)
                .collect();
        }
        if self.current_slash_query().is_some() {
            self.refresh_suggestions();
        }
        Ok(())
    }

    pub fn refresh_suggestions(&mut self) {
        if self.input.shell_mode_active {
            self.slash.suggestions.clear();
            self.slash.selected_suggestion = 0;
            return;
        }

        if self.current_file_reference_query().is_some() {
            match self
                .runtime
                .list_workspace_file_reference_suggestions(&self.input.value, self.input.cursor)
            {
                Ok((suggestions, index_ready)) => {
                    self.file_reference_index_loading = !index_ready;
                    self.slash.suggestions = suggestions
                        .into_iter()
                        .map(InputSuggestion::simple)
                        .collect();
                }
                Err(err) => {
                    self.file_reference_index_loading = false;
                    logging::log_event(&format!(
                        "[file-reference] failed to query candidates: {err:#}"
                    ));
                    self.slash.suggestions.clear();
                }
            };

            if self.slash.selected_suggestion >= self.slash.suggestions.len() {
                self.slash.selected_suggestion = 0;
            }
            return;
        }

        self.file_reference_index_loading = false;

        let Some(query) = self.current_slash_query().map(ToString::to_string) else {
            self.slash.suggestions.clear();
            self.slash.selected_suggestion = 0;
            return;
        };

        let commands = slash::slash_commands_for_shell(self);
        self.slash.commands = commands.clone();
        self.slash.suggestions = slash::compute_suggestions(self, &query, &commands);

        if self.slash.selected_suggestion >= self.slash.suggestions.len() {
            self.slash.selected_suggestion = 0;
        }
    }

    pub fn poll_runtime(&mut self) {
        self.runtime.poll();
        self.apply_runtime_events();
        self.sync_mcp_status();
        self.refresh_active_subagent_view();
        self.refresh_plan_metadata_from_disk();
        if self.file_reference_index_loading && self.current_file_reference_query().is_some() {
            self.refresh_suggestions();
        }
        if !self.can_interrupt_current_turn() {
            self.clear_interrupt_escape_arm();
        }
    }

    pub fn handle_stream_stall_timeout(&mut self) {
        self.runtime.handle_stream_stall_timeout();
        self.apply_runtime_events();
        self.sync_mcp_status();
        if !self.can_interrupt_current_turn() {
            self.clear_interrupt_escape_arm();
        }
    }

    pub fn tick(&mut self) {
        if self.runtime.is_busy() {
            self.thinking_spinner_index = (self.thinking_spinner_index + 1) % 4;
        } else {
            self.thinking_spinner_index = 0;
        }
    }

    pub fn should_quit(&self) -> bool {
        self.should_quit
    }

    pub fn request_quit(&mut self) {
        self.should_quit = true;
    }

    pub fn push_agent_message(&mut self, content: impl Into<String>) {
        self.messages.push(ChatMessage {
            role: MessageRole::Agent,
            content: content.into(),
            tool_block: None,
        });
    }

    pub(crate) fn start_new_session_for_slash(&mut self) {
        if self.runtime.is_busy() {
            self.runtime.abort();
            self.apply_runtime_events();
        }
        if let Err(err) = self.runtime.reset_session() {
            self.push_agent_message(t!("tui.session.new_failed", err = err).into_owned());
            return;
        }
        self.reset_conversation_ui_for_new_session();
        self.apply_runtime_events();
    }

    fn reset_conversation_ui_for_new_session(&mut self) {
        self.reset_primary_picker_overlay();
        self.messages.clear();
        self.assistant_aux_by_message.clear();
        self.clear_input_history();
        self.session_notices.clear();
        self.persisted_standalone_pending_aux = None;
        self.persisted_standalone_pending_aux_anchor = None;
        self.subagent.picker_active = false;
        self.close_subagent_view();
        self.session_display_name = None;
        self.session_title_source = None;
        self.todo_items.clear();
        self.todo_strip_expanded = false;
        self.pending_assistant_msg_index = None;
        self.last_completed_assistant_msg_index = None;
        self.last_turn_can_continue = false;
        if self.inline_mode {
            self.inline_scrollback.reset();
        }
        self.last_mcp_status_revision = self.runtime.mcp_status_snapshot().revision;
        self.scroll_history_to_bottom();
    }

    pub(crate) fn compact_history_for_slash(&mut self) {
        self.runtime.compact_history();
        self.apply_runtime_events();
    }

    pub(crate) fn prompt_slash_commands(&self) -> &[slash::PromptSlashCommand] {
        &self.slash.prompt_commands
    }

    pub fn toggle_aux_details(&mut self) {
        self.show_aux_details = !self.show_aux_details;
    }

    pub(super) fn enter_rewind_picker_mode(&mut self) {
        if self.rewind_picker_active {
            return;
        }

        self.rewind_aux_details_before_picker = Some(self.show_aux_details);
        if should_toggle_aux_details_on_enter_rewind_picker(self.show_aux_details) {
            self.toggle_aux_details();
        }
        self.rewind_picker_active = true;
    }

    pub(super) fn exit_rewind_picker_mode(&mut self) {
        self.rewind_picker_active = false;
        self.rewind_picker_index = 0;
        let previous_show_aux_details = self.rewind_aux_details_before_picker.take();
        if should_toggle_aux_details_on_exit_rewind_picker(
            self.show_aux_details,
            previous_show_aux_details,
        ) {
            self.toggle_aux_details();
        }
    }

    pub(super) fn enter_fork_picker_mode(&mut self) {
        if self.fork_picker_active {
            return;
        }
        self.exit_rewind_picker_mode();
        self.fork_picker_active = true;
    }

    pub(super) fn exit_fork_picker_mode(&mut self) {
        self.fork_picker_active = false;
        self.fork_picker_index = 0;
    }

    pub fn is_model_picker_active(&self) -> bool {
        self.model_picker_active
    }

    /// Any full-screen model list overlay (switching the current model).
    pub fn is_model_list_overlay_active(&self) -> bool {
        self.model_picker_active
    }

    pub fn is_language_picker_active(&self) -> bool {
        self.language_picker_active
    }

    pub fn is_approval_picker_active(&self) -> bool {
        self.approval_picker_active
    }

    pub fn is_network_picker_active(&self) -> bool {
        self.network_picker_active
    }

    pub fn is_tui_picker_active(&self) -> bool {
        self.tui_picker_active
    }

    pub fn is_chat_picker_active(&self) -> bool {
        self.chat_picker_active
    }

    pub fn is_image_picker_active(&self) -> bool {
        self.image_picker_active
    }

    fn handle_slash_command(&mut self, message: &str) {
        slash::handle_command(self, message);
    }

    /// Adds a model, saves API key, sets it as `active_model`, and persists config.
    fn apply_model_add_and_switch(
        &mut self,
        params: ApplyModelAddParams<'_>,
    ) -> Result<(), String> {
        let ApplyModelAddParams {
            name,
            api_base,
            api_key,
            provider,
            transport_kind,
            context_length,
            azure_resource_name,
            cloudflare_account_id,
            cloudflare_gateway_id,
            provider_site,
            alibaba_workspace_id,
        } = params;
        let mut config = self.runtime.config().clone();
        if config.has_model_name(name) {
            return Err(t!("tui.model_add.duplicate", name = name).into_owned());
        }

        let provider = provider.unwrap_or(ModelProvider::Custom);
        let group_id = crate::model_registry::default_preset_provider_group_id(provider);
        let connect = crate::model_registry::ProviderGroupConnectDraft {
            transport_kind: (transport_kind
                == crate::model_registry::ModelTransportKind::Anthropic
                || transport_kind == crate::model_registry::ModelTransportKind::OpenResponses)
                .then(|| transport_kind.as_str().to_string()),
            provider_site: provider_site
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned),
            alibaba_workspace_id: alibaba_workspace_id
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned),
            azure_resource_name: azure_resource_name
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned),
            cloudflare_account_id: cloudflare_account_id
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned),
            cloudflare_gateway_id: cloudflare_gateway_id
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned),
            ..Default::default()
        };
        config.add_model_to_group(
            &group_id,
            provider,
            api_base.to_string(),
            connect,
            crate::model_registry::ModelEntry {
                name: name.to_string(),
                reasoning_effort: None,
                reasoning_mode: None,
                thinking_enabled: None,
                supported_reasoning_efforts: None,
                capabilities: None,
                context_length,
                supports_thinking_type: None,
                supports_thinking_switch: None,
            },
        );
        config.active_model = crate::model_registry::ModelRef {
            group_id,
            name: name.to_string(),
        };

        if let Err(err) = self.runtime.validate_config_change(&config) {
            return Err(err.to_string());
        }

        if !api_key.trim().is_empty() {
            if let Err(err) = self.secret_store.save_model_api_key(name, api_key) {
                return Err(t!("tui.model_add.key_save_failed", err = err).into_owned());
            }
        }

        if let Err(err) = self.config_store.save(&config) {
            return Err(t!("tui.model_add.config_save_failed", err = err).into_owned());
        }

        self.runtime.replace_config(config);
        self.apply_runtime_events();
        Ok(())
    }

    fn switch_ui_locale(&mut self, locale_code: &str) {
        let normalized = locale::normalize_ui_locale(locale_code);
        let mut config = self.runtime.config().clone();
        config.ui_locale = Some(normalized.clone());
        locale::apply_ui_locale(&config);
        self.runtime.replace_config(config.clone());
        let locale_name = locale::language_display_name(&normalized);

        if let Err(err) = self.config_store.save(&config) {
            self.messages.push(ChatMessage {
                role: MessageRole::Agent,
                content: t!(
                    "tui.language.switch_saved_fail",
                    locale_name = locale_name,
                    err = err
                )
                .into_owned(),
                tool_block: None,
            });
        } else {
            self.messages.push(ChatMessage {
                role: MessageRole::Agent,
                content: t!("tui.language.switch_success", locale_name = locale_name).into_owned(),
                tool_block: None,
            });
        }
    }

    fn save_current_chat(&mut self, path: Option<&str>) {
        match self.export_chat_archive_for_message_count(self.messages.len()) {
            Ok(archive) => match self.chat_repository.save(path, &archive) {
                Ok(saved_path) => {
                    let conversation_key = chat_store::conversation_key_for_path(&saved_path);
                    if let Err(err) = self.runtime.migrate_conversation_key(&conversation_key) {
                        logging::log_event(&format!(
                            "[tui-session] migrateConversationKey failed path={conversation_key} err={err:#}"
                        ));
                    }
                    self.push_session_notice(
                        t!("tui.session.saved", path = saved_path.display()).into_owned(),
                    );
                }
                Err(err) => {
                    self.push_session_notice(t!("tui.session.save_failed", err = err).into_owned());
                }
            },
            Err(err) => {
                self.push_session_notice(t!("tui.session.save_failed", err = err).into_owned());
            }
        }
    }

    fn reset_loaded_session_ui_state(&mut self) {
        self.exit_rewind_picker_mode();
        self.subagent.picker_active = false;
        self.close_subagent_view();
        self.assistant_aux_by_message.clear();
        self.persisted_standalone_pending_aux = None;
        self.persisted_standalone_pending_aux_anchor = None;
        self.pending_assistant_msg_index = None;
        self.last_completed_assistant_msg_index = None;
        self.last_turn_can_continue = false;
        self.session_notices.clear();
        self.clear_input_history();
    }

    fn populate_ui_from_disk_archive(&mut self, archive: &ChatArchive) {
        self.session_notices.clear();
        if let Some(snapshots) = archive.desktop_messages.as_deref() {
            self.restore_conversation_from_snapshots(snapshots);
            return;
        }
        self.reset_loaded_session_ui_state();
        let mut msgs = Vec::new();
        for (role, content) in &archive.messages {
            msgs.push(ChatMessage {
                role: if role == "user" {
                    MessageRole::User
                } else {
                    MessageRole::Agent
                },
                content: content.clone(),
                tool_block: None,
            });
        }
        self.messages = msgs;
        self.assistant_aux_by_message = archive
            .assistant_aux
            .iter()
            .filter_map(|entry| {
                let thinking = entry
                    .thinking
                    .clone()
                    .filter(|value| !value.trim().is_empty());
                let compaction = entry
                    .compaction
                    .clone()
                    .filter(|value| !value.trim().is_empty());
                if thinking.is_none() && compaction.is_none() {
                    None
                } else {
                    Some((
                        entry.message_index,
                        AssistantAuxData {
                            thinking,
                            compaction,
                        },
                    ))
                }
            })
            .collect();
    }

    fn populate_ui_from_live_archive(&mut self) -> Result<()> {
        let live = self.runtime.fetch_live_chat_archive()?;
        self.reset_loaded_session_ui_state();
        if let Some(snapshots) = live.desktop_messages.as_deref() {
            // Canonical path: the daemon-stored desktop timeline, hydrated
            // exactly like a disk load.
            self.restore_conversation_from_snapshots(snapshots);
            return Ok(());
        }
        // Degraded path (explicit): no desktop host has pushed a timeline for
        // this live session, so fall back to projecting llm_history.
        let projection = project_live_chat_from_llm_history(&live.llm_history);
        self.messages = projection.messages;
        self.assistant_aux_by_message = projection.assistant_aux_by_message;
        self.messages.push(ChatMessage {
            role: MessageRole::Agent,
            content: t!("tui.session.live_timeline_degraded").into_owned(),
            tool_block: None,
        });
        Ok(())
    }

    fn load_chat_by_path(&mut self, path: &str) {
        let resolved_path = match chat_store::resolve_chat_file_path(path) {
            Ok(resolved) => resolved,
            Err(err) => {
                self.push_session_notice(t!("tui.session.load_failed", err = err).into_owned());
                return;
            }
        };
        match self.chat_repository.load(path) {
            Ok(archive) => {
                let outcome = match self
                    .runtime
                    .attach_or_open_chat_session(&resolved_path, &archive)
                {
                    Ok(outcome) => outcome,
                    Err(err) => {
                        self.push_session_notice(
                            t!("tui.session.load_failed", err = err).into_owned(),
                        );
                        return;
                    }
                };

                match outcome {
                    AttachChatSessionOutcome::Created => {
                        self.populate_ui_from_disk_archive(&archive);
                    }
                    AttachChatSessionOutcome::AttachedLive => {
                        if let Err(err) = self.populate_ui_from_live_archive() {
                            self.push_session_notice(
                                t!("tui.session.load_failed", err = err).into_owned(),
                            );
                            return;
                        }
                    }
                }

                if self.messages.is_empty() {
                    self.push_session_notice(t!("tui.session.loaded_empty").into_owned());
                }
                self.apply_runtime_events();
                self.session_display_name = archive.session_display_name.clone();
                self.session_title_source = archive.session_title_source.clone();
                self.scroll_history_to_bottom();
                let loaded_message = match outcome {
                    AttachChatSessionOutcome::AttachedLive => {
                        t!("tui.session.loaded_live", path = path).into_owned()
                    }
                    AttachChatSessionOutcome::Created => {
                        t!("tui.session.loaded", path = path).into_owned()
                    }
                };
                self.push_session_notice(loaded_message);
            }
            Err(err) => {
                self.push_session_notice(t!("tui.session.load_failed", err = err).into_owned());
            }
        }
    }

    fn apply_runtime_events(&mut self) {
        runtime_events::apply_runtime_events(self);
        self.apply_pending_generated_session_title();
        self.refresh_todo_items();
        self.maybe_resync_live_desktop_timeline();
    }

    fn apply_pending_generated_session_title(&mut self) {
        let Some(title) = self.runtime.take_pending_session_title() else {
            return;
        };
        if let Some((display_name, source)) =
            apply_generated_session_title_if_allowed(self.session_title_source.as_deref(), &title)
        {
            self.session_display_name = Some(display_name);
            self.session_title_source = Some(source);
        }
    }

    fn push_session_notice(&mut self, content: String) {
        const SESSION_NOTICES_CAP: usize = 50;
        let notice = ChatMessage {
            role: MessageRole::Agent,
            content,
            tool_block: None,
        };
        self.messages.push(notice.clone());
        self.session_notices.push(notice);
        if self.session_notices.len() > SESSION_NOTICES_CAP {
            let excess = self.session_notices.len() - SESSION_NOTICES_CAP;
            self.session_notices.drain(..excess);
        }
    }

    /// Apply a pending desktop timeline update pushed by the authoritative
    /// desktop host. Full-snapshot resync, applied only while idle so in-flight
    /// streaming state (pending message indices, approval cards) is never
    /// clobbered mid-turn; the flag persists until it can be applied.
    fn maybe_resync_live_desktop_timeline(&mut self) {
        if !self.runtime.desktop_timeline_resync_pending() {
            return;
        }
        if self.runtime.is_busy() {
            return;
        }
        match self.runtime.fetch_live_desktop_timeline() {
            Ok(Some(snapshots)) => {
                self.runtime.clear_desktop_timeline_resync_pending();
                // Continue-after-abort is a daemon-side history operation; the
                // timeline rebuild must not clear the affordance.
                let can_continue = self.last_turn_can_continue;
                self.restore_conversation_from_snapshots(&snapshots);
                self.last_turn_can_continue = can_continue;
                self.scroll_history_to_bottom();
                logging::log_event("[tui-timeline] applied live desktop timeline resync");
            }
            Ok(None) => {
                self.runtime.clear_desktop_timeline_resync_pending();
            }
            Err(err) => {
                self.runtime.clear_desktop_timeline_resync_pending();
                logging::log_event(&format!(
                    "[tui-timeline] live timeline resync failed: {err:#}"
                ));
            }
        }
    }

    fn submit_runtime_user_turn(
        &mut self,
        user_turn: String,
        explicit_images: Option<Vec<String>>,
    ) -> Result<()> {
        self.last_turn_can_continue = false;
        let user_message_count = self.messages.len();
        let Some(user_message_index) = user_message_count.checked_sub(1) else {
            return Ok(());
        };
        let before_archive = self.export_chat_archive_for_message_count(user_message_index);
        let before_messages = self.conversation_snapshots_for_message_count(user_message_index);
        let before_todos = self.runtime.list_session_todos().ok();
        let submit_result = self.runtime.submit_user_turn(user_turn, explicit_images);
        if submit_result.is_err() {
            self.messages.pop();
        } else {
            let current_archive = self.export_chat_archive_for_message_count(user_message_count);
            match (before_archive, current_archive) {
                (Ok(before_archive), Ok(archive)) => {
                    let snapshot = DesktopRewindCheckpointSnapshot {
                        archive,
                        desktop_messages: self
                            .conversation_snapshots_for_message_count(user_message_count),
                        before_archive: Some(before_archive),
                        before_desktop_messages: Some(before_messages),
                        todos: self.runtime.list_session_todos().ok(),
                        before_todos,
                    };
                    if let Err(err) = self.runtime.record_rewind_checkpoint(
                        user_message_index + 1,
                        user_message_index,
                        snapshot,
                    ) {
                        logging::log_event(&format!(
                            "[tui-rewind] record checkpoint failed message_id={} index={} err={:#}",
                            user_message_index + 1,
                            user_message_index,
                            err
                        ));
                    }
                }
                (Err(err), _) | (_, Err(err)) => {
                    logging::log_event(&format!(
                        "[tui-rewind] export archive for checkpoint failed message_id={} index={} err={:#}",
                        user_message_index + 1,
                        user_message_index,
                        err
                    ));
                }
            }
        }
        self.apply_runtime_events();
        submit_result
    }

    fn refresh_todo_items(&mut self) {
        self.todo_items = self.runtime.list_session_todos().unwrap_or_default();
        // No expand/collapse keybinding in TUI — always show the full list when todos exist.
        self.todo_strip_expanded = !self.todo_items.is_empty();
    }

    fn archive_messages_for_message_count(&self, message_count: usize) -> Vec<(String, String)> {
        self.messages
            .iter()
            .take(message_count)
            .map(|message| {
                (
                    match message.role {
                        MessageRole::User => "user".to_string(),
                        MessageRole::Agent => "assistant".to_string(),
                    },
                    message.content.clone(),
                )
            })
            .collect()
    }

    fn assistant_aux_for_message_count(
        &self,
        message_count: usize,
    ) -> Vec<AssistantAuxArchiveEntry> {
        rewind::assistant_aux_entries(&self.assistant_aux_by_message, message_count)
    }

    fn export_chat_archive_for_message_count(
        &mut self,
        message_count: usize,
    ) -> Result<crate::ports::ChatArchive> {
        let messages = self.archive_messages_for_message_count(message_count);
        let assistant_aux = self.assistant_aux_for_message_count(message_count);
        let mut archive = self
            .runtime
            .export_chat_archive(&messages, &assistant_aux)?;
        let desktop_messages = self.conversation_snapshots_for_message_count(message_count);
        archive.desktop_messages = (!desktop_messages.is_empty()).then_some(desktop_messages);
        archive.session_display_name = self.session_display_name.clone();
        archive.session_title_source = self.session_title_source.clone();
        Ok(archive)
    }

    fn conversation_snapshots_for_message_count(
        &self,
        message_count: usize,
    ) -> Vec<ConversationMessageSnapshot> {
        rewind::conversation_snapshots(
            &self.messages[..message_count],
            &self.assistant_aux_by_message,
            self.pending_assistant_msg_index
                .filter(|index| *index < message_count),
        )
    }

    fn restore_conversation_from_snapshots(&mut self, snapshots: &[ConversationMessageSnapshot]) {
        let (messages, assistant_aux_by_message) = rewind::restore_conversation(snapshots);
        self.messages = messages;
        // Session notices (save/load/fork confirmations) survive rebuilds so a
        // live timeline resync does not silently erase them.
        let notices = self.session_notices.clone();
        self.messages.extend(notices);
        self.assistant_aux_by_message = assistant_aux_by_message;
        self.persisted_standalone_pending_aux = None;
        self.persisted_standalone_pending_aux_anchor = None;
        self.pending_assistant_msg_index = None;
        self.last_completed_assistant_msg_index = None;
        self.last_turn_can_continue = false;
        self.clear_input_history();
        self.exit_rewind_picker_mode();
        self.exit_fork_picker_mode();
        self.subagent.picker_active = false;
        self.close_subagent_view();
    }

    fn rewind_to_message(&mut self, message_id: usize) -> Result<()> {
        if self.runtime.is_busy() {
            return Err(anyhow!(t!("tui.busy.pending_reply").into_owned()));
        }

        let outcome = self.runtime.rewind_message(message_id)?;
        self.apply_rewind_restore_outcome(outcome);
        Ok(())
    }

    fn rewind_message_and_submit(
        &mut self,
        message_id: usize,
        replacement_text: &str,
    ) -> Result<()> {
        let trimmed = replacement_text.trim();
        if trimmed.is_empty() {
            return Err(anyhow!(
                t!("tui.session.rewind.replacement_empty").into_owned()
            ));
        }
        self.rewind_to_message(message_id)?;

        let workspace_root = self.app_paths.workspace_root();
        let runtime_turn = user_turn_text_for_mode(&workspace_root, self.input.mode, trimmed);
        self.messages.push(ChatMessage {
            role: MessageRole::User,
            content: trimmed.to_string(),
            tool_block: None,
        });
        self.input.push_history_entry(trimmed.to_string());
        self.submit_runtime_user_turn(runtime_turn, None)
    }

    fn fork_to_message(&mut self, message_id: usize) -> Result<()> {
        if self.runtime.is_busy() {
            return Err(anyhow!(t!("tui.busy.pending_reply").into_owned()));
        }

        let snapshots = self.conversation_snapshots_for_message_count(self.messages.len());
        let Some(anchor_index) = crate::fork::resolve_fork_anchor_index(&snapshots, message_id)
        else {
            return Err(anyhow!(t!("tui.session.fork.invalid_anchor").into_owned()));
        };
        let truncated = crate::fork::truncate_messages_through_index(&snapshots, anchor_index);
        if truncated.is_empty() {
            return Err(anyhow!(t!("tui.session.fork.invalid_anchor").into_owned()));
        }

        let source_display_name = self
            .session_display_name
            .clone()
            .unwrap_or_else(|| chat_store::fallback_session_display_name(&snapshots));
        let fork_display_name =
            crate::fork::derive_forked_session_display_name(&source_display_name);

        let full_archive = self.export_chat_archive_for_message_count(self.messages.len())?;
        let mut fork_archive = crate::fork::build_truncated_chat_archive_for_fork(
            &full_archive,
            &snapshots,
            anchor_index,
        );
        fork_archive.session_display_name = Some(fork_display_name.clone());
        fork_archive.session_title_source = Some("seed".to_string());

        let todos = self.runtime.list_session_todos()?;
        let saved_path = self.chat_repository.save(None, &fork_archive)?;
        self.runtime.activate_forked_session(&fork_archive, todos)?;
        self.session_display_name = Some(fork_display_name);
        self.session_title_source = Some("seed".to_string());
        self.session_notices.clear();
        self.restore_conversation_from_snapshots(&truncated);
        self.scroll_history_to_bottom();
        self.push_session_notice(
            t!("tui.session.fork.created", path = saved_path.display()).into_owned(),
        );
        Ok(())
    }

    fn apply_rewind_restore_outcome(&mut self, outcome: rewind::RewindRestoreOutcome) {
        if !outcome.warnings.is_empty() {
            logging::log_event(&format!(
                "[tui-rewind] restore warnings restored={} skipped={} warnings={}",
                outcome.restored,
                outcome.skipped,
                outcome
                    .warnings
                    .iter()
                    .map(|warning| format!(
                        "path={} action={:?} message={}",
                        warning.path, warning.action, warning.message
                    ))
                    .collect::<Vec<_>>()
                    .join(" | ")
            ));
        }
        self.restore_conversation_from_snapshots(&outcome.before_messages);
        if conversation_user_message_count(&self.messages) == 0 {
            self.session_title_source = Some("seed".to_string());
        }
        self.scroll_history_to_bottom();
    }

    fn refresh_plan_metadata_from_disk(&mut self) {
        let Ok(next) = self.runtime.load_plan_metadata(self.agent_mode()) else {
            return;
        };
        if next == self.plan_metadata {
            return;
        }

        self.plan_metadata = next.clone();
        self.runtime.replace_plan_metadata(next);
    }

    fn push_plan_metadata_snapshot(&mut self) {
        let Ok(next) = self.runtime.load_plan_metadata(self.agent_mode()) else {
            return;
        };
        if next == self.plan_metadata {
            return;
        }

        self.plan_metadata = next.clone();
        self.runtime.replace_plan_metadata(next);
    }

    fn start_manual_shell_execution(&mut self, command: String) {
        self.runtime
            .execute_manual_tool_command(&manual_shell_tool_command(&command));
        self.apply_runtime_events();
    }
}

fn user_turn_text_for_mode(
    _workspace_root: &Path,
    _input_mode: MainInputMode,
    raw_message: &str,
) -> String {
    raw_message.to_string()
}

fn apply_generated_session_title_if_allowed(
    session_title_source: Option<&str>,
    title: &str,
) -> Option<(String, String)> {
    let trimmed = title.trim();
    if trimmed.is_empty() {
        return None;
    }
    if session_title_source == Some("manual") {
        return None;
    }
    Some((trimmed.to_string(), "llm".to_string()))
}

fn conversation_user_message_count(messages: &[ChatMessage]) -> usize {
    messages
        .iter()
        .filter(|message| message.role == MessageRole::User)
        .count()
}

fn manual_shell_tool_command(command: &str) -> String {
    format!("/tool shell {}", command)
}

fn is_standalone_subagent_status_aux(pending_aux: &PendingAssistantAux) -> bool {
    parse_pending_subagent_status_text(&pending_aux.status_text).is_some()
}

fn next_persisted_standalone_pending_aux(
    is_busy: bool,
    pending_assistant_msg_index: Option<usize>,
    live_pending_aux: Option<PendingAssistantAux>,
    persisted_standalone_pending_aux: Option<PendingAssistantAux>,
) -> Option<PendingAssistantAux> {
    let live_is_subagent_status = live_pending_aux
        .as_ref()
        .is_some_and(is_standalone_subagent_status_aux);
    let persisted_is_subagent_status = persisted_standalone_pending_aux
        .as_ref()
        .is_some_and(is_standalone_subagent_status_aux);

    if is_busy {
        if live_is_subagent_status {
            return live_pending_aux;
        }

        if pending_assistant_msg_index.is_none() {
            return live_pending_aux;
        }

        return if persisted_is_subagent_status {
            persisted_standalone_pending_aux
        } else {
            None
        };
    }

    if live_pending_aux.is_some() {
        return live_pending_aux;
    }

    persisted_standalone_pending_aux
}

fn next_persisted_standalone_pending_aux_anchor(
    anchor_source_msg_index: Option<usize>,
    live_pending_aux: Option<&PendingAssistantAux>,
    persisted_standalone_pending_aux: Option<&PendingAssistantAux>,
    persisted_standalone_pending_aux_anchor: Option<usize>,
) -> Option<usize> {
    if live_pending_aux.is_some_and(is_standalone_subagent_status_aux) {
        return anchor_source_msg_index.or(persisted_standalone_pending_aux_anchor);
    }

    persisted_standalone_pending_aux?;

    if !persisted_standalone_pending_aux.is_some_and(is_standalone_subagent_status_aux) {
        return None;
    }

    persisted_standalone_pending_aux_anchor
}

fn should_reanchor_persisted_subagent_status_on_begin_assistant_response(
    last_message: Option<&ChatMessage>,
    persisted_standalone_pending_aux: Option<&PendingAssistantAux>,
) -> bool {
    last_message.is_some_and(|message| message.role == MessageRole::Agent)
        && persisted_standalone_pending_aux.is_some_and(is_standalone_subagent_status_aux)
}

fn should_toggle_aux_details_on_enter_rewind_picker(show_aux_details: bool) -> bool {
    show_aux_details
}

fn should_toggle_aux_details_on_exit_rewind_picker(
    show_aux_details: bool,
    previous_show_aux_details: Option<bool>,
) -> bool {
    previous_show_aux_details.is_some_and(|previous| previous != show_aux_details)
}

fn is_subagents_command(message: &str) -> bool {
    message == "/subagents" || message.starts_with("/subagents ")
}

fn cursor_byte_index_for_text(text: &str, cursor_chars: usize) -> usize {
    if cursor_chars == 0 {
        return 0;
    }

    text.char_indices()
        .nth(cursor_chars)
        .map(|(idx, _)| idx)
        .unwrap_or(text.len())
}

fn should_log_input_edit(text: &str) -> bool {
    text.contains('\n')
        || text.chars().count() >= 16
        || text.chars().filter(|ch| !ch.is_ascii()).count() >= 8
}

fn truncate_input_log_preview(text: &str, max_chars: usize) -> String {
    let mut preview = String::new();
    for (emitted, ch) in text.chars().enumerate() {
        if emitted >= max_chars {
            preview.push('…');
            break;
        }
        match ch {
            '\n' => preview.push_str("\\n"),
            '\r' => preview.push_str("\\r"),
            _ => preview.push(ch),
        }
    }
    preview
}

fn skill_entry_from_extension_slash(entry: CliExtensionSkillSlashEntry) -> SkillEntry {
    SkillEntry {
        source: SkillSource {
            id: entry.id,
            scope: SkillScope::Extension,
            root_kind: SkillRootKind::Extension,
            name: entry.name.clone(),
            description: entry.description.clone(),
            short_label: format!("extension/skills/{}/SKILL.md", entry.name),
            path: entry.path,
        },
        enabled: true,
        content: entry.content.clone(),
        preview: SkillPreview {
            excerpt: entry.content,
            truncated: false,
        },
    }
}

fn compile_cli_ui_hooks(entries: &[CliExtensionEntry]) -> Vec<CliUiHookView> {
    let mut hooks = Vec::new();

    for entry in entries {
        if !entry.enabled {
            continue;
        }
        let contributed = entry
            .contributes
            .as_ref()
            .and_then(|contributes| contributes.cli.as_ref())
            .and_then(|cli| cli.hooks.as_ref());
        let Some(contributed) = contributed else {
            continue;
        };

        for hook in contributed {
            if let Some(compiled) = compile_cli_ui_hook(hook) {
                hooks.push(compiled);
            }
        }
    }

    hooks
}

fn compile_cli_ui_hook(hook: &CliExtensionCliUiHookEntry) -> Option<CliUiHookView> {
    let slot = parse_cli_ui_hook_slot(&hook.slot)?;
    let variant = hook.variant.as_deref().and_then(parse_cli_ui_hook_variant);
    let tokens = CliUiHookTokensView {
        foreground: hook
            .tokens
            .as_ref()
            .and_then(|tokens| tokens.foreground.as_deref())
            .and_then(parse_cli_ui_hook_token_role),
        border: hook
            .tokens
            .as_ref()
            .and_then(|tokens| tokens.border.as_deref())
            .and_then(parse_cli_ui_hook_token_role),
        accent: hook
            .tokens
            .as_ref()
            .and_then(|tokens| tokens.accent.as_deref())
            .and_then(parse_cli_ui_hook_token_role),
    };

    Some(CliUiHookView {
        slot,
        variant,
        tokens,
        prefix: hook.prefix.clone(),
        suffix: hook.suffix.clone(),
    })
}

fn parse_cli_ui_hook_slot(slot: &str) -> Option<CliUiHookSlot> {
    match slot {
        "message.user" => Some(CliUiHookSlot::MessageUser),
        "message.assistant" => Some(CliUiHookSlot::MessageAssistant),
        "message.tool" => Some(CliUiHookSlot::MessageTool),
        "assistant.thinking" => Some(CliUiHookSlot::AssistantThinking),
        "input.frame" => Some(CliUiHookSlot::InputFrame),
        "bottom_form" => Some(CliUiHookSlot::BottomForm),
        "bottom_form.section" => Some(CliUiHookSlot::BottomFormSection),
        "slash_suggestions" => Some(CliUiHookSlot::SlashSuggestions),
        "approval.panel" => Some(CliUiHookSlot::ApprovalPanel),
        "questions.panel" => Some(CliUiHookSlot::QuestionsPanel),
        _ => None,
    }
}

fn parse_cli_ui_hook_variant(variant: &str) -> Option<CliUiHookVariant> {
    match variant {
        "default" => Some(CliUiHookVariant::Default),
        "accented" => Some(CliUiHookVariant::Accented),
        "muted" => Some(CliUiHookVariant::Muted),
        "warning" => Some(CliUiHookVariant::Warning),
        "success" => Some(CliUiHookVariant::Success),
        "danger" => Some(CliUiHookVariant::Danger),
        _ => None,
    }
}

fn parse_cli_ui_hook_token_role(role: &str) -> Option<CliUiHookTokenRole> {
    match role {
        "default" => Some(CliUiHookTokenRole::Default),
        "primary" => Some(CliUiHookTokenRole::Primary),
        "secondary" => Some(CliUiHookTokenRole::Secondary),
        "muted" => Some(CliUiHookTokenRole::Muted),
        "accent" => Some(CliUiHookTokenRole::Accent),
        "success" => Some(CliUiHookTokenRole::Success),
        "warning" => Some(CliUiHookTokenRole::Warning),
        "danger" => Some(CliUiHookTokenRole::Danger),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        apply_generated_session_title_if_allowed, conversation_user_message_count,
        is_standalone_subagent_status_aux, manual_shell_tool_command,
        next_persisted_standalone_pending_aux, next_persisted_standalone_pending_aux_anchor,
        should_reanchor_persisted_subagent_status_on_begin_assistant_response,
        should_toggle_aux_details_on_enter_rewind_picker,
        should_toggle_aux_details_on_exit_rewind_picker, user_turn_text_for_mode,
    };
    use crate::view::{
        AssistantAuxKind, ChatMessage, MainInputMode, MessageRole, PendingAssistantAux,
    };
    use std::path::PathBuf;

    #[test]
    fn user_turn_text_for_agent_mode_keeps_raw_input() {
        let workspace_root = PathBuf::from("C:/workspace/demo");
        let raw_message = "implement plan mode";

        let runtime_turn =
            user_turn_text_for_mode(&workspace_root, MainInputMode::Agent, raw_message);

        assert_eq!(runtime_turn, raw_message);
    }

    #[test]
    fn user_turn_text_for_plan_mode_keeps_only_user_text() {
        let workspace_root = PathBuf::from("C:/workspace/demo");
        let raw_message = "implement plan mode";

        let runtime_turn =
            user_turn_text_for_mode(&workspace_root, MainInputMode::Plan, raw_message);

        assert_eq!(runtime_turn, raw_message);
    }

    #[test]
    fn apply_generated_session_title_skips_manual_source() {
        assert_eq!(
            apply_generated_session_title_if_allowed(Some("manual"), "LLM title"),
            None
        );
        assert_eq!(
            apply_generated_session_title_if_allowed(Some("llm"), "  New title  "),
            Some(("New title".to_string(), "llm".to_string()))
        );
        assert_eq!(
            apply_generated_session_title_if_allowed(None, "First title"),
            Some(("First title".to_string(), "llm".to_string()))
        );
        assert_eq!(apply_generated_session_title_if_allowed(None, "   "), None);
    }

    #[test]
    fn conversation_user_message_count_ignores_agent_notices() {
        let messages = vec![
            ChatMessage::new(MessageRole::User, "hello"),
            ChatMessage::new(MessageRole::Agent, "reply"),
            ChatMessage::new(MessageRole::Agent, "saved"),
        ];
        assert_eq!(conversation_user_message_count(&messages), 1);
        assert_eq!(conversation_user_message_count(&[]), 0);
    }

    #[test]
    fn manual_shell_tool_command_wraps_input_for_bridge() {
        assert_eq!(
            manual_shell_tool_command("echo hello world"),
            "/tool shell echo hello world"
        );
    }

    #[test]
    fn standalone_subagent_status_aux_detection_ignores_generic_spinner_text() {
        assert!(!is_standalone_subagent_status_aux(&PendingAssistantAux {
            kind: AssistantAuxKind::Thinking,
            status_text: "| Thinking...".to_string(),
            detail_text: Some("Still working".to_string()),
        }));
    }

    #[test]
    fn standalone_subagent_status_aux_detection_accepts_named_status_text() {
        assert!(is_standalone_subagent_status_aux(&PendingAssistantAux {
            kind: AssistantAuxKind::Thinking,
            status_text: "| Subagent task: Done".to_string(),
            detail_text: None,
        }));
    }

    #[test]
    fn completed_subagent_status_survives_parent_completion_while_busy() {
        let persisted = PendingAssistantAux {
            kind: AssistantAuxKind::Thinking,
            status_text: "| Subagent task: Done".to_string(),
            detail_text: None,
        };

        let next =
            next_persisted_standalone_pending_aux(true, Some(7), None, Some(persisted.clone()));

        assert_eq!(
            next.as_ref().map(|aux| aux.status_text.as_str()),
            Some(persisted.status_text.as_str())
        );
    }

    #[test]
    fn live_subagent_status_captures_pending_assistant_anchor() {
        let live = PendingAssistantAux {
            kind: AssistantAuxKind::Thinking,
            status_text: "| Subagent task: Running".to_string(),
            detail_text: None,
        };

        let next =
            next_persisted_standalone_pending_aux_anchor(Some(7), Some(&live), Some(&live), None);

        assert_eq!(next, Some(7));
    }

    #[test]
    fn live_subagent_status_captures_last_completed_assistant_anchor() {
        let live = PendingAssistantAux {
            kind: AssistantAuxKind::Thinking,
            status_text: "| Subagent task: Running".to_string(),
            detail_text: None,
        };

        let next =
            next_persisted_standalone_pending_aux_anchor(Some(4), Some(&live), Some(&live), None);

        assert_eq!(next, Some(4));
    }

    #[test]
    fn begin_assistant_response_reanchors_persisted_subagent_status_after_agent_message() {
        let persisted = PendingAssistantAux {
            kind: AssistantAuxKind::Thinking,
            status_text: "| Subagent task: Done".to_string(),
            detail_text: None,
        };

        let should_reanchor = should_reanchor_persisted_subagent_status_on_begin_assistant_response(
            Some(&ChatMessage::new(
                MessageRole::Agent,
                "previous parent reply",
            )),
            Some(&persisted),
        );

        assert!(should_reanchor);
    }

    #[test]
    fn begin_assistant_response_does_not_reanchor_persisted_subagent_status_after_user_message() {
        let persisted = PendingAssistantAux {
            kind: AssistantAuxKind::Thinking,
            status_text: "| Subagent task: Done".to_string(),
            detail_text: None,
        };

        let should_reanchor = should_reanchor_persisted_subagent_status_on_begin_assistant_response(
            Some(&ChatMessage::new(MessageRole::User, "new user input")),
            Some(&persisted),
        );

        assert!(!should_reanchor);
    }

    #[test]
    fn live_subagent_status_keeps_existing_anchor_after_parent_completion() {
        let live = PendingAssistantAux {
            kind: AssistantAuxKind::Thinking,
            status_text: "| Subagent task: Done".to_string(),
            detail_text: None,
        };

        let next =
            next_persisted_standalone_pending_aux_anchor(None, Some(&live), Some(&live), Some(5));

        assert_eq!(next, Some(5));
    }

    #[test]
    fn completed_subagent_status_keeps_existing_anchor() {
        let persisted = PendingAssistantAux {
            kind: AssistantAuxKind::Thinking,
            status_text: "| Subagent task: Done".to_string(),
            detail_text: None,
        };

        let next =
            next_persisted_standalone_pending_aux_anchor(None, None, Some(&persisted), Some(5));

        assert_eq!(next, Some(5));
    }

    #[test]
    fn rewind_picker_enter_toggles_aux_details_only_when_currently_visible() {
        assert!(should_toggle_aux_details_on_enter_rewind_picker(true));
        assert!(!should_toggle_aux_details_on_enter_rewind_picker(false));
    }

    #[test]
    fn rewind_picker_exit_restores_previous_aux_details_mode() {
        assert!(should_toggle_aux_details_on_exit_rewind_picker(
            false,
            Some(true)
        ));
        assert!(should_toggle_aux_details_on_exit_rewind_picker(
            true,
            Some(false)
        ));
        assert!(!should_toggle_aux_details_on_exit_rewind_picker(
            false,
            Some(false)
        ));
        assert!(!should_toggle_aux_details_on_exit_rewind_picker(
            true,
            Some(true)
        ));
        assert!(!should_toggle_aux_details_on_exit_rewind_picker(true, None));
    }
}
