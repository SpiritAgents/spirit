use anyhow::{Result, anyhow};
use std::path::{Path, PathBuf};

use crate::{mcp::spirit_data_dir, rewind::ConversationMessageSnapshot};

pub fn chat_dir_path() -> PathBuf {
    spirit_data_dir().join("chats")
}

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

pub fn conversation_key_for_path(path: &Path) -> String {
    let resolved = resolve_chat_file_path(path.to_string_lossy().as_ref())
        .unwrap_or_else(|_| path.to_path_buf());
    std::path::absolute(&resolved)
        .unwrap_or(resolved)
        .to_string_lossy()
        .into_owned()
}

pub fn fallback_session_display_name(messages: &[ConversationMessageSnapshot]) -> String {
    let seed = messages
        .iter()
        .find(|message| {
            message.role == crate::rewind::ConversationMessageRole::User
                && !message.content.trim().is_empty()
        })
        .map(|message| message.content.trim());
    let Some(seed) = seed else {
        return "Chat".to_string();
    };
    let truncated = seed.chars().take(28).collect::<String>();
    if seed.chars().count() > 28 {
        format!("{}…", truncated)
    } else {
        seed.to_string()
    }
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
