use crate::host_runtime::{
    build_tool_preview_block, build_tool_result_block, format_tool_ui_message,
};
use crate::ports::{ArchivedLlmMessage, ArchivedLlmToolCall};
use crate::rewind::{
    ConversationMessageRole, ConversationMessageSnapshot, MessageAuxSnapshot, ToolBlockSnapshot,
};
use crate::tool_ui::tool_request_from_streaming_preview;
use crate::view::{AssistantAuxData, ChatMessage, MessageRole};
use std::collections::HashMap;

pub const CHAT_SCHEMA_VERSION: i32 = 2;

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedTimelineRow {
    pub row_id: String,
    pub message_id: usize,
    pub turn_id: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub segment_id: Option<u64>,
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub section: Option<String>,
    pub created_order: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    pub pending: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool: Option<ToolBlockSnapshot>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub aux: Option<MessageAuxSnapshot>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedTimelineSegment {
    pub segment_id: u64,
    pub turn_id: u64,
    pub kind: String,
    pub status: String,
    pub created_order: u64,
    pub rows: Vec<PersistedTimelineRow>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedTimelineTurn {
    pub turn_id: u64,
    pub created_order: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_row: Option<PersistedTimelineRow>,
    pub segments: Vec<PersistedTimelineSegment>,
}

pub fn normalize_desktop_messages_for_persistence(
    messages: &[ConversationMessageSnapshot],
) -> Vec<ConversationMessageSnapshot> {
    messages
        .iter()
        .filter(|message| {
            let aux = sanitize_aux(message.aux.as_ref());
            !(message.role == ConversationMessageRole::Assistant
                && message.content.trim().is_empty()
                && message.tool.is_none()
                && aux.is_none())
        })
        .map(|message| ConversationMessageSnapshot {
            id: message.id,
            role: message.role,
            content: message.content.clone(),
            tool: message.tool.clone(),
            aux: sanitize_aux(message.aux.as_ref()),
            pending: false,
        })
        .collect()
}

pub fn build_persisted_timeline(
    messages: &[ConversationMessageSnapshot],
) -> Vec<PersistedTimelineTurn> {
    let normalized = normalize_desktop_messages_for_persistence(messages);
    let mut turns = Vec::new();
    let mut current_turn: Option<PersistedTimelineTurn> = None;
    let mut current_segment: Option<PersistedTimelineSegment> = None;
    let mut next_turn_id = 1u64;
    let mut next_segment_id = 1u64;
    let mut next_row_id = 1u64;
    let mut next_created_order = 0u64;

    let push_segment = |turn: &mut PersistedTimelineTurn, segment: PersistedTimelineSegment| {
        if !segment.rows.is_empty() {
            turn.segments.push(segment);
        }
    };

    for message in normalized {
        if message.role == ConversationMessageRole::User {
            if let Some(mut turn) = current_turn.take() {
                if let Some(segment) = current_segment.take() {
                    push_segment(&mut turn, segment);
                }
                turns.push(turn);
            }
            current_turn = Some(PersistedTimelineTurn {
                turn_id: next_turn_id,
                created_order: next_created_order,
                user_row: Some(PersistedTimelineRow {
                    row_id: format!("row-{next_row_id}"),
                    message_id: message.id,
                    turn_id: next_turn_id,
                    segment_id: None,
                    kind: "user".to_string(),
                    section: None,
                    created_order: next_created_order,
                    content: Some(message.content.clone()),
                    pending: false,
                    tool: None,
                    aux: None,
                }),
                segments: Vec::new(),
            });
            next_turn_id += 1;
            next_row_id += 1;
            next_created_order += 1;
            continue;
        }

        if current_segment.is_none() {
            let turn_id = if let Some(turn) = current_turn.as_ref() {
                turn.turn_id
            } else {
                let turn = PersistedTimelineTurn {
                    turn_id: next_turn_id,
                    created_order: next_created_order,
                    user_row: None,
                    segments: Vec::new(),
                };
                next_turn_id += 1;
                next_created_order += 1;
                current_turn = Some(turn);
                current_turn.as_ref().expect("turn inserted").turn_id
            };
            current_segment = Some(PersistedTimelineSegment {
                segment_id: next_segment_id,
                turn_id,
                kind: "initial".to_string(),
                status: "completed".to_string(),
                created_order: next_created_order,
                rows: Vec::new(),
            });
            next_segment_id += 1;
            next_created_order += 1;
        }

        let turn = current_turn.as_mut().expect("assistant turn");
        let segment = current_segment.as_mut().expect("assistant segment");
        if let Some(row) = row_from_assistant_message(
            message,
            turn.turn_id,
            segment.segment_id,
            next_created_order,
            next_row_id,
        ) {
            segment.rows.push(row);
            next_row_id += 1;
            next_created_order += 1;
        }
    }

    if let Some(mut turn) = current_turn.take() {
        if let Some(segment) = current_segment.take() {
            push_segment(&mut turn, segment);
        }
        if turn.user_row.is_some() || !turn.segments.is_empty() {
            turns.push(turn);
        }
    }

    turns
}

fn row_from_assistant_message(
    message: ConversationMessageSnapshot,
    turn_id: u64,
    segment_id: u64,
    created_order: u64,
    row_id_num: u64,
) -> Option<PersistedTimelineRow> {
    let base = |kind: &str, section: Option<&str>| PersistedTimelineRow {
        row_id: format!("row-{row_id_num}"),
        message_id: message.id,
        turn_id,
        segment_id: Some(segment_id),
        kind: kind.to_string(),
        section: section.map(str::to_string),
        created_order,
        content: None,
        pending: false,
        tool: None,
        aux: None,
    };

    if let Some(tool) = message.tool.clone() {
        let mut row = base("tool", Some("tools"));
        row.tool = Some(tool);
        return Some(row);
    }

    let aux = sanitize_aux(message.aux.as_ref());
    if message.content.trim().is_empty() {
        if let Some(thinking) = aux.as_ref().and_then(|value| value.thinking.clone()) {
            return Some(PersistedTimelineRow {
                aux: Some(MessageAuxSnapshot {
                    thinking: Some(thinking),
                    compaction: None,
                }),
                section: Some("before-tools".to_string()),
                ..base("assistant-thinking", Some("before-tools"))
            });
        }
        if let Some(compaction) = aux.as_ref().and_then(|value| value.compaction.clone()) {
            return Some(PersistedTimelineRow {
                aux: Some(MessageAuxSnapshot {
                    thinking: None,
                    compaction: Some(compaction),
                }),
                ..base("assistant-compaction", None)
            });
        }
        return None;
    }

    Some(PersistedTimelineRow {
        content: Some(message.content),
        aux,
        section: Some("after-tools".to_string()),
        ..base("assistant-text", Some("after-tools"))
    })
}

pub fn hydrate_desktop_messages_from_timeline(
    timeline: &[PersistedTimelineTurn],
) -> Vec<ConversationMessageSnapshot> {
    let mut messages = Vec::new();
    for turn in timeline {
        if let Some(user_row) = turn.user_row.as_ref()
            && let Some(message) = row_to_message(user_row)
        {
            messages.push(message);
        }
        for segment in &turn.segments {
            for row in &segment.rows {
                if let Some(message) = row_to_message(row) {
                    messages.push(message);
                }
            }
        }
    }
    messages
}

fn row_to_message(row: &PersistedTimelineRow) -> Option<ConversationMessageSnapshot> {
    if row.pending {
        return None;
    }
    match row.kind.as_str() {
        "user" => {
            let content = row.content.as_deref()?.trim();
            if content.is_empty() {
                return None;
            }
            Some(ConversationMessageSnapshot {
                id: row.message_id,
                role: ConversationMessageRole::User,
                content: content.to_string(),
                tool: None,
                aux: None,
                pending: false,
            })
        }
        "assistant-text" => {
            let content = row.content.as_deref()?.trim();
            if content.is_empty() {
                return None;
            }
            Some(ConversationMessageSnapshot {
                id: row.message_id,
                role: ConversationMessageRole::Assistant,
                content: content.to_string(),
                tool: None,
                aux: sanitize_aux(row.aux.as_ref()),
                pending: false,
            })
        }
        "assistant-thinking" => Some(ConversationMessageSnapshot {
            id: row.message_id,
            role: ConversationMessageRole::Assistant,
            content: String::new(),
            tool: None,
            aux: sanitize_aux(row.aux.as_ref()),
            pending: false,
        }),
        "assistant-compaction" => Some(ConversationMessageSnapshot {
            id: row.message_id,
            role: ConversationMessageRole::Assistant,
            content: String::new(),
            tool: None,
            aux: sanitize_aux(row.aux.as_ref()),
            pending: false,
        }),
        "tool" => Some(ConversationMessageSnapshot {
            id: row.message_id,
            role: ConversationMessageRole::Assistant,
            content: String::new(),
            tool: row.tool.clone(),
            aux: None,
            pending: false,
        }),
        _ => None,
    }
}

pub fn derive_archive_projection(
    messages: &[ConversationMessageSnapshot],
) -> (
    Vec<(String, String)>,
    Vec<crate::ports::AssistantAuxArchiveEntry>,
) {
    let mut archive_messages = Vec::new();
    let mut assistant_aux = Vec::new();
    for message in messages {
        if message.role == ConversationMessageRole::User {
            archive_messages.push(("user".to_string(), message.content.clone()));
            continue;
        }
        if message.tool.is_some() {
            continue;
        }
        let aux = sanitize_aux(message.aux.as_ref());
        if message.content.trim().is_empty() && aux.is_none() {
            continue;
        }
        let index = archive_messages.len();
        archive_messages.push(("assistant".to_string(), message.content.clone()));
        if let Some(aux) = aux {
            assistant_aux.push(crate::ports::AssistantAuxArchiveEntry {
                message_index: index,
                thinking: aux.thinking,
                compaction: aux.compaction,
                finish_task_notice: None,
            });
        }
    }
    (archive_messages, assistant_aux)
}

/// UI projection from daemon `llm_history` for live session attach.
#[derive(Clone, Debug, Default)]
pub struct LiveChatProjection {
    pub messages: Vec<ChatMessage>,
    pub assistant_aux_by_message: HashMap<usize, AssistantAuxData>,
}

/// Project daemon `llm_history` into TUI chat rows, including tool cards.
pub fn project_live_chat_from_llm_history(history: &[ArchivedLlmMessage]) -> LiveChatProjection {
    project_live_chat_with_task_notices(history, &[])
}

pub(crate) fn project_live_chat_with_task_notices(
    history: &[ArchivedLlmMessage],
    notices: &[serde_json::Value],
) -> LiveChatProjection {
    let mut projection = LiveChatProjection::default();
    let mut index = 0usize;
    while index < history.len() {
        let entry = &history[index];
        match entry.role.as_str() {
            "user" => {
                if let Some(notice) = notices.iter().find(|notice| {
                    notice.get("content").and_then(serde_json::Value::as_str)
                        == Some(entry.text_content().as_str())
                }) {
                    let projected = notice
                        .get("output")
                        .cloned()
                        .map(serde_json::from_value::<crate::background_task_display::TaskOutput>)
                        .transpose()
                        .map_err(|error| error.to_string())
                        .and_then(|output| {
                            crate::background_task_display::task_tool_message(
                                &notice["task"],
                                &output.unwrap_or_default(),
                                true,
                                notice
                                    .get("restored")
                                    .and_then(serde_json::Value::as_bool)
                                    .unwrap_or(false),
                                notice
                                    .get("outputError")
                                    .and_then(serde_json::Value::as_str),
                            )
                        });
                    projection.messages.push(
                        projected
                            .unwrap_or_else(|error| ChatMessage::new(MessageRole::Agent, error)),
                    );
                } else {
                    push_user_message(&mut projection, entry);
                }
                index += 1;
            }
            "assistant" => {
                index = push_assistant_turn(&mut projection, history, index);
            }
            "tool" => {
                index += 1;
            }
            _ => index += 1,
        }
    }
    projection
}

pub(crate) fn append_presentation_events(
    projection: &mut LiveChatProjection,
    entries: &[serde_json::Value],
) -> Result<(), String> {
    use crate::host_runtime::RuntimeEvent;
    let mut sync = crate::runtime_sync::RuntimeSyncState::new();
    let mut active: Option<usize> = None;
    for entry in entries {
        match entry.get("kind").and_then(serde_json::Value::as_str) {
            Some("user") => {
                let text = entry
                    .get("text")
                    .and_then(serde_json::Value::as_str)
                    .ok_or("Invalid presentation user turn")?;
                projection
                    .messages
                    .push(ChatMessage::new(MessageRole::User, text));
                active = None;
                continue;
            }
            Some("runtime") => sync.apply_bridge_events(vec![
                serde_json::from_value(entry["event"].clone())
                    .map_err(|error| error.to_string())?,
            ]),
            _ => return Err("Invalid presentation entry".into()),
        }
        for event in sync.events.drain(..) {
            match event {
                RuntimeEvent::BeginAssistantResponse => {
                    projection
                        .messages
                        .push(ChatMessage::new(MessageRole::Agent, ""));
                    active = Some(projection.messages.len() - 1);
                }
                RuntimeEvent::AssistantChunk(text) => {
                    let index = *active.get_or_insert_with(|| {
                        projection
                            .messages
                            .push(ChatMessage::new(MessageRole::Agent, ""));
                        projection.messages.len() - 1
                    });
                    projection.messages[index].content.push_str(&text);
                }
                RuntimeEvent::ReplacePendingAssistant(text) => {
                    if let Some(index) = active {
                        projection.messages[index].content = text;
                    }
                }
                RuntimeEvent::UpdatePendingAssistantThinking(text)
                | RuntimeEvent::AssistantThinkingSegmentFinalized(text) => {
                    if let Some(index) = active {
                        projection
                            .assistant_aux_by_message
                            .entry(index)
                            .or_default()
                            .thinking = Some(text);
                    }
                }
                RuntimeEvent::UpdatePendingAssistantCompaction(text) => {
                    if let Some(index) = active {
                        projection
                            .assistant_aux_by_message
                            .entry(index)
                            .or_default()
                            .compaction = Some(text);
                    }
                }
                RuntimeEvent::AssistantResponseCompleted => active = None,
                RuntimeEvent::RemovePendingAssistant => {
                    if let Some(index) = active.take() {
                        projection.messages[index].content.clear();
                    }
                }
                RuntimeEvent::PushMessage(message) => projection.messages.push(message),
                RuntimeEvent::UpsertTaskTool { message, insert } => {
                    let id = message
                        .tool_block
                        .as_ref()
                        .and_then(|tool| tool.tool_call_id.as_ref());
                    let existing = projection.messages.iter_mut().find(|entry| {
                        id.is_some()
                            && entry
                                .tool_block
                                .as_ref()
                                .and_then(|tool| tool.tool_call_id.as_ref())
                                == id
                    });
                    if let Some(existing) = existing {
                        *existing = message;
                    } else if insert {
                        projection.messages.push(message);
                    }
                }
                RuntimeEvent::UpsertToolPreview { .. } | RuntimeEvent::OpenAskQuestions { .. } => {}
            }
        }
    }
    Ok(())
}

/// Backward-compatible wrapper returning message rows only.
pub fn project_chat_messages_from_llm_history(history: &[ArchivedLlmMessage]) -> Vec<ChatMessage> {
    project_live_chat_from_llm_history(history).messages
}

fn push_user_message(projection: &mut LiveChatProjection, entry: &ArchivedLlmMessage) {
    let content = entry.text_content();
    if content.trim().is_empty() {
        return;
    }
    projection.messages.push(ChatMessage {
        role: MessageRole::User,
        content,
        tool_block: None,
    });
}

fn push_assistant_turn(
    projection: &mut LiveChatProjection,
    history: &[ArchivedLlmMessage],
    start_index: usize,
) -> usize {
    let entry = &history[start_index];
    let mut next_index = start_index + 1;
    if let Some(tool_calls) = entry.tool_calls.as_ref().filter(|calls| !calls.is_empty()) {
        let tool_outputs = collect_following_tool_outputs(history, start_index + 1);
        next_index = start_index + 1 + tool_outputs.consumed;
        for tool_call in tool_calls {
            push_tool_call_message(
                projection,
                tool_call,
                tool_outputs.by_id.get(&tool_call.id).copied(),
            );
        }
    }

    let content = entry.text_content();
    if !content.trim().is_empty() {
        let message_index = projection.messages.len();
        projection.messages.push(ChatMessage {
            role: MessageRole::Agent,
            content,
            tool_block: None,
        });
        if let Some(aux) = assistant_aux_from_provider_state(entry.provider_state.as_ref()) {
            projection
                .assistant_aux_by_message
                .insert(message_index, aux);
        }
    } else if let Some(aux) = assistant_aux_from_provider_state(entry.provider_state.as_ref()) {
        let message_index = projection.messages.len();
        projection.messages.push(ChatMessage {
            role: MessageRole::Agent,
            content: String::new(),
            tool_block: None,
        });
        projection
            .assistant_aux_by_message
            .insert(message_index, aux);
    }

    next_index
}

struct FollowingToolOutputs<'a> {
    by_id: HashMap<String, &'a ArchivedLlmMessage>,
    consumed: usize,
}

fn collect_following_tool_outputs<'a>(
    history: &'a [ArchivedLlmMessage],
    start_index: usize,
) -> FollowingToolOutputs<'a> {
    let mut by_id = HashMap::new();
    let mut consumed = 0usize;
    for entry in history.iter().skip(start_index) {
        if entry.role != "tool" {
            break;
        }
        if let Some(tool_call_id) = entry.tool_call_id.as_deref() {
            by_id.entry(tool_call_id.to_string()).or_insert(entry);
        }
        consumed += 1;
    }
    FollowingToolOutputs { by_id, consumed }
}

fn push_tool_call_message(
    projection: &mut LiveChatProjection,
    tool_call: &ArchivedLlmToolCall,
    tool_output: Option<&ArchivedLlmMessage>,
) {
    let request = tool_request_from_streaming_preview(&tool_call.name, &tool_call.arguments_json);
    let (content, tool_block) = if let Some(output) = tool_output {
        let output_text = output.text_content();
        (
            format_tool_ui_message(&request, &tool_call.name, &output_text),
            build_tool_result_block(&request, &tool_call.name, Some(&tool_call.id), &output_text),
        )
    } else {
        (
            String::new(),
            build_tool_preview_block(&tool_call.name, &tool_call.id, &request),
        )
    };
    projection.messages.push(ChatMessage {
        role: MessageRole::Agent,
        content,
        tool_block: Some(tool_block),
    });
}

fn assistant_aux_from_provider_state(
    provider_state: Option<&serde_json::Value>,
) -> Option<AssistantAuxData> {
    let provider_state = provider_state?;
    let thinking = provider_state
        .get("thinking")
        .or_else(|| provider_state.get("reasoning"))
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let compaction = provider_state
        .get("compaction")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    if thinking.is_none() && compaction.is_none() {
        None
    } else {
        Some(AssistantAuxData {
            thinking,
            compaction,
        })
    }
}

fn sanitize_aux(aux: Option<&MessageAuxSnapshot>) -> Option<MessageAuxSnapshot> {
    let aux = aux?;
    let thinking = aux
        .thinking
        .clone()
        .filter(|value| !value.trim().is_empty());
    let compaction = aux
        .compaction
        .clone()
        .filter(|value| !value.trim().is_empty());
    if thinking.is_none() && compaction.is_none() {
        None
    } else {
        Some(MessageAuxSnapshot {
            thinking,
            compaction,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rewind::ToolBlockSnapshotPhase;

    #[test]
    fn build_persisted_timeline_omits_empty_assistant_content_for_tool_and_thinking() {
        let messages = vec![
            ConversationMessageSnapshot {
                id: 1,
                role: ConversationMessageRole::User,
                content: "hello".to_string(),
                tool: None,
                aux: None,
                pending: false,
            },
            ConversationMessageSnapshot {
                id: 2,
                role: ConversationMessageRole::Assistant,
                content: String::new(),
                tool: None,
                aux: Some(MessageAuxSnapshot {
                    thinking: Some("reasoning".to_string()),
                    compaction: None,
                }),
                pending: false,
            },
            ConversationMessageSnapshot {
                id: 3,
                role: ConversationMessageRole::Assistant,
                content: String::new(),
                tool: Some(crate::rewind::ToolBlockSnapshot {
                    metadata: Default::default(),
                    tool_call_id: Some("call-1".to_string()),
                    tool_name: "read_file".to_string(),
                    phase: ToolBlockSnapshotPhase::Succeeded,
                    headline: "Read".to_string(),
                    detail_lines: Vec::new(),
                    image_paths: Vec::new(),
                    video_paths: Vec::new(),
                    args_excerpt: None,
                    output_excerpt: None,
                }),
                aux: None,
                pending: false,
            },
            ConversationMessageSnapshot {
                id: 4,
                role: ConversationMessageRole::Assistant,
                content: "answer".to_string(),
                tool: None,
                aux: None,
                pending: false,
            },
        ];

        let timeline = build_persisted_timeline(&messages);
        let rows = &timeline[0].segments[0].rows;
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].kind, "assistant-thinking");
        assert!(rows[0].content.is_none());
        assert_eq!(rows[1].kind, "tool");
        assert!(rows[1].content.is_none());
        assert_eq!(rows[2].content.as_deref(), Some("answer"));
    }

    #[test]
    fn project_chat_messages_from_llm_history_includes_tool_cards() {
        use crate::ports::ArchivedLlmToolCall;

        let history = vec![
            ArchivedLlmMessage::from_text_and_images(
                "user".to_string(),
                "hi".to_string(),
                Vec::new(),
            ),
            ArchivedLlmMessage::from_text_and_images(
                "assistant".to_string(),
                String::new(),
                Vec::new(),
            )
            .with_tool_calls(Some(vec![ArchivedLlmToolCall {
                id: "call-1".to_string(),
                name: "Shell".to_string(),
                arguments_json: r#"{"command":"echo hi"}"#.to_string(),
            }])),
            ArchivedLlmMessage::from_text_and_images(
                "tool".to_string(),
                "hi\n".to_string(),
                Vec::new(),
            )
            .with_tool_call_id(Some("call-1".to_string())),
            ArchivedLlmMessage::from_text_and_images(
                "assistant".to_string(),
                "done".to_string(),
                Vec::new(),
            ),
        ];

        let projection = project_live_chat_from_llm_history(&history);
        assert_eq!(projection.messages.len(), 3);
        assert_eq!(projection.messages[0].role, MessageRole::User);
        assert!(projection.messages[1].tool_block.is_some());
        assert_eq!(projection.messages[2].content, "done");
    }

    #[test]
    fn project_chat_messages_from_llm_history_skips_orphan_tool_rows() {
        use crate::ports::ArchivedLlmToolCall;

        let history = vec![
            ArchivedLlmMessage::from_text_and_images(
                "user".to_string(),
                "hi".to_string(),
                Vec::new(),
            ),
            ArchivedLlmMessage::from_text_and_images(
                "assistant".to_string(),
                String::new(),
                Vec::new(),
            )
            .with_tool_calls(Some(vec![ArchivedLlmToolCall {
                id: "call-1".to_string(),
                name: "Shell".to_string(),
                arguments_json: "{}".to_string(),
            }])),
            ArchivedLlmMessage::from_text_and_images(
                "tool".to_string(),
                "output".to_string(),
                Vec::new(),
            )
            .with_tool_call_id(Some("call-1".to_string())),
            ArchivedLlmMessage::from_text_and_images(
                "assistant".to_string(),
                "done".to_string(),
                Vec::new(),
            ),
        ];

        let projection = project_live_chat_from_llm_history(&history);
        assert_eq!(projection.messages.len(), 3);
        assert_eq!(projection.messages[0].role, MessageRole::User);
        assert_eq!(projection.messages[0].content, "hi");
        assert!(projection.messages[1].tool_block.is_some());
        assert_eq!(projection.messages[2].role, MessageRole::Agent);
        assert_eq!(projection.messages[2].content, "done");
    }

    /// Desktop-pushed timeline rows carry fields the CLI does not model
    /// (`canContinue`, `localFileAttachments`, `aux.finishTaskNotice`) and row
    /// kinds without a TUI projection (`standalone-subagent-status`); the
    /// daemon wire payload must still hydrate like a disk load.
    #[test]
    fn hydrate_desktop_messages_from_daemon_timeline_payload() {
        let payload = serde_json::json!({
            "messages": [],
            "assistantAux": [],
            "llmHistory": [],
            "loopEnabled": false,
            "approvalLevel": "default",
            "subagentSessions": [],
            "desktopMessageTimeline": [{
                "turnId": 1,
                "createdOrder": 0,
                "userRow": {
                    "rowId": "row-1",
                    "messageId": 1,
                    "turnId": 1,
                    "kind": "user",
                    "createdOrder": 0,
                    "content": "Read Cargo.toml",
                    "pending": false,
                    "localFileAttachments": [{ "path": "Cargo.toml", "kind": "file" }]
                },
                "segments": [{
                    "segmentId": 1,
                    "turnId": 1,
                    "kind": "initial",
                    "status": "completed",
                    "createdOrder": 1,
                    "rows": [{
                        "rowId": "row-2",
                        "messageId": 2,
                        "turnId": 1,
                        "segmentId": 1,
                        "kind": "assistant-thinking",
                        "section": "before-tools",
                        "createdOrder": 2,
                        "pending": false,
                        "aux": { "thinking": "Check dependencies first", "finishTaskNotice": "ignored" }
                    }, {
                        "rowId": "row-3",
                        "messageId": 3,
                        "turnId": 1,
                        "segmentId": 1,
                        "kind": "tool",
                        "section": "tools",
                        "createdOrder": 3,
                        "pending": false,
                        "tool": {
                            "toolCallId": "call-1",
                            "toolName": "read_file",
                            "phase": "succeeded",
                            "headline": "Read Cargo.toml",
                            "detailLines": ["path: Cargo.toml"],
                            "argsExcerpt": "{\"path\":\"Cargo.toml\"}",
                            "outputExcerpt": "[package]"
                        }
                    }, {
                        "rowId": "row-4",
                        "messageId": 4,
                        "turnId": 1,
                        "segmentId": 1,
                        "kind": "standalone-subagent-status",
                        "createdOrder": 4,
                        "pending": false,
                        "content": "SubAgent running"
                    }, {
                        "rowId": "row-5",
                        "messageId": 5,
                        "turnId": 1,
                        "segmentId": 1,
                        "kind": "assistant-text",
                        "section": "after-tools",
                        "createdOrder": 5,
                        "pending": false,
                        "canContinue": true,
                        "content": "Read complete"
                    }]
                }]
            }],
            "desktopMessageTimelineRevision": 7
        });

        let archive: crate::host_protocol::BridgeChatArchive =
            serde_json::from_value(payload).expect("bridge archive parses");
        let timeline = archive.desktop_message_timeline.expect("timeline present");
        let messages = hydrate_desktop_messages_from_timeline(&timeline);

        assert_eq!(messages.len(), 4);
        assert_eq!(messages[0].role, ConversationMessageRole::User);
        assert_eq!(messages[0].content, "Read Cargo.toml");
        assert_eq!(
            messages[1]
                .aux
                .as_ref()
                .and_then(|aux| aux.thinking.as_deref()),
            Some("Check dependencies first")
        );
        let tool = messages[2].tool.as_ref().expect("tool snapshot");
        assert_eq!(tool.tool_name, "read_file");
        assert_eq!(tool.tool_call_id.as_deref(), Some("call-1"));
        assert_eq!(messages[3].content, "Read complete");
    }
}
