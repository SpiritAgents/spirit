use anyhow::Result;
use serde_json::Value;
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

use crate::{
    ask_questions::AskQuestionsResult,
    daemon::DaemonRuntime,
    host_protocol::{CliExtensionEntry, CliHostMetadataSnapshot, WorkspaceCapabilityTrustPrompter},
    host_runtime::RuntimeEvent,
    mcp::{McpScope, McpServerConfig},
    mcp_types::{
        ManagedMcpServer, McpDiscoveredPrompt, McpDiscoveredResource, McpDiscoveredTool,
        McpServerInspection,
    },
    model_registry::AppConfig,
    plan::PlanMetadata,
    ports::{
        AssistantAuxArchiveEntry, AttachChatSessionOutcome, ChatArchive, McpStatusSnapshot,
        SecretStore, SubagentSessionArchiveEntry, SubagentSessionSummary,
    },
    rewind::{DesktopRewindCheckpointSnapshot, RewindRestoreOutcome},
    session::SessionModel,
    skills::ActiveSkillPayload,
    view::{ChatMessage, PendingAssistantAux, PendingSubagentApprovalView},
};

#[derive(Clone, Debug)]
pub struct RuntimeExportState {
    pub api_messages: Vec<Value>,
    pub system_prompts: Value,
    pub api_request_trace: Vec<Value>,
}

/// TUI-facing runtime handle backed by the shared Spirit Server daemon.
pub struct RuntimeHandle {
    backend: DaemonRuntime,
}

impl RuntimeHandle {
    pub fn new(
        config: AppConfig,
        secret_store: Arc<dyn SecretStore>,
        workspace_root: PathBuf,
    ) -> Result<Self> {
        Ok(Self {
            backend: DaemonRuntime::new(config, secret_store, workspace_root)?,
        })
    }

    pub fn config(&self) -> &AppConfig {
        self.backend.config()
    }

    pub fn validate_config_change(&self, config: &AppConfig) -> Result<()> {
        self.backend.validate_config_change(config)
    }

    pub fn replace_config(&mut self, config: AppConfig) {
        self.backend.replace_config(config)
    }

    pub fn store_config(&mut self, config: AppConfig) {
        self.backend.store_config(config)
    }

    pub fn set_llm_http_version(&mut self, llm_http_version: &str) -> Result<()> {
        self.backend.set_llm_http_version(llm_http_version)
    }

    pub fn replace_plan_metadata(&mut self, metadata: PlanMetadata) {
        self.backend.replace_plan_metadata(metadata)
    }

    pub fn activate_skill(&mut self, skill: ActiveSkillPayload) -> Result<()> {
        self.backend.activate_skill(skill)
    }

    pub fn load_cli_host_metadata(&mut self, agent_mode: &str) -> Result<CliHostMetadataSnapshot> {
        self.backend.load_cli_host_metadata(agent_mode)
    }

    pub fn load_plan_metadata(&mut self, agent_mode: &str) -> Result<PlanMetadata> {
        self.backend.load_plan_metadata(agent_mode)
    }

    pub fn has_active_plan(&self) -> bool {
        self.backend.has_active_plan()
    }

    pub fn active_plan_path(&self) -> Option<&std::path::Path> {
        self.backend.active_plan_path()
    }

    pub fn list_workspace_file_reference_suggestions(
        &mut self,
        input: &str,
        cursor_chars: usize,
    ) -> Result<(Vec<String>, bool)> {
        self.backend
            .list_workspace_file_reference_suggestions(input, cursor_chars)
    }

    pub fn prime_workspace_file_reference_index(&mut self) -> Result<()> {
        self.backend.prime_workspace_file_reference_index()
    }

    pub fn write_rule_state(
        &mut self,
        enabled_overrides: std::collections::BTreeMap<String, bool>,
    ) -> Result<PathBuf> {
        self.backend.write_rule_state(enabled_overrides)
    }

    pub fn write_skill_state(
        &mut self,
        enabled_overrides: std::collections::BTreeMap<String, bool>,
    ) -> Result<PathBuf> {
        self.backend.write_skill_state(enabled_overrides)
    }

    pub fn reload_host_metadata(&mut self, agent_mode: &str) -> Result<()> {
        self.backend.reload_host_metadata(agent_mode)
    }

    pub fn list_extensions(&mut self) -> Result<Vec<CliExtensionEntry>> {
        self.backend.list_extensions()
    }

    pub fn import_extension_archive(
        &mut self,
        archive_bytes: &[u8],
        file_name: Option<&str>,
    ) -> Result<CliExtensionEntry> {
        self.backend
            .import_extension_archive(archive_bytes, file_name)
    }

    pub fn delete_extension(&mut self, id: &str) -> Result<()> {
        self.backend.delete_extension(id)
    }

    pub fn session(&self) -> &SessionModel {
        self.backend.session()
    }

    pub fn export_llm_state(&mut self) -> Result<RuntimeExportState> {
        self.backend.export_llm_state()
    }

    pub fn export_chat_archive(
        &mut self,
        messages: &[(String, String)],
        assistant_aux: &[AssistantAuxArchiveEntry],
    ) -> Result<ChatArchive> {
        self.backend.export_chat_archive(messages, assistant_aux)
    }

    pub fn mcp_status_snapshot(&mut self) -> McpStatusSnapshot {
        self.backend.mcp_status_snapshot()
    }

    pub fn subagent_sessions(&self) -> &[SubagentSessionSummary] {
        self.backend.subagent_sessions()
    }

    pub fn subagent_session_archive(
        &mut self,
        session_id: &str,
    ) -> Result<Option<SubagentSessionArchiveEntry>> {
        self.backend.subagent_session_archive(session_id)
    }

    pub fn subagent_live_messages(&self, session_id: &str) -> Vec<ChatMessage> {
        self.backend.subagent_live_messages(session_id)
    }

    pub fn subagent_pending_aux_state(
        &mut self,
        session_id: &str,
    ) -> Result<Option<PendingAssistantAux>> {
        self.backend.subagent_pending_aux_state(session_id)
    }

    pub fn pending_subagent_approval(&self) -> Option<PendingSubagentApprovalView> {
        self.backend.pending_subagent_approval()
    }

    pub fn has_pending_tool_approval(&self) -> bool {
        self.backend.has_pending_tool_approval()
    }

    pub fn is_busy(&self) -> bool {
        self.backend.is_busy()
    }

    pub fn loop_enabled(&self) -> bool {
        self.backend.loop_enabled()
    }

    pub fn set_loop_enabled(&mut self, enabled: bool) -> Result<()> {
        self.backend.set_loop_enabled(enabled)
    }

    pub fn approval_level(&self) -> &str {
        self.backend.approval_level()
    }

    pub fn set_approval_level(&mut self, approval_level: &str) -> Result<()> {
        self.backend.set_approval_level(approval_level)
    }

    pub fn abort(&mut self) {
        self.backend.abort()
    }

    pub fn continue_assistant_completion(&mut self) -> Result<()> {
        self.backend.continue_assistant_completion()
    }

    pub fn drain_events(&mut self) -> Vec<RuntimeEvent> {
        self.backend.drain_events()
    }

    pub fn pending_aux_state(&self) -> Option<PendingAssistantAux> {
        self.backend.pending_aux_state()
    }

    pub fn poll(&mut self) {
        self.backend.poll()
    }

    pub fn handle_stream_stall_timeout(&mut self) {
        self.backend.handle_stream_stall_timeout()
    }

    pub fn can_rewind_message(&self, message_id: usize) -> bool {
        self.backend.can_rewind_message(message_id)
    }

    pub fn record_rewind_checkpoint(
        &mut self,
        message_id: usize,
        message_index: usize,
        snapshot: DesktopRewindCheckpointSnapshot,
    ) -> Result<()> {
        self.backend
            .record_rewind_checkpoint(message_id, message_index, snapshot)
    }

    pub fn rewind_message(&mut self, message_id: usize) -> Result<RewindRestoreOutcome> {
        self.backend.rewind_message(message_id)
    }

    pub fn set_todo_session_key(&mut self, session_key: &str) -> Result<()> {
        self.backend.set_todo_session_key(session_key)
    }

    pub fn list_session_todos(&mut self) -> Result<Vec<crate::rewind::HostTodoRecord>> {
        self.backend.list_session_todos()
    }

    pub fn submit_user_turn(
        &mut self,
        text: String,
        explicit_images: Option<Vec<String>>,
    ) -> Result<()> {
        self.backend.submit_user_turn(text, explicit_images)
    }

    pub fn list_mcp_servers(&mut self) -> Result<Vec<ManagedMcpServer>> {
        self.backend.list_mcp_servers()
    }

    pub fn list_hook_entries(&mut self) -> Result<Vec<crate::hooks_types::HookListItem>> {
        self.backend.list_hook_entries(None)
    }

    pub fn save_hook_entry(
        &mut self,
        workspace_binding: Option<&str>,
        request: &crate::hooks_types::SaveHookEntryRequest,
    ) -> Result<()> {
        self.backend.save_hook_entry(workspace_binding, request)
    }

    pub fn inspect_mcp_server(&mut self, name: &str) -> Result<McpServerInspection> {
        self.backend.inspect_mcp_server(name)
    }

    pub fn list_mcp_tools(&mut self, name: &str) -> Result<Vec<McpDiscoveredTool>> {
        self.backend.list_mcp_tools(name)
    }

    pub fn list_mcp_resources(&mut self, name: &str) -> Result<Vec<McpDiscoveredResource>> {
        self.backend.list_mcp_resources(name)
    }

    pub fn list_mcp_prompts(&mut self, name: &str) -> Result<Vec<McpDiscoveredPrompt>> {
        self.backend.list_mcp_prompts(name)
    }

    pub fn list_cached_mcp_prompts(&mut self, name: &str) -> Result<Vec<McpDiscoveredPrompt>> {
        self.backend.list_cached_mcp_prompts(name)
    }

    pub fn attach_mcp_resource(&mut self, server: &str, uri: &str) -> Result<String> {
        self.backend.attach_mcp_resource(server, uri)
    }

    pub fn clear_pending_mcp_resources(&mut self) -> usize {
        self.backend.clear_pending_mcp_resources()
    }

    pub fn apply_mcp_prompt(
        &mut self,
        server: &str,
        prompt: &str,
        args_json: Option<&str>,
        user_message: Option<&str>,
    ) -> Result<String> {
        self.backend
            .apply_mcp_prompt(server, prompt, args_json, user_message)
    }

    pub fn add_mcp_server(
        &mut self,
        scope: McpScope,
        name: &str,
        config: McpServerConfig,
    ) -> Result<PathBuf> {
        self.backend.add_mcp_server(scope, name, config)
    }

    pub fn execute_mcp_tool(
        &mut self,
        server: &str,
        tool_name: &str,
        args_json: Option<&str>,
    ) -> Result<()> {
        self.backend.execute_mcp_tool(server, tool_name, args_json)
    }

    pub fn respond_to_pending_tool_approval(&mut self, message: &str) {
        self.backend.respond_to_pending_tool_approval(message)
    }

    pub fn respond_to_pending_questions(&mut self, result: &AskQuestionsResult) {
        self.backend.respond_to_pending_questions(result)
    }

    pub fn execute_manual_tool_command(&mut self, message: &str) {
        self.backend.execute_manual_tool_command(message)
    }

    pub fn compact_history(&mut self) {
        self.backend.compact_history()
    }

    pub fn replace_session_from_archive(&mut self, archive: &crate::ports::ChatArchive) {
        self.backend.replace_session_from_archive(archive)
    }

    pub fn attach_or_open_chat_session(
        &mut self,
        chat_path: &Path,
        archive: &crate::ports::ChatArchive,
    ) -> Result<AttachChatSessionOutcome> {
        self.backend.attach_or_open_chat_session(chat_path, archive)
    }

    pub fn fetch_live_chat_archive(&mut self) -> Result<ChatArchive> {
        self.backend.fetch_live_chat_archive()
    }

    pub fn desktop_timeline_resync_pending(&self) -> bool {
        self.backend.desktop_timeline_resync_pending()
    }

    pub fn clear_desktop_timeline_resync_pending(&mut self) {
        self.backend.clear_desktop_timeline_resync_pending()
    }

    pub fn take_pending_session_title(&mut self) -> Option<String> {
        self.backend.take_pending_session_title()
    }

    pub fn fetch_live_desktop_timeline(
        &mut self,
    ) -> Result<Option<Vec<crate::rewind::ConversationMessageSnapshot>>> {
        self.backend.fetch_live_desktop_timeline()
    }

    pub fn migrate_conversation_key(&mut self, conversation_key: &str) -> Result<()> {
        self.backend.migrate_conversation_key(conversation_key)
    }

    pub fn activate_forked_session(
        &mut self,
        archive: &crate::ports::ChatArchive,
        todos: Vec<crate::rewind::HostTodoRecord>,
    ) -> Result<()> {
        self.backend.activate_forked_session(archive, todos)
    }

    pub fn reset_session(&mut self) -> Result<()> {
        self.backend.reset_session()
    }

    pub fn run_session_start(&mut self, source: &str) -> Result<()> {
        self.backend.run_session_start(source)
    }

    pub fn set_workspace_capability_trust_prompter(
        &mut self,
        prompter: Option<WorkspaceCapabilityTrustPrompter>,
    ) {
        self.backend
            .set_workspace_capability_trust_prompter(prompter)
    }

    pub fn has_workspace_capability_trust_prompter(&self) -> bool {
        self.backend.has_workspace_capability_trust_prompter()
    }

    pub fn add_pending_image(&mut self, path: String) {
        self.backend.add_pending_image(path)
    }

    pub fn clear_pending_images(&mut self) -> usize {
        self.backend.clear_pending_images()
    }
}
