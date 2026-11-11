use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashMap,
    time::{SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

use crate::{
    ports::{AssistantAuxArchiveEntry, ChatArchive},
    view::{AssistantAuxData, ChatMessage, MessageRole, ToolUiBlock, ToolUiPhase},
};

fn fresh_id() -> String {
    Uuid::new_v4().to_string()
}

fn current_unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0)
}

fn find_last_index<T>(items: &[T], predicate: impl Fn(&T) -> bool) -> Option<usize> {
    (0..items.len())
        .rev()
        .find(|index| predicate(&items[*index]))
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredDesktopRewindMetadata {
    pub session_id: String,
    pub next_sequence: u64,
    #[serde(default)]
    pub checkpoints: Vec<DesktopRewindCheckpointMetadata>,
    #[serde(default)]
    pub file_changes: Vec<DesktopRewindFileChangeMetadata>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopRewindCheckpointMetadata {
    pub id: String,
    pub message_id: usize,
    pub message_index: usize,
    pub sequence: u64,
    pub created_at_unix_ms: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopRewindFileChangeMetadata {
    pub id: String,
    pub kind: HostFileChangeKind,
    pub path: String,
    pub resolved_path: String,
    pub tool_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message_id: Option<usize>,
    pub sequence: u64,
    pub created_at_unix_ms: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HostFileChangeKind {
    CreateFile,
    EditFile,
    DeleteFile,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostFileSnapshot {
    pub exists: bool,
    pub file: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mtime_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostFileChangeRequestSummary {
    pub name: HostFileChangeKind,
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_chars: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub old_chars: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub new_chars: Option<usize>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostRecordedFileChange {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub kind: HostFileChangeKind,
    pub path: String,
    pub resolved_path: String,
    pub tool_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subagent_session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subagent_title: Option<String>,
    pub request: HostFileChangeRequestSummary,
    pub before: HostFileSnapshot,
    pub after: HostFileSnapshot,
    pub created_at_unix_ms: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopStoredFileChange {
    pub id: String,
    pub kind: HostFileChangeKind,
    pub path: String,
    pub resolved_path: String,
    pub tool_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subagent_session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subagent_title: Option<String>,
    pub request: HostFileChangeRequestSummary,
    pub before: HostFileSnapshot,
    pub after: HostFileSnapshot,
    pub created_at_unix_ms: u64,
    pub sequence: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message_id: Option<usize>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostTodoRecord {
    pub id: String,
    pub title: String,
    pub status: String,
    pub created_at_unix_ms: u64,
    pub updated_at_unix_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completed_at_unix_ms: Option<u64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopRewindCheckpointSnapshot {
    pub archive: ChatArchive,
    pub desktop_messages: Vec<ConversationMessageSnapshot>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub before_archive: Option<ChatArchive>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub before_desktop_messages: Option<Vec<ConversationMessageSnapshot>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub todos: Option<Vec<HostTodoRecord>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub before_todos: Option<Vec<HostTodoRecord>>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ConversationMessageRole {
    User,
    Assistant,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationMessageSnapshot {
    pub id: usize,
    pub role: ConversationMessageRole,
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool: Option<ToolBlockSnapshot>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub aux: Option<MessageAuxSnapshot>,
    pub pending: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageAuxSnapshot {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thinking: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub compaction: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolBlockSnapshot {
    #[serde(flatten)]
    pub metadata: serde_json::Map<String, Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    pub tool_name: String,
    pub phase: ToolBlockSnapshotPhase,
    pub headline: String,
    pub detail_lines: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub image_paths: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub video_paths: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub args_excerpt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_excerpt: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ToolBlockSnapshotPhase {
    Preview,
    PendingApproval,
    Running,
    Succeeded,
    Failed,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostFileRewindWarning {
    pub change_id: Option<String>,
    pub path: String,
    pub action: HostFileChangeKind,
    pub message: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostFileRewindResult {
    pub restored: usize,
    pub skipped: usize,
    pub warnings: Vec<HostFileRewindWarning>,
}

#[derive(Clone, Debug)]
pub struct RewindRestoreOutcome {
    pub before_archive: ChatArchive,
    pub before_messages: Vec<ConversationMessageSnapshot>,
    pub restored: usize,
    pub skipped: usize,
    pub warnings: Vec<HostFileRewindWarning>,
}

pub fn create_desktop_rewind_metadata() -> StoredDesktopRewindMetadata {
    StoredDesktopRewindMetadata {
        session_id: fresh_id(),
        next_sequence: 1,
        checkpoints: Vec::new(),
        file_changes: Vec::new(),
    }
}

pub fn normalize_desktop_rewind_metadata(value: Option<&Value>) -> StoredDesktopRewindMetadata {
    let mut metadata = value
        .and_then(|entry| serde_json::from_value::<StoredDesktopRewindMetadata>(entry.clone()).ok())
        .unwrap_or_else(create_desktop_rewind_metadata);
    if metadata.session_id.trim().is_empty() {
        metadata.session_id = fresh_id();
    }
    metadata.checkpoints.sort_by_key(|entry| entry.sequence);
    metadata.file_changes.sort_by_key(|entry| entry.sequence);
    let largest_sequence = metadata
        .checkpoints
        .iter()
        .map(|entry| entry.sequence)
        .chain(metadata.file_changes.iter().map(|entry| entry.sequence))
        .max()
        .unwrap_or(0);
    if metadata.next_sequence <= largest_sequence {
        metadata.next_sequence = largest_sequence + 1;
    }
    metadata
}

impl StoredDesktopRewindMetadata {
    pub fn next_sequence(&mut self) -> u64 {
        let next = self.next_sequence;
        self.next_sequence += 1;
        next
    }

    pub fn checkpoint_for_message_id(
        &self,
        message_id: usize,
    ) -> Option<&DesktopRewindCheckpointMetadata> {
        self.checkpoints
            .iter()
            .find(|checkpoint| checkpoint.message_id == message_id)
    }

    pub fn can_rewind_message(&self, message_id: usize) -> bool {
        self.checkpoint_for_message_id(message_id).is_some()
    }

    pub fn upsert_checkpoint(&mut self, checkpoint: DesktopRewindCheckpointMetadata) {
        if let Some(existing) = self
            .checkpoints
            .iter()
            .position(|candidate| candidate.message_id == checkpoint.message_id)
        {
            self.checkpoints[existing] = checkpoint;
        } else {
            self.checkpoints.push(checkpoint);
        }
        self.checkpoints.sort_by_key(|entry| entry.sequence);
    }

    pub fn prune_after_checkpoint(&mut self, checkpoint_sequence: u64) {
        self.checkpoints
            .retain(|checkpoint| checkpoint.sequence < checkpoint_sequence);
        self.file_changes
            .retain(|change| change.sequence <= checkpoint_sequence);
    }

    pub fn as_json(&self) -> Value {
        serde_json::to_value(self).unwrap_or(Value::Null)
    }
}

pub fn create_rewind_checkpoint_metadata(
    message_id: usize,
    message_index: usize,
    sequence: u64,
) -> DesktopRewindCheckpointMetadata {
    DesktopRewindCheckpointMetadata {
        id: fresh_id(),
        message_id,
        message_index,
        sequence,
        created_at_unix_ms: current_unix_ms(),
    }
}

pub fn to_desktop_file_change(
    change: HostRecordedFileChange,
    sequence: u64,
) -> DesktopStoredFileChange {
    DesktopStoredFileChange {
        id: fresh_id(),
        kind: change.kind,
        path: change.path,
        resolved_path: change.resolved_path,
        tool_name: change.tool_name,
        tool_call_id: change.tool_call_id,
        subagent_session_id: change.subagent_session_id,
        subagent_title: change.subagent_title,
        request: change.request,
        before: change.before,
        after: change.after,
        created_at_unix_ms: change.created_at_unix_ms,
        sequence,
        message_id: None,
    }
}

pub fn file_change_metadata(change: &DesktopStoredFileChange) -> DesktopRewindFileChangeMetadata {
    DesktopRewindFileChangeMetadata {
        id: change.id.clone(),
        kind: change.kind.clone(),
        path: change.path.clone(),
        resolved_path: change.resolved_path.clone(),
        tool_name: change.tool_name.clone(),
        tool_call_id: change.tool_call_id.clone(),
        message_id: change.message_id,
        sequence: change.sequence,
        created_at_unix_ms: change.created_at_unix_ms,
    }
}

pub fn archive_before_last_user(archive: &ChatArchive) -> ChatArchive {
    let mut cloned = archive.clone();
    let message_index = find_last_index(&cloned.messages, |(role, _)| role == "user");
    let history_index = find_last_index(&cloned.llm_history, |message| message.role == "user");
    if let Some(index) = message_index {
        cloned.messages.truncate(index);
        cloned
            .assistant_aux
            .retain(|entry| entry.message_index < index);
    }
    if let Some(index) = history_index {
        cloned.llm_history.truncate(index);
    }
    if let Some(messages) = cloned.desktop_messages.take() {
        let trimmed = conversation_before_last_user(&messages);
        cloned.desktop_messages = (!trimmed.is_empty()).then_some(trimmed);
    }
    cloned
}

pub fn conversation_before_last_user(
    messages: &[ConversationMessageSnapshot],
) -> Vec<ConversationMessageSnapshot> {
    if let Some(index) = find_last_index(messages, |message| {
        message.role == ConversationMessageRole::User
    }) {
        return messages[..index].to_vec();
    }
    messages.to_vec()
}

pub fn resolve_before_checkpoint_state(
    snapshot: &DesktopRewindCheckpointSnapshot,
) -> RewindRestoreOutcome {
    let before_archive = snapshot
        .before_archive
        .clone()
        .unwrap_or_else(|| archive_before_last_user(&snapshot.archive));
    let before_messages = snapshot
        .before_desktop_messages
        .clone()
        .unwrap_or_else(|| conversation_before_last_user(&snapshot.desktop_messages));
    RewindRestoreOutcome {
        before_archive,
        before_messages,
        restored: 0,
        skipped: 0,
        warnings: Vec::new(),
    }
}

pub fn conversation_snapshots(
    messages: &[ChatMessage],
    assistant_aux_by_message: &HashMap<usize, AssistantAuxData>,
    pending_assistant_msg_index: Option<usize>,
) -> Vec<ConversationMessageSnapshot> {
    messages
        .iter()
        .enumerate()
        .map(|(index, message)| ConversationMessageSnapshot {
            id: index + 1,
            role: if message.role == MessageRole::User {
                ConversationMessageRole::User
            } else {
                ConversationMessageRole::Assistant
            },
            content: message.content.clone(),
            tool: message.tool_block.as_ref().map(tool_snapshot_from_block),
            aux: assistant_aux_by_message
                .get(&index)
                .and_then(message_aux_snapshot_from_data),
            pending: pending_assistant_msg_index == Some(index),
        })
        .collect()
}

pub fn restore_conversation(
    snapshots: &[ConversationMessageSnapshot],
) -> (Vec<ChatMessage>, HashMap<usize, AssistantAuxData>) {
    let mut messages = Vec::with_capacity(snapshots.len());
    let mut assistant_aux_by_message = HashMap::new();
    for (index, snapshot) in snapshots.iter().enumerate() {
        let tool_block = snapshot.tool.as_ref().map(tool_block_from_snapshot);
        messages.push(ChatMessage {
            role: if snapshot.role == ConversationMessageRole::User {
                MessageRole::User
            } else {
                MessageRole::Agent
            },
            content: snapshot.content.clone(),
            tool_block,
        });
        if let Some(aux) = snapshot
            .aux
            .as_ref()
            .and_then(assistant_aux_data_from_snapshot)
        {
            assistant_aux_by_message.insert(index, aux);
        }
    }
    (messages, assistant_aux_by_message)
}

pub fn assistant_aux_entries(
    assistant_aux_by_message: &HashMap<usize, AssistantAuxData>,
    message_count: usize,
) -> Vec<AssistantAuxArchiveEntry> {
    let mut entries = assistant_aux_by_message
        .iter()
        .filter_map(|(idx, aux)| {
            if *idx >= message_count {
                return None;
            }
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
                Some(AssistantAuxArchiveEntry {
                    message_index: *idx,
                    thinking,
                    compaction,
                    finish_task_notice: None,
                })
            }
        })
        .collect::<Vec<_>>();
    entries.sort_by_key(|entry| entry.message_index);
    entries
}

fn message_aux_snapshot_from_data(aux: &AssistantAuxData) -> Option<MessageAuxSnapshot> {
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

fn assistant_aux_data_from_snapshot(snapshot: &MessageAuxSnapshot) -> Option<AssistantAuxData> {
    let thinking = snapshot
        .thinking
        .clone()
        .filter(|value| !value.trim().is_empty());
    let compaction = snapshot
        .compaction
        .clone()
        .filter(|value| !value.trim().is_empty());
    if thinking.is_none() && compaction.is_none() {
        None
    } else {
        Some(AssistantAuxData {
            thinking,
            compaction,
        })
    }
}

fn tool_snapshot_from_block(block: &ToolUiBlock) -> ToolBlockSnapshot {
    ToolBlockSnapshot {
        metadata: block.metadata.clone(),
        tool_call_id: block.tool_call_id.clone(),
        tool_name: block.tool_name.clone(),
        phase: match block.phase {
            ToolUiPhase::Preview => ToolBlockSnapshotPhase::Preview,
            ToolUiPhase::PendingApproval => ToolBlockSnapshotPhase::PendingApproval,
            ToolUiPhase::Running => ToolBlockSnapshotPhase::Running,
            ToolUiPhase::Succeeded => ToolBlockSnapshotPhase::Succeeded,
            ToolUiPhase::Failed => ToolBlockSnapshotPhase::Failed,
        },
        headline: block.headline.clone(),
        detail_lines: block.detail_lines.clone(),
        image_paths: block.image_paths.clone(),
        video_paths: block.video_paths.clone(),
        args_excerpt: block.args_excerpt.clone(),
        output_excerpt: block.output_excerpt.clone(),
    }
}

fn tool_block_from_snapshot(snapshot: &ToolBlockSnapshot) -> ToolUiBlock {
    ToolUiBlock {
        metadata: snapshot.metadata.clone(),
        tool_call_id: snapshot.tool_call_id.clone(),
        tool_name: snapshot.tool_name.clone(),
        phase: match snapshot.phase {
            ToolBlockSnapshotPhase::Preview => ToolUiPhase::Preview,
            ToolBlockSnapshotPhase::PendingApproval => ToolUiPhase::PendingApproval,
            ToolBlockSnapshotPhase::Running => ToolUiPhase::Running,
            ToolBlockSnapshotPhase::Succeeded => ToolUiPhase::Succeeded,
            ToolBlockSnapshotPhase::Failed => ToolUiPhase::Failed,
        },
        headline: snapshot.headline.clone(),
        detail_lines: snapshot.detail_lines.clone(),
        image_paths: snapshot.image_paths.clone(),
        video_paths: snapshot.video_paths.clone(),
        args_excerpt: snapshot.args_excerpt.clone(),
        output_excerpt: snapshot.output_excerpt.clone(),
        suppress_expand: None,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        StoredDesktopRewindMetadata, create_desktop_rewind_metadata,
        normalize_desktop_rewind_metadata,
    };
    use serde_json::json;

    #[test]
    fn normalize_desktop_rewind_metadata_advances_next_sequence() {
        let metadata = normalize_desktop_rewind_metadata(Some(&json!({
            "sessionId": "session-1",
            "nextSequence": 1,
            "checkpoints": [
                {
                    "id": "cp-1",
                    "messageId": 1,
                    "messageIndex": 0,
                    "sequence": 3,
                    "createdAtUnixMs": 1
                }
            ],
            "fileChanges": [
                {
                    "id": "fc-1",
                    "kind": "edit_file",
                    "path": "a.txt",
                    "resolvedPath": "C:/tmp/a.txt",
                    "toolName": "edit_file",
                    "sequence": 4,
                    "createdAtUnixMs": 2
                }
            ]
        })));

        assert_eq!(metadata.next_sequence, 5);
    }

    #[test]
    fn create_desktop_rewind_metadata_starts_empty() {
        let metadata: StoredDesktopRewindMetadata = create_desktop_rewind_metadata();

        assert!(metadata.checkpoints.is_empty());
        assert!(metadata.file_changes.is_empty());
        assert_eq!(metadata.next_sequence, 1);
        assert!(!metadata.session_id.trim().is_empty());
    }
}
