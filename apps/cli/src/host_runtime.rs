use rust_i18n::t;
use serde_json::{Map, Value, json};

use crate::{
    ask_questions::AskQuestionsRequest,
    host_protocol::{BridgeToolApprovalPrompt, BridgeToolApprovalRequest},
    view::{ChatMessage, ToolUiBlock, ToolUiPhase},
};

#[derive(Clone, Debug)]
pub(crate) struct ToolUiRequest {
    pub(crate) name: String,
    pub(crate) arguments: Value,
}

impl ToolUiRequest {
    pub(crate) fn new(name: impl Into<String>, arguments: Value) -> Self {
        Self {
            name: name.into(),
            arguments,
        }
    }
}

pub enum RuntimeEvent {
    PushMessage(ChatMessage),
    UpsertToolPreview {
        tool_call_id: String,
        tool_name: String,
        arguments: serde_json::Value,
    },
    OpenAskQuestions {
        tool_call_id: String,
        tool_name: String,
        questions: AskQuestionsRequest,
    },
    BeginAssistantResponse,
    UpdatePendingAssistantThinking(String),
    AssistantThinkingSegmentFinalized(String),
    UpdatePendingAssistantCompaction(String),
    AssistantChunk(String),
    ReplacePendingAssistant(String),
    AssistantResponseCompleted,
    RemovePendingAssistant,
}

fn tool_request_args_excerpt(request: &ToolUiRequest) -> String {
    let value = match request.name.as_str() {
        "create_file" => json!({
            "path": string_arg(request, "path"),
            "content_chars": string_arg(request, "content").map(|value| value.chars().count()),
        }),
        "edit_file" => json!({
            "path": string_arg(request, "path"),
            "old_text_chars": string_arg(request, "old_text").map(|value| value.chars().count()),
            "new_text_chars": string_arg(request, "new_text").map(|value| value.chars().count()),
        }),
        "apply_patch" => json!({
            "operation": {
                "type": apply_patch_operation_type(request),
                "path": apply_patch_path(request),
                "diff_chars": apply_patch_diff_chars(request),
            }
        }),
        "ask_questions" => json!({
            "title": string_arg(request, "title"),
            "questionCount": question_count(request),
        }),
        _ => request.arguments.clone(),
    };
    serde_json::to_string_pretty(&value).unwrap_or_else(|_| "{}".to_string())
}

fn args_object(request: &ToolUiRequest) -> Option<&Map<String, Value>> {
    request.arguments.as_object()
}

fn string_arg<'a>(request: &'a ToolUiRequest, key: &str) -> Option<&'a str> {
    args_object(request)?
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
}

fn u64_arg(request: &ToolUiRequest, key: &str) -> Option<u64> {
    args_object(request)?.get(key).and_then(Value::as_u64)
}

fn read_file_range_display(request: &ToolUiRequest) -> (u64, String) {
    let offset = u64_arg(request, "offset").unwrap_or(1);
    let end = u64_arg(request, "limit")
        .map(|limit| (offset + limit - 1).to_string())
        .unwrap_or_else(|| "default".to_string());
    (offset, end)
}

fn question_count(request: &ToolUiRequest) -> usize {
    if let Some(count) = u64_arg(request, "questionCount") {
        return count as usize;
    }

    args_object(request)
        .and_then(|object| object.get("questions"))
        .and_then(Value::as_array)
        .map(|questions| questions.len())
        .unwrap_or(0)
}

fn apply_patch_operation_object(request: &ToolUiRequest) -> Option<&Map<String, Value>> {
    args_object(request)?
        .get("operation")
        .and_then(Value::as_object)
}

fn apply_patch_path(request: &ToolUiRequest) -> Option<&str> {
    apply_patch_operation_object(request)?
        .get("path")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
}

fn apply_patch_operation_type(request: &ToolUiRequest) -> Option<&str> {
    apply_patch_operation_object(request)?
        .get("type")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
}

fn apply_patch_diff_chars(request: &ToolUiRequest) -> Option<usize> {
    apply_patch_operation_object(request)?
        .get("diff")
        .and_then(Value::as_str)
        .map(|value| value.chars().count())
        .filter(|count| *count > 0)
}

/// Display text for a pending approval, built TUI-side from the structured bridge payload.
/// Returns `(headline_override, body)`: the shell reason lifts into the block headline.
pub(crate) fn approval_prompt_text(
    prompt: &BridgeToolApprovalPrompt,
    tool_name: &str,
) -> (Option<String>, String) {
    match prompt {
        BridgeToolApprovalPrompt::Hook { message } => {
            let body = message
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
                .unwrap_or_else(|| {
                    t!("tui.tool.approval.hook_fallback", tool = tool_name).into_owned()
                });
            (None, body)
        }
        BridgeToolApprovalPrompt::Tool { request } => approval_request_text(request),
    }
}

fn approval_request_text(request: &BridgeToolApprovalRequest) -> (Option<String>, String) {
    match request {
        BridgeToolApprovalRequest::Shell {
            command,
            reason,
            terminal,
        } => {
            let reason = reason
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string);
            let body = [
                t!("tui.tool.approval.high_risk.shell").into_owned(),
                t!("tui.tool.approval.field.terminal", name = terminal).into_owned(),
                t!("tui.tool.approval.field.command", command = command).into_owned(),
            ]
            .join("\n");
            (reason, body)
        }
        BridgeToolApprovalRequest::WebFetch { url } => {
            let body = [
                t!("tui.tool.approval.high_risk.fetch_web_page").into_owned(),
                t!("tui.tool.approval.field.url", url = url).into_owned(),
                String::new(),
                t!("tui.tool.approval.web_fetch_warning").into_owned(),
            ]
            .join("\n");
            (None, body)
        }
        BridgeToolApprovalRequest::ReadPath { operation, path } => {
            let headline = if operation == "ls" {
                t!("tui.tool.approval.high_risk.list_directory_outside_workspace").into_owned()
            } else {
                t!("tui.tool.approval.high_risk.read_file_outside_workspace").into_owned()
            };
            let body = [
                headline,
                t!("tui.tool.approval.field.path", path = path).into_owned(),
            ]
            .join("\n");
            (None, body)
        }
        BridgeToolApprovalRequest::CreateFile {
            path,
            content_chars,
        } => {
            let body = [
                t!("tui.tool.approval.high_risk.create_file").into_owned(),
                t!("tui.tool.approval.field.path", path = path).into_owned(),
                t!(
                    "tui.tool.approval.field.content_length",
                    chars = content_chars
                )
                .into_owned(),
            ]
            .join("\n");
            (None, body)
        }
        BridgeToolApprovalRequest::CreatePlan {
            plan_name,
            content_chars,
        } => {
            let body = [
                t!("tui.tool.approval.high_risk.create_plan").into_owned(),
                t!("tui.tool.approval.field.name", name = plan_name).into_owned(),
                t!(
                    "tui.tool.approval.field.content_length",
                    chars = content_chars
                )
                .into_owned(),
            ]
            .join("\n");
            (None, body)
        }
        BridgeToolApprovalRequest::EditFile {
            path,
            old_chars,
            new_chars,
        } => {
            let body = [
                t!("tui.tool.approval.high_risk.edit_file_exact_replacement").into_owned(),
                t!("tui.tool.approval.field.path", path = path).into_owned(),
                t!("tui.tool.approval.field.old_text_length", chars = old_chars).into_owned(),
                t!("tui.tool.approval.field.new_text_length", chars = new_chars).into_owned(),
            ]
            .join("\n");
            (None, body)
        }
        BridgeToolApprovalRequest::DeleteFile { path } => {
            let body = [
                t!("tui.tool.approval.high_risk.delete_file").into_owned(),
                t!("tui.tool.approval.field.path", path = path).into_owned(),
            ]
            .join("\n");
            (None, body)
        }
        BridgeToolApprovalRequest::ApplyPatch {
            operation,
            path,
            diff_lines,
        } => {
            let mut lines = vec![
                t!(
                    "tui.tool.approval.high_risk.apply_patch",
                    operation = operation
                )
                .into_owned(),
                t!("tui.tool.approval.field.path", path = path).into_owned(),
            ];
            if let Some(diff_lines) = diff_lines {
                lines.push(
                    t!("tui.tool.approval.field.diff_lines", lines = diff_lines).into_owned(),
                );
            }
            (None, lines.join("\n"))
        }
        BridgeToolApprovalRequest::CreateAutomation {
            title,
            trigger,
            approval_level,
            overview_chars,
        } => {
            let body = [
                t!("tui.tool.approval.high_risk.create_automation").into_owned(),
                t!("tui.tool.approval.field.title", title = title).into_owned(),
                t!(
                    "tui.tool.approval.field.schedule",
                    schedule = automation_trigger_label(trigger)
                )
                .into_owned(),
                t!(
                    "tui.tool.approval.field.run_approval",
                    level = automation_approval_level_label(approval_level)
                )
                .into_owned(),
                t!(
                    "tui.tool.approval.field.overview_length",
                    characters = overview_chars
                )
                .into_owned(),
            ]
            .join("\n");
            (None, body)
        }
        BridgeToolApprovalRequest::ExtensionTool {
            extension_id,
            tool_name,
            arguments_preview,
        } => {
            let body = [
                t!("tui.tool.approval.high_risk.extension_tool").into_owned(),
                t!("tui.tool.approval.field.extension", id = extension_id).into_owned(),
                t!("tui.tool.approval.field.tool", tool = tool_name).into_owned(),
                String::new(),
                t!(
                    "tui.tool.approval.field.extension_arguments",
                    arguments = arguments_preview
                )
                .into_owned(),
            ]
            .join("\n");
            (None, body)
        }
        BridgeToolApprovalRequest::LazyToolCall {
            provider,
            server,
            tool,
            arguments,
        } => {
            let args_text = arguments
                .as_ref()
                .map(|value| serde_json::to_string_pretty(value).unwrap_or_default())
                .filter(|text| !text.is_empty())
                .unwrap_or_else(|| t!("tui.tool.approval.field.no_arguments").into_owned());
            let headline = match provider.as_str() {
                "built-in" => {
                    t!("tui.tool.approval.high_risk.lazy_built_in_tool_call").into_owned()
                }
                "mcp" => t!("tui.tool.approval.high_risk.lazy_mcp_tool_call").into_owned(),
                other => [
                    t!("tui.tool.approval.high_risk.lazy_tool_call").into_owned(),
                    t!("tui.tool.approval.field.provider", provider = other).into_owned(),
                ]
                .join("\n"),
            };
            let body = [
                headline,
                t!("tui.tool.approval.field.server", server = server).into_owned(),
                t!("tui.tool.approval.field.tool", tool = tool).into_owned(),
                t!("tui.tool.approval.field.arguments", arguments = args_text).into_owned(),
            ]
            .join("\n");
            (None, body)
        }
    }
}

fn automation_approval_level_label(approval_level: &str) -> String {
    match approval_level {
        "auto-approval" => t!("tui.tool.approval.level.auto").into_owned(),
        "bypass-approval" => t!("tui.tool.approval.level.bypass").into_owned(),
        _ => t!("tui.tool.approval.level.default").into_owned(),
    }
}

fn automation_trigger_label(trigger: &Value) -> String {
    let kind = trigger.get("kind").and_then(Value::as_str).unwrap_or("");
    if kind == "time" {
        let schedule = trigger.get("schedule").cloned().unwrap_or(Value::Null);
        let schedule_kind = schedule.get("kind").and_then(Value::as_str).unwrap_or("");
        if schedule_kind == "hourly" {
            return t!("tui.tool.approval.schedule.hourly").into_owned();
        }
        let hour = schedule.get("hour").and_then(Value::as_u64).unwrap_or(0);
        let minute = schedule.get("minute").and_then(Value::as_u64).unwrap_or(0);
        let time = format!("{hour:02}:{minute:02}");
        if schedule_kind == "daily" {
            return t!("tui.tool.approval.schedule.daily", time = time).into_owned();
        }
        if schedule_kind == "weekly" {
            let weekday_index = schedule.get("weekday").and_then(Value::as_u64).unwrap_or(0);
            let weekday =
                t!(format!("tui.tool.approval.schedule.weekday{weekday_index}")).into_owned();
            return t!(
                "tui.tool.approval.schedule.weekly",
                weekday = weekday,
                time = time
            )
            .into_owned();
        }
    }
    if kind == "github" {
        let owner = trigger.get("owner").and_then(Value::as_str).unwrap_or("");
        let repo = trigger.get("repo").and_then(Value::as_str).unwrap_or("");
        let event = trigger.get("event").and_then(Value::as_str).unwrap_or("");
        let event_label = if event == "pull_request_created" {
            t!("tui.tool.approval.schedule.event_pull_request_created").into_owned()
        } else {
            t!("tui.tool.approval.schedule.event_issue_created").into_owned()
        };
        return t!(
            "tui.tool.approval.schedule.github",
            owner = owner,
            repo = repo,
            event = event_label
        )
        .into_owned();
    }
    trigger.to_string()
}

fn truncate_for_preview(text: &str, max_chars: usize) -> String {
    let chars = text.chars().collect::<Vec<_>>();
    if chars.len() <= max_chars {
        return text.to_string();
    }

    let mut out = chars.into_iter().take(max_chars).collect::<String>();
    out.push_str(t!("tui.tool.preview_truncated").as_ref());
    out
}

fn truncate_output_for_tool_ui(text: &str, max_chars: usize) -> String {
    truncate_for_preview(text, max_chars)
}

fn spirit_ui_suppresses_expand(arguments: &Value) -> bool {
    arguments
        .get("_spiritUi")
        .and_then(|ui| ui.get("suppressExpand"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn spirit_ui_input_excerpt(arguments: &Value) -> Option<String> {
    arguments
        .get("_spiritUi")
        .and_then(|ui| ui.get("inputExcerpt"))
        .and_then(Value::as_str)
        .map(str::to_string)
}

pub(crate) fn build_tool_preview_block(
    tool_name: &str,
    tool_call_id: &str,
    request: &ToolUiRequest,
) -> ToolUiBlock {
    let (headline, detail_lines) = preview_summary_for_tool(tool_name, request);
    let suppress_expand = spirit_ui_suppresses_expand(&request.arguments);
    let args_excerpt = if suppress_expand {
        spirit_ui_input_excerpt(&request.arguments)
    } else {
        Some(tool_request_args_excerpt(request))
    };
    ToolUiBlock {
        tool_call_id: Some(tool_call_id.to_string()),
        tool_name: tool_name.to_string(),
        phase: ToolUiPhase::Preview,
        headline,
        detail_lines,
        image_paths: Vec::new(),
        video_paths: Vec::new(),
        args_excerpt,
        output_excerpt: None,
        suppress_expand: suppress_expand.then_some(true),
    }
}

fn preview_summary_for_tool(tool_name: &str, request: &ToolUiRequest) -> (String, Vec<String>) {
    match tool_name {
        "read_file" => {
            let path = string_arg(request, "path")
                .or_else(|| string_arg(request, "filePath"))
                .map(str::to_string)
                .unwrap_or_else(|| t!("tui.tool.fallback_file").into_owned());
            (t!("tui.tool.preview.read").into_owned(), vec![path])
        }
        "ls" => (
            t!("tui.tool.preview.ls").into_owned(),
            vec![string_arg(request, "path").unwrap_or(".").to_string()],
        ),
        "glob" => (
            t!("tui.tool.preview.glob").into_owned(),
            vec![string_arg(request, "pattern").unwrap_or("**/*").to_string()],
        ),
        "shell" => (
            t!("tui.tool.preview.shell").into_owned(),
            string_arg(request, "command")
                .map(|value| vec![value.to_string()])
                .unwrap_or_default(),
        ),
        "edit_file" => {
            let path = string_arg(request, "path")
                .map(str::to_string)
                .unwrap_or_else(|| t!("tui.tool.fallback_file").into_owned());
            let mut lines = vec![path];
            if let Some(old) = string_arg(request, "old_text") {
                lines.push(
                    t!(
                        "tui.tool.preview.old_text_chars",
                        count = old.chars().count()
                    )
                    .into_owned(),
                );
            } else if let Some(chars) = u64_arg(request, "old_text_chars")
                && chars > 0
            {
                lines.push(t!("tui.tool.preview.old_text_streaming", count = chars).into_owned());
            }
            if let Some(new) = string_arg(request, "new_text") {
                lines.push(
                    t!(
                        "tui.tool.preview.new_text_chars",
                        count = new.chars().count()
                    )
                    .into_owned(),
                );
            } else if let Some(chars) = u64_arg(request, "new_text_chars")
                && chars > 0
            {
                lines.push(t!("tui.tool.preview.new_text_streaming", count = chars).into_owned());
            }
            (t!("tui.tool.preview.edit").into_owned(), lines)
        }
        "create_file" => {
            let path = string_arg(request, "path")
                .map(str::to_string)
                .unwrap_or_else(|| t!("tui.tool.fallback_file").into_owned());
            let mut lines = vec![path];
            if let Some(content) = string_arg(request, "content") {
                lines.push(
                    t!(
                        "tui.tool.preview.content_chars",
                        count = content.chars().count()
                    )
                    .into_owned(),
                );
            } else if let Some(chars) = u64_arg(request, "content_chars")
                && chars > 0
            {
                lines.push(t!("tui.tool.preview.content_streaming", count = chars).into_owned());
            }
            (t!("tui.tool.preview.create").into_owned(), lines)
        }
        "apply_patch" => {
            let path = apply_patch_path(request)
                .map(str::to_string)
                .unwrap_or_else(|| t!("tui.tool.fallback_file").into_owned());
            let mut lines = vec![path];
            if let Some(chars) = apply_patch_diff_chars(request) {
                lines.push(t!("tui.tool.preview.diff_chars", count = chars).into_owned());
            }
            let headline = match apply_patch_operation_type(request) {
                Some("create_file") => t!("tui.tool.preview.create").into_owned(),
                Some("update_file") => t!("tui.tool.preview.edit").into_owned(),
                Some("delete_file") => t!("tui.tool.preview.delete").into_owned(),
                _ => t!("tui.tool.preview.patch").into_owned(),
            };
            (headline, lines)
        }
        "web_search" => {
            if let Some(query) = spirit_ui_input_excerpt(&request.arguments) {
                return (t!("tui.tool.preview.web_search").into_owned(), vec![query]);
            }
            (t!("tui.tool.preview.web_search").into_owned(), Vec::new())
        }
        _ => (
            t!("tui.tool.preview.call_generic", tool = tool_name).into_owned(),
            Vec::new(),
        ),
    }
}

pub(crate) fn tool_approval_block(
    tool_name: &str,
    tool_call_id: Option<&str>,
    prompt: &BridgeToolApprovalPrompt,
    supports_remember: bool,
    auto_review_block_reason: Option<&str>,
) -> ToolUiBlock {
    let (shell_reason, body) = approval_prompt_text(prompt, tool_name);
    let mut detail_lines = body
        .lines()
        .map(|line| line.to_string())
        .collect::<Vec<_>>();
    if let Some(reason) = auto_review_block_reason
        .map(str::trim)
        .filter(|r| !r.is_empty())
    {
        detail_lines.push(t!("tui.tool.approval.block_reason", reason = reason).into_owned());
    }
    detail_lines.push(if supports_remember {
        t!("tui.tool.approval.shortcuts_remember").into_owned()
    } else {
        t!("tui.tool.approval.shortcuts").into_owned()
    });
    ToolUiBlock {
        tool_call_id: tool_call_id.map(String::from),
        tool_name: tool_name.to_string(),
        phase: ToolUiPhase::PendingApproval,
        headline: shell_reason.unwrap_or_else(|| t!("tui.tool.approval.headline").into_owned()),
        detail_lines,
        image_paths: Vec::new(),
        video_paths: Vec::new(),
        args_excerpt: None,
        output_excerpt: None,
        suppress_expand: None,
    }
}

pub(crate) fn tool_failed_block(
    tool_name: &str,
    tool_call_id: Option<&str>,
    summary: &str,
    err: &str,
) -> ToolUiBlock {
    ToolUiBlock {
        tool_call_id: tool_call_id.map(String::from),
        tool_name: tool_name.to_string(),
        phase: ToolUiPhase::Failed,
        headline: summary.to_string(),
        detail_lines: Vec::new(),
        image_paths: Vec::new(),
        video_paths: Vec::new(),
        args_excerpt: None,
        output_excerpt: Some(truncate_output_for_tool_ui(err, 2000)),
        suppress_expand: None,
    }
}

pub(crate) fn build_tool_result_block(
    request: &ToolUiRequest,
    tool_name: &str,
    tool_call_id: Option<&str>,
    output: &str,
) -> ToolUiBlock {
    let args_excerpt = tool_request_args_excerpt(request);
    match request.name.as_str() {
        "mcp_tool" => ToolUiBlock {
            tool_call_id: tool_call_id.map(String::from),
            tool_name: tool_name.to_string(),
            phase: ToolUiPhase::Succeeded,
            headline: t!("tui.tool.result.mcp_done").into_owned(),
            detail_lines: vec![
                format!(
                    "Server: {} ({})",
                    string_arg(request, "display_name").unwrap_or("<unknown>"),
                    string_arg(request, "server").unwrap_or("<unknown>")
                ),
                format!(
                    "Tool: {}",
                    string_arg(request, "tool_name").unwrap_or("<unknown>")
                ),
            ],
            image_paths: Vec::new(),
            video_paths: Vec::new(),
            args_excerpt: Some(args_excerpt),
            output_excerpt: Some(truncate_output_for_tool_ui(output, 3600)),
            suppress_expand: None,
        },
        "web_fetch" => ToolUiBlock {
            tool_call_id: tool_call_id.map(String::from),
            tool_name: tool_name.to_string(),
            phase: ToolUiPhase::Succeeded,
            headline: t!("tui.tool.result.web_fetch_done").into_owned(),
            detail_lines: vec![format!(
                "URL: {}",
                string_arg(request, "url").unwrap_or("<unknown>")
            )],
            image_paths: Vec::new(),
            video_paths: Vec::new(),
            args_excerpt: Some(args_excerpt),
            output_excerpt: Some(truncate_output_for_tool_ui(output, 3600)),
            suppress_expand: None,
        },
        "ls" => ToolUiBlock {
            tool_call_id: tool_call_id.map(String::from),
            tool_name: tool_name.to_string(),
            phase: ToolUiPhase::Succeeded,
            headline: t!("tui.tool.result.ls_done").into_owned(),
            detail_lines: vec![
                t!(
                    "tui.tool.detail.path",
                    path = string_arg(request, "path").unwrap_or("<unknown>")
                )
                .into_owned(),
            ],
            image_paths: Vec::new(),
            video_paths: Vec::new(),
            args_excerpt: Some(args_excerpt),
            output_excerpt: Some(truncate_output_for_tool_ui(output, 3600)),
            suppress_expand: None,
        },
        "glob" => ToolUiBlock {
            tool_call_id: tool_call_id.map(String::from),
            tool_name: tool_name.to_string(),
            phase: ToolUiPhase::Succeeded,
            headline: t!("tui.tool.result.glob_done").into_owned(),
            detail_lines: vec![
                t!(
                    "tui.tool.detail.pattern",
                    pattern = string_arg(request, "pattern").unwrap_or("<unknown>")
                )
                .into_owned(),
            ],
            image_paths: Vec::new(),
            video_paths: Vec::new(),
            args_excerpt: Some(args_excerpt),
            output_excerpt: Some(truncate_output_for_tool_ui(output, 3600)),
            suppress_expand: None,
        },
        "read_file" => {
            let (offset, end) = read_file_range_display(request);
            ToolUiBlock {
                tool_call_id: tool_call_id.map(String::from),
                tool_name: tool_name.to_string(),
                phase: ToolUiPhase::Succeeded,
                headline: t!("tui.tool.result.read_done").into_owned(),
                detail_lines: vec![
                    t!(
                        "tui.tool.detail.path",
                        path = string_arg(request, "path").unwrap_or("<unknown>")
                    )
                    .into_owned(),
                    t!("tui.tool.detail.line_range", start = offset, end = end).into_owned(),
                ],
                image_paths: Vec::new(),
                video_paths: Vec::new(),
                args_excerpt: Some(args_excerpt),
                output_excerpt: None,
                suppress_expand: None,
            }
        }
        "grep" => ToolUiBlock {
            tool_call_id: tool_call_id.map(String::from),
            tool_name: tool_name.to_string(),
            phase: ToolUiPhase::Succeeded,
            headline: t!("tui.tool.result.grep_done").into_owned(),
            detail_lines: vec![
                t!(
                    "tui.tool.detail.query",
                    query = string_arg(request, "query").unwrap_or("<unknown>")
                )
                .into_owned(),
            ],
            image_paths: Vec::new(),
            video_paths: Vec::new(),
            args_excerpt: Some(args_excerpt),
            output_excerpt: Some(truncate_output_for_tool_ui(output, 3600)),
            suppress_expand: None,
        },
        "subagent" => ToolUiBlock {
            tool_call_id: tool_call_id.map(String::from),
            tool_name: tool_name.to_string(),
            phase: ToolUiPhase::Succeeded,
            headline: t!("tui.tool.result.subagent_done").into_owned(),
            detail_lines: vec![
                t!(
                    "tui.tool.detail.task",
                    task = string_arg(request, "task").unwrap_or("<unknown>")
                )
                .into_owned(),
            ],
            image_paths: Vec::new(),
            video_paths: Vec::new(),
            args_excerpt: Some(args_excerpt),
            output_excerpt: Some(truncate_output_for_tool_ui(output, 3600)),
            suppress_expand: None,
        },
        "ask_questions" => ToolUiBlock {
            tool_call_id: tool_call_id.map(String::from),
            tool_name: tool_name.to_string(),
            phase: ToolUiPhase::Succeeded,
            headline: t!("tui.tool.result.ask_done").into_owned(),
            detail_lines: vec![
                t!(
                    "tui.tool.detail.question_count",
                    count = question_count(request)
                )
                .into_owned(),
            ],
            image_paths: Vec::new(),
            video_paths: Vec::new(),
            args_excerpt: Some(args_excerpt),
            output_excerpt: Some(truncate_output_for_tool_ui(output, 3600)),
            suppress_expand: None,
        },
        "generate_image" => {
            let image_paths = generated_image_paths_from_output(output);
            ToolUiBlock {
                tool_call_id: tool_call_id.map(String::from),
                tool_name: tool_name.to_string(),
                phase: ToolUiPhase::Succeeded,
                headline: t!("tui.tool.result.image_done").into_owned(),
                detail_lines: image_paths
                    .iter()
                    .map(|path| t!("tui.tool.detail.path", path = path).into_owned())
                    .collect(),
                image_paths,
                video_paths: Vec::new(),
                args_excerpt: Some(args_excerpt),
                output_excerpt: Some(truncate_output_for_tool_ui(output, 3600)),
                suppress_expand: None,
            }
        }
        "generate_video" => {
            let video_paths = generated_video_paths_from_output(output);
            ToolUiBlock {
                tool_call_id: tool_call_id.map(String::from),
                tool_name: tool_name.to_string(),
                phase: ToolUiPhase::Succeeded,
                headline: t!("tui.tool.result.video_done").into_owned(),
                detail_lines: video_paths
                    .iter()
                    .map(|path| t!("tui.tool.detail.path", path = path).into_owned())
                    .collect(),
                image_paths: Vec::new(),
                video_paths,
                args_excerpt: Some(args_excerpt),
                output_excerpt: Some(truncate_output_for_tool_ui(output, 3600)),
                suppress_expand: None,
            }
        }
        "create_file" => ToolUiBlock {
            tool_call_id: tool_call_id.map(String::from),
            tool_name: tool_name.to_string(),
            phase: ToolUiPhase::Succeeded,
            headline: t!("tui.tool.result.file_created").into_owned(),
            detail_lines: vec![
                t!(
                    "tui.tool.detail.path",
                    path = string_arg(request, "path").unwrap_or("<unknown>")
                )
                .into_owned(),
            ],
            image_paths: Vec::new(),
            video_paths: Vec::new(),
            args_excerpt: Some(args_excerpt),
            output_excerpt: None,
            suppress_expand: None,
        },
        "edit_file" => ToolUiBlock {
            tool_call_id: tool_call_id.map(String::from),
            tool_name: tool_name.to_string(),
            phase: ToolUiPhase::Succeeded,
            headline: t!("tui.tool.result.file_edited").into_owned(),
            detail_lines: vec![
                t!(
                    "tui.tool.detail.path",
                    path = string_arg(request, "path").unwrap_or("<unknown>")
                )
                .into_owned(),
            ],
            image_paths: Vec::new(),
            video_paths: Vec::new(),
            args_excerpt: Some(args_excerpt),
            output_excerpt: None,
            suppress_expand: None,
        },
        "delete_file" => ToolUiBlock {
            tool_call_id: tool_call_id.map(String::from),
            tool_name: tool_name.to_string(),
            phase: ToolUiPhase::Succeeded,
            headline: t!("tui.tool.result.file_deleted").into_owned(),
            detail_lines: vec![
                t!(
                    "tui.tool.detail.path",
                    path = string_arg(request, "path").unwrap_or("<unknown>")
                )
                .into_owned(),
            ],
            image_paths: Vec::new(),
            video_paths: Vec::new(),
            args_excerpt: Some(args_excerpt),
            output_excerpt: None,
            suppress_expand: None,
        },
        "apply_patch" => {
            let path = apply_patch_path(request).unwrap_or("<unknown>");
            let headline = match apply_patch_operation_type(request) {
                Some("create_file") => t!("tui.tool.result.file_created").into_owned(),
                Some("update_file") => t!("tui.tool.result.file_edited").into_owned(),
                Some("delete_file") => t!("tui.tool.result.file_deleted").into_owned(),
                _ => t!("tui.tool.result.patch_applied").into_owned(),
            };
            ToolUiBlock {
                tool_call_id: tool_call_id.map(String::from),
                tool_name: tool_name.to_string(),
                phase: ToolUiPhase::Succeeded,
                headline,
                detail_lines: vec![t!("tui.tool.detail.path", path = path).into_owned()],
                image_paths: Vec::new(),
                video_paths: Vec::new(),
                args_excerpt: Some(args_excerpt),
                output_excerpt: None,
                suppress_expand: None,
            }
        }
        "shell" => ToolUiBlock {
            tool_call_id: tool_call_id.map(String::from),
            tool_name: tool_name.to_string(),
            phase: ToolUiPhase::Succeeded,
            headline: t!("tui.tool.result.shell_done").into_owned(),
            detail_lines: vec![
                t!(
                    "tui.tool.detail.command",
                    command = string_arg(request, "command").unwrap_or("<unknown>")
                )
                .into_owned(),
            ],
            image_paths: Vec::new(),
            video_paths: Vec::new(),
            args_excerpt: Some(args_excerpt),
            output_excerpt: Some(truncate_output_for_tool_ui(output, 3600)),
            suppress_expand: None,
        },
        _ => ToolUiBlock {
            tool_call_id: tool_call_id.map(String::from),
            tool_name: tool_name.to_string(),
            phase: ToolUiPhase::Succeeded,
            headline: t!("tui.tool.result.generic_done").into_owned(),
            detail_lines: Vec::new(),
            image_paths: Vec::new(),
            video_paths: Vec::new(),
            args_excerpt: Some(args_excerpt),
            output_excerpt: Some(truncate_output_for_tool_ui(output, 3600)),
            suppress_expand: None,
        },
    }
}

pub(crate) fn format_tool_ui_message(
    request: &ToolUiRequest,
    tool_name: &str,
    output: &str,
) -> String {
    match request.name.as_str() {
        "mcp_tool" => t!(
            "tui.tool.message.mcp_done",
            display = string_arg(request, "display_name").unwrap_or("<unknown>"),
            server = string_arg(request, "server").unwrap_or("<unknown>"),
            tool = string_arg(request, "tool_name").unwrap_or("<unknown>"),
            output = truncate_for_preview(output, 1200)
        )
        .into_owned(),
        "web_fetch" => t!(
            "tui.tool.message.web_fetch_done",
            url = string_arg(request, "url").unwrap_or("<unknown>")
        )
        .into_owned(),
        "ls" => t!(
            "tui.tool.message.ls_done",
            path = string_arg(request, "path").unwrap_or("<unknown>")
        )
        .into_owned(),
        "glob" => output.to_string(),
        "read_file" => {
            let (offset, end) = read_file_range_display(request);
            t!(
                "tui.tool.message.read_done",
                path = string_arg(request, "path").unwrap_or("<unknown>"),
                start = offset,
                end = end
            )
            .into_owned()
        }
        "grep" => output.to_string(),
        "subagent" => t!(
            "tui.tool.message.subagent_done",
            task = string_arg(request, "task").unwrap_or("<unknown>"),
            output = truncate_for_preview(output, 1200)
        )
        .into_owned(),
        "ask_questions" => t!(
            "tui.tool.message.ask_done",
            tool = tool_name,
            output = truncate_for_preview(output, 1200)
        )
        .into_owned(),
        "generate_image" => t!(
            "tui.tool.message.image_done",
            output = truncate_for_preview(output, 1200)
        )
        .into_owned(),
        "generate_video" => t!(
            "tui.tool.message.video_done",
            output = truncate_for_preview(output, 1200)
        )
        .into_owned(),
        "create_file" => t!(
            "tui.tool.message.file_created",
            path = string_arg(request, "path").unwrap_or("<unknown>")
        )
        .into_owned(),
        "edit_file" => t!(
            "tui.tool.message.file_edited",
            path = string_arg(request, "path").unwrap_or("<unknown>")
        )
        .into_owned(),
        "delete_file" => t!(
            "tui.tool.message.file_deleted",
            path = string_arg(request, "path").unwrap_or("<unknown>")
        )
        .into_owned(),
        "apply_patch" => t!(
            "tui.tool.message.patch_applied",
            path = apply_patch_path(request).unwrap_or("<unknown>")
        )
        .into_owned(),
        "shell" => t!(
            "tui.tool.message.generic_done",
            tool = tool_name,
            output = truncate_for_preview(output, 1200)
        )
        .into_owned(),
        _ => t!(
            "tui.tool.message.generic_done",
            tool = tool_name,
            output = truncate_for_preview(output, 1200)
        )
        .into_owned(),
    }
}

fn generated_image_paths_from_output(output: &str) -> Vec<String> {
    generated_media_paths_from_output(output, &["path:", "image_ref:", "read_file_path:"])
}

fn generated_video_paths_from_output(output: &str) -> Vec<String> {
    generated_media_paths_from_output(output, &["path:", "video_ref:", "read_file_path:"])
}

fn generated_media_paths_from_output(output: &str, prefixes: &[&str]) -> Vec<String> {
    let mut paths = Vec::new();
    for line in output.lines() {
        let trimmed = line.trim();
        let Some((_, path)) = prefixes.iter().find_map(|prefix| {
            trimmed
                .strip_prefix(prefix)
                .map(|value| (*prefix, value.trim()))
        }) else {
            continue;
        };
        if path.is_empty() {
            continue;
        }
        if !paths.iter().any(|existing| existing == path) {
            paths.push(path.to_string());
        }
    }
    paths
}

#[cfg(test)]
mod tests {
    use super::{
        ToolUiPhase, ToolUiRequest, build_tool_preview_block, build_tool_result_block,
        format_tool_ui_message, tool_approval_block, tool_request_args_excerpt,
    };
    use crate::host_protocol::{BridgeToolApprovalPrompt, BridgeToolApprovalRequest};
    use rust_i18n::t;
    use serde_json::{Value, json};

    #[test]
    fn shell_tool_args_excerpt_keeps_reason_field() {
        let excerpt = tool_request_args_excerpt(&ToolUiRequest::new(
            "shell",
            json!({ "command": "echo hello", "reason": "smoke test" }),
        ));
        let parsed: Value = serde_json::from_str(&excerpt).expect("args excerpt json");
        assert_eq!(
            parsed,
            json!({ "command": "echo hello", "reason": "smoke test" })
        );
    }

    #[test]
    fn tool_result_block_keeps_tool_call_id_for_shell() {
        let block = build_tool_result_block(
            &ToolUiRequest::new(
                "shell",
                json!({ "command": "echo hello", "reason": "smoke test" }),
            ),
            "shell",
            Some("call_00_demo"),
            "hello\n",
        );

        assert_eq!(block.tool_call_id.as_deref(), Some("call_00_demo"));
        assert_eq!(block.tool_name, "shell");
        assert_eq!(
            block.headline,
            t!("tui.tool.result.shell_done").into_owned()
        );
        assert_eq!(
            block.args_excerpt.as_deref(),
            Some("{\n  \"command\": \"echo hello\",\n  \"reason\": \"smoke test\"\n}")
        );
    }

    #[test]
    fn generate_image_result_block_shows_generated_path() {
        let output = "[generated image]\npath: C:/Users/pc/AppData/Roaming/Spirit/generated-images/example.png\nmime_type: image/png\nmodel: image-model";
        let block = build_tool_result_block(
            &ToolUiRequest::new("generate_image", json!({ "prompt": "draw a picture" })),
            "generate_image",
            Some("tool-call-image"),
            output,
        );

        assert_eq!(
            block.headline,
            t!("tui.tool.result.image_done").into_owned()
        );
        assert_eq!(
            block.detail_lines,
            vec![
                t!(
                    "tui.tool.detail.path",
                    path = "C:/Users/pc/AppData/Roaming/Spirit/generated-images/example.png"
                )
                .into_owned()
            ]
        );
        assert_eq!(
            block.image_paths,
            vec!["C:/Users/pc/AppData/Roaming/Spirit/generated-images/example.png"]
        );
        assert!(
            block
                .output_excerpt
                .as_deref()
                .is_some_and(|text| text.contains("path:"))
        );
    }

    #[test]
    fn generate_video_result_block_shows_managed_uri() {
        let output = "[generated video]\nvideo_ref: spirit://generated/video/example.mp4\nread_file_path: spirit://generated/video/example.mp4\nmime_type: video/mp4\nmodel: video-model";
        let block = build_tool_result_block(
            &ToolUiRequest::new("generate_video", json!({ "prompt": "generate a video" })),
            "generate_video",
            Some("tool-call-video"),
            output,
        );

        assert_eq!(
            block.headline,
            t!("tui.tool.result.video_done").into_owned()
        );
        assert_eq!(
            block.detail_lines,
            vec![
                t!(
                    "tui.tool.detail.path",
                    path = "spirit://generated/video/example.mp4"
                )
                .into_owned()
            ]
        );
        assert_eq!(
            block.video_paths,
            vec!["spirit://generated/video/example.mp4"]
        );
    }

    #[test]
    fn tool_approval_block_shows_auto_review_block_reason_before_shortcuts() {
        let block = tool_approval_block(
            "shell",
            Some("call_00_block"),
            &BridgeToolApprovalPrompt::Tool {
                request: BridgeToolApprovalRequest::Shell {
                    command: "rm -rf /".to_string(),
                    reason: None,
                    terminal: "zsh".to_string(),
                },
            },
            false,
            Some("destructive command"),
        );

        assert_eq!(
            block.detail_lines.last(),
            Some(&t!("tui.tool.approval.shortcuts").into_owned())
        );
        assert!(block.detail_lines.iter().any(|line| {
            line.as_str()
                == t!(
                    "tui.tool.approval.block_reason",
                    reason = "destructive command"
                )
                .as_ref()
        }));
    }

    #[test]
    fn tool_approval_block_uses_shell_reason_as_headline() {
        let block = tool_approval_block(
            "shell",
            Some("call_00_demo"),
            &BridgeToolApprovalPrompt::Tool {
                request: BridgeToolApprovalRequest::Shell {
                    command: "echo hi".to_string(),
                    reason: Some("check build output".to_string()),
                    terminal: "Command Prompt (cmd.exe)".to_string(),
                },
            },
            true,
            None,
        );

        assert_eq!(block.headline, "check build output");
        assert_eq!(
            block.detail_lines,
            vec![
                "High-risk tool call: shell".to_string(),
                "Terminal: Command Prompt (cmd.exe)".to_string(),
                "Command: echo hi".to_string(),
                t!("tui.tool.approval.shortcuts_remember").into_owned(),
            ]
        );
    }

    #[test]
    fn read_file_preview_block_uses_read_headline() {
        let block = build_tool_preview_block(
            "read_file",
            "call_preview_read",
            &ToolUiRequest::new(
                "read_file",
                json!({
                    "path": "src/main.rs",
                    "offset": 1,
                    "limit": 20
                }),
            ),
        );

        assert_eq!(block.tool_call_id.as_deref(), Some("call_preview_read"));
        assert_eq!(block.tool_name, "read_file");
        assert_eq!(block.phase, ToolUiPhase::Preview);
        assert_eq!(block.headline, t!("tui.tool.preview.read").into_owned());
        assert_eq!(block.detail_lines, vec!["src/main.rs".to_string()]);
    }

    #[test]
    fn read_file_tool_message_uses_read_file_wording() {
        let message = format_tool_ui_message(
            &ToolUiRequest::new(
                "read_file",
                json!({
                    "path": "src/main.rs",
                    "offset": 3,
                    "limit": 7
                }),
            ),
            "read_file",
            "line3\nline4\n",
        );

        assert_eq!(
            message,
            t!(
                "tui.tool.message.read_done",
                path = "src/main.rs",
                start = 3,
                end = "9"
            )
            .into_owned()
        );
    }

    #[test]
    fn read_file_tool_block_keeps_legacy_summary_shape() {
        let block = build_tool_result_block(
            &ToolUiRequest::new(
                "read_file",
                json!({
                    "path": "src/main.rs",
                    "offset": 3,
                    "limit": 7
                }),
            ),
            "read_file",
            Some("call_01_read"),
            "line3\nline4\n",
        );

        assert_eq!(block.tool_call_id.as_deref(), Some("call_01_read"));
        assert_eq!(block.headline, t!("tui.tool.result.read_done").into_owned());
        assert_eq!(
            block.detail_lines,
            vec![
                t!("tui.tool.detail.path", path = "src/main.rs").into_owned(),
                t!("tui.tool.detail.line_range", start = 3, end = "9").into_owned()
            ]
        );
        assert!(block.output_excerpt.is_none());
    }

    #[test]
    fn glob_tool_block_shows_pattern_detail_and_output_excerpt() {
        let output = "[glob]\npattern: src/**/*.ts\nmatches: 2\n\nsrc/app.ts\nsrc/lib/util.ts\n";
        let block = build_tool_result_block(
            &ToolUiRequest::new("glob", json!({ "pattern": "src/**/*.ts" })),
            "glob",
            Some("call_02_glob"),
            output,
        );

        assert_eq!(block.tool_call_id.as_deref(), Some("call_02_glob"));
        assert_eq!(block.headline, t!("tui.tool.result.glob_done").into_owned());
        assert_eq!(
            block.detail_lines,
            vec![t!("tui.tool.detail.pattern", pattern = "src/**/*.ts").into_owned()]
        );
        assert!(
            block
                .output_excerpt
                .as_deref()
                .is_some_and(|text| text.contains("src/app.ts"))
        );
    }

    #[test]
    fn provider_tool_preview_sets_suppress_expand_and_query_excerpt() {
        let block = build_tool_preview_block(
            "web_search",
            "call_provider_01",
            &ToolUiRequest::new(
                "web_search",
                json!({
                    "status": "in_progress",
                    "_spiritUi": {
                        "inputExcerpt": "latest AI news",
                        "suppressExpand": true
                    }
                }),
            ),
        );

        assert_eq!(block.suppress_expand, Some(true));
        assert_eq!(block.args_excerpt.as_deref(), Some("latest AI news"));
        assert_eq!(
            block.headline,
            t!("tui.tool.preview.web_search").into_owned()
        );
        assert_eq!(block.detail_lines, vec!["latest AI news".to_string()]);
    }
}
