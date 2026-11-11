use anyhow::Result;
use std::{env, path::PathBuf};

use crate::{
    daemon::config::call_config_rpc,
    logging,
    model_registry::{AppConfig, config_file_path},
    ports::{AppPaths, ChatArchive, ChatRepository, ConfigStore, SecretStore},
    session_paths,
};

pub struct DefaultAppPaths {
    workspace_root: PathBuf,
}

impl Default for DefaultAppPaths {
    fn default() -> Self {
        Self::new()
    }
}

impl DefaultAppPaths {
    pub fn new() -> Self {
        Self {
            workspace_root: env::current_dir().unwrap_or_else(|_| PathBuf::from(".")),
        }
    }
}

impl AppPaths for DefaultAppPaths {
    fn workspace_root(&self) -> PathBuf {
        self.workspace_root.clone()
    }

    fn config_file(&self) -> PathBuf {
        config_file_path()
    }

    fn chats_dir(&self) -> PathBuf {
        session_paths::chat_dir_path()
    }

    fn log_file(&self) -> PathBuf {
        logging::log_file_path()
    }
}

pub struct JsonConfigStore;

impl ConfigStore for JsonConfigStore {
    fn load(&self) -> Result<AppConfig> {
        let workspace_root = env::current_dir()?;
        let value = call_config_rpc(&workspace_root, "host.getConfig", serde_json::json!({}))?;
        Ok(serde_json::from_value(value)?)
    }

    fn save(&self, config: &AppConfig) -> Result<()> {
        let workspace_root = env::current_dir()?;
        call_config_rpc(
            &workspace_root,
            "host.replaceConfig",
            serde_json::json!({ "config": config }),
        )?;
        Ok(())
    }
}

pub struct KeyringSecretStore;

impl SecretStore for KeyringSecretStore {
    fn read_keyring_secret(&self, service: &str, account: &str) -> Result<Option<String>> {
        let workspace_root = env::current_dir()?;
        let value = call_config_rpc(
            &workspace_root,
            "host.readKeyringSecret",
            serde_json::json!({ "service": service, "account": account }),
        )?;
        Ok(value
            .get("value")
            .and_then(serde_json::Value::as_str)
            .map(ToOwned::to_owned))
    }

    fn save_provider_secret(&self, account: &str, secret: &str) -> Result<()> {
        let workspace_root = env::current_dir()?;
        call_config_rpc(
            &workspace_root,
            "host.writeKeyringSecret",
            serde_json::json!({ "service": crate::product::NAME, "account": account, "value": secret }),
        )?;
        Ok(())
    }

    fn remove_provider_secret(&self, account: &str) -> Result<()> {
        let workspace_root = env::current_dir()?;
        call_config_rpc(
            &workspace_root,
            "host.deleteKeyringSecret",
            serde_json::json!({ "service": crate::product::NAME, "account": account }),
        )?;
        Ok(())
    }
}

pub struct JsonChatRepository;

impl ChatRepository for JsonChatRepository {
    fn list(&self) -> Result<Vec<crate::ports::ChatSessionListItem>> {
        let workspace_root = env::current_dir()?;
        let value = call_config_rpc(&workspace_root, "session.listStored", serde_json::json!({}))?;
        Ok(serde_json::from_value(value)?)
    }

    fn save(&self, path: Option<&str>, archive: &ChatArchive) -> Result<PathBuf> {
        let workspace_root = env::current_dir()?;
        let archive = crate::chat_archive::chat_archive_to_bridge_json(archive);
        let value = call_config_rpc(
            &workspace_root,
            "session.saveStored",
            serde_json::json!({ "path": path, "archive": archive }),
        )?;
        let path = value
            .get("path")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| anyhow::anyhow!("session.saveStored did not return a path"))?;
        Ok(PathBuf::from(path))
    }

    fn load(&self, path: &str) -> Result<ChatArchive> {
        let workspace_root = env::current_dir()?;
        let stored = call_config_rpc(
            &workspace_root,
            "session.loadStored",
            serde_json::json!({ "path": path }),
        )?;
        let timeline: Vec<crate::chat_timeline::PersistedTimelineTurn> =
            serde_json::from_value(stored["desktopMessageTimeline"].clone())?;
        let desktop_messages =
            crate::chat_timeline::hydrate_desktop_messages_from_timeline(&timeline);
        let (messages, assistant_aux) =
            crate::chat_timeline::derive_archive_projection(&desktop_messages);
        Ok(ChatArchive {
            messages,
            assistant_aux,
            llm_history: serde_json::from_value(stored["llmHistory"].clone())?,
            loop_enabled: stored["loopEnabled"].as_bool().unwrap_or(false),
            approval_level: stored["approvalLevel"]
                .as_str()
                .unwrap_or("default")
                .to_string(),
            subagent_sessions: serde_json::from_value(stored["subagentSessions"].clone())?,
            desktop_messages: Some(desktop_messages),
            rewind: Some(stored["rewind"].clone()),
            session_display_name: stored["sessionDisplayName"].as_str().map(ToOwned::to_owned),
            session_title_source: stored["sessionTitleSource"].as_str().map(ToOwned::to_owned),
        })
    }
}
