//! Shared runtime-sync state for CLI daemon backend. Projects daemon
//! `BridgeRuntimeEvent` / `BridgeRuntimeSnapshot` shapes into TUI-facing state.

use rust_i18n::t;
use serde_json::Value;
use std::collections::{HashMap, VecDeque};

use crate::{
    host_protocol::{
        BridgeManualToolCommandStartResult, BridgePendingApproval, BridgeRuntimeEvent,
        BridgeRuntimeSnapshot,
    },
    host_runtime::{
        RuntimeEvent, approval_prompt_text, build_tool_result_block, format_tool_ui_message,
        tool_approval_block, tool_failed_block,
    },
    ports::SubagentSessionSummary,
    session::SessionModel,
    tool_ui::{tool_request_from_host_value, tool_request_from_streaming_preview},
    view::{ChatMessage, MessageRole, PendingAssistantAux},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum PendingApprovalKind {
    Tool,
    Manual,
}

pub(crate) struct RuntimeSyncState {
    pub(crate) session: SessionModel,
    pub(crate) pending_aux_state: Option<PendingAssistantAux>,
    pub(crate) pending_approval_kind: Option<PendingApprovalKind>,
    pub(crate) current_pending_approval: Option<BridgePendingApproval>,
    pub(crate) pending_questions_active: bool,
    pub(crate) pending_assistant_has_output: bool,
    pub(crate) is_busy_cache: bool,
    pub(crate) child_sessions_cache: Vec<SubagentSessionSummary>,
    pub(crate) subagent_message_cache: HashMap<String, Vec<ChatMessage>>,
    /// A `session.desktopTimelineUpdated` arrived; the TUI applies it once idle.
    pub(crate) desktop_timeline_resync_pending: bool,
    /// Latest `session.titleUpdated` title for this session; TUI takes and applies it.
    pub(crate) pending_session_title: Option<String>,
    pub(crate) events: VecDeque<RuntimeEvent>,
}

impl RuntimeSyncState {
    pub(crate) fn new() -> Self {
        Self {
            session: SessionModel::new(),
            pending_aux_state: None,
            pending_approval_kind: None,
            current_pending_approval: None,
            pending_questions_active: false,
            pending_assistant_has_output: false,
            is_busy_cache: false,
            child_sessions_cache: Vec::new(),
            subagent_message_cache: HashMap::new(),
            desktop_timeline_resync_pending: false,
            pending_session_title: None,
            events: VecDeque::new(),
        }
    }

    pub(crate) fn apply_bridge_events(&mut self, events: Vec<BridgeRuntimeEvent>) {
        for event in events {
            match event {
                BridgeRuntimeEvent::BeginAssistantResponse => {
                    self.pending_assistant_has_output = false;
                    self.events.push_back(RuntimeEvent::BeginAssistantResponse);
                }
                BridgeRuntimeEvent::UpdatePendingAssistantThinking { text } => {
                    self.events
                        .push_back(RuntimeEvent::UpdatePendingAssistantThinking(text));
                }
                BridgeRuntimeEvent::AssistantThinkingSegmentFinalized { text } => {
                    self.events
                        .push_back(RuntimeEvent::AssistantThinkingSegmentFinalized(text));
                }
                BridgeRuntimeEvent::UpdatePendingAssistantCompaction { text } => {
                    self.events
                        .push_back(RuntimeEvent::UpdatePendingAssistantCompaction(text));
                }
                BridgeRuntimeEvent::AssistantChunk { text } => {
                    self.pending_assistant_has_output = true;
                    self.events.push_back(RuntimeEvent::AssistantChunk(text));
                }
                BridgeRuntimeEvent::ReplacePendingAssistant { text } => {
                    self.pending_assistant_has_output = !text.trim().is_empty();
                    self.events
                        .push_back(RuntimeEvent::ReplacePendingAssistant(text));
                }
                BridgeRuntimeEvent::AssistantResponseCompleted => {
                    self.pending_assistant_has_output = false;
                    self.events
                        .push_back(RuntimeEvent::AssistantResponseCompleted);
                }
                BridgeRuntimeEvent::RemovePendingAssistant => {
                    self.pending_assistant_has_output = false;
                    self.events.push_back(RuntimeEvent::RemovePendingAssistant);
                }
                BridgeRuntimeEvent::ApprovalRequested { approval } => {
                    let (_, approval_body) =
                        approval_prompt_text(&approval.prompt, &approval.tool_name);
                    if let Some(session_id) = approval.subagent_session_id.as_deref() {
                        match tool_request_from_host_value(approval.request.clone()) {
                            Ok(_) => self.push_subagent_live_message(
                                session_id,
                                ChatMessage::with_tool_block(
                                    MessageRole::Agent,
                                    approval_body.clone(),
                                    tool_approval_block(
                                        &approval.tool_name,
                                        approval.tool_call_id.as_deref(),
                                        &approval.prompt,
                                        approval.remember_target.is_some(),
                                        approval.auto_review_block_reason.as_deref(),
                                    ),
                                ),
                            ),
                            Err(err) => self.push_subagent_live_message(
                                session_id,
                                ChatMessage::new(
                                    MessageRole::Agent,
                                    t!(
                                        "tui.tool.approval_parse_failed",
                                        err = err,
                                        prompt = approval_body
                                    )
                                    .into_owned(),
                                ),
                            ),
                        }
                    } else {
                        self.events.push_back(RuntimeEvent::PushMessage(
                            ChatMessage::with_tool_block(
                                MessageRole::Agent,
                                approval_body,
                                tool_approval_block(
                                    &approval.tool_name,
                                    approval.tool_call_id.as_deref(),
                                    &approval.prompt,
                                    approval.remember_target.is_some(),
                                    approval.auto_review_block_reason.as_deref(),
                                ),
                            ),
                        ));
                    }
                }
                BridgeRuntimeEvent::QuestionsRequested { questions } => {
                    self.events.push_back(RuntimeEvent::OpenAskQuestions {
                        tool_call_id: questions.tool_call_id,
                        tool_name: questions.tool_name,
                        questions: questions.questions,
                    });
                }
                BridgeRuntimeEvent::ToolCallStarted { .. } => {}
                BridgeRuntimeEvent::StreamingToolPreview {
                    tool_call_id,
                    tool_name,
                    arguments_json,
                } => {
                    let request = tool_request_from_streaming_preview(&tool_name, &arguments_json);
                    self.events.push_back(RuntimeEvent::UpsertToolPreview {
                        tool_call_id,
                        tool_name,
                        arguments: request.arguments,
                    });
                }
                BridgeRuntimeEvent::ApprovalResolved { .. } => {}
                BridgeRuntimeEvent::HistoryCompacted {
                    dropped_messages,
                    summary_preview,
                } => {
                    let summary = summary_preview
                        .unwrap_or_else(|| t!("tui.session.compact_summary_empty").into_owned());
                    self.events
                        .push_back(RuntimeEvent::PushMessage(ChatMessage::new(
                            MessageRole::Agent,
                            t!(
                                "tui.session.compacted",
                                count = dropped_messages,
                                summary = summary
                            )
                            .into_owned(),
                        )));
                }
                BridgeRuntimeEvent::BackgroundToolStatus { .. } => {}
                BridgeRuntimeEvent::ContextUsageUpdated { .. } => {}
                // TODO(cli): project tool-execution-output-chunk into TUI shell tool cards.
                BridgeRuntimeEvent::ToolExecutionOutputChunk { .. } => {}
                BridgeRuntimeEvent::ToolExecutionFinished { execution } => {
                    if execution.tool_name.starts_with("todo_") {
                        continue;
                    }
                    match tool_request_from_host_value(execution.request) {
                        Ok(request) => {
                            self.events.push_back(RuntimeEvent::PushMessage(
                                ChatMessage::with_tool_block(
                                    MessageRole::Agent,
                                    if execution.failed {
                                        t!("tui.tool.failed", output = execution.output)
                                            .into_owned()
                                    } else {
                                        format_tool_ui_message(
                                            &request,
                                            &execution.tool_name,
                                            &execution.output,
                                        )
                                    },
                                    if execution.failed {
                                        tool_failed_block(
                                            &execution.tool_name,
                                            Some(execution.tool_call_id.as_str()),
                                            &t!("tui.tool.failed_headline"),
                                            &execution.output,
                                        )
                                    } else {
                                        build_tool_result_block(
                                            &request,
                                            &execution.tool_name,
                                            Some(execution.tool_call_id.as_str()),
                                            &execution.output,
                                        )
                                    },
                                ),
                            ));
                        }
                        Err(err) => {
                            self.events.push_back(RuntimeEvent::PushMessage(
                                ChatMessage::with_tool_block(
                                    MessageRole::Agent,
                                    if execution.failed {
                                        t!(
                                            "tui.tool.failed_request_parse",
                                            output = execution.output
                                        )
                                        .into_owned()
                                    } else {
                                        t!(
                                            "tui.tool.done_request_parse_failed",
                                            err = err,
                                            output = execution.output
                                        )
                                        .into_owned()
                                    },
                                    if execution.failed {
                                        tool_failed_block(
                                            &execution.tool_name,
                                            Some(execution.tool_call_id.as_str()),
                                            &t!("tui.tool.failed_headline"),
                                            &execution.output,
                                        )
                                    } else {
                                        tool_failed_block(
                                            &execution.tool_name,
                                            Some(execution.tool_call_id.as_str()),
                                            &t!("tui.tool.done_request_parse_failed_headline"),
                                            &err.to_string(),
                                        )
                                    },
                                ),
                            ));
                        }
                    }
                }
            }
        }
    }

    pub(crate) fn push_remote_user_turn(&mut self, text: String) {
        self.events
            .push_back(RuntimeEvent::PushMessage(ChatMessage::new(
                MessageRole::User,
                text,
            )));
    }

    pub(crate) fn apply_subagent_bridge_events(
        &mut self,
        session_id: &str,
        events: Vec<BridgeRuntimeEvent>,
    ) {
        for event in events {
            match event {
                BridgeRuntimeEvent::BeginAssistantResponse => {
                    self.subagent_message_cache
                        .entry(session_id.to_string())
                        .or_default()
                        .push(ChatMessage::new(MessageRole::Agent, String::new()));
                }
                BridgeRuntimeEvent::AssistantChunk { text } => {
                    let cache = self
                        .subagent_message_cache
                        .entry(session_id.to_string())
                        .or_default();
                    if let Some(last) = cache.last_mut() {
                        if matches!(last.role, MessageRole::Agent) {
                            last.content.push_str(&text);
                            continue;
                        }
                    }
                    cache.push(ChatMessage::new(MessageRole::Agent, text));
                }
                BridgeRuntimeEvent::ReplacePendingAssistant { text } => {
                    let cache = self
                        .subagent_message_cache
                        .entry(session_id.to_string())
                        .or_default();
                    if let Some(last) = cache.last_mut() {
                        if matches!(last.role, MessageRole::Agent) {
                            last.content = text;
                            continue;
                        }
                    }
                    cache.push(ChatMessage::new(MessageRole::Agent, text));
                }
                _ => {}
            }
        }
    }

    pub(crate) fn apply_snapshot(&mut self, snapshot: BridgeRuntimeSnapshot) {
        self.session.clear_pending_user_turn();
        self.session.clear_pending_images();
        self.session.clear_pending_mcp_resources();
        self.session.set_loop_enabled(snapshot.loop_enabled);
        self.session
            .set_approval_level(snapshot.approval_level.as_str());
        if let Some(turn) = snapshot.pending_user_turn {
            self.session.set_pending_user_turn(turn);
        }
        for path in snapshot.pending_image_paths {
            self.session.add_pending_image(path);
        }
        for resource in snapshot.pending_mcp_resources {
            self.session.add_pending_mcp_resource(resource);
        }

        self.pending_aux_state = snapshot.pending_aux_state;
        self.current_pending_approval = snapshot.current_pending_approval;
        self.pending_approval_kind = if snapshot.has_pending_approval {
            Some(if snapshot.has_pending_manual_approval {
                PendingApprovalKind::Manual
            } else {
                PendingApprovalKind::Tool
            })
        } else {
            None
        };
        self.child_sessions_cache = snapshot
            .child_sessions
            .into_iter()
            .map(|summary| SubagentSessionSummary {
                session_id: summary.session_id,
                parent_tool_call_id: summary.parent_tool_call_id,
                title: summary.title,
                status: summary.status,
                started_at_unix_ms: summary.started_at_unix_ms,
                updated_at_unix_ms: summary.updated_at_unix_ms,
                completed_at_unix_ms: summary.completed_at_unix_ms,
                latest_message: summary.latest_message,
                final_output: summary.final_output,
                error: summary.error,
            })
            .collect();
        self.subagent_message_cache.retain(|session_id, _| {
            self.child_sessions_cache
                .iter()
                .any(|summary| summary.session_id == *session_id)
        });
        self.pending_questions_active = snapshot.has_pending_questions;
        self.is_busy_cache = snapshot.is_busy;
    }

    pub(crate) fn push_subagent_live_message(&mut self, session_id: &str, message: ChatMessage) {
        self.subagent_message_cache
            .entry(session_id.to_string())
            .or_default()
            .push(message);
    }

    pub(crate) fn handle_manual_tool_command_result(
        &mut self,
        result: BridgeManualToolCommandStartResult,
    ) {
        match result {
            BridgeManualToolCommandStartResult::Completed {
                request,
                tool_name,
                output,
                failed,
                background_execution: _,
            } => self.push_manual_tool_command_message(request, &tool_name, &output, failed),
            BridgeManualToolCommandStartResult::StartedBackground {
                request: _,
                tool_name: _,
                status_text: _,
            }
            | BridgeManualToolCommandStartResult::StartedUserTurn { user_message: _ }
            | BridgeManualToolCommandStartResult::RequiresApproval { approval: _ } => {}
            BridgeManualToolCommandStartResult::Denied {
                request: _,
                tool_name: _,
                message,
            } => {
                self.events
                    .push_back(RuntimeEvent::PushMessage(ChatMessage::new(
                        MessageRole::Agent,
                        message,
                    )));
            }
            BridgeManualToolCommandStartResult::Failed { error, request } => {
                self.push_manual_tool_command_failure(request, &error);
            }
        }
    }

    fn push_manual_tool_command_message(
        &mut self,
        request: Value,
        tool_name: &str,
        output: &str,
        failed: bool,
    ) {
        match tool_request_from_host_value(request) {
            Ok(request) => {
                self.events
                    .push_back(RuntimeEvent::PushMessage(ChatMessage::with_tool_block(
                        MessageRole::Agent,
                        if failed {
                            t!("tui.tool.failed", output = output).into_owned()
                        } else {
                            format_tool_ui_message(&request, tool_name, output)
                        },
                        if failed {
                            tool_failed_block(
                                tool_name,
                                None,
                                &t!("tui.tool.failed_headline"),
                                output,
                            )
                        } else {
                            build_tool_result_block(&request, tool_name, None, output)
                        },
                    )));
            }
            Err(err) => {
                self.events
                    .push_back(RuntimeEvent::PushMessage(ChatMessage::new(
                        MessageRole::Agent,
                        if failed {
                            t!("tui.tool.failed_request_parse", output = output).into_owned()
                        } else {
                            t!(
                                "tui.tool.done_request_parse_failed",
                                err = err,
                                output = output
                            )
                            .into_owned()
                        },
                    )));
            }
        }
    }

    fn push_manual_tool_command_failure(&mut self, request: Option<Value>, error: &str) {
        if let Some(request) = request
            && let Ok(request) = tool_request_from_host_value(request)
        {
            self.events
                .push_back(RuntimeEvent::PushMessage(ChatMessage::with_tool_block(
                    MessageRole::Agent,
                    t!("tui.tool.failed", output = error).into_owned(),
                    tool_failed_block(&request.name, None, &t!("tui.tool.failed_headline"), error),
                )));
            return;
        }

        self.events
            .push_back(RuntimeEvent::PushMessage(ChatMessage::new(
                MessageRole::Agent,
                t!("tui.tool.failed", output = error).into_owned(),
            )));
    }
}
