use anyhow::Result;
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;
use std::path::PathBuf;

use crate::model_registry::AppConfig;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantAuxArchiveEntry {
    pub message_index: usize,
    pub thinking: Option<String>,
    pub compaction: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finish_task_notice: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SubagentSessionStatus {
    Running,
    Completed,
    Failed,
    Blocked,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubagentSessionSummary {
    pub session_id: String,
    pub parent_tool_call_id: String,
    pub title: String,
    pub status: SubagentSessionStatus,
    pub started_at_unix_ms: u64,
    pub updated_at_unix_ms: u64,
    pub completed_at_unix_ms: Option<u64>,
    pub latest_message: Option<String>,
    pub final_output: Option<String>,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum LlmContentPart {
    Text { text: String },
    Image { path: String },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchivedLlmToolCall {
    pub id: String,
    pub name: String,
    pub arguments_json: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchivedLlmMessage {
    pub role: String,
    pub content: Vec<LlmContentPart>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ArchivedLlmToolCall>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider_state: Option<Value>,
}

impl ArchivedLlmMessage {
    pub fn from_text_and_images(role: String, content: String, image_paths: Vec<String>) -> Self {
        let mut parts = Vec::new();
        if !content.is_empty() {
            parts.push(LlmContentPart::Text { text: content });
        }
        for path in image_paths {
            parts.push(LlmContentPart::Image { path });
        }
        Self {
            role,
            content: parts,
            tool_call_id: None,
            tool_calls: None,
            provider_state: None,
        }
    }

    pub fn with_tool_call_id(mut self, tool_call_id: Option<String>) -> Self {
        self.tool_call_id = tool_call_id;
        self
    }

    pub fn with_tool_calls(mut self, tool_calls: Option<Vec<ArchivedLlmToolCall>>) -> Self {
        self.tool_calls = tool_calls;
        self
    }

    pub fn with_provider_state(mut self, provider_state: Option<Value>) -> Self {
        self.provider_state = provider_state;
        self
    }

    pub fn text_content(&self) -> String {
        self.content
            .iter()
            .filter_map(|part| match part {
                LlmContentPart::Text { text } => Some(text.as_str()),
                LlmContentPart::Image { .. } => None,
            })
            .collect::<String>()
    }

    pub fn image_paths(&self) -> Vec<String> {
        self.content
            .iter()
            .filter_map(|part| match part {
                LlmContentPart::Image { path } => Some(path.clone()),
                LlmContentPart::Text { .. } => None,
            })
            .collect()
    }
}

impl<'de> Deserialize<'de> for ArchivedLlmMessage {
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct CurrentArchivedLlmMessage {
            role: String,
            content: Vec<LlmContentPart>,
            #[serde(default, alias = "tool_call_id")]
            tool_call_id: Option<String>,
            #[serde(default, alias = "toolCalls")]
            tool_calls: Option<Vec<ArchivedLlmToolCall>>,
            #[serde(default, alias = "providerState")]
            provider_state: Option<Value>,
        }

        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct LegacyArchivedLlmMessage {
            role: String,
            content: String,
            #[serde(default)]
            image_paths: Vec<String>,
            #[serde(default, alias = "tool_call_id")]
            tool_call_id: Option<String>,
            #[serde(default, alias = "toolCalls")]
            tool_calls: Option<Vec<ArchivedLlmToolCall>>,
            #[serde(default, alias = "providerState")]
            provider_state: Option<Value>,
        }

        #[derive(Deserialize)]
        #[serde(untagged)]
        enum ArchivedLlmMessageRepr {
            Current(CurrentArchivedLlmMessage),
            Legacy(LegacyArchivedLlmMessage),
        }

        match ArchivedLlmMessageRepr::deserialize(deserializer)? {
            ArchivedLlmMessageRepr::Current(message) => Ok(Self {
                role: message.role,
                content: message.content,
                tool_call_id: message.tool_call_id,
                tool_calls: message.tool_calls,
                provider_state: message.provider_state,
            }),
            ArchivedLlmMessageRepr::Legacy(message) => {
                Ok(
                    Self::from_text_and_images(message.role, message.content, message.image_paths)
                        .with_tool_call_id(message.tool_call_id)
                        .with_tool_calls(message.tool_calls)
                        .with_provider_state(message.provider_state),
                )
            }
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubagentSessionArchiveEntry {
    pub summary: SubagentSessionSummary,
    #[serde(default)]
    pub llm_history: Vec<ArchivedLlmMessage>,
}

fn default_approval_level() -> String {
    "default".to_string()
}

/// Canonical approval levels shown in CLI help / unknown-value errors.
pub const APPROVAL_LEVELS: [&str; 3] = ["default", "auto-approval", "bypass-approval"];

pub fn available_approval_levels_csv() -> String {
    APPROVAL_LEVELS.join(", ")
}

/// Soft normalize used by archives / internal paths: unknown values become `default`.
pub fn normalize_approval_level(value: &str) -> String {
    parse_approval_level_strict(value).unwrap_or_else(|| "default".to_string())
}

/// Strict parse for CLI flags: unknown values return `None` (do not fall back to default).
pub fn parse_approval_level_strict(value: &str) -> Option<String> {
    match value.trim() {
        "default" => Some("default".to_string()),
        "auto-approval" => Some("auto-approval".to_string()),
        "bypass-approval" => Some("bypass-approval".to_string()),
        _ => None,
    }
}

pub fn normalize_llm_http_version(value: &str) -> String {
    let normalized = value.trim().to_ascii_lowercase();
    if normalized == "http1.1" || normalized == "http/1.1" || normalized == "http1" {
        "http1.1".to_string()
    } else {
        "http2".to_string()
    }
}

pub const TUI_MODE_INLINE: &str = "inline";
pub const TUI_MODE_FULLSCREEN: &str = "fullscreen";
pub const TUI_MODES: [&str; 2] = [TUI_MODE_INLINE, TUI_MODE_FULLSCREEN];

pub fn available_tui_modes_csv() -> String {
    TUI_MODES.join(", ")
}

/// Strict parse for CLI flags and `/tui`: unknown values return `None`.
pub fn parse_tui_mode_strict(value: &str) -> Option<String> {
    match value.trim().to_ascii_lowercase().as_str() {
        TUI_MODE_INLINE => Some(TUI_MODE_INLINE.to_string()),
        TUI_MODE_FULLSCREEN => Some(TUI_MODE_FULLSCREEN.to_string()),
        _ => None,
    }
}

/// Soft normalize used by config: unknown values become `inline`.
pub fn normalize_tui_mode(value: &str) -> String {
    parse_tui_mode_strict(value).unwrap_or_else(|| TUI_MODE_INLINE.to_string())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AttachChatSessionOutcome {
    /// `session.attach` missed; created a session and hydrated from disk archive.
    Created,
    /// Joined an existing live daemon session for this conversation key.
    AttachedLive,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatArchive {
    pub messages: Vec<(String, String)>,
    pub assistant_aux: Vec<AssistantAuxArchiveEntry>,
    pub llm_history: Vec<ArchivedLlmMessage>,
    #[serde(default)]
    pub loop_enabled: bool,
    #[serde(default = "default_approval_level")]
    pub approval_level: String,
    #[serde(default)]
    pub subagent_sessions: Vec<SubagentSessionArchiveEntry>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub desktop_messages: Option<Vec<crate::rewind::ConversationMessageSnapshot>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rewind: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_display_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_title_source: Option<String>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum McpStatusState {
    #[default]
    Idle,
    Loading,
    Ready,
    Error,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStatusSnapshot {
    pub revision: u64,
    pub state: McpStatusState,
    pub configured_servers: usize,
    pub loaded_servers: usize,
    pub cached_tools: usize,
    pub last_error: Option<String>,
}

pub trait AppPaths: Send + Sync {
    fn workspace_root(&self) -> PathBuf;
    fn config_file(&self) -> PathBuf;
    fn chats_dir(&self) -> PathBuf;
    fn log_file(&self) -> PathBuf;
}

pub trait ConfigStore: Send + Sync {
    fn load(&self) -> Result<AppConfig>;
    fn save(&self, config: &AppConfig) -> Result<()>;
}

pub trait SecretStore: Send + Sync {
    fn load_global_api_key(&self) -> Result<Option<String>>;
    fn save_global_api_key(&self, api_key: &str) -> Result<()>;
    fn remove_global_api_key(&self) -> Result<()>;
    /// Reads an arbitrary keyring entry — internal `Spirit` accounts (`provider::{id}[::{slot}]`)
    /// and external `apiKeyKeyring` / `credentials` slot references alike; missing or blank
    /// values resolve to `None`.
    fn read_keyring_secret(&self, service: &str, account: &str) -> Result<Option<String>>;
    /// Writes an internal keyring account (a blank value clears the entry).
    fn save_provider_secret(&self, account: &str, secret: &str) -> Result<()>;
    fn remove_provider_secret(&self, account: &str) -> Result<()>;
}

#[derive(Clone, Debug)]
pub struct ChatSessionListItem {
    pub path: String,
    pub display_name: String,
    pub modified_at_unix_ms: u128,
}

pub trait ChatRepository: Send + Sync {
    fn list(&self) -> Result<Vec<ChatSessionListItem>>;
    fn save(&self, path: Option<&str>, archive: &ChatArchive) -> Result<PathBuf>;
    fn load(&self, path: &str) -> Result<ChatArchive>;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_approval_level_strict_accepts_canonical_values() {
        assert_eq!(
            parse_approval_level_strict("default").as_deref(),
            Some("default")
        );
        assert_eq!(
            parse_approval_level_strict("auto-approval").as_deref(),
            Some("auto-approval")
        );
        assert_eq!(
            parse_approval_level_strict("bypass-approval").as_deref(),
            Some("bypass-approval")
        );
    }

    #[test]
    fn parse_approval_level_strict_rejects_unknown() {
        assert_eq!(parse_approval_level_strict("bogus"), None);
        assert_eq!(parse_approval_level_strict(""), None);
        assert_eq!(parse_approval_level_strict("full-approval"), None);
        assert_eq!(parse_approval_level_strict("auto"), None);
    }

    #[test]
    fn available_approval_levels_csv_uses_comma_space() {
        assert_eq!(
            available_approval_levels_csv(),
            "default, auto-approval, bypass-approval"
        );
    }

    #[test]
    fn normalize_approval_level_falls_back_unknown_to_default() {
        assert_eq!(normalize_approval_level("nope"), "default");
    }

    #[test]
    fn parse_tui_mode_strict_accepts_canonical() {
        assert_eq!(parse_tui_mode_strict("inline").as_deref(), Some("inline"));
        assert_eq!(
            parse_tui_mode_strict("FULLSCREEN").as_deref(),
            Some("fullscreen")
        );
    }

    #[test]
    fn parse_tui_mode_strict_rejects_unknown() {
        assert_eq!(parse_tui_mode_strict("mini"), None);
        assert_eq!(parse_tui_mode_strict(""), None);
        assert_eq!(parse_tui_mode_strict("window"), None);
    }

    #[test]
    fn available_tui_modes_csv_uses_comma_space() {
        assert_eq!(available_tui_modes_csv(), "inline, fullscreen");
    }

    #[test]
    fn normalize_tui_mode_falls_back_unknown_to_inline() {
        assert_eq!(normalize_tui_mode("nope"), "inline");
        assert_eq!(normalize_tui_mode("fullscreen"), "fullscreen");
    }
}
