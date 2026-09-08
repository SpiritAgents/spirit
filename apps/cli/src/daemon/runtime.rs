//! Daemon-backed runtime for the CLI: TUI-facing runtime surface backed by the
//! shared Spirit Server daemon. Events arrive as WebSocket push notifications.

use anyhow::{Result, anyhow};
use serde_json::{Value, json};
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use crate::{
    adapters::KeyringSecretStore,
    chat_archive::chat_archive_to_bridge_json,
    chat_store,
    host_protocol::{
        BridgeChatArchive, BridgeExportState, BridgeManualToolCommandStartResult,
        BridgeRuntimeEvent, BridgeRuntimeSnapshot, BridgeSubagentSessionArchiveEntry,
        BridgeWorkspaceFileReferenceSuggestions, CliExtensionEntry, CliHostMetadataSnapshot,
        CliMarketplaceActionResult, CliMarketplaceCatalogEntry, CliMarketplaceCatalogResponse,
        CliMarketplaceSource, WorkspaceCapabilityTrustDecision, WorkspaceCapabilityTrustPrompter,
        WorkspaceCapabilityTrustRequest,
    },
    host_runtime::RuntimeEvent,
    logging,
    model_registry::AppConfig,
    plan::{self, PlanMetadata, bootstrap_plan_metadata},
    ports::{
        AssistantAuxArchiveEntry, AttachChatSessionOutcome, ChatArchive, McpStatusSnapshot,
        SecretStore, SubagentSessionArchiveEntry, SubagentSessionSummary, normalize_approval_level,
        normalize_llm_http_version,
    },
    rewind::{self, DesktopRewindCheckpointSnapshot, RewindRestoreOutcome},
    runtime_sync::RuntimeSyncState,
    session::SessionModel,
    skills::ActiveSkillPayload,
    tool_ui::approval_decision_from_input,
    transport_config::{TransportHost, transport_config_will_change},
    view::{ChatMessage, PendingAssistantAux, PendingSubagentApprovalView},
};

use super::client::DaemonClient;
use super::resolve::{ensure_daemon, is_loopback_host};

/// Buffer window for draining daemon notifications without blocking.
const NOTIFICATION_DRAIN_TIMEOUT: Duration = Duration::from_millis(5);

pub(crate) struct DaemonRuntime {
    client: DaemonClient,
    /// None for host-only connections (management subcommands, no session).
    session_id: Option<String>,
    pub(crate) config: AppConfig,
    pub(crate) secret_store: Arc<dyn SecretStore>,
    pub(crate) workspace_root: PathBuf,
    pub(crate) sync: RuntimeSyncState,
    pub(crate) rewind: rewind::StoredDesktopRewindMetadata,
    pub(crate) plan_metadata: PlanMetadata,
    pub(crate) active_plan_path: Option<PathBuf>,
    daemon_failed: bool,
    workspace_capability_trust_prompter: Option<WorkspaceCapabilityTrustPrompter>,
    pending_local_client_turn_ids: HashSet<String>,
}

impl DaemonRuntime {
    pub fn new(
        config: AppConfig,
        secret_store: Arc<dyn SecretStore>,
        workspace_root: PathBuf,
    ) -> Result<Self> {
        let mut runtime = Self::connect(config, secret_store, workspace_root)?;

        let rewind = rewind::create_desktop_rewind_metadata();
        let created = runtime.client.call(
            "session.create",
            json!({
                "workspaceRoot": runtime.workspace_root.to_string_lossy(),
                "todoSessionKey": rewind.session_id,
            }),
        )?;
        let session_id = created
            .get("sessionId")
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| anyhow!("session.create did not return sessionId"))?;
        runtime.session_id = Some(session_id.clone());
        runtime
            .client
            .call("session.attach", json!({ "sessionId": session_id }))?;
        runtime.rewind = rewind;

        logging::log_event(&format!(
            "[daemon-runtime] connected session={}",
            runtime.session_id.as_deref().unwrap_or("<none>")
        ));
        runtime.apply_llm_http_version_from_config()?;
        runtime.apply_llm_client_version_from_build()?;
        runtime.sync_snapshot_remote()?;
        Ok(runtime)
    }

    /// Management-only connection (hooks/mcp/extension subcommands): no
    /// session, only `host.*` RPCs.
    pub fn new_host_only(workspace_root: PathBuf) -> Result<Self> {
        Self::connect(
            AppConfig::default(),
            Arc::new(KeyringSecretStore),
            workspace_root,
        )
    }

    fn connect(
        config: AppConfig,
        secret_store: Arc<dyn SecretStore>,
        workspace_root: PathBuf,
    ) -> Result<Self> {
        let (instance, token) = ensure_daemon(&workspace_root)?;
        if !is_loopback_host(&instance.host) {
            return Err(anyhow!("daemon host must be loopback: {}", instance.host));
        }
        let mut client = DaemonClient::connect(&instance.host, instance.port, &token)?;

        // The daemon greets each connection with server.connected.
        let hello = client
            .next_notification(Duration::from_secs(5))?
            .ok_or_else(|| anyhow!("daemon handshake timed out: server.connected not received"))?;
        if hello.get("method").and_then(Value::as_str) != Some("server.connected") {
            return Err(anyhow!(
                "daemon handshake failed: first frame was not server.connected"
            ));
        }

        client.call(
            "server.initialize",
            json!({
                "clientKind": "cli",
                "clientId": format!("cli-{}", std::process::id()),
                "workspaceRoot": workspace_root.to_string_lossy(),
            }),
        )?;

        let health = client.call("server.health", json!({}))?;
        let health_instance_id = health
            .get("instanceId")
            .and_then(Value::as_str)
            .unwrap_or("");
        if health_instance_id != instance.instance_id {
            return Err(anyhow!(
                "daemon health instanceId does not match registry: expected {}, got {}",
                instance.instance_id,
                health_instance_id
            ));
        }

        Ok(Self {
            client,
            session_id: None,
            config,
            secret_store,
            workspace_root,
            sync: RuntimeSyncState::new(),
            rewind: rewind::create_desktop_rewind_metadata(),
            plan_metadata: bootstrap_plan_metadata(),
            active_plan_path: None,
            daemon_failed: false,
            workspace_capability_trust_prompter: None,
            pending_local_client_turn_ids: HashSet::new(),
        })
    }

    fn conversation_key_for_path(chat_path: &Path) -> String {
        chat_store::conversation_key_for_path(chat_path)
    }

    fn is_attach_miss(err: &anyhow::Error) -> bool {
        err.to_string()
            .contains("no live session for conversationKey")
    }

    fn detach_current_session(&mut self) {
        self.sync.pending_session_title = None;
        if self.daemon_failed {
            return;
        }
        let Some(session_id) = self.session_id.take() else {
            return;
        };
        if let Err(err) = self
            .client
            .call("session.detach", json!({ "sessionId": session_id }))
        {
            logging::log_event(&format!("[daemon-runtime] session.detach failed: {err}"));
        }
    }

    fn try_attach_session(&mut self, conversation_key: &str) -> Result<()> {
        let value = self.client.call(
            "session.attach",
            json!({ "conversationKey": conversation_key }),
        )?;
        let session_id = value
            .get("session")
            .and_then(|session| session.get("sessionId"))
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| anyhow!("session.attach did not return sessionId"))?;
        self.session_id = Some(session_id);
        let snapshot = value.get("snapshot").cloned().unwrap_or(Value::Null);
        self.sync
            .apply_snapshot(serde_json::from_value::<BridgeRuntimeSnapshot>(snapshot)?);
        Ok(())
    }

    fn create_and_attach_session(
        &mut self,
        conversation_key: &str,
        archive: &ChatArchive,
    ) -> Result<()> {
        let created = self.client.call(
            "session.create",
            json!({
                "workspaceRoot": self.workspace_root.to_string_lossy(),
                "conversationKey": conversation_key,
                "todoSessionKey": conversation_key,
            }),
        )?;
        let session_id = created
            .get("sessionId")
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| anyhow!("session.create did not return sessionId"))?;
        self.session_id = Some(session_id);
        self.client.call(
            "session.attach",
            json!({ "conversationKey": conversation_key }),
        )?;
        self.replace_runtime_archive(archive)?;
        Ok(())
    }

    fn apply_loaded_chat_metadata(&mut self, archive: &ChatArchive, conversation_key: &str) {
        self.rewind = rewind::normalize_desktop_rewind_metadata(archive.rewind.as_ref());
        self.apply_live_session_plan_metadata(&archive.llm_history);
        if let Err(err) = self.set_todo_session_key(conversation_key) {
            logging::log_event(&format!(
                "[daemon-runtime] set_todo_session_key failed: {err}"
            ));
        }
    }

    fn apply_live_session_plan_metadata(
        &mut self,
        llm_history: &[crate::ports::ArchivedLlmMessage],
    ) {
        self.active_plan_path =
            plan::extract_active_plan_path_from_archived_llm_history(llm_history);
        self.plan_metadata = plan::plan_metadata_snapshot(
            self.plan_metadata.agent_mode(),
            self.active_plan_path.as_deref(),
        );
    }

    fn apply_attached_live_session_metadata(&mut self, conversation_key: &str) -> Result<()> {
        if let Err(err) = self.set_todo_session_key(conversation_key) {
            logging::log_event(&format!(
                "[daemon-runtime] set_todo_session_key failed: {err}"
            ));
        }
        let live = self.export_chat_archive(&[], &[])?;
        self.apply_live_session_plan_metadata(&live.llm_history);
        Ok(())
    }

    /// Bind the active daemon session to a stable chat file path.
    pub fn migrate_conversation_key(&mut self, conversation_key: &str) -> Result<()> {
        if self.daemon_failed {
            return Err(anyhow!("daemon connection is already in a failed state."));
        }
        self.call_daemon(
            "session.migrateConversationKey",
            Some(json!({ "conversationKey": conversation_key })),
        )?;
        Ok(())
    }

    /// Join a live daemon session by chat path, or create and hydrate when none exists.
    pub fn attach_or_open_chat_session(
        &mut self,
        chat_path: &Path,
        archive: &ChatArchive,
    ) -> Result<AttachChatSessionOutcome> {
        if self.daemon_failed {
            return Err(anyhow!("daemon connection is already in a failed state."));
        }
        let conversation_key = Self::conversation_key_for_path(chat_path);
        self.detach_current_session();
        self.sync.subagent_message_cache.clear();

        match self.try_attach_session(&conversation_key) {
            Ok(()) => {
                self.apply_attached_live_session_metadata(&conversation_key)?;
                Ok(AttachChatSessionOutcome::AttachedLive)
            }
            Err(err) if Self::is_attach_miss(&err) => {
                self.create_and_attach_session(&conversation_key, archive)?;
                self.apply_loaded_chat_metadata(archive, &conversation_key);
                Ok(AttachChatSessionOutcome::Created)
            }
            Err(err) => {
                self.handle_daemon_error(err);
                Err(anyhow!("session.attach failed"))
            }
        }
    }

    /// Export the daemon session's live archive (llm history, subagents, loop state).
    pub fn fetch_live_chat_archive(&mut self) -> Result<ChatArchive> {
        self.export_chat_archive(&[], &[])
    }

    pub fn desktop_timeline_resync_pending(&self) -> bool {
        self.sync.desktop_timeline_resync_pending
    }

    pub fn clear_desktop_timeline_resync_pending(&mut self) {
        self.sync.desktop_timeline_resync_pending = false;
    }

    pub fn take_pending_session_title(&mut self) -> Option<String> {
        self.sync.pending_session_title.take()
    }

    /// Pull the daemon-stored desktop timeline and hydrate it like a disk load.
    pub fn fetch_live_desktop_timeline(
        &mut self,
    ) -> Result<Option<Vec<crate::rewind::ConversationMessageSnapshot>>> {
        let value = self.call_daemon("session.getDesktopTimeline", None)?;
        if value.is_null() {
            return Ok(None);
        }
        let result: crate::host_protocol::BridgeDesktopTimelineResult =
            serde_json::from_value(value)?;
        let snapshots =
            crate::chat_timeline::hydrate_desktop_messages_from_timeline(&result.timeline);
        if snapshots.is_empty() {
            return Ok(None);
        }
        logging::log_event(&format!(
            "[daemon-runtime] fetched live desktop timeline revision={} messages={}",
            result.revision,
            snapshots.len()
        ));
        Ok(Some(snapshots))
    }

    // ------------------------------------------------------------ transport

    pub(crate) fn call_daemon(&mut self, method: &str, params: Option<Value>) -> Result<Value> {
        if self.daemon_failed {
            return Err(anyhow!("daemon connection is already in a failed state."));
        }
        let mut params = params.unwrap_or(Value::Null);
        if method.starts_with("session.") {
            let session_id = self
                .session_id
                .as_deref()
                .ok_or_else(|| anyhow!("current connection has no session (host-only)"))?;
            if let Value::Object(ref mut map) = params {
                map.insert("sessionId".to_string(), json!(session_id));
            } else {
                params = json!({ "sessionId": session_id });
            }
        }
        self.client.call(method, params).map_err(|err| {
            let message = err.to_string();
            if message.contains("daemon reader thread ended")
                || message.contains("daemon closed the connection")
                || message.contains("daemon writer poisoned")
            {
                return err;
            }
            anyhow!("runtime-error: {}", message)
        })
    }

    pub(crate) fn handle_daemon_error(&mut self, err: anyhow::Error) {
        let mut summary = err.to_string();
        let fatal = !summary.starts_with("runtime-error: ");
        if let Some(stripped) = summary.strip_prefix("runtime-error: ") {
            summary = stripped.to_string();
        }
        if fatal {
            self.daemon_failed = true;
        }
        logging::log_event(&format!(
            "[daemon-runtime] {}: {}",
            if fatal {
                "fatal error"
            } else {
                "runtime error"
            },
            summary
        ));
        let had_inflight_response =
            self.sync.is_busy_cache || self.sync.pending_aux_state.is_some();
        let had_pending_output = self.sync.pending_assistant_has_output;
        self.sync.is_busy_cache = false;
        self.sync.pending_aux_state = None;
        self.sync.pending_approval_kind = None;
        self.sync.pending_assistant_has_output = false;
        self.sync.session.clear_pending_user_turn();
        if had_inflight_response {
            self.sync.events.push_back(if had_pending_output {
                RuntimeEvent::AssistantResponseCompleted
            } else {
                RuntimeEvent::RemovePendingAssistant
            });
        }
        self.sync
            .events
            .push_back(RuntimeEvent::PushMessage(ChatMessage::new(
                crate::view::MessageRole::Agent,
                if fatal {
                    format!("daemon connection failed: {}", summary)
                } else {
                    format!("daemon execution failed: {}", summary)
                },
            )));
    }

    // ------------------------------------------------- notification intake

    /// Drains every buffered daemon notification into the sync projection.
    /// Called from `poll` / `drain_events` — the TUI's existing 50ms loop.
    fn pump_notifications(&mut self) {
        loop {
            match self.client.next_notification(NOTIFICATION_DRAIN_TIMEOUT) {
                Ok(Some(message)) => self.handle_notification(message),
                Ok(None) => break,
                Err(err) => {
                    self.handle_daemon_error(err);
                    break;
                }
            }
        }
    }

    fn handle_notification(&mut self, message: Value) {
        let method = message.get("method").and_then(Value::as_str).unwrap_or("");
        let params = message.get("params").cloned().unwrap_or(Value::Null);
        let for_this_session =
            params.get("sessionId").and_then(Value::as_str) == self.session_id.as_deref();

        match method {
            "runtime.event" if for_this_session => {
                let event_value = params.get("event").cloned().unwrap_or(Value::Null);
                match serde_json::from_value::<BridgeRuntimeEvent>(event_value) {
                    Ok(event) => self.sync.apply_bridge_events(vec![event]),
                    Err(err) => logging::log_event(&format!(
                        "[daemon-runtime] failed to parse runtime.event: {err}"
                    )),
                }
            }
            "session.snapshot" if for_this_session => {
                match serde_json::from_value::<BridgeRuntimeSnapshot>(
                    params.get("snapshot").cloned().unwrap_or(Value::Null),
                ) {
                    Ok(snapshot) => self.sync.apply_snapshot(snapshot),
                    Err(err) => logging::log_event(&format!(
                        "[daemon-runtime] failed to parse session.snapshot: {err}"
                    )),
                }
            }
            "session.turnFinished" if for_this_session => {
                // Terminal state is also reflected in the pushed snapshot; a
                // turnFinished without a fresh snapshot still forces a resync.
                if let Err(err) = self.sync_snapshot_remote() {
                    self.handle_daemon_error(err);
                }
            }
            "session.desktopTimelineUpdated" if for_this_session => {
                // The TUI applies the resync once idle (full snapshot pull).
                self.sync.desktop_timeline_resync_pending = true;
            }
            "session.fileChanged" if for_this_session => {
                let change = params.get("change").cloned().unwrap_or(Value::Null);
                match serde_json::from_value::<rewind::HostRecordedFileChange>(change) {
                    Ok(change) => {
                        if let Err(err) = self.record_host_file_change(change) {
                            logging::log_event(&format!(
                                "[daemon-runtime] record_host_file_change failed: {err}"
                            ));
                        }
                    }
                    Err(err) => logging::log_event(&format!(
                        "[daemon-runtime] failed to parse session.fileChanged: {err}"
                    )),
                }
            }
            "workspace.trustRequested" if for_this_session => {
                self.handle_trust_request(&params);
            }
            "session.titleUpdated" if for_this_session => {
                let title = params
                    .get("title")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string);
                if let Some(title) = title {
                    self.sync.pending_session_title = Some(title);
                }
            }
            "session.userTurnSubmitted" if for_this_session => {
                let text = params
                    .get("text")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                if let Some(client_turn_id) = params.get("clientTurnId").and_then(Value::as_str) {
                    if self.pending_local_client_turn_ids.remove(client_turn_id) {
                        return;
                    }
                }
                self.sync.push_remote_user_turn(text);
            }
            "session.subagentEvents" if for_this_session => {
                if let Some(drains) = params.get("drains").and_then(Value::as_array) {
                    for drain in drains {
                        let child_session_id = drain
                            .get("sessionId")
                            .and_then(Value::as_str)
                            .unwrap_or_default();
                        if child_session_id.is_empty() {
                            continue;
                        }
                        match serde_json::from_value::<Vec<BridgeRuntimeEvent>>(
                            drain.get("events").cloned().unwrap_or(Value::Null),
                        ) {
                            Ok(events) => self
                                .sync
                                .apply_subagent_bridge_events(child_session_id, events),
                            Err(err) => logging::log_event(&format!(
                                "[daemon-runtime] failed to parse session.subagentEvents: {err}"
                            )),
                        }
                    }
                }
            }
            _ => {}
        }
    }

    fn handle_trust_request(&mut self, params: &Value) {
        let request_id = params
            .get("requestId")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        if request_id.is_empty() {
            return;
        }
        let request: WorkspaceCapabilityTrustRequest =
            match serde_json::from_value(params.get("request").cloned().unwrap_or(Value::Null)) {
                Ok(request) => request,
                Err(err) => {
                    logging::log_event(&format!(
                        "[daemon-runtime] failed to parse workspace.trustRequested: {err}"
                    ));
                    return;
                }
            };
        // Take the prompter out so the nested UI can redraw without holding it via self.
        let mut prompter = self.workspace_capability_trust_prompter.take();
        let decision = match prompter.as_mut() {
            Some(prompter) => prompter(request),
            None => {
                logging::log_event("[workspace-trust] no interactive prompter registered; denying");
                WorkspaceCapabilityTrustDecision::Deny
            }
        };
        self.workspace_capability_trust_prompter = prompter;
        if let Err(err) = self.call_daemon(
            "session.replyWorkspaceCapabilityTrust",
            Some(json!({ "requestId": request_id, "decision": decision.as_str() })),
        ) {
            self.handle_daemon_error(err);
        }
    }

    fn sync_snapshot_remote(&mut self) -> Result<()> {
        let value = self.call_daemon("session.poll", None)?;
        let snapshot = value.get("snapshot").cloned().unwrap_or(Value::Null);
        self.sync.apply_snapshot(serde_json::from_value(snapshot)?);
        Ok(())
    }

    /// The daemon pumps server-side; the client-side loop only drains pushes
    /// and picks up completed manual tool results.
    pub fn poll(&mut self) {
        if self.daemon_failed {
            return;
        }
        self.pump_notifications();
        if let Err(err) = self.consume_completed_manual_tool_command_result() {
            self.handle_daemon_error(err);
        }
    }

    pub fn drain_events(&mut self) -> Vec<RuntimeEvent> {
        if !self.daemon_failed {
            self.pump_notifications();
        }
        self.sync.events.drain(..).collect()
    }

    pub fn handle_stream_stall_timeout(&mut self) {
        // Stream stall detection runs inside the daemon's session pump.
        self.pump_notifications();
    }

    // ------------------------------------------------------------ lifecycle

    pub fn abort(&mut self) {
        if self.daemon_failed {
            return;
        }
        if let Err(err) = self.call_daemon("session.abort", None) {
            self.handle_daemon_error(err);
        }
    }

    pub fn continue_assistant_completion(&mut self) -> Result<()> {
        if self.daemon_failed {
            return Err(anyhow!(
                "daemon is no longer available; cannot continue completing the reply"
            ));
        }
        self.call_daemon("session.continueAssistantCompletion", None)?;
        self.sync.is_busy_cache = true;
        Ok(())
    }

    pub fn run_session_start(&mut self, source: &str) -> Result<()> {
        if self.daemon_failed {
            return Err(anyhow!(
                "daemon is no longer available; cannot run sessionStart"
            ));
        }
        self.call_daemon("session.runSessionStart", Some(json!({ "source": source })))?;
        self.sync_snapshot_remote()?;
        Ok(())
    }

    pub fn reset_session(&mut self) -> Result<()> {
        if self.daemon_failed {
            return Err(anyhow!(
                "daemon is no longer available; cannot start a new session"
            ));
        }
        self.call_daemon("session.reset", None)?;
        self.sync.pending_session_title = None;
        self.rewind = rewind::create_desktop_rewind_metadata();
        let session_key = self.rewind.session_id.clone();
        self.set_todo_session_key(&session_key)?;
        self.active_plan_path = None;
        self.plan_metadata = plan::plan_metadata_snapshot(self.plan_metadata.agent_mode(), None);
        self.sync_snapshot_remote()?;
        Ok(())
    }

    // -------------------------------------------------------------- config

    pub fn config(&self) -> &AppConfig {
        &self.config
    }

    pub fn session(&self) -> &SessionModel {
        &self.sync.session
    }

    fn transport_host(&self) -> TransportHost<'_> {
        TransportHost {
            workspace_root: &self.workspace_root,
            secret_store: self.secret_store.as_ref(),
            stored_config: &self.config,
        }
    }

    pub fn validate_config_change(&self, config: &AppConfig) -> Result<()> {
        if !transport_config_will_change(&self.config, config) {
            return Ok(());
        }
        crate::transport_config::resolve_transport_config_json_for(&self.transport_host(), config)
            .map(|_| ())
    }

    pub fn replace_config(&mut self, config: AppConfig) {
        if let Err(err) = self.validate_config_change(&config) {
            self.sync
                .events
                .push_back(RuntimeEvent::PushMessage(ChatMessage::new(
                    crate::view::MessageRole::Agent,
                    err.to_string(),
                )));
            return;
        }
        let transport_changed = transport_config_will_change(&self.config, &config);
        self.config = config;
        if let Err(err) = self.apply_llm_http_version_from_config() {
            self.handle_daemon_error(err);
        }
        if let Err(err) = self.apply_attribution_to_daemon() {
            self.handle_daemon_error(err);
        }
        if !transport_changed {
            return;
        }
        // The daemon re-resolves the transport from the persisted config.json.
        if let Err(err) = self.call_daemon("session.replaceConfig", None) {
            self.handle_daemon_error(err);
        }
    }

    pub fn store_config(&mut self, config: AppConfig) {
        self.config = config;
    }

    pub(crate) fn apply_llm_http_version_from_config(&mut self) -> Result<()> {
        if self.daemon_failed {
            return Err(anyhow!("daemon is already in a failed state."));
        }
        let version = self.config.networks.llm_http_version.clone();
        self.set_llm_http_version(&version)
    }

    pub(crate) fn apply_llm_client_version_from_build(&mut self) -> Result<()> {
        if self.daemon_failed {
            return Err(anyhow!("daemon is already in a failed state."));
        }
        self.set_llm_client_version(env!("CARGO_PKG_VERSION"))
    }

    pub(crate) fn apply_attribution_to_daemon(&mut self) -> Result<()> {
        if self.daemon_failed {
            return Err(anyhow!("daemon is already in a failed state."));
        }
        let (commit_attribution, pr_attribution) =
            crate::model_registry::resolve_cli_attribution(&self.config);
        self.call_daemon(
            "session.setAttribution",
            Some(json!({
                "attribution": {
                    "commitEnabled": commit_attribution,
                    "prEnabled": pr_attribution,
                },
            })),
        )?;
        Ok(())
    }

    pub fn set_llm_http_version(&mut self, llm_http_version: &str) -> Result<()> {
        if self.daemon_failed {
            return Err(anyhow!("daemon is already in a failed state."));
        }
        let normalized = normalize_llm_http_version(llm_http_version);
        self.client.call(
            "server.setLlmHttpVersion",
            json!({ "llmHttpVersion": normalized }),
        )?;
        Ok(())
    }

    pub fn set_llm_client_version(&mut self, client_version: &str) -> Result<()> {
        if self.daemon_failed {
            return Err(anyhow!("daemon is already in a failed state."));
        }
        self.client.call(
            "server.setLlmClientVersion",
            json!({ "clientVersion": client_version }),
        )?;
        Ok(())
    }

    // --------------------------------------------------------- metadata

    pub fn replace_plan_metadata(&mut self, metadata: PlanMetadata) {
        self.plan_metadata = metadata;
        if !self.plan_metadata.path.as_os_str().is_empty() {
            self.active_plan_path = Some(self.plan_metadata.path.clone());
        }
        if self.daemon_failed {
            return;
        }
        if let Err(err) = self.call_daemon(
            "session.reloadHostMetadata",
            Some(json!({
                "mode": self.plan_metadata.agent_mode(),
            })),
        ) {
            self.handle_daemon_error(err);
        }
    }

    pub fn activate_skill(&mut self, skill: ActiveSkillPayload) -> Result<()> {
        if self.daemon_failed {
            return Err(anyhow!(
                "daemon is no longer available; cannot activate skill"
            ));
        }
        self.call_daemon("session.activateSkill", Some(json!({ "skill": skill })))?;
        Ok(())
    }

    pub fn has_active_plan(&self) -> bool {
        self.active_plan_path
            .as_ref()
            .is_some_and(|path| !path.as_os_str().is_empty())
    }

    pub fn active_plan_path(&self) -> Option<&std::path::Path> {
        self.active_plan_path.as_deref()
    }

    pub fn load_cli_host_metadata(&mut self, agent_mode: &str) -> Result<CliHostMetadataSnapshot> {
        let value = self.client.call(
            "host.loadCliMetadata",
            json!({
                "workspaceRoot": self.workspace_root.to_string_lossy(),
                "hostKind": "cli",
                "agentMode": agent_mode,
                "activePlanPath": self.active_plan_path.as_ref().map(|path| path.display().to_string()),
            }),
        )?;
        let metadata: CliHostMetadataSnapshot = serde_json::from_value(value)?;
        self.plan_metadata = metadata.plan_metadata.clone();
        Ok(metadata)
    }

    pub fn load_plan_metadata(&mut self, agent_mode: &str) -> Result<PlanMetadata> {
        let value = self.client.call(
            "host.loadPlanMetadata",
            json!({
                "workspaceRoot": self.workspace_root.to_string_lossy(),
                "agentMode": agent_mode,
                "activePlanPath": self.active_plan_path.as_ref().map(|path| path.display().to_string()),
            }),
        )?;
        Ok(serde_json::from_value(value)?)
    }

    pub fn list_workspace_file_reference_suggestions(
        &mut self,
        input: &str,
        cursor_chars: usize,
    ) -> Result<(Vec<String>, bool)> {
        let value = self.client.call(
            "host.listWorkspaceFileReferenceSuggestions",
            json!({
                "workspaceRoot": self.workspace_root.to_string_lossy(),
                "input": input,
                "cursorChars": cursor_chars,
            }),
        )?;
        if value.is_null() {
            return Ok((Vec::new(), true));
        }
        let suggestions: BridgeWorkspaceFileReferenceSuggestions = serde_json::from_value(value)?;
        Ok((
            suggestions.suggestions,
            suggestions.index_ready.unwrap_or(true),
        ))
    }

    pub fn prime_workspace_file_reference_index(&mut self) -> Result<()> {
        self.client.call(
            "host.primeWorkspaceFileReferenceIndex",
            json!({ "workspaceRoot": self.workspace_root.to_string_lossy() }),
        )?;
        Ok(())
    }

    pub fn write_rule_state(
        &mut self,
        enabled_overrides: std::collections::BTreeMap<String, bool>,
    ) -> Result<PathBuf> {
        let value = self.client.call(
            "host.writeRuleState",
            json!({
                "workspaceRoot": self.workspace_root.to_string_lossy(),
                "enabledOverrides": enabled_overrides,
            }),
        )?;
        let path = value
            .as_str()
            .ok_or_else(|| anyhow!("host.writeRuleState returned an invalid value"))?;
        Ok(PathBuf::from(path))
    }

    pub fn write_skill_state(
        &mut self,
        enabled_overrides: std::collections::BTreeMap<String, bool>,
    ) -> Result<PathBuf> {
        let value = self.client.call(
            "host.writeSkillState",
            json!({
                "workspaceRoot": self.workspace_root.to_string_lossy(),
                "enabledOverrides": enabled_overrides,
            }),
        )?;
        let path = value
            .as_str()
            .ok_or_else(|| anyhow!("host.writeSkillState returned an invalid value"))?;
        Ok(PathBuf::from(path))
    }

    pub fn reload_host_metadata(&mut self, agent_mode: &str) -> Result<()> {
        self.call_daemon(
            "session.reloadHostMetadata",
            Some(json!({ "mode": agent_mode })),
        )?;
        self.sync_snapshot_remote()?;
        Ok(())
    }

    pub fn validate_hooks(
        &mut self,
        workspace_root: Option<&str>,
    ) -> Result<crate::hooks_types::HooksValidationReport> {
        let value = self.client.call(
            "host.validateHooks",
            json!({
                "workspaceRoot": workspace_root
                    .map(str::to_string)
                    .unwrap_or_else(|| self.workspace_root.to_string_lossy().into_owned()),
            }),
        )?;
        Ok(serde_json::from_value(value)?)
    }

    pub fn list_hook_entries(
        &mut self,
        workspace_root: Option<&str>,
    ) -> Result<Vec<crate::hooks_types::HookListItem>> {
        let value = self.client.call(
            "host.listHookEntries",
            json!({
                "workspaceRoot": workspace_root
                    .map(str::to_string)
                    .unwrap_or_else(|| self.workspace_root.to_string_lossy().into_owned()),
            }),
        )?;
        Ok(serde_json::from_value(value)?)
    }

    pub fn save_hook_entry(
        &mut self,
        workspace_binding: Option<&str>,
        request: &crate::hooks_types::SaveHookEntryRequest,
    ) -> Result<()> {
        let mut params = json!({
            "workspaceRoot": self.workspace_root.to_string_lossy(),
            "request": request,
        });
        if let Some(obj) = params.as_object_mut()
            && let Some(binding) = workspace_binding
        {
            obj.insert("workspaceBinding".to_string(), json!(binding));
        }
        self.client.call("host.saveHookEntry", params)?;
        Ok(())
    }

    pub fn check_permission(
        &mut self,
        domain: &str,
        value: &str,
        workspace_root: Option<&str>,
    ) -> Result<crate::permissions_types::PermissionCheckResult> {
        let response = self.client.call(
            "host.checkPermission",
            json!({
                "domain": domain,
                "value": value,
                "workspaceRoot": workspace_root
                    .map(str::to_string)
                    .unwrap_or_else(|| self.workspace_root.to_string_lossy().into_owned()),
            }),
        )?;
        Ok(serde_json::from_value(response)?)
    }

    // --------------------------------------------------------- extensions

    pub fn list_extensions(&mut self) -> Result<Vec<CliExtensionEntry>> {
        let value = self
            .client
            .call("host.listExtensions", json!({ "hostKind": "cli" }))?;
        Ok(serde_json::from_value(value)?)
    }

    pub fn import_extension_archive(
        &mut self,
        archive_bytes: &[u8],
        file_name: Option<&str>,
    ) -> Result<CliExtensionEntry> {
        use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64_STANDARD};
        let value = self.client.call(
            "host.importExtension",
            json!({
                "hostKind": "cli",
                "archiveBase64": BASE64_STANDARD.encode(archive_bytes),
                "fileName": file_name,
            }),
        )?;
        Ok(serde_json::from_value(value)?)
    }

    pub fn delete_extension(&mut self, id: &str) -> Result<()> {
        self.client.call(
            "host.deleteExtension",
            json!({ "hostKind": "cli", "id": id }),
        )?;
        Ok(())
    }

    pub fn set_extension_enabled(&mut self, id: &str, enabled: bool) -> Result<()> {
        self.client.call(
            "host.setExtensionEnabled",
            json!({ "hostKind": "cli", "id": id, "enabled": enabled }),
        )?;
        Ok(())
    }

    pub fn list_marketplace_sources(&mut self) -> Result<Vec<CliMarketplaceSource>> {
        let value = self
            .client
            .call("host.listMarketplaceSources", json!({ "hostKind": "cli" }))?;
        Ok(serde_json::from_value(value)?)
    }

    pub fn add_marketplace_source(
        &mut self,
        locator: &str,
        git_ref: Option<&str>,
    ) -> Result<CliMarketplaceSource> {
        let value = self.client.call(
            "host.addMarketplaceSource",
            json!({ "locator": locator, "ref": git_ref }),
        )?;
        Ok(serde_json::from_value(value)?)
    }

    pub fn remove_marketplace_source(&mut self, name: &str) -> Result<CliMarketplaceSource> {
        let value = self
            .client
            .call("host.removeMarketplaceSource", json!({ "name": name }))?;
        Ok(serde_json::from_value(value)?)
    }

    pub fn list_marketplace_catalog(
        &mut self,
        source_id: &str,
    ) -> Result<CliMarketplaceCatalogResponse> {
        let value = self.client.call(
            "host.listMarketplaceCatalog",
            json!({ "hostKind": "cli", "sourceId": source_id }),
        )?;
        Ok(serde_json::from_value(value)?)
    }

    pub fn get_marketplace_extension_detail(
        &mut self,
        source_id: &str,
        name: &str,
    ) -> Result<CliMarketplaceCatalogEntry> {
        let value = self.client.call(
            "host.getMarketplaceExtensionDetail",
            json!({ "hostKind": "cli", "sourceId": source_id, "name": name }),
        )?;
        Ok(serde_json::from_value(value)?)
    }

    pub fn install_marketplace_extension(
        &mut self,
        name: &str,
        marketplace: Option<&str>,
        review_acknowledged: bool,
    ) -> Result<CliMarketplaceActionResult> {
        let value = self.client.call(
            "host.installMarketplaceExtension",
            json!({
                "hostKind": "cli",
                "name": name,
                "marketplace": marketplace,
                "reviewAcknowledged": review_acknowledged,
            }),
        )?;
        Ok(serde_json::from_value(value)?)
    }

    pub fn update_extension(
        &mut self,
        id: &str,
        review_acknowledged: bool,
    ) -> Result<CliMarketplaceActionResult> {
        let value = self.client.call(
            "host.updateExtension",
            json!({ "hostKind": "cli", "id": id, "reviewAcknowledged": review_acknowledged }),
        )?;
        Ok(serde_json::from_value(value)?)
    }

    // ------------------------------------------------------------ sessions

    pub fn submit_user_turn(
        &mut self,
        text: String,
        explicit_images: Option<Vec<String>>,
    ) -> Result<()> {
        if self.daemon_failed {
            return Err(anyhow!("daemon is already in a failed state."));
        }
        let client_turn_id = uuid::Uuid::new_v4().to_string();
        self.pending_local_client_turn_ids
            .insert(client_turn_id.clone());
        let mut params = json!({
            "text": text,
            "clientTurnId": client_turn_id,
        });
        if let Some(images) = explicit_images {
            params["explicitImages"] = serde_json::to_value(images).unwrap_or(Value::Array(vec![]));
        }
        logging::log_event(&format!(
            "[daemon-runtime] submit_user_turn chars={} explicit_images={}",
            params
                .get("text")
                .and_then(Value::as_str)
                .map(|text| text.chars().count())
                .unwrap_or(0),
            params
                .get("explicitImages")
                .and_then(Value::as_array)
                .map(|items| items.len())
                .unwrap_or(0)
        ));
        if let Err(err) = self.call_daemon("session.submitUserTurn", Some(params)) {
            self.pending_local_client_turn_ids.remove(&client_turn_id);
            return Err(err);
        }
        // The turn is now running (or queued); the daemon's pushed snapshots
        // maintain the busy flag from here. Set the edge locally so callers
        // that immediately check is_busy (headless loop) don't exit early.
        self.sync.is_busy_cache = true;
        Ok(())
    }

    pub fn compact_history(&mut self) {
        if self.daemon_failed {
            return;
        }
        match self.call_daemon("session.compactHistory", None) {
            Ok(_) => {
                self.sync.is_busy_cache = true;
            }
            Err(err) => self.handle_daemon_error(err),
        }
    }

    pub fn replace_session_from_archive(&mut self, archive: &ChatArchive) {
        if let Err(err) = self.replace_runtime_archive(archive) {
            self.handle_daemon_error(err);
            return;
        }
        self.rewind = rewind::normalize_desktop_rewind_metadata(archive.rewind.as_ref());
        self.active_plan_path =
            plan::extract_active_plan_path_from_archived_llm_history(&archive.llm_history);
        self.plan_metadata = plan::plan_metadata_snapshot(
            self.plan_metadata.agent_mode(),
            self.active_plan_path.as_deref(),
        );
    }

    pub fn activate_forked_session(
        &mut self,
        archive: &ChatArchive,
        todos: Vec<rewind::HostTodoRecord>,
    ) -> Result<()> {
        self.sync.pending_session_title = None;
        self.replace_runtime_archive(archive)?;
        self.rewind = rewind::normalize_desktop_rewind_metadata(archive.rewind.as_ref());
        self.active_plan_path =
            plan::extract_active_plan_path_from_archived_llm_history(&archive.llm_history);
        self.plan_metadata = plan::plan_metadata_snapshot(
            self.plan_metadata.agent_mode(),
            self.active_plan_path.as_deref(),
        );
        let session_key = self.rewind.session_id.clone();
        self.set_todo_session_key(&session_key)?;
        self.replace_session_todos(todos)?;
        Ok(())
    }

    pub(crate) fn replace_runtime_archive(&mut self, archive: &ChatArchive) -> Result<()> {
        if self.daemon_failed {
            return Ok(());
        }
        self.sync.subagent_message_cache.clear();
        self.call_daemon(
            "session.replaceFromArchive",
            Some(json!({ "archive": chat_archive_to_bridge_json(archive) })),
        )?;
        self.sync_snapshot_remote()
    }

    // -------------------------------------------------------------- rewind

    pub fn can_rewind_message(&self, message_id: usize) -> bool {
        self.rewind.can_rewind_message(message_id)
    }

    pub fn set_todo_session_key(&mut self, session_key: &str) -> Result<()> {
        self.call_daemon(
            "session.setTodoSessionKey",
            Some(json!({ "sessionKey": session_key })),
        )?;
        Ok(())
    }

    pub fn list_session_todos(&mut self) -> Result<Vec<rewind::HostTodoRecord>> {
        #[derive(serde::Deserialize)]
        struct HostTodoListResponse {
            todos: Vec<rewind::HostTodoRecord>,
        }
        let session_id = self
            .session_id
            .clone()
            .ok_or_else(|| anyhow!("current connection has no session (host-only)"))?;
        let value = self
            .client
            .call("host.listSessionTodos", json!({ "sessionId": session_id }))?;
        let parsed: HostTodoListResponse = serde_json::from_value(value)?;
        Ok(parsed.todos)
    }

    pub fn replace_session_todos(&mut self, records: Vec<rewind::HostTodoRecord>) -> Result<()> {
        let session_id = self
            .session_id
            .clone()
            .ok_or_else(|| anyhow!("current connection has no session (host-only)"))?;
        self.client.call(
            "host.replaceSessionTodos",
            json!({ "sessionId": session_id, "records": records }),
        )?;
        Ok(())
    }

    pub fn record_rewind_checkpoint(
        &mut self,
        message_id: usize,
        message_index: usize,
        snapshot: DesktopRewindCheckpointSnapshot,
    ) -> Result<()> {
        let checkpoint = rewind::create_rewind_checkpoint_metadata(
            message_id,
            message_index,
            self.rewind.next_sequence(),
        );
        let spirit_data_dir = crate::mcp::spirit_data_dir();
        rewind::save_rewind_checkpoint_snapshot(
            &spirit_data_dir,
            &self.rewind.session_id,
            &checkpoint.id,
            &snapshot,
        )?;
        self.rewind.upsert_checkpoint(checkpoint);
        Ok(())
    }

    pub fn rewind_message(&mut self, message_id: usize) -> Result<RewindRestoreOutcome> {
        let checkpoint = self
            .rewind
            .checkpoint_for_message_id(message_id)
            .cloned()
            .ok_or_else(|| anyhow!("This message has no rewind checkpoint available."))?;
        let spirit_data_dir = crate::mcp::spirit_data_dir();
        let snapshot = rewind::load_rewind_checkpoint_snapshot(
            &spirit_data_dir,
            &self.rewind.session_id,
            &checkpoint.id,
        )?
        .ok_or_else(|| anyhow!("The rewind checkpoint file does not exist; cannot rewind."))?;

        let changes_to_restore = self
            .rewind
            .file_changes
            .iter()
            .filter(|change| change.sequence > checkpoint.sequence)
            .cloned()
            .collect::<Vec<_>>();
        let mut loaded_changes = Vec::new();
        let mut warnings = Vec::new();
        for metadata in changes_to_restore {
            if let Some(stored) = rewind::load_rewind_file_change(
                &spirit_data_dir,
                &self.rewind.session_id,
                &metadata.id,
            )? {
                loaded_changes.push(stored);
            } else {
                warnings.push(rewind::HostFileRewindWarning {
                    change_id: Some(metadata.id.clone()),
                    path: metadata.resolved_path.clone(),
                    action: metadata.kind.clone(),
                    message: "File change snapshot is missing; this rewind item was skipped."
                        .to_string(),
                });
            }
        }

        let restore_result = rewind::restore_host_file_changes(&loaded_changes)?;
        let mut outcome = rewind::resolve_before_checkpoint_state(&snapshot);
        outcome.restored = restore_result.restored;
        outcome.skipped = restore_result.skipped + warnings.len();
        outcome.warnings.extend(warnings);
        outcome.warnings.extend(restore_result.warnings);

        self.rewind.prune_after_checkpoint(checkpoint.sequence);
        self.replace_runtime_archive(&outcome.before_archive)?;
        let todos_to_restore = snapshot
            .before_todos
            .clone()
            .or(snapshot.todos.clone())
            .unwrap_or_default();
        self.replace_session_todos(todos_to_restore)?;
        Ok(outcome)
    }

    pub(crate) fn record_host_file_change(
        &mut self,
        change: rewind::HostRecordedFileChange,
    ) -> Result<()> {
        if change.tool_name == "create_plan" && change.after.exists {
            self.active_plan_path = Some(PathBuf::from(change.resolved_path.clone()));
            self.plan_metadata = plan::plan_metadata_snapshot(
                self.plan_metadata.agent_mode(),
                self.active_plan_path.as_deref(),
            );
        }

        let spirit_data_dir = crate::mcp::spirit_data_dir();
        let stored = rewind::to_desktop_file_change(change, self.rewind.next_sequence());
        rewind::save_rewind_file_change(&spirit_data_dir, &self.rewind.session_id, &stored)?;
        self.rewind
            .file_changes
            .push(rewind::file_change_metadata(&stored));
        self.rewind.file_changes.sort_by_key(|entry| entry.sequence);
        Ok(())
    }

    // ---------------------------------------------------------------- state

    pub fn pending_aux_state(&self) -> Option<PendingAssistantAux> {
        self.sync.pending_aux_state.clone()
    }

    pub fn is_busy(&self) -> bool {
        self.sync.is_busy_cache
    }

    pub fn loop_enabled(&self) -> bool {
        self.sync.session.loop_enabled()
    }

    pub fn set_loop_enabled(&mut self, enabled: bool) -> Result<()> {
        if self.daemon_failed {
            return Err(anyhow!("daemon is already in a failed state."));
        }
        self.call_daemon(
            "session.setLoopEnabled",
            Some(json!({ "enabled": enabled })),
        )?;
        self.sync_snapshot_remote()?;
        Ok(())
    }

    pub fn approval_level(&self) -> &str {
        self.sync.session.approval_level()
    }

    pub fn set_approval_level(&mut self, approval_level: &str) -> Result<()> {
        if self.daemon_failed {
            return Err(anyhow!("daemon is already in a failed state."));
        }
        let normalized = normalize_approval_level(approval_level);
        self.call_daemon(
            "session.setApprovalLevel",
            Some(json!({ "approvalLevel": normalized })),
        )?;
        self.sync_snapshot_remote()?;
        Ok(())
    }

    pub fn has_pending_tool_approval(&self) -> bool {
        self.sync.pending_approval_kind.is_some()
    }

    pub fn respond_to_pending_tool_approval(&mut self, message: &str) {
        if self.daemon_failed {
            return;
        }
        let decision = approval_decision_from_input(message);
        let method = match self.sync.pending_approval_kind {
            Some(crate::runtime_sync::PendingApprovalKind::Manual) => {
                "session.continuePendingManualToolApproval"
            }
            Some(crate::runtime_sync::PendingApprovalKind::Tool) => "session.replyPendingApproval",
            None => return,
        };
        if let Err(err) = self.call_daemon(method, Some(json!({ "decision": decision }))) {
            self.handle_daemon_error(err);
        }
    }

    pub fn respond_to_pending_questions(
        &mut self,
        result: &crate::ask_questions::AskQuestionsResult,
    ) {
        if self.daemon_failed {
            return;
        }
        if let Err(err) = self.call_daemon(
            "session.replyPendingQuestions",
            Some(json!({ "result": result })),
        ) {
            self.handle_daemon_error(err);
        }
    }

    pub fn execute_manual_tool_command(&mut self, message: &str) {
        if self.daemon_failed {
            return;
        }
        let value = match self.call_daemon(
            "session.startManualToolCommand",
            Some(json!({ "message": message })),
        ) {
            Ok(value) => value,
            Err(err) => {
                self.handle_daemon_error(err);
                return;
            }
        };
        if let Err(err) = self.handle_manual_tool_command_bridge_response(&value) {
            self.handle_daemon_error(err);
        }
    }

    pub(crate) fn consume_completed_manual_tool_command_result(&mut self) -> Result<()> {
        let value = self.call_daemon("session.takeCompletedManualToolCommandResult", None)?;
        if value.is_null() {
            return Ok(());
        }
        let result: BridgeManualToolCommandStartResult = serde_json::from_value(value)?;
        self.sync.handle_manual_tool_command_result(result);
        Ok(())
    }

    pub(crate) fn handle_manual_tool_command_bridge_response(
        &mut self,
        value: &Value,
    ) -> Result<()> {
        let result_value = if value.get("kind").is_some() {
            value.clone()
        } else {
            match value.get("result") {
                Some(nested) => nested.clone(),
                None => return Ok(()),
            }
        };
        let result: BridgeManualToolCommandStartResult = serde_json::from_value(result_value)?;
        self.sync.handle_manual_tool_command_result(result);
        Ok(())
    }

    // ------------------------------------------------------------------ MCP

    fn mcp_call(&mut self, action: &str, params: Value) -> Result<Value> {
        if self.session_id.is_some() {
            return self.call_daemon(
                "session.mcp",
                Some(json!({ "action": action, "params": params })),
            );
        }
        // Host-only connections use the workspace-scoped shared MCP service.
        self.client.call(
            "host.mcp",
            json!({
                "workspaceRoot": self.workspace_root.to_string_lossy(),
                "action": action,
                "params": params,
            }),
        )
    }

    pub fn read_mcp_resource_value(&mut self, server: &str, uri: &str) -> Result<Value> {
        self.mcp_call("readMcpResource", json!({ "server": server, "uri": uri }))
    }

    pub fn get_mcp_prompt_value(
        &mut self,
        server: &str,
        prompt: &str,
        args_json: Option<&str>,
    ) -> Result<Value> {
        let mut params = json!({ "server": server, "prompt": prompt });
        if let Some(args_json) = args_json {
            params["argsJson"] = Value::String(args_json.to_string());
        }
        self.mcp_call("getMcpPrompt", params)
    }

    pub fn call_mcp_tool_value(
        &mut self,
        server: &str,
        tool_name: &str,
        args_json: Option<&str>,
    ) -> Result<Value> {
        let mut params = json!({ "server": server, "tool": tool_name });
        if let Some(args_json) = args_json {
            params["argsJson"] = Value::String(args_json.to_string());
        }
        self.mcp_call("callMcpTool", params)
    }

    pub fn list_mcp_servers(&mut self) -> Result<Vec<crate::mcp_types::ManagedMcpServer>> {
        let value = self.mcp_call("listMcpServers", Value::Null)?;
        Ok(serde_json::from_value(value)?)
    }

    pub fn inspect_mcp_server(
        &mut self,
        name: &str,
    ) -> Result<crate::mcp_types::McpServerInspection> {
        let value = self.mcp_call("inspectMcpServer", json!({ "name": name }))?;
        Ok(serde_json::from_value(value)?)
    }

    pub fn list_mcp_tools(
        &mut self,
        name: &str,
    ) -> Result<Vec<crate::mcp_types::McpDiscoveredTool>> {
        let value = self.mcp_call("listMcpTools", json!({ "name": name }))?;
        Ok(serde_json::from_value(value)?)
    }

    pub fn list_mcp_resources(
        &mut self,
        name: &str,
    ) -> Result<Vec<crate::mcp_types::McpDiscoveredResource>> {
        let value = self.mcp_call("listMcpResources", json!({ "name": name }))?;
        Ok(serde_json::from_value(value)?)
    }

    pub fn list_mcp_prompts(
        &mut self,
        name: &str,
    ) -> Result<Vec<crate::mcp_types::McpDiscoveredPrompt>> {
        let value = self.mcp_call("listMcpPrompts", json!({ "name": name }))?;
        Ok(serde_json::from_value(value)?)
    }

    pub fn list_cached_mcp_prompts(
        &mut self,
        name: &str,
    ) -> Result<Vec<crate::mcp_types::McpDiscoveredPrompt>> {
        let value = self.mcp_call("listCachedMcpPrompts", json!({ "name": name }))?;
        Ok(serde_json::from_value(value)?)
    }

    pub fn attach_mcp_resource(&mut self, server: &str, uri: &str) -> Result<String> {
        let value = self.call_daemon(
            "session.attachMcpResource",
            Some(json!({ "server": server, "uri": uri })),
        )?;
        let label = value
            .get("label")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow!("session.attachMcpResource did not return label"))?
            .to_string();
        self.sync_snapshot_remote()?;
        Ok(label)
    }

    pub fn clear_pending_mcp_resources(&mut self) -> usize {
        let cleared = match self.call_daemon("session.clearPendingMcpResources", None) {
            Ok(value) => value.get("cleared").and_then(Value::as_u64).unwrap_or(0) as usize,
            Err(err) => {
                self.handle_daemon_error(err);
                return 0;
            }
        };
        if let Err(err) = self.sync_snapshot_remote() {
            self.handle_daemon_error(err);
        }
        cleared
    }

    pub fn apply_mcp_prompt(
        &mut self,
        server: &str,
        prompt: &str,
        args_json: Option<&str>,
        user_message: Option<&str>,
    ) -> Result<String> {
        let mut params = json!({ "server": server, "prompt": prompt });
        if let Some(args_json) = args_json {
            params["argsJson"] = Value::String(args_json.to_string());
        }
        if let Some(user_message) = user_message {
            params["userMessage"] = Value::String(user_message.to_string());
        }
        let value = self.call_daemon("session.applyMcpPrompt", Some(params))?;
        self.sync.is_busy_cache = true;
        let notice = value
            .get("notice")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow!("session.applyMcpPrompt did not return notice"))?
            .to_string();
        Ok(notice)
    }

    pub fn add_mcp_server(
        &mut self,
        scope: crate::mcp::McpScope,
        name: &str,
        config: crate::mcp::McpServerConfig,
    ) -> Result<PathBuf> {
        let path = crate::mcp::add_mcp_server(&self.workspace_root, scope, name, config)?;
        let _ = self.mcp_call("startMcpBackgroundRefresh", Value::Null)?;
        Ok(path)
    }

    pub fn execute_mcp_tool(
        &mut self,
        server: &str,
        tool_name: &str,
        args_json: Option<&str>,
    ) -> Result<()> {
        let mut inner = json!({ "server": server, "tool": tool_name });
        if let Some(args_json) = args_json {
            inner["argsJson"] = Value::String(args_json.to_string());
        }
        let value = self.mcp_call("startManualMcpTool", inner)?;
        self.handle_manual_tool_command_bridge_response(&value)?;
        Ok(())
    }

    pub fn mcp_status_snapshot(&mut self) -> McpStatusSnapshot {
        match self.mcp_call("mcpStatusSnapshot", Value::Null) {
            Ok(value) => serde_json::from_value(value).unwrap_or_default(),
            Err(err) => {
                logging::log_event(&format!(
                    "[daemon-runtime] read mcpStatusSnapshot failed: {}",
                    err
                ));
                McpStatusSnapshot::default()
            }
        }
    }

    // -------------------------------------------------------------- export

    pub fn export_llm_state(&mut self) -> Result<crate::runtime_handle::RuntimeExportState> {
        let value = self.call_daemon("session.exportState", None)?;
        let export: BridgeExportState = serde_json::from_value(value)?;
        Ok(crate::runtime_handle::RuntimeExportState {
            api_messages: export.api_messages,
            system_prompts: export.system_prompts,
            api_request_trace: export.request_trace,
        })
    }

    pub fn export_chat_archive(
        &mut self,
        messages: &[(String, String)],
        assistant_aux: &[AssistantAuxArchiveEntry],
    ) -> Result<ChatArchive> {
        let message_values = messages
            .iter()
            .map(|(role, content)| json!({ "role": role, "content": content }))
            .collect::<Vec<_>>();
        let value = self.call_daemon(
            "session.exportArchive",
            Some(json!({ "messages": message_values, "assistantAux": assistant_aux })),
        )?;
        let bridge_archive: BridgeChatArchive = serde_json::from_value(value)?;
        // Live timeline pushed by the authoritative desktop host; hydrate it
        // into desktop messages exactly like a disk load would.
        let desktop_messages = bridge_archive
            .desktop_message_timeline
            .as_deref()
            .map(crate::chat_timeline::hydrate_desktop_messages_from_timeline)
            .filter(|snapshots| !snapshots.is_empty());
        Ok(ChatArchive {
            messages: bridge_archive
                .messages
                .into_iter()
                .map(|message| (message.role, message.content))
                .collect(),
            assistant_aux: bridge_archive
                .assistant_aux
                .into_iter()
                .map(|entry| AssistantAuxArchiveEntry {
                    message_index: entry.message_index,
                    thinking: entry.thinking,
                    compaction: entry.compaction,
                    finish_task_notice: entry.finish_task_notice,
                })
                .collect(),
            llm_history: bridge_archive.llm_history,
            loop_enabled: bridge_archive.loop_enabled,
            approval_level: normalize_approval_level(&bridge_archive.approval_level),
            subagent_sessions: bridge_archive
                .subagent_sessions
                .into_iter()
                .map(|entry| SubagentSessionArchiveEntry {
                    summary: SubagentSessionSummary {
                        session_id: entry.summary.session_id,
                        parent_tool_call_id: entry.summary.parent_tool_call_id,
                        title: entry.summary.title,
                        status: entry.summary.status,
                        started_at_unix_ms: entry.summary.started_at_unix_ms,
                        updated_at_unix_ms: entry.summary.updated_at_unix_ms,
                        completed_at_unix_ms: entry.summary.completed_at_unix_ms,
                        latest_message: entry.summary.latest_message,
                        final_output: entry.summary.final_output,
                        error: entry.summary.error,
                    },
                    llm_history: entry.llm_history,
                })
                .collect(),
            desktop_messages,
            rewind: Some(self.rewind.as_json()),
            session_display_name: None,
            session_title_source: None,
        })
    }

    // ------------------------------------------------------------ subagents

    pub fn subagent_sessions(&self) -> &[SubagentSessionSummary] {
        &self.sync.child_sessions_cache
    }

    pub fn subagent_session_archive(
        &mut self,
        session_id: &str,
    ) -> Result<Option<SubagentSessionArchiveEntry>> {
        let value = self.call_daemon(
            "session.subagentSessionArchive",
            Some(json!({ "subagentSessionId": session_id })),
        )?;
        if value.is_null() {
            return Ok(None);
        }
        let archive: BridgeSubagentSessionArchiveEntry = serde_json::from_value(value)?;
        Ok(Some(SubagentSessionArchiveEntry {
            summary: SubagentSessionSummary {
                session_id: archive.summary.session_id,
                parent_tool_call_id: archive.summary.parent_tool_call_id,
                title: archive.summary.title,
                status: archive.summary.status,
                started_at_unix_ms: archive.summary.started_at_unix_ms,
                updated_at_unix_ms: archive.summary.updated_at_unix_ms,
                completed_at_unix_ms: archive.summary.completed_at_unix_ms,
                latest_message: archive.summary.latest_message,
                final_output: archive.summary.final_output,
                error: archive.summary.error,
            },
            llm_history: archive.llm_history,
        }))
    }

    pub fn subagent_live_messages(&self, session_id: &str) -> Vec<ChatMessage> {
        self.sync
            .subagent_message_cache
            .get(session_id)
            .cloned()
            .unwrap_or_default()
    }

    pub fn subagent_pending_aux_state(
        &mut self,
        session_id: &str,
    ) -> Result<Option<PendingAssistantAux>> {
        let value = self.call_daemon(
            "session.subagentPendingAuxState",
            Some(json!({ "subagentSessionId": session_id })),
        )?;
        if value.is_null() {
            return Ok(None);
        }
        Ok(Some(serde_json::from_value(value)?))
    }

    pub fn pending_subagent_approval(&self) -> Option<PendingSubagentApprovalView> {
        let approval = self.sync.current_pending_approval.as_ref()?;
        let session_id = approval.subagent_session_id.clone()?;
        Some(PendingSubagentApprovalView {
            session_id,
            session_title: approval
                .subagent_title
                .clone()
                .unwrap_or_else(|| "SubAgent".to_string()),
            tool_name: approval.tool_name.clone(),
            prompt: approval.prompt.clone(),
        })
    }

    // -------------------------------------------------------- trust prompt

    pub fn set_workspace_capability_trust_prompter(
        &mut self,
        prompter: Option<WorkspaceCapabilityTrustPrompter>,
    ) {
        self.workspace_capability_trust_prompter = prompter;
    }

    pub fn has_workspace_capability_trust_prompter(&self) -> bool {
        self.workspace_capability_trust_prompter.is_some()
    }

    // ------------------------------------------------------------- images

    pub fn add_pending_image(&mut self, path: String) {
        if self.daemon_failed {
            return;
        }
        if let Err(err) = self.call_daemon("session.addPendingImage", Some(json!({ "path": path })))
        {
            self.handle_daemon_error(err);
            return;
        }
        if let Err(err) = self.sync_snapshot_remote() {
            self.handle_daemon_error(err);
        }
    }

    pub fn clear_pending_images(&mut self) -> usize {
        if self.daemon_failed {
            return 0;
        }
        let cleared = match self.call_daemon("session.clearPendingImages", None) {
            Ok(value) => value.get("cleared").and_then(Value::as_u64).unwrap_or(0) as usize,
            Err(err) => {
                self.handle_daemon_error(err);
                return 0;
            }
        };
        if let Err(err) = self.sync_snapshot_remote() {
            self.handle_daemon_error(err);
        }
        cleared
    }

    /// Close the daemon session (headless runs are ephemeral). Best effort.
    pub fn close_session(&mut self) {
        if self.daemon_failed {
            return;
        }
        let Some(session_id) = self.session_id.clone() else {
            return;
        };
        if let Err(err) = self
            .client
            .call("session.detach", json!({ "sessionId": session_id }))
        {
            logging::log_event(&format!("[daemon-runtime] session.detach failed: {err}"));
        }
        self.client.close();
    }
}
