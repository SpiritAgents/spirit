use rust_i18n::t;
use serde::Deserialize;
use serde_json::{Value, json};

use crate::view::{ChatMessage, MessageRole, ToolUiBlock, ToolUiPhase};

#[derive(Clone, Default, Deserialize)]
pub(crate) struct TaskOutput {
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub truncated: bool,
}

impl TaskOutput {
    pub fn append(&mut self, text: &str) {
        self.text.push_str(text);
        if self.text.chars().count() > 16_384 {
            self.truncated = true;
            self.text = self
                .text
                .chars()
                .rev()
                .take(16_384)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect();
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskView {
    id: String,
    tool_call_id: String,
    kind: String,
    status: String,
    input: String,
    output_path: String,
    terminal_event_id: Option<String>,
    final_output_preview: Option<String>,
    session_id: Option<String>,
    session_transcript: Option<String>,
    worktree_path: Option<String>,
    worktree_branch: Option<String>,
    exit_code: Option<i32>,
}

pub(crate) fn task_tool_message(
    task: &Value,
    output: &TaskOutput,
    notice: bool,
    restored: bool,
    output_error: Option<&str>,
) -> Result<ChatMessage, String> {
    let record: TaskView =
        serde_json::from_value(task.clone()).map_err(|error| error.to_string())?;
    let name = match record.kind.as_str() {
        "shell" => "Shell".to_string(),
        "subagent" => t!("tui.task.subagent").into_owned(),
        kind => return Err(format!("Unknown task kind: {kind}")),
    };
    let (headline, phase) = if notice {
        let headline = match record.status.as_str() {
            "completed" => t!("tui.task.completed", task = name),
            "failed" => t!("tui.task.failed", task = name),
            "stopped" => t!("tui.task.stopped", task = name),
            "interrupted" => t!("tui.task.interrupted", task = name),
            status => return Err(format!("Nonterminal task notification: {status}")),
        }
        .into_owned();
        (
            headline,
            if record.status == "completed" {
                ToolUiPhase::Succeeded
            } else {
                ToolUiPhase::Failed
            },
        )
    } else {
        (
            if record.kind == "shell" {
                t!("tui.tool.result.shell_done").into_owned()
            } else {
                t!("tui.task.delegated").into_owned()
            },
            ToolUiPhase::Succeeded,
        )
    };
    let mut metadata = serde_json::Map::new();
    metadata.insert("backgroundTask".into(), task.clone());
    metadata.insert(
        "backgroundTaskOutput".into(),
        json!({ "text": output.text, "truncated": output.truncated }),
    );
    let tool_call_id = if notice {
        let event_id = record
            .terminal_event_id
            .ok_or("Missing task notification event ID")?;
        metadata.insert(
            "taskNotification".into(),
            json!({
                "eventId": event_id, "origin": "background-task", "restored": restored,
                "outputError": output_error,
            }),
        );
        format!("task-notice:{event_id}")
    } else {
        record.tool_call_id
    };
    let mut details = vec![record.id, record.output_path];
    if let Some(code) = record.exit_code {
        details.push(format!("exit_code: {code}"));
    }
    for (key, value) in [
        ("sessionId", record.session_id),
        ("sessionTranscript", record.session_transcript),
        ("worktree_path", record.worktree_path),
        ("worktree_branch", record.worktree_branch),
    ] {
        if let Some(value) = value {
            details.push(format!("{key}: {value}"));
        }
    }

    if let Some(error) = output_error {
        details.push(error.to_string());
    }
    let detail = record.final_output_preview.unwrap_or(record.input);
    let content = format!(
        "{headline}: {detail}\n{}\n{}",
        details.join("\n"),
        output.text
    );
    Ok(ChatMessage::with_tool_block(
        MessageRole::Agent,
        content,
        ToolUiBlock {
            metadata,
            tool_call_id: Some(tool_call_id),
            tool_name: record.kind,
            phase,
            headline,
            detail_lines: details,
            image_paths: Vec::new(),
            video_paths: Vec::new(),
            args_excerpt: task
                .get("argumentsJson")
                .and_then(Value::as_str)
                .map(String::from),
            output_excerpt: Some(output.text.clone()),
            suppress_expand: None,
        },
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn task() -> Value {
        json!({
            "id": "task_000000000001", "toolCallId": "original-call", "kind": "shell",
            "status": "interrupted", "input": "build", "outputPath": "/tasks/output.log",
            "terminalEventId": "event-1", "elapsedMs": 1200,
        })
    }

    #[test]
    fn task_notification_metadata_survives_timeline_roundtrip() {
        let message = task_tool_message(
            &task(),
            &TaskOutput {
                text: "last output".into(),
                truncated: true,
            },
            true,
            true,
            Some("Missing output file"),
        )
        .unwrap();
        let snapshots = crate::rewind::conversation_snapshots(
            &[message],
            &std::collections::HashMap::new(),
            None,
        );
        let encoded = serde_json::to_string(&snapshots).unwrap();
        let decoded: Vec<crate::rewind::ConversationMessageSnapshot> =
            serde_json::from_str(&encoded).unwrap();
        let (restored, _) = crate::rewind::restore_conversation(&decoded);
        let block = restored[0].tool_block.as_ref().unwrap();
        assert_eq!(block.tool_call_id.as_deref(), Some("task-notice:event-1"));
        assert_eq!(
            block.metadata["backgroundTask"]["toolCallId"],
            "original-call"
        );
        assert_eq!(
            block.metadata["taskNotification"]["origin"],
            "background-task"
        );
        assert_eq!(
            block.metadata["taskNotification"]["outputError"],
            "Missing output file"
        );
        assert_eq!(block.metadata["backgroundTaskOutput"]["truncated"], true);
        assert_eq!(block.output_excerpt.as_deref(), Some("last output"));
    }

    #[test]
    fn task_output_tail_preserves_unicode_and_reports_truncation() {
        let mut output = TaskOutput::default();
        output.append(&"😀".repeat(16_384));
        assert!(!output.truncated);
        output.append("終");
        assert!(output.truncated);
        assert_eq!(output.text.chars().count(), 16_384);
        assert!(output.text.ends_with('終'));
    }

    #[test]
    fn task_notifications_require_terminal_state_and_identity() {
        let mut value = task();
        value["status"] = json!("running");
        assert!(task_tool_message(&value, &TaskOutput::default(), true, false, None).is_err());
        value["status"] = json!("completed");
        value.as_object_mut().unwrap().remove("terminalEventId");
        assert!(task_tool_message(&value, &TaskOutput::default(), true, false, None).is_err());
    }
}
