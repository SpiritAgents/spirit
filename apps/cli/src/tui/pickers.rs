use super::image_paths::list_local_image_files;
use super::*;
use crate::host_protocol::CliExtensionEntry;
use crate::model_registry::ModelRef;

pub(crate) const APPROVAL_LEVEL_OPTIONS: [&str; 3] =
    ["default", "auto-approval", "bypass-approval"];
pub(crate) const LLM_HTTP_VERSION_OPTIONS: [&str; 2] = ["http1.1", "http2"];
pub(crate) const TUI_MODE_OPTIONS: [&str; 2] = [
    crate::ports::TUI_MODE_INLINE,
    crate::ports::TUI_MODE_FULLSCREEN,
];

pub(crate) fn llm_http_version_picker_index(current: &str) -> usize {
    if crate::ports::normalize_llm_http_version(current) == "http1.1" {
        0
    } else {
        1
    }
}

pub(crate) fn tui_mode_picker_index(current: &str) -> usize {
    if crate::ports::normalize_tui_mode(current) == crate::ports::TUI_MODE_FULLSCREEN {
        1
    } else {
        0
    }
}

pub(crate) fn approval_level_picker_index(current: &str) -> usize {
    match crate::ports::normalize_approval_level(current).as_str() {
        "bypass-approval" => 2,
        "auto-approval" => 1,
        _ => 0,
    }
}

impl TuiShell {
    pub fn cancel_model_picker(&mut self) {
        self.model_picker_active = false;
    }

    pub fn cancel_language_picker(&mut self) {
        self.language_picker_active = false;
    }

    pub fn cancel_approval_picker(&mut self) {
        self.approval_picker_active = false;
    }

    pub fn cancel_network_picker(&mut self) {
        self.network_picker_active = false;
    }

    pub fn cancel_tui_picker(&mut self) {
        self.tui_picker_active = false;
    }

    pub fn select_next_model(&mut self) {
        let total = self.runtime.config().flatten_models().len();
        if total == 0 {
            return;
        }
        self.model_picker_index = (self.model_picker_index + 1) % total;
    }

    pub fn select_next_language(&mut self) {
        let locales = locale::supported_ui_locales();
        if locales.is_empty() {
            return;
        }
        self.language_picker_index = (self.language_picker_index + 1) % locales.len();
    }

    pub fn select_next_approval_level(&mut self) {
        self.approval_picker_index =
            (self.approval_picker_index + 1) % APPROVAL_LEVEL_OPTIONS.len();
    }

    pub fn select_next_network_version(&mut self) {
        self.network_picker_index =
            (self.network_picker_index + 1) % LLM_HTTP_VERSION_OPTIONS.len();
    }

    pub fn select_next_tui_mode(&mut self) {
        self.tui_picker_index = (self.tui_picker_index + 1) % TUI_MODE_OPTIONS.len();
    }

    pub fn select_prev_model(&mut self) {
        let total = self.runtime.config().flatten_models().len();
        if total == 0 {
            return;
        }
        if self.model_picker_index == 0 {
            self.model_picker_index = total - 1;
        } else {
            self.model_picker_index -= 1;
        }
    }

    pub fn select_prev_language(&mut self) {
        let locales = locale::supported_ui_locales();
        if locales.is_empty() {
            return;
        }
        if self.language_picker_index == 0 {
            self.language_picker_index = locales.len() - 1;
        } else {
            self.language_picker_index -= 1;
        }
    }

    pub fn select_prev_approval_level(&mut self) {
        if self.approval_picker_index == 0 {
            self.approval_picker_index = APPROVAL_LEVEL_OPTIONS.len() - 1;
        } else {
            self.approval_picker_index -= 1;
        }
    }

    pub fn select_prev_network_version(&mut self) {
        if self.network_picker_index == 0 {
            self.network_picker_index = LLM_HTTP_VERSION_OPTIONS.len() - 1;
        } else {
            self.network_picker_index -= 1;
        }
    }

    pub fn select_prev_tui_mode(&mut self) {
        if self.tui_picker_index == 0 {
            self.tui_picker_index = TUI_MODE_OPTIONS.len() - 1;
        } else {
            self.tui_picker_index -= 1;
        }
    }

    pub fn confirm_model_picker(&mut self) {
        let Some(profile) = self
            .runtime
            .config()
            .flatten_models()
            .get(self.model_picker_index)
            .cloned()
        else {
            self.model_picker_active = false;
            return;
        };
        let selected = ModelRef {
            group_id: profile.group_id.clone(),
            name: profile.name.clone(),
        };

        let mut config = self.runtime.config().clone();
        config.active_model = selected.clone();
        if let Err(err) = self.runtime.validate_config_change(&config) {
            self.messages.push(ChatMessage {
                role: MessageRole::Agent,
                content: err.to_string(),
                tool_block: None,
            });
            self.model_picker_active = false;
            return;
        }
        if let Err(err) = self.config_store.save(&config) {
            self.messages.push(ChatMessage {
                role: MessageRole::Agent,
                content: t!("tui.model_picker.switch_saved_fail", err = err).into_owned(),
                tool_block: None,
            });
        } else {
            self.runtime.replace_config(config);
            self.apply_runtime_events();
            self.messages.push(ChatMessage {
                role: MessageRole::Agent,
                content: t!("tui.model_picker.switch_success", model = selected.name).into_owned(),
                tool_block: None,
            });
        }
        self.model_picker_active = false;
    }

    pub fn confirm_language_picker(&mut self) {
        let locales = locale::supported_ui_locales();
        let Some(selected) = locales.get(self.language_picker_index).copied() else {
            self.language_picker_active = false;
            return;
        };

        self.switch_ui_locale(selected);
        self.language_picker_active = false;
    }

    pub fn confirm_approval_picker(&mut self) {
        let Some(selected) = APPROVAL_LEVEL_OPTIONS
            .get(self.approval_picker_index)
            .copied()
        else {
            self.approval_picker_active = false;
            return;
        };

        match self.runtime.set_approval_level(selected) {
            Ok(()) => self.push_agent_message(
                t!(
                    "tui.approval.changed",
                    level = crate::ui::approval_level_label(selected)
                )
                .into_owned(),
            ),
            Err(err) => self.push_agent_message(t!("tui.approval.failed", err = err).into_owned()),
        }
        self.approval_picker_active = false;
    }

    pub fn confirm_network_picker(&mut self) {
        let Some(selected) = LLM_HTTP_VERSION_OPTIONS
            .get(self.network_picker_index)
            .copied()
        else {
            self.network_picker_active = false;
            return;
        };

        self.persist_llm_http_version(selected);
        self.network_picker_active = false;
    }

    pub fn confirm_tui_picker(&mut self) {
        let Some(selected) = TUI_MODE_OPTIONS.get(self.tui_picker_index).copied() else {
            self.tui_picker_active = false;
            return;
        };

        self.persist_tui_mode(selected);
        self.tui_picker_active = false;
    }

    pub fn cancel_chat_picker(&mut self) {
        self.chat_picker_active = false;
    }

    pub fn open_subagent_picker(&mut self) {
        self.subagent.picker_active = true;
        self.subagent.picker_index = 0;
    }

    pub fn cancel_subagent_picker(&mut self) {
        self.subagent.picker_active = false;
    }

    pub fn select_next_subagent(&mut self) {
        let total = self.runtime.subagent_sessions().len();
        if total == 0 {
            return;
        }
        self.subagent.picker_index = (self.subagent.picker_index + 1) % total;
    }

    pub fn select_prev_subagent(&mut self) {
        let total = self.runtime.subagent_sessions().len();
        if total == 0 {
            return;
        }
        if self.subagent.picker_index == 0 {
            self.subagent.picker_index = total - 1;
        } else {
            self.subagent.picker_index -= 1;
        }
    }

    pub fn confirm_subagent_picker(&mut self) {
        let Some(summary) = self
            .runtime
            .subagent_sessions()
            .get(self.subagent.picker_index)
            .cloned()
        else {
            self.subagent.picker_active = false;
            return;
        };

        self.subagent.picker_active = false;
        self.open_subagent_view(&summary.session_id);
    }

    pub fn select_next_chat(&mut self) {
        if self.chat_picker_sessions.is_empty() {
            return;
        }
        self.chat_picker_index = (self.chat_picker_index + 1) % self.chat_picker_sessions.len();
    }

    pub fn select_prev_chat(&mut self) {
        if self.chat_picker_sessions.is_empty() {
            return;
        }
        if self.chat_picker_index == 0 {
            self.chat_picker_index = self.chat_picker_sessions.len() - 1;
        } else {
            self.chat_picker_index -= 1;
        }
    }

    pub fn confirm_chat_picker(&mut self) {
        let Some(selected) = self
            .chat_picker_sessions
            .get(self.chat_picker_index)
            .cloned()
        else {
            self.chat_picker_active = false;
            return;
        };
        self.chat_picker_active = false;
        self.load_chat_by_path(&selected.path);
    }

    pub fn cancel_image_picker(&mut self) {
        self.image_picker_active = false;
    }

    pub fn add_pending_image_with_feedback(&mut self, path: std::path::PathBuf) {
        if !path.exists() {
            super::logging::log_event(&format!(
                "[clipboard] image file does not exist: {}",
                path.display()
            ));
            return;
        }
        let path_str = path.to_string_lossy().to_string();
        self.runtime.add_pending_image(path_str.clone());
        self.messages.push(super::ChatMessage {
            role: super::MessageRole::Agent,
            content: super::t!(
                "tui.image_picker.added",
                count = self.runtime.session().pending_image_paths().len(),
                path = path_str
            )
            .into_owned(),
            tool_block: None,
        });
    }

    pub fn select_next_image(&mut self) {
        if self.image_picker_files.is_empty() {
            return;
        }
        self.image_picker_index = (self.image_picker_index + 1) % self.image_picker_files.len();
    }

    pub fn select_prev_image(&mut self) {
        if self.image_picker_files.is_empty() {
            return;
        }
        if self.image_picker_index == 0 {
            self.image_picker_index = self.image_picker_files.len() - 1;
        } else {
            self.image_picker_index -= 1;
        }
    }

    pub fn confirm_image_picker(&mut self) {
        let Some(selected) = self
            .image_picker_files
            .get(self.image_picker_index)
            .cloned()
        else {
            self.image_picker_active = false;
            return;
        };

        self.image_picker_active = false;
        self.runtime.add_pending_image(selected.clone());
        self.messages.push(ChatMessage {
            role: MessageRole::Agent,
            content: t!(
                "tui.image_picker.added",
                count = self.runtime.session().pending_image_paths().len(),
                path = selected
            )
            .into_owned(),
            tool_block: None,
        });
    }

    pub(super) fn reset_primary_picker_overlay(&mut self) {
        self.exit_rewind_picker_mode();
        self.exit_fork_picker_mode();
        self.model_picker_active = false;
        self.language_picker_active = false;
        self.approval_picker_active = false;
        self.network_picker_active = false;
        self.tui_picker_active = false;
        self.chat_picker_active = false;
        self.image_picker_active = false;
        self.marketplace_picker_active = false;
        self.forms.active = None;
        self.set_input(String::new());
        self.refresh_suggestions();
    }

    pub(super) fn open_model_picker(&mut self) {
        if self.runtime.config().flatten_models().is_empty() {
            self.messages.push(ChatMessage {
                role: MessageRole::Agent,
                content: t!("tui.model_picker.empty").into_owned(),
                tool_block: None,
            });
            return;
        }

        self.model_picker_index = self
            .runtime
            .config()
            .flatten_models()
            .iter()
            .position(|profile| {
                profile.group_id == self.runtime.config().active_model.group_id
                    && profile.name == self.runtime.config().active_model.name
            })
            .unwrap_or(0);
        self.model_display_titles = crate::model_catalog_display::build_model_display_titles(
            &self.runtime.config().flatten_models(),
        );
        self.reset_primary_picker_overlay();
        self.model_picker_active = true;
    }

    pub(super) fn open_language_picker(&mut self) {
        let current = locale::normalize_ui_locale(rust_i18n::locale().as_ref());
        self.language_picker_index = locale::supported_ui_locales()
            .iter()
            .position(|candidate| *candidate == current)
            .unwrap_or(0);
        self.reset_primary_picker_overlay();
        self.language_picker_active = true;
    }

    pub(super) fn open_approval_picker(&mut self) {
        self.approval_picker_index = approval_level_picker_index(self.runtime.approval_level());
        self.reset_primary_picker_overlay();
        self.approval_picker_active = true;
    }

    pub(super) fn open_network_picker(&mut self) {
        self.network_picker_index =
            llm_http_version_picker_index(&self.runtime.config().networks.llm_http_version);
        self.reset_primary_picker_overlay();
        self.network_picker_active = true;
    }

    pub(super) fn persist_llm_http_version(&mut self, version: &str) {
        let normalized = crate::ports::normalize_llm_http_version(version);
        let mut config = self.runtime.config().clone();
        config.networks.llm_http_version = normalized.clone();
        if let Err(err) = self.config_store.save(&config) {
            self.push_agent_message(t!("tui.networks.save_failed", err = err).into_owned());
            return;
        }
        self.runtime.store_config(config);
        match self.runtime.set_llm_http_version(&normalized) {
            Ok(()) => self.push_agent_message(
                t!(
                    "tui.networks.changed",
                    level = crate::ui::llm_http_version_label(&normalized)
                )
                .into_owned(),
            ),
            Err(err) => self.push_agent_message(t!("tui.networks.failed", err = err).into_owned()),
        }
    }

    pub(super) fn open_tui_picker(&mut self) {
        self.tui_picker_index = tui_mode_picker_index(self.current_tui_mode());
        self.reset_primary_picker_overlay();
        self.tui_picker_active = true;
    }

    pub(super) fn persist_tui_mode(&mut self, mode: &str) {
        let Some(normalized) = crate::ports::parse_tui_mode_strict(mode) else {
            self.push_agent_message(t!("tui.tui.usage").into_owned());
            return;
        };
        let mut config = self.runtime.config().clone();
        config.tui = normalized.clone();
        if let Err(err) = self.config_store.save(&config) {
            self.push_agent_message(t!("tui.tui.save_failed", err = err).into_owned());
            return;
        }
        self.runtime.store_config(config);
        if self.current_tui_mode() != normalized {
            self.pending_tui_mode = Some(normalized.clone());
        }
        self.push_agent_message(
            t!(
                "tui.tui.changed",
                mode = crate::ui::tui_mode_label(&normalized)
            )
            .into_owned(),
        );
    }

    pub(super) fn open_chat_picker(&mut self) {
        match self.chat_repository.list() {
            Ok(files) => {
                if files.is_empty() {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: t!("tui.session_picker.empty").into_owned(),
                        tool_block: None,
                    });
                    return;
                }
                self.chat_picker_sessions = files;
                self.chat_picker_index = 0;
                self.reset_primary_picker_overlay();
                self.chat_picker_active = true;
            }
            Err(err) => {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: t!("tui.session_picker.read_failed", err = err).into_owned(),
                    tool_block: None,
                });
            }
        }
    }

    pub(super) fn open_image_picker(&mut self) {
        match list_local_image_files() {
            Ok(files) => {
                if files.is_empty() {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: t!("tui.image_picker.empty").into_owned(),
                        tool_block: None,
                    });
                    return;
                }
                self.image_picker_files = files;
                self.image_picker_index = 0;
                self.reset_primary_picker_overlay();
                self.image_picker_active = true;
            }
            Err(err) => {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: t!("tui.image_picker.read_failed", err = err).into_owned(),
                    tool_block: None,
                });
            }
        }
    }

    pub fn cancel_marketplace_picker(&mut self) {
        self.marketplace_picker_active = false;
    }

    pub fn select_next_marketplace_item(&mut self) {
        if self.marketplace_catalog.is_empty() {
            return;
        }
        self.marketplace_picker_index =
            (self.marketplace_picker_index + 1) % self.marketplace_catalog.len();
    }

    pub fn select_prev_marketplace_item(&mut self) {
        if self.marketplace_catalog.is_empty() {
            return;
        }
        if self.marketplace_picker_index == 0 {
            self.marketplace_picker_index = self.marketplace_catalog.len() - 1;
        } else {
            self.marketplace_picker_index -= 1;
        }
    }

    pub fn confirm_marketplace_picker(&mut self) {
        let Some(selected) = self
            .marketplace_catalog
            .get(self.marketplace_picker_index)
            .cloned()
        else {
            self.marketplace_picker_active = false;
            return;
        };

        if selected.installed {
            if let Err(err) = self.runtime.delete_extension(&selected.id) {
                self.push_agent_message(
                    t!("tui.marketplace.remove_failed", err = err).into_owned(),
                );
                return;
            }
            self.push_agent_message(t!("tui.marketplace.removed", id = selected.id).into_owned());
        } else if let Err(err) = self.runtime.install_built_in_extension(&selected.id) {
            self.push_agent_message(t!("tui.marketplace.install_failed", err = err).into_owned());
            return;
        } else {
            self.push_agent_message(
                t!("tui.marketplace.installed", name = selected.display_name).into_owned(),
            );
        }

        if let Err(err) = self.refresh_extensions_from_disk() {
            self.push_agent_message(t!("tui.extensions.refresh_failed", err = err).into_owned());
        }
        if let Err(err) = self.reload_marketplace_catalog(None) {
            self.push_agent_message(t!("tui.marketplace.refresh_failed", err = err).into_owned());
        }
    }

    pub(super) fn open_marketplace_picker(&mut self, filter: Option<&str>) {
        match self.reload_marketplace_catalog(filter) {
            Ok(()) => {
                self.reset_primary_picker_overlay();
                self.marketplace_picker_active = true;
                self.push_agent_message(t!("tui.marketplace.opened").into_owned());
            }
            Err(err) => {
                self.push_agent_message(t!("tui.marketplace.read_failed", err = err).into_owned());
            }
        }
    }

    pub(super) fn reload_marketplace_catalog(
        &mut self,
        filter: Option<&str>,
    ) -> anyhow::Result<()> {
        let catalog = self.runtime.list_marketplace_catalog()?;
        self.marketplace_catalog = filter_marketplace_catalog(catalog, filter);
        if self.marketplace_catalog.is_empty() {
            self.marketplace_picker_index = 0;
        } else {
            self.marketplace_picker_index = self
                .marketplace_picker_index
                .min(self.marketplace_catalog.len() - 1);
        }
        Ok(())
    }
}

fn filter_marketplace_catalog(
    catalog: Vec<CliExtensionEntry>,
    filter: Option<&str>,
) -> Vec<CliExtensionEntry> {
    let Some(query) = filter
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_ascii_lowercase)
    else {
        return catalog;
    };

    catalog
        .into_iter()
        .filter(|entry| marketplace_catalog_matches(entry, &query))
        .collect()
}

fn marketplace_catalog_matches(entry: &CliExtensionEntry, query: &str) -> bool {
    entry.id.to_ascii_lowercase().contains(query)
        || entry.display_name.to_ascii_lowercase().contains(query)
        || entry
            .description
            .as_deref()
            .is_some_and(|value| value.to_ascii_lowercase().contains(query))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_catalog_entry(
        id: &str,
        display_name: &str,
        description: Option<&str>,
    ) -> CliExtensionEntry {
        CliExtensionEntry {
            id: id.to_string(),
            display_name: display_name.to_string(),
            version: "0.1.0".to_string(),
            enabled: false,
            description: description.map(str::to_string),
            author: None,
            homepage: None,
            main: None,
            supported_hosts: vec!["cli".to_string()],
            activation_events: None,
            requested_capabilities: None,
            contributes: None,
            instruction_contributions: None,
            settings_schema: None,
            secret_slots: None,
            archive_file_name: None,
            installed_at_unix_ms: 0,
            installed: false,
            install_source: Some("built-in".to_string()),
        }
    }

    #[test]
    fn filter_marketplace_catalog_matches_id_name_and_description() {
        let catalog = vec![
            sample_catalog_entry("spirit.catalog-demo", "Catalog Demo", None),
            sample_catalog_entry(
                "spirit.local-demo",
                "Local Demo",
                Some("searchable fixture note"),
            ),
        ];

        let by_id = filter_marketplace_catalog(catalog.clone(), Some("catalog-demo"));
        assert_eq!(by_id.len(), 1);
        assert_eq!(by_id[0].id, "spirit.catalog-demo");

        let by_description = filter_marketplace_catalog(catalog, Some("searchable"));
        assert_eq!(by_description.len(), 1);
        assert_eq!(by_description[0].id, "spirit.local-demo");
    }

    #[test]
    fn filter_marketplace_catalog_blank_query_keeps_all() {
        let catalog = vec![
            sample_catalog_entry("spirit.catalog-demo", "Catalog Demo", None),
            sample_catalog_entry("spirit.local-demo", "Local Demo", None),
        ];
        assert_eq!(
            filter_marketplace_catalog(catalog.clone(), Some("   ")).len(),
            2
        );
        assert_eq!(filter_marketplace_catalog(catalog, None).len(), 2);
    }
}
