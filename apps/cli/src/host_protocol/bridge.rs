use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{
    ask_questions::AskQuestionsRequest, ports::ArchivedLlmMessage, session::PendingMcpResource,
    view::PendingAssistantAux,
};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceCapabilityTrustHookEntry {
    pub event: String,
    pub command: String,
    pub resolved_path: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceCapabilityTrustRequest {
    pub workspace_root: String,
    pub content_hash: String,
    pub hash_changed: bool,
    pub hooks: Vec<WorkspaceCapabilityTrustHookEntry>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WorkspaceCapabilityTrustDecision {
    AllowOnce,
    Deny,
    AlwaysTrust,
}

impl WorkspaceCapabilityTrustDecision {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::AllowOnce => "allowOnce",
            Self::Deny => "deny",
            Self::AlwaysTrust => "alwaysTrust",
        }
    }
}

pub type WorkspaceCapabilityTrustPrompter =
    Box<dyn FnMut(WorkspaceCapabilityTrustRequest) -> WorkspaceCapabilityTrustDecision>;

fn default_bridge_approval_level() -> String {
    "default".to_string()
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BridgeRuntimeSnapshot {
    pub(crate) pending_user_turn: Option<String>,
    pub(crate) pending_image_paths: Vec<String>,
    pub(crate) pending_mcp_resources: Vec<PendingMcpResource>,
    pub(crate) pending_aux_state: Option<PendingAssistantAux>,
    pub(crate) has_pending_approval: bool,
    pub(crate) has_pending_manual_approval: bool,
    pub(crate) has_pending_questions: bool,
    pub(crate) current_pending_approval: Option<BridgePendingApproval>,
    #[serde(default)]
    pub(crate) child_sessions: Vec<BridgeSubagentSessionSummary>,
    pub(crate) current_pending_questions: Option<BridgePendingQuestions>,
    pub(crate) is_busy: bool,
    #[serde(default)]
    pub(crate) loop_enabled: bool,
    #[serde(default = "default_bridge_approval_level")]
    pub(crate) approval_level: String,
    pub(crate) background_tool_status: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BridgeExportState {
    pub(crate) api_messages: Vec<Value>,
    pub(crate) request_trace: Vec<Value>,
    pub(crate) system_prompts: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BridgeChatArchive {
    pub(crate) messages: Vec<BridgeChatMessage>,
    pub(crate) assistant_aux: Vec<BridgeAssistantAuxEntry>,
    pub(crate) llm_history: Vec<ArchivedLlmMessage>,
    #[serde(default)]
    pub(crate) loop_enabled: bool,
    #[serde(default = "default_bridge_approval_level")]
    pub(crate) approval_level: String,
    #[serde(default)]
    pub(crate) subagent_sessions: Vec<BridgeSubagentSessionArchiveEntry>,
    #[serde(default)]
    pub(crate) rewind: Option<Value>,
    /// Daemon-stored desktop timeline pushed by the authoritative desktop host
    /// (same shape as chat-file `desktopMessageTimeline`); absent when no host
    /// has pushed one for this session.
    #[serde(default)]
    pub(crate) desktop_message_timeline: Option<Vec<crate::chat_timeline::PersistedTimelineTurn>>,
}

/// `session.getDesktopTimeline` result (null when the session has none).
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BridgeDesktopTimelineResult {
    pub(crate) revision: u64,
    pub(crate) timeline: Vec<crate::chat_timeline::PersistedTimelineTurn>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BridgeSubagentSessionSummary {
    pub(crate) session_id: String,
    pub(crate) parent_tool_call_id: String,
    pub(crate) title: String,
    pub(crate) status: crate::ports::SubagentSessionStatus,
    pub(crate) started_at_unix_ms: u64,
    pub(crate) updated_at_unix_ms: u64,
    pub(crate) completed_at_unix_ms: Option<u64>,
    pub(crate) latest_message: Option<String>,
    pub(crate) final_output: Option<String>,
    pub(crate) error: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BridgeSubagentSessionArchiveEntry {
    pub(crate) summary: BridgeSubagentSessionSummary,
    #[serde(default)]
    pub(crate) llm_history: Vec<ArchivedLlmMessage>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BridgeChatMessage {
    pub(crate) role: String,
    pub(crate) content: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BridgeAssistantAuxEntry {
    pub(crate) message_index: usize,
    pub(crate) thinking: Option<String>,
    pub(crate) compaction: Option<String>,
    #[serde(default)]
    pub(crate) finish_task_notice: Option<String>,
}

/// Target the user can remember when approving a tool call (wire field
/// `rememberTarget`); tagged union mirroring the daemon's `PermissionMemoryTarget`.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub(crate) enum BridgePermissionMemoryTarget {
    #[serde(rename = "shell")]
    Shell { command: String },
    #[serde(rename = "read_file")]
    ReadFile { path: String },
}

/// Structured approval description produced by the tool executor; the TUI builds
/// its own (localized) display strings from it. Tagged union mirroring the daemon's
/// `ToolApprovalRequest`.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub(crate) enum BridgeToolApprovalRequest {
    #[serde(rename = "shell")]
    Shell {
        command: String,
        #[serde(default)]
        reason: Option<String>,
        terminal: String,
    },
    #[serde(rename = "web_fetch")]
    WebFetch { url: String },
    #[serde(rename = "read_path")]
    ReadPath { operation: String, path: String },
    #[serde(rename = "create_file")]
    CreateFile {
        path: String,
        #[serde(rename = "contentChars")]
        content_chars: u64,
    },
    #[serde(rename = "create_plan")]
    CreatePlan {
        #[serde(rename = "planName")]
        plan_name: String,
        #[serde(rename = "contentChars")]
        content_chars: u64,
    },
    #[serde(rename = "edit_file")]
    EditFile {
        path: String,
        #[serde(rename = "oldChars")]
        old_chars: u64,
        #[serde(rename = "newChars")]
        new_chars: u64,
    },
    #[serde(rename = "delete_file")]
    DeleteFile { path: String },
    #[serde(rename = "apply_patch")]
    ApplyPatch {
        operation: String,
        path: String,
        #[serde(rename = "diffLines", default)]
        diff_lines: Option<u64>,
    },
    #[serde(rename = "create_automation")]
    CreateAutomation {
        title: String,
        trigger: Value,
        #[serde(rename = "approvalLevel")]
        approval_level: String,
        #[serde(rename = "overviewChars")]
        overview_chars: u64,
    },
    #[serde(rename = "extension_tool")]
    ExtensionTool {
        #[serde(rename = "extensionId")]
        extension_id: String,
        #[serde(rename = "toolName")]
        tool_name: String,
        #[serde(rename = "argumentsPreview")]
        arguments_preview: String,
    },
    #[serde(rename = "lazy_tool_call")]
    LazyToolCall {
        provider: String,
        server: String,
        tool: String,
        #[serde(default)]
        arguments: Option<Value>,
    },
}

/// Approval prompt surfaced to the TUI: a structured tool request, or free-form
/// hook text. Tagged union mirroring the daemon's `ToolApprovalPrompt`.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub(crate) enum BridgeToolApprovalPrompt {
    #[serde(rename = "tool")]
    Tool { request: BridgeToolApprovalRequest },
    #[serde(rename = "hook")]
    Hook {
        #[serde(default)]
        message: Option<String>,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BridgePendingApproval {
    pub(crate) prompt: BridgeToolApprovalPrompt,
    pub(crate) request: Value,
    pub(crate) remember_target: Option<BridgePermissionMemoryTarget>,
    pub(crate) tool_call_id: Option<String>,
    pub(crate) tool_name: String,
    pub(crate) subagent_session_id: Option<String>,
    pub(crate) subagent_title: Option<String>,
    #[serde(default)]
    pub(crate) auto_review_block_reason: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BridgePendingQuestions {
    pub(crate) request: Value,
    pub(crate) tool_call_id: String,
    pub(crate) tool_name: String,
    pub(crate) questions: AskQuestionsRequest,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BridgeWorkspaceFileReferenceQuery {
    pub(crate) start: usize,
    pub(crate) end: usize,
    pub(crate) raw: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BridgeWorkspaceFileReferenceSuggestions {
    pub(crate) query: BridgeWorkspaceFileReferenceQuery,
    pub(crate) suggestions: Vec<String>,
    #[serde(default)]
    pub(crate) index_ready: Option<bool>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BridgeToolExecution {
    pub(crate) tool_call_id: String,
    pub(crate) tool_name: String,
    pub(crate) request: Value,
    pub(crate) output: String,
    pub(crate) failed: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub(crate) enum BridgeManualToolCommandStartResult {
    #[serde(rename = "completed")]
    Completed {
        request: Value,
        #[serde(alias = "toolName")]
        tool_name: String,
        output: String,
        failed: bool,
        #[serde(alias = "backgroundExecution")]
        background_execution: bool,
    },
    #[serde(rename = "started-background")]
    StartedBackground {
        request: Value,
        #[serde(alias = "toolName")]
        tool_name: String,
        #[serde(alias = "statusText")]
        status_text: Option<String>,
    },
    #[serde(rename = "started-user-turn")]
    StartedUserTurn {
        #[serde(alias = "userMessage")]
        user_message: String,
    },
    #[serde(rename = "requires-approval")]
    RequiresApproval { approval: BridgePendingApproval },
    #[serde(rename = "denied")]
    Denied {
        request: Value,
        #[serde(alias = "toolName")]
        tool_name: String,
        message: String,
    },
    #[serde(rename = "failed")]
    Failed {
        error: String,
        request: Option<Value>,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BridgeLlmTokenUsage {
    pub(crate) input_tokens: u64,
    pub(crate) output_tokens: u64,
    pub(crate) total_tokens: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub(crate) enum BridgeRuntimeEvent {
    #[serde(rename = "begin-assistant-response")]
    BeginAssistantResponse,
    #[serde(rename = "update-pending-assistant-thinking")]
    UpdatePendingAssistantThinking { text: String },
    #[serde(rename = "assistant-thinking-segment-finalized")]
    AssistantThinkingSegmentFinalized { text: String },
    #[serde(rename = "update-pending-assistant-compaction")]
    UpdatePendingAssistantCompaction { text: String },
    #[serde(rename = "assistant-chunk")]
    AssistantChunk { text: String },
    #[serde(rename = "replace-pending-assistant")]
    ReplacePendingAssistant { text: String },
    #[serde(rename = "assistant-response-completed")]
    AssistantResponseCompleted,
    #[serde(rename = "remove-pending-assistant")]
    RemovePendingAssistant,
    #[serde(rename = "approval-requested")]
    ApprovalRequested { approval: BridgePendingApproval },
    #[serde(rename = "questions-requested")]
    QuestionsRequested { questions: BridgePendingQuestions },
    #[serde(rename = "tool-call-started")]
    ToolCallStarted {
        #[serde(alias = "toolCallId")]
        tool_call_id: String,
        #[serde(alias = "toolName")]
        tool_name: String,
        request: Value,
    },
    #[serde(rename = "streaming-tool-preview")]
    StreamingToolPreview {
        #[serde(alias = "toolCallId")]
        tool_call_id: String,
        #[serde(alias = "toolName")]
        tool_name: String,
        #[serde(alias = "argumentsJson")]
        arguments_json: String,
    },
    #[serde(rename = "approval-resolved")]
    ApprovalResolved {
        #[serde(alias = "toolCallId")]
        tool_call_id: String,
        #[serde(alias = "toolName")]
        tool_name: String,
        request: Value,
        #[serde(alias = "decisionKind")]
        decision_kind: String,
    },
    #[serde(rename = "history-compacted")]
    HistoryCompacted {
        #[serde(alias = "droppedMessages")]
        dropped_messages: usize,
        #[serde(alias = "summaryPreview")]
        summary_preview: Option<String>,
    },
    #[serde(rename = "background-tool-status")]
    BackgroundToolStatus {
        phase: String,
        #[serde(alias = "toolName")]
        tool_name: Option<String>,
        request: Option<Value>,
        #[serde(alias = "statusText")]
        status_text: Option<String>,
        failed: Option<bool>,
    },
    #[serde(rename = "tool-execution-finished")]
    ToolExecutionFinished { execution: BridgeToolExecution },
    /// Incremental shell stdout/stderr while `shell` runs in the background.
    /// CLI TUI does not render chunks yet; Desktop projects them into tool cards.
    #[serde(rename = "tool-execution-output-chunk")]
    ToolExecutionOutputChunk {
        #[serde(alias = "toolCallId")]
        tool_call_id: String,
        #[serde(alias = "toolName")]
        tool_name: String,
        request: Value,
        chunk: String,
    },
    #[serde(rename = "context-usage-updated")]
    ContextUsageUpdated { usage: BridgeLlmTokenUsage },
}
