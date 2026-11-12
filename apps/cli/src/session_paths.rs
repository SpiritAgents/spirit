use anyhow::{Result, anyhow};
use std::{
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use crate::{mcp::spirit_data_dir, rewind::ConversationMessageSnapshot};

pub fn chat_dir_path() -> PathBuf {
    spirit_data_dir().join("chats")
}

pub fn resolve_chat_save_path(path_arg: Option<&str>) -> Result<PathBuf> {
    match path_arg {
        Some(raw) if !raw.trim().is_empty() => {
            resolve_explicit_chat_save_path(raw, &std::env::current_dir()?)
        }
        _ => {
            let timestamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|duration| duration.as_secs())
                .unwrap_or(0);
            Ok(chat_dir_path().join(format!("chat-{timestamp}.json")))
        }
    }
}

fn resolve_explicit_chat_save_path(raw: &str, workspace_root: &Path) -> Result<PathBuf> {
    let path = with_json_extension(PathBuf::from(raw.trim()));
    Ok(if path.is_absolute() {
        path
    } else {
        workspace_root.join(path)
    })
}

pub fn resolve_chat_file_path(path_arg: &str) -> Result<PathBuf> {
    resolve_chat_file_path_from(path_arg, &std::env::current_dir()?, &chat_dir_path())
}

fn resolve_chat_file_path_from(
    path_arg: &str,
    workspace_root: &Path,
    chats_dir: &Path,
) -> Result<PathBuf> {
    let trimmed = path_arg.trim();
    if trimmed.is_empty() {
        return Err(anyhow!("/session load requires a file name or path"));
    }
    let raw = PathBuf::from(trimmed);
    let candidate = if raw.is_absolute() {
        with_json_extension(raw)
    } else {
        let in_chat_dir = with_json_extension(chats_dir.join(&raw));
        if in_chat_dir.exists() {
            in_chat_dir
        } else {
            with_json_extension(workspace_root.join(raw))
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

#[cfg(test)]
mod tests {
    use super::{resolve_chat_file_path_from, resolve_explicit_chat_save_path};
    use std::fs;

    #[test]
    fn explicit_relative_save_paths_use_the_cli_working_directory() {
        let workspace_root = std::env::temp_dir().join("spirit-save-path-fixture");
        let resolved = resolve_explicit_chat_save_path("exports/conversation", &workspace_root)
            .expect("resolve relative save path");
        assert_eq!(
            resolved,
            workspace_root.join("exports").join("conversation.json")
        );
    }

    #[test]
    fn relative_load_paths_preserve_chat_dir_and_working_directory_semantics() {
        let fixture =
            std::env::temp_dir().join(format!("spirit-load-path-{}", uuid::Uuid::new_v4()));
        let workspace_root = fixture.join("workspace");
        let chats_dir = fixture.join("chats");
        fs::create_dir_all(workspace_root.join("exports")).expect("create workspace fixture");
        fs::create_dir_all(&chats_dir).expect("create chats fixture");
        fs::write(workspace_root.join("exports/conversation.json"), "{}").expect("write cwd chat");
        fs::write(workspace_root.join("shared.json"), "{}").expect("write cwd duplicate");
        fs::write(chats_dir.join("shared.json"), "{}").expect("write chats duplicate");

        let cwd_path =
            resolve_chat_file_path_from("exports/conversation", &workspace_root, &chats_dir)
                .expect("resolve cwd chat");
        let chats_path = resolve_chat_file_path_from("shared", &workspace_root, &chats_dir)
            .expect("prefer chats chat");

        assert_eq!(cwd_path, workspace_root.join("exports/conversation.json"));
        assert_eq!(chats_path, chats_dir.join("shared.json"));
        fs::remove_dir_all(fixture).expect("remove load path fixture");
    }
}
