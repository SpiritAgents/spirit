use serde_json::{Value, json};

use crate::ports::ArchivedLlmMessage;

pub(crate) fn archived_llm_message_to_json(message: &ArchivedLlmMessage) -> Value {
    let mut value = json!({
        "role": message.role,
        "content": message.content,
    });

    if let Some(tool_call_id) = &message.tool_call_id
        && let Some(object) = value.as_object_mut()
    {
        object.insert(
            "toolCallId".to_string(),
            Value::String(tool_call_id.clone()),
        );
    }

    if let Some(tool_calls) = &message.tool_calls
        && let Some(object) = value.as_object_mut()
    {
        object.insert(
            "toolCalls".to_string(),
            serde_json::to_value(tool_calls).unwrap_or(Value::Null),
        );
    }

    if let Some(provider_state) = &message.provider_state
        && let Some(object) = value.as_object_mut()
    {
        object.insert("providerState".to_string(), provider_state.clone());
    }

    value
}

pub(crate) fn chat_archive_to_bridge_json(archive: &crate::ports::ChatArchive) -> Value {
    let snapshots = archive.desktop_messages.clone().unwrap_or_else(|| {
        let projection =
            crate::chat_timeline::project_live_chat_from_llm_history(&archive.llm_history);
        crate::rewind::conversation_snapshots(
            &projection.messages,
            &projection.assistant_aux_by_message,
            None,
        )
    });
    let mut value = json!({
        "desktopMessageTimeline": crate::chat_timeline::build_persisted_timeline(&snapshots),
        "messages": archive.messages.iter().map(|(role, content)| {
            json!({
                "role": role,
                "content": content,
            })
        }).collect::<Vec<_>>(),
        "assistantAux": archive.assistant_aux.iter().map(|entry| {
            json!({
                "messageIndex": entry.message_index,
                "thinking": entry.thinking,
                "compaction": entry.compaction,
                "finishTaskNotice": entry.finish_task_notice,
            })
        }).collect::<Vec<_>>(),
        "llmHistory": archive.llm_history.iter().map(archived_llm_message_to_json).collect::<Vec<_>>(),
        "loopEnabled": archive.loop_enabled,
        "approvalLevel": archive.approval_level,
        "subagentSessions": archive.subagent_sessions.iter().map(|entry| {
            json!({
                "summary": {
                    "sessionId": entry.summary.session_id,
                    "parentToolCallId": entry.summary.parent_tool_call_id,
                    "title": entry.summary.title,
                    "status": entry.summary.status,
                    "startedAtUnixMs": entry.summary.started_at_unix_ms,
                    "updatedAtUnixMs": entry.summary.updated_at_unix_ms,
                    "completedAtUnixMs": entry.summary.completed_at_unix_ms,
                    "latestMessage": entry.summary.latest_message,
                    "finalOutput": entry.summary.final_output,
                    "error": entry.summary.error,
                },
                "llmHistory": entry.llm_history.iter().map(archived_llm_message_to_json).collect::<Vec<_>>(),
            })
        }).collect::<Vec<_>>(),
    });

    if let Some(rewind) = &archive.rewind
        && let Some(object) = value.as_object_mut()
    {
        object.insert("rewind".to_string(), rewind.clone());
    }

    value
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bridge_import_preserves_ui_before_compacted_model_history() {
        let mut archive: crate::ports::ChatArchive = serde_json::from_value(json!({
            "messages": [], "assistantAux": [],
            "llmHistory": [{ "role": "assistant", "content": "Compacted context." }]
        }))
        .unwrap();
        archive.desktop_messages = Some(crate::rewind::conversation_snapshots(
            &[crate::view::ChatMessage::new(
                crate::view::MessageRole::User,
                "Original request.",
            )],
            &Default::default(),
            None,
        ));
        let serialized = chat_archive_to_bridge_json(&archive);
        let timeline: Vec<crate::chat_timeline::PersistedTimelineTurn> =
            serde_json::from_value(serialized["desktopMessageTimeline"].clone()).unwrap();
        let messages = crate::chat_timeline::hydrate_desktop_messages_from_timeline(&timeline);
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].content, "Original request.");
    }

    #[test]
    fn bridge_import_builds_a_baseline_for_history_only_archives() {
        let archive: crate::ports::ChatArchive = serde_json::from_value(json!({
            "messages": [], "assistantAux": [],
            "llmHistory": [{ "role": "user", "content": "Imported request." }]
        }))
        .unwrap();
        let serialized = chat_archive_to_bridge_json(&archive);
        let timeline: Vec<crate::chat_timeline::PersistedTimelineTurn> =
            serde_json::from_value(serialized["desktopMessageTimeline"].clone()).unwrap();
        let messages = crate::chat_timeline::hydrate_desktop_messages_from_timeline(&timeline);
        assert_eq!(messages[0].content, "Imported request.");
    }
}
