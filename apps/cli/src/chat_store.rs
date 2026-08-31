use anyhow::{Context, Result, anyhow};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    env, fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use crate::chat_timeline::{
    CHAT_SCHEMA_VERSION, PersistedTimelineTurn, build_persisted_timeline,
    derive_archive_projection, hydrate_desktop_messages_from_timeline,
    normalize_desktop_messages_for_persistence,
};
use crate::rewind::ConversationMessageSnapshot;

use crate::mcp::spirit_data_dir;

const CHAT_DIR_NAME: &str = "chats";

fn default_chat_approval_level() -> String {
    "default".to_string()
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatFile {
    chat_schema_version: i32,
    saved_at_unix_ms: u128,
    desktop_message_timeline: Vec<PersistedTimelineTurn>,
    llm_history: Vec<crate::ports::ArchivedLlmMessage>,
    #[serde(default)]
    loop_enabled: bool,
    #[serde(default = "default_chat_approval_level")]
    approval_level: String,
    #[serde(default)]
    subagent_sessions: Vec<StoredSubagentSession>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    rewind: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    session_display_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    session_title_source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    workspace_root: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    git_branch: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredSubagentSession {
    summary: StoredSubagentSessionSummary,
    #[serde(default)]
    llm_history: Vec<crate::ports::ArchivedLlmMessage>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredSubagentSessionSummary {
    session_id: String,
    parent_tool_call_id: String,
    title: String,
    status: crate::ports::SubagentSessionStatus,
    started_at_unix_ms: u64,
    updated_at_unix_ms: u64,
    completed_at_unix_ms: Option<u64>,
    latest_message: Option<String>,
    final_output: Option<String>,
    error: Option<String>,
}

#[derive(Debug)]
pub struct LoadedChat {
    pub messages: Vec<(String, String)>,
    pub assistant_aux: Vec<crate::ports::AssistantAuxArchiveEntry>,
    pub llm_history: Vec<crate::ports::ArchivedLlmMessage>,
    pub loop_enabled: bool,
    pub approval_level: String,
    pub subagent_sessions: Vec<crate::ports::SubagentSessionArchiveEntry>,
    pub desktop_messages: Option<Vec<ConversationMessageSnapshot>>,
    pub rewind: Option<Value>,
    pub session_display_name: Option<String>,
    pub session_title_source: Option<String>,
}

pub fn chat_dir_path() -> PathBuf {
    spirit_data_dir().join(CHAT_DIR_NAME)
}

pub fn list_chat_sessions() -> Result<Vec<crate::ports::ChatSessionListItem>> {
    list_chat_sessions_in(&chat_dir_path())
}

fn list_chat_sessions_in(dir: &Path) -> Result<Vec<crate::ports::ChatSessionListItem>> {
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let files = fs::read_dir(dir)
        .with_context(|| format!("Failed to read conversation directory: {}", dir.display()))?
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.is_file())
        .filter(|path| path.extension().and_then(|ext| ext.to_str()) == Some("json"));

    let mut items = Vec::new();
    for path in files {
        if let Some(item) = read_chat_session_list_entry(&path) {
            items.push(item);
        }
    }
    items.sort_by_key(|item| std::cmp::Reverse(item.modified_at_unix_ms));
    Ok(items
        .into_iter()
        .map(|entry| crate::ports::ChatSessionListItem {
            path: entry.path,
            display_name: entry.display_name,
            modified_at_unix_ms: entry.modified_at_unix_ms,
        })
        .collect())
}

struct ChatSessionListEntry {
    path: String,
    display_name: String,
    modified_at_unix_ms: u128,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatListMeta {
    #[serde(default)]
    chat_schema_version: Option<i32>,
    #[serde(default)]
    saved_at_unix_ms: Option<u128>,
    #[serde(default)]
    session_display_name: Option<String>,
    #[serde(default)]
    desktop_message_timeline: Vec<PersistedTimelineTurn>,
}

fn read_chat_session_list_entry(path: &Path) -> Option<ChatSessionListEntry> {
    let raw = fs::read_to_string(path).ok()?;
    let parsed: ChatListMeta = serde_json::from_str(&raw).ok()?;
    if parsed.chat_schema_version != Some(CHAT_SCHEMA_VERSION) {
        return None;
    }

    let display_name = parsed
        .session_display_name
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| derive_display_name_from_timeline(&parsed.desktop_message_timeline));
    let modified_at_unix_ms = parsed
        .saved_at_unix_ms
        .unwrap_or_else(|| file_mtime_unix_ms(path));

    Some(ChatSessionListEntry {
        path: path.to_string_lossy().into_owned(),
        display_name,
        modified_at_unix_ms,
    })
}

fn derive_display_name_from_timeline(timeline: &[PersistedTimelineTurn]) -> String {
    let seed = timeline
        .iter()
        .filter_map(|turn| turn.user_row.as_ref())
        .filter_map(|row| row.content.as_deref())
        .map(str::trim)
        .find(|content| !content.is_empty())
        .unwrap_or("New conversation");
    truncate_session_display_name(seed)
}

fn truncate_session_display_name(seed: &str) -> String {
    let trimmed = seed.trim();
    if trimmed.is_empty() {
        return "New conversation".to_string();
    }
    if trimmed.chars().count() > 28 {
        format!("{}…", trimmed.chars().take(28).collect::<String>())
    } else {
        trimmed.to_string()
    }
}

fn file_mtime_unix_ms(path: &Path) -> u128 {
    fs::metadata(path)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

pub struct SaveChatParams<'a> {
    pub path_arg: Option<&'a str>,
    pub messages: &'a [(String, String)],
    pub assistant_aux: &'a [crate::ports::AssistantAuxArchiveEntry],
    pub llm_history: &'a [crate::ports::ArchivedLlmMessage],
    pub loop_enabled: bool,
    pub approval_level: &'a str,
    pub subagent_sessions: &'a [crate::ports::SubagentSessionArchiveEntry],
    pub rewind: Option<&'a Value>,
    pub desktop_messages: Option<&'a [ConversationMessageSnapshot]>,
    pub session_display_name_override: Option<&'a str>,
    pub session_title_source: Option<&'a str>,
}

pub fn save_chat(params: SaveChatParams<'_>) -> Result<PathBuf> {
    let SaveChatParams {
        path_arg,
        messages,
        assistant_aux,
        llm_history,
        loop_enabled,
        approval_level,
        subagent_sessions,
        rewind,
        desktop_messages,
        session_display_name_override,
        session_title_source,
    } = params;
    let path = resolve_save_path(path_arg)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).with_context(|| {
            format!(
                "Failed to create conversation directory: {}",
                parent.display()
            )
        })?;
    }

    let desktop_messages = desktop_messages
        .map(normalize_desktop_messages_for_persistence)
        .filter(|messages| !messages.is_empty())
        .unwrap_or_else(|| build_fallback_desktop_messages(messages, assistant_aux));
    let desktop_message_timeline = build_persisted_timeline(&desktop_messages);
    if desktop_message_timeline.is_empty() {
        return Err(anyhow!(
            "chat schema v2 refuses to write an empty session timeline"
        ));
    }
    let workspace_root = current_workspace_root();

    let file = ChatFile {
        chat_schema_version: CHAT_SCHEMA_VERSION,
        saved_at_unix_ms: current_unix_millis(),
        desktop_message_timeline,
        llm_history: llm_history.to_vec(),
        loop_enabled,
        approval_level: crate::ports::normalize_approval_level(approval_level),
        subagent_sessions: subagent_sessions
            .iter()
            .map(|entry| StoredSubagentSession {
                summary: StoredSubagentSessionSummary {
                    session_id: entry.summary.session_id.clone(),
                    parent_tool_call_id: entry.summary.parent_tool_call_id.clone(),
                    title: entry.summary.title.clone(),
                    status: entry.summary.status,
                    started_at_unix_ms: entry.summary.started_at_unix_ms,
                    updated_at_unix_ms: entry.summary.updated_at_unix_ms,
                    completed_at_unix_ms: entry.summary.completed_at_unix_ms,
                    latest_message: entry.summary.latest_message.clone(),
                    final_output: entry.summary.final_output.clone(),
                    error: entry.summary.error.clone(),
                },
                llm_history: entry.llm_history.clone(),
            })
            .collect(),
        rewind: rewind.cloned(),
        session_display_name: session_display_name_override
            .map(str::to_string)
            .or_else(|| derive_session_display_name(&desktop_messages)),
        session_title_source: session_title_source
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        workspace_root: workspace_root
            .as_ref()
            .map(|path| path.to_string_lossy().to_string()),
        git_branch: workspace_root
            .as_ref()
            .and_then(|path| detect_git_branch(path)),
    };

    let content = serde_json::to_string_pretty(&file)?;
    fs::write(&path, content)
        .with_context(|| format!("Failed to write conversation: {}", path.display()))?;
    Ok(path)
}

pub fn load_chat(path_arg: &str) -> Result<LoadedChat> {
    let path = resolve_load_path(path_arg)?;
    let text = fs::read_to_string(&path)
        .with_context(|| format!("Failed to read conversation file: {}", path.display()))?;
    let parsed: Value = serde_json::from_str(&text)
        .with_context(|| format!("Failed to parse conversation file: {}", path.display()))?;

    ensure_chat_schema_v2(&parsed)?;
    reject_legacy_conversation_fields(&parsed)?;

    let parsed: ChatFile = serde_json::from_value(parsed)
        .with_context(|| format!("Failed to parse chat schema v2: {}", path.display()))?;
    if parsed.desktop_message_timeline.is_empty() {
        return Err(anyhow!(
            "chat schema v2 requires a non-empty desktopMessageTimeline"
        ));
    }

    let desktop_messages = hydrate_desktop_messages_from_timeline(&parsed.desktop_message_timeline);
    if desktop_messages.is_empty() {
        return Err(anyhow!(
            "chat schema v2 timeline did not restore any messages"
        ));
    }
    let (messages, assistant_aux) = derive_archive_projection(&desktop_messages);

    Ok(LoadedChat {
        messages,
        assistant_aux,
        llm_history: parsed.llm_history,
        loop_enabled: parsed.loop_enabled,
        approval_level: crate::ports::normalize_approval_level(&parsed.approval_level),
        subagent_sessions: parsed
            .subagent_sessions
            .into_iter()
            .map(|entry| crate::ports::SubagentSessionArchiveEntry {
                summary: crate::ports::SubagentSessionSummary {
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
        desktop_messages: Some(desktop_messages),
        rewind: parsed.rewind,
        session_display_name: parsed.session_display_name,
        session_title_source: parsed.session_title_source,
    })
}

fn ensure_chat_schema_v2(parsed: &Value) -> Result<()> {
    match parsed.get("chatSchemaVersion").and_then(Value::as_i64) {
        Some(version) if version == CHAT_SCHEMA_VERSION as i64 => Ok(()),
        Some(version) => Err(anyhow!(
            "chat schema v2 required (chatSchemaVersion={CHAT_SCHEMA_VERSION}), got {version}"
        )),
        None => Err(anyhow!(
            "chat schema v2 required (chatSchemaVersion={CHAT_SCHEMA_VERSION}), got none"
        )),
    }
}

fn reject_legacy_conversation_fields(parsed: &Value) -> Result<()> {
    if parsed.get("messages").is_some() {
        return Err(anyhow!("chat schema v2 must not include messages"));
    }
    if parsed.get("assistantAux").is_some() {
        return Err(anyhow!("chat schema v2 must not include assistantAux"));
    }
    if parsed.get("desktopMessages").is_some() {
        return Err(anyhow!("chat schema v2 must not include desktopMessages"));
    }
    Ok(())
}

fn current_unix_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn build_fallback_desktop_messages(
    messages: &[(String, String)],
    assistant_aux: &[crate::ports::AssistantAuxArchiveEntry],
) -> Vec<ConversationMessageSnapshot> {
    use crate::rewind::{ConversationMessageRole, MessageAuxSnapshot};

    messages
        .iter()
        .enumerate()
        .map(|(index, (role, content))| ConversationMessageSnapshot {
            id: index + 1,
            role: if role == "user" {
                ConversationMessageRole::User
            } else {
                ConversationMessageRole::Assistant
            },
            content: content.clone(),
            tool: None,
            aux: assistant_aux
                .iter()
                .find(|entry| entry.message_index == index)
                .and_then(|entry| {
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
                        Some(MessageAuxSnapshot {
                            thinking,
                            compaction,
                        })
                    }
                }),
            pending: false,
        })
        .collect()
}

fn derive_session_display_name(messages: &[ConversationMessageSnapshot]) -> Option<String> {
    use crate::rewind::ConversationMessageRole;

    let seed = messages
        .iter()
        .find(|message| {
            message.role == ConversationMessageRole::User && !message.content.trim().is_empty()
        })?
        .content
        .trim();
    let truncated = seed.chars().take(28).collect::<String>();
    Some(if seed.chars().count() > 28 {
        format!("{}...", truncated)
    } else {
        seed.to_string()
    })
}

pub fn fallback_session_display_name(messages: &[ConversationMessageSnapshot]) -> String {
    derive_session_display_name(messages).unwrap_or_else(|| "Chat".to_string())
}

fn current_workspace_root() -> Option<PathBuf> {
    env::current_dir().ok()
}

fn detect_git_branch(workspace_root: &Path) -> Option<String> {
    let git_dir = resolve_git_dir(workspace_root)?;
    let head = fs::read_to_string(git_dir.join("HEAD")).ok()?;
    let reference = head.trim().strip_prefix("ref:")?.trim();
    let branch = reference.rsplit('/').next()?.trim();
    (!branch.is_empty()).then(|| branch.to_string())
}

fn resolve_git_dir(workspace_root: &Path) -> Option<PathBuf> {
    let dot_git = workspace_root.join(".git");
    if dot_git.is_dir() {
        return Some(dot_git);
    }
    if !dot_git.is_file() {
        return None;
    }

    let raw = fs::read_to_string(dot_git).ok()?;
    let relative = raw.trim().strip_prefix("gitdir:")?.trim();
    let path = PathBuf::from(relative);
    Some(if path.is_absolute() {
        path
    } else {
        workspace_root.join(path)
    })
}

fn resolve_save_path(path_arg: Option<&str>) -> Result<PathBuf> {
    match path_arg {
        Some(raw) if !raw.trim().is_empty() => {
            let p = PathBuf::from(raw.trim());
            Ok(with_json_extension(p))
        }
        _ => {
            let dir = chat_dir_path();
            let ts = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            Ok(dir.join(format!("chat-{}.json", ts)))
        }
    }
}

fn resolve_load_path(path_arg: &str) -> Result<PathBuf> {
    resolve_chat_file_path(path_arg)
}

/// Resolve a chat file path the same way load/save does (absolute, under chats dir when relative).
pub fn resolve_chat_file_path(path_arg: &str) -> Result<PathBuf> {
    let trimmed = path_arg.trim();
    if trimmed.is_empty() {
        return Err(anyhow!("/session load requires a file name or path"));
    }

    let raw = PathBuf::from(trimmed);
    let candidate = if raw.is_absolute() {
        with_json_extension(raw)
    } else {
        let in_chat_dir = with_json_extension(chat_dir_path().join(&raw));
        if in_chat_dir.exists() {
            in_chat_dir
        } else {
            with_json_extension(raw)
        }
    };

    if !candidate.exists() {
        return Err(anyhow!(
            "Conversation file does not exist: {}",
            candidate.display()
        ));
    }

    Ok(candidate)
}

/// Match Desktop `path.resolve`: absolute path without following symlinks.
pub fn conversation_key_for_path(path: &Path) -> String {
    let resolved = resolve_chat_file_path(path.to_string_lossy().as_ref())
        .unwrap_or_else(|_| path.to_path_buf());
    std::path::absolute(&resolved)
        .unwrap_or(resolved)
        .to_string_lossy()
        .into_owned()
}

fn with_json_extension(path: PathBuf) -> PathBuf {
    if path.extension().and_then(|s| s.to_str()) == Some("json") {
        return path;
    }

    let mut p = path;
    if p.file_name().is_some() {
        p.set_extension("json");
    }
    p
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rewind::{ConversationMessageRole, MessageAuxSnapshot};
    use serde_json::json;

    #[test]
    fn save_chat_writes_v2_schema_and_reloads() {
        let file_path = test_file_path("v2-save");
        let messages = vec![
            ("user".to_string(), "hello".to_string()),
            ("assistant".to_string(), "".to_string()),
            ("assistant".to_string(), "".to_string()),
            ("assistant".to_string(), "answer".to_string()),
        ];
        let assistant_aux = vec![crate::ports::AssistantAuxArchiveEntry {
            message_index: 2,
            thinking: Some("reasoning".to_string()),
            compaction: None,
            finish_task_notice: None,
        }];
        let llm_history = vec![crate::ports::ArchivedLlmMessage::from_text_and_images(
            "user".to_string(),
            "hello".to_string(),
            Vec::new(),
        )];
        let desktop_messages = vec![
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
                content: "answer".to_string(),
                tool: None,
                aux: None,
                pending: false,
            },
        ];

        let saved = save_chat(SaveChatParams {
            path_arg: Some(file_path.to_string_lossy().as_ref()),
            messages: &messages,
            assistant_aux: &assistant_aux,
            llm_history: &llm_history,
            loop_enabled: true,
            approval_level: "default",
            subagent_sessions: &[],
            rewind: None,
            desktop_messages: Some(&desktop_messages),
            session_display_name_override: None,
            session_title_source: None,
        })
        .expect("save chat");

        let raw = fs::read_to_string(&saved).expect("read saved chat");
        let parsed: Value = serde_json::from_str(&raw).expect("parse saved chat json");
        assert_eq!(parsed["chatSchemaVersion"], json!(2));
        assert!(parsed.get("messages").is_none());
        assert!(parsed.get("assistantAux").is_none());
        assert!(parsed.get("desktopMessages").is_none());
        assert!(parsed["desktopMessageTimeline"].is_array());
        assert_eq!(parsed["loopEnabled"], json!(true));

        let loaded = load_chat(saved.to_string_lossy().as_ref()).expect("reload chat");
        assert_eq!(loaded.messages.len(), 3);
        assert!(loaded.loop_enabled);
        assert_eq!(loaded.assistant_aux.len(), 1);
        assert_eq!(
            loaded
                .desktop_messages
                .as_ref()
                .expect("desktop messages loaded")
                .len(),
            3
        );

        let _ = fs::remove_file(saved);
    }

    #[test]
    fn save_chat_persists_session_title_source() {
        let file_path = test_file_path("title-source");
        let desktop_messages = vec![ConversationMessageSnapshot {
            id: 1,
            role: ConversationMessageRole::User,
            content: "hello from title source test".to_string(),
            tool: None,
            aux: None,
            pending: false,
        }];
        let messages = vec![(
            "user".to_string(),
            "hello from title source test".to_string(),
        )];
        let saved = save_chat(SaveChatParams {
            path_arg: Some(file_path.to_string_lossy().as_ref()),
            messages: &messages,
            assistant_aux: &[],
            llm_history: &[],
            loop_enabled: false,
            approval_level: "default",
            subagent_sessions: &[],
            rewind: None,
            desktop_messages: Some(&desktop_messages),
            session_display_name_override: Some("LLM title"),
            session_title_source: Some("llm"),
        })
        .expect("save chat");

        let raw = fs::read_to_string(&saved).expect("read saved chat");
        let parsed: Value = serde_json::from_str(&raw).expect("parse saved chat json");
        assert_eq!(parsed["sessionDisplayName"], json!("LLM title"));
        assert_eq!(parsed["sessionTitleSource"], json!("llm"));

        let loaded = load_chat(saved.to_string_lossy().as_ref()).expect("reload chat");
        assert_eq!(loaded.session_display_name.as_deref(), Some("LLM title"));
        assert_eq!(loaded.session_title_source.as_deref(), Some("llm"));

        let _ = fs::remove_file(saved);
    }

    #[test]
    fn load_chat_rejects_legacy_schema() {
        let file_path = test_file_path("legacy-schema");
        let raw = json!({
            "savedAtUnixMs": current_unix_millis(),
            "messages": [{ "role": "user", "content": "hello" }],
            "assistantAux": [],
            "llmHistory": [],
            "subagentSessions": [],
        });
        fs::write(
            &file_path,
            serde_json::to_string_pretty(&raw).expect("serialize legacy json"),
        )
        .expect("write legacy chat");

        let error = load_chat(file_path.to_string_lossy().as_ref()).expect_err("legacy load");
        assert!(error.to_string().contains("chat schema v2"));

        let _ = fs::remove_file(file_path);
    }

    #[test]
    fn load_chat_preserves_v2_tool_timeline_rows() {
        let file_path = test_file_path("v2-tool-snapshot");
        let raw = json!({
            "chatSchemaVersion": 2,
            "savedAtUnixMs": current_unix_millis(),
            "desktopMessageTimeline": [{
                "turnId": 1,
                "createdOrder": 0,
                "userRow": {
                    "rowId": "row-user",
                    "messageId": 1,
                    "turnId": 1,
                    "kind": "user",
                    "createdOrder": 0,
                    "content": "画一张图",
                    "pending": false
                },
                "segments": [{
                    "segmentId": 1,
                    "turnId": 1,
                    "kind": "initial",
                    "status": "completed",
                    "createdOrder": 1,
                    "rows": [{
                        "rowId": "row-tool",
                        "messageId": 2,
                        "turnId": 1,
                        "segmentId": 1,
                        "kind": "tool",
                        "section": "tools",
                        "createdOrder": 2,
                        "pending": false,
                        "tool": {
                            "toolName": "generate_image",
                            "phase": "succeeded",
                            "headline": "图片生成完成",
                            "detailLines": [
                                "path: C:\\\\Users\\\\pc\\\\AppData\\\\Roaming\\\\Spirit\\\\generated-images\\\\demo.png"
                            ],
                            "outputExcerpt": "[generated image]",
                            "imagePaths": [
                                "C:\\\\Users\\\\pc\\\\AppData\\\\Roaming\\\\Spirit\\\\generated-images\\\\demo.png"
                            ]
                        }
                    }]
                }]
            }],
            "llmHistory": [],
            "subagentSessions": []
        });
        fs::write(
            &file_path,
            serde_json::to_string_pretty(&raw).expect("serialize v2 json"),
        )
        .expect("write v2 chat");

        let loaded = load_chat(file_path.to_string_lossy().as_ref()).expect("load v2 chat");
        let desktop_messages = loaded
            .desktop_messages
            .as_ref()
            .expect("desktop tool snapshots");
        assert_eq!(desktop_messages.len(), 2);
        assert_eq!(
            desktop_messages[1]
                .tool
                .as_ref()
                .expect("tool snapshot")
                .tool_name,
            "generate_image"
        );

        let _ = fs::remove_file(file_path);
    }

    #[test]
    fn list_chat_sessions_uses_display_name_and_sorts_by_saved_at() {
        let dir = env::temp_dir().join(format!(
            "spirit-chat-list-{}-{}",
            std::process::id(),
            current_unix_millis()
        ));
        fs::create_dir_all(&dir).expect("create list dir");

        write_list_chat_file(
            &dir.join("older.json"),
            100,
            Some("Older title"),
            Some("older user"),
        );
        write_list_chat_file(
            &dir.join("newer.json"),
            300,
            Some("Newer title"),
            Some("newer user"),
        );
        write_list_chat_file(
            &dir.join("from-user.json"),
            200,
            None,
            Some("First user prompt"),
        );
        write_list_chat_file(
            &dir.join("long.json"),
            250,
            None,
            Some("abcdefghijklmnopqrstuvwxyz0123456789"),
        );

        let listed = list_chat_sessions_in(&dir).expect("list sessions");
        let titles: Vec<&str> = listed
            .iter()
            .map(|item| item.display_name.as_str())
            .collect();
        assert_eq!(
            titles,
            vec![
                "Newer title",
                "abcdefghijklmnopqrstuvwxyz01…",
                "First user prompt",
                "Older title"
            ]
        );

        let _ = fs::remove_dir_all(&dir);
    }

    fn write_list_chat_file(
        path: &Path,
        saved_at_unix_ms: u128,
        session_display_name: Option<&str>,
        user_content: Option<&str>,
    ) {
        let user_row = user_content.map(|content| {
            json!({
                "rowId": "user-1",
                "messageId": 1,
                "turnId": 1,
                "kind": "user",
                "createdOrder": 1,
                "pending": false,
                "content": content,
            })
        });
        let raw = json!({
            "chatSchemaVersion": 2,
            "savedAtUnixMs": saved_at_unix_ms,
            "sessionDisplayName": session_display_name,
            "desktopMessageTimeline": [{
                "turnId": 1,
                "createdOrder": 1,
                "userRow": user_row,
                "segments": []
            }],
            "llmHistory": [],
        });
        fs::write(
            path,
            serde_json::to_string_pretty(&raw).expect("serialize list chat"),
        )
        .expect("write list chat");
    }

    fn test_file_path(label: &str) -> PathBuf {
        let file_name = format!("spirit-chat-store-{}-{}.json", label, current_unix_millis());
        env::temp_dir().join(file_name)
    }
}
