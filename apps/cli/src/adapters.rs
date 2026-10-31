use anyhow::Result;
use std::{env, path::PathBuf};

use crate::{
    chat_store, logging,
    model_registry::{
        AppConfig, config_file_path, load_config, read_external_keyring_secret,
        remove_provider_secret, save_config, save_provider_secret,
    },
    ports::{AppPaths, ChatArchive, ChatRepository, ConfigStore, SecretStore},
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
        chat_store::chat_dir_path()
    }

    fn log_file(&self) -> PathBuf {
        logging::log_file_path()
    }
}

pub struct JsonConfigStore;

impl ConfigStore for JsonConfigStore {
    fn load(&self) -> Result<AppConfig> {
        load_config()
    }

    fn save(&self, config: &AppConfig) -> Result<()> {
        save_config(config)
    }
}

pub struct KeyringSecretStore;

impl SecretStore for KeyringSecretStore {
    fn read_keyring_secret(&self, service: &str, account: &str) -> Result<Option<String>> {
        Ok(read_external_keyring_secret(service, account))
    }

    fn save_provider_secret(&self, account: &str, secret: &str) -> Result<()> {
        save_provider_secret(account, secret)
    }

    fn remove_provider_secret(&self, account: &str) -> Result<()> {
        remove_provider_secret(account)
    }
}

pub struct JsonChatRepository;

impl ChatRepository for JsonChatRepository {
    fn list(&self) -> Result<Vec<crate::ports::ChatSessionListItem>> {
        chat_store::list_chat_sessions()
    }

    fn save(&self, path: Option<&str>, archive: &ChatArchive) -> Result<PathBuf> {
        chat_store::save_chat(chat_store::SaveChatParams {
            path_arg: path,
            messages: &archive.messages,
            assistant_aux: &archive.assistant_aux,
            llm_history: &archive.llm_history,
            loop_enabled: archive.loop_enabled,
            approval_level: &archive.approval_level,
            subagent_sessions: &archive.subagent_sessions,
            rewind: archive.rewind.as_ref(),
            desktop_messages: archive.desktop_messages.as_deref(),
            session_display_name_override: archive.session_display_name.as_deref(),
            session_title_source: archive.session_title_source.as_deref(),
        })
    }

    fn load(&self, path: &str) -> Result<ChatArchive> {
        let loaded = chat_store::load_chat(path)?;
        Ok(ChatArchive {
            messages: loaded.messages,
            assistant_aux: loaded.assistant_aux,
            llm_history: loaded.llm_history,
            loop_enabled: loaded.loop_enabled,
            approval_level: loaded.approval_level,
            subagent_sessions: loaded.subagent_sessions,
            desktop_messages: loaded.desktop_messages,
            rewind: loaded.rewind,
            session_display_name: loaded.session_display_name,
            session_title_source: loaded.session_title_source,
        })
    }
}
