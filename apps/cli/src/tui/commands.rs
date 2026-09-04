use super::image_paths::{
    is_supported_image_path, parse_image_path_and_prompt, trim_wrapped_quotes,
};
use super::mcp_actions::{PromptTail, classify_prompt_tail, non_empty_opt};
use super::*;

impl TuiShell {
    pub(crate) fn handle_model_slash(&mut self, args: &[&str]) {
        match args {
            [] => self.open_model_picker(),
            ["list"] => {
                let list = self
                    .runtime
                    .config()
                    .flatten_models()
                    .into_iter()
                    .map(|m| format!("{} ({})", m.name, m.api_base))
                    .collect::<Vec<_>>()
                    .join(", ");
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: t!(
                        "tui.model.list",
                        current = self.runtime.config().active_model_name(),
                        list = list
                    )
                    .into_owned(),
                    tool_block: None,
                });
            }
            ["use"] => {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: t!("tui.model.use_usage").into_owned(),
                    tool_block: None,
                });
            }
            ["use", model] => {
                let mut config = self.runtime.config().clone();
                let model_ref = match config.parse_model_ref_selector(model) {
                    Ok(model_ref) => model_ref,
                    Err(message) => {
                        self.messages.push(ChatMessage {
                            role: MessageRole::Agent,
                            content: message,
                            tool_block: None,
                        });
                        return;
                    }
                };
                config.active_model = model_ref;
                if let Err(err) = self.runtime.validate_config_change(&config) {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: err.to_string(),
                        tool_block: None,
                    });
                    return;
                }
                if let Err(err) = self.config_store.save(&config) {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: t!("tui.model.switch_save_failed", err = err).into_owned(),
                        tool_block: None,
                    });
                } else {
                    self.runtime.replace_config(config);
                    self.apply_runtime_events();
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: t!("tui.model_picker.switch_success", model = model).into_owned(),
                        tool_block: None,
                    });
                }
            }
            ["add"] => {
                self.open_model_add_form();
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: t!("tui.model_add.opened").into_owned(),
                    tool_block: None,
                });
            }
            ["add", model, api_base, api_key] => {
                match self.apply_model_add_and_switch(ApplyModelAddParams {
                    name: model,
                    api_base,
                    api_key,
                    provider: None,
                    transport_kind: crate::model_registry::ModelTransportKind::OpenAiCompatible,
                    context_length: None,
                    azure_resource_name: None,
                    cloudflare_account_id: None,
                    cloudflare_gateway_id: None,
                    provider_site: None,
                    alibaba_workspace_id: None,
                }) {
                    Ok(()) => {
                        self.messages.push(ChatMessage {
                            role: MessageRole::Agent,
                            content: t!("tui.model_add.saved", name = model).into_owned(),
                            tool_block: None,
                        });
                    }
                    Err(err) => {
                        self.messages.push(ChatMessage {
                            role: MessageRole::Agent,
                            content: err,
                            tool_block: None,
                        });
                    }
                }
            }
            ["remove"] => {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: t!("tui.model.remove_usage").into_owned(),
                    tool_block: None,
                });
            }
            ["remove", model] => {
                let mut config = self.runtime.config().clone();
                let model_ref = match config.parse_model_ref_selector(model) {
                    Ok(model_ref) => model_ref,
                    Err(message) => {
                        self.messages.push(ChatMessage {
                            role: MessageRole::Agent,
                            content: message,
                            tool_block: None,
                        });
                        return;
                    }
                };
                if !config.remove_model(&model_ref) {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: t!("tui.model.not_found", model = model).into_owned(),
                        tool_block: None,
                    });
                    return;
                }
                if crate::model_registry::model_refs_equal(&config.active_model, &model_ref) {
                    config.active_model = config.first_model_ref();
                }
                if config
                    .image_generation_model
                    .as_ref()
                    .is_some_and(|slot| crate::model_registry::model_refs_equal(slot, &model_ref))
                {
                    config.image_generation_model = None;
                }
                if config
                    .video_generation_model
                    .as_ref()
                    .is_some_and(|slot| crate::model_registry::model_refs_equal(slot, &model_ref))
                {
                    config.video_generation_model = None;
                }
                if let Err(err) = self.config_store.save(&config) {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: t!("tui.model.remove_save_failed", err = err).into_owned(),
                        tool_block: None,
                    });
                } else {
                    let _ = self.secret_store.remove_model_api_key(&model_ref.name);
                    self.runtime.replace_config(config);
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: t!("tui.model.removed", model = model).into_owned(),
                        tool_block: None,
                    });
                }
            }
            _ => {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: t!("tui.model.usage").into_owned(),
                    tool_block: None,
                });
            }
        }
    }

    pub(crate) fn handle_sessions_slash(&mut self, message: &str) {
        let tail = message
            .strip_prefix("/session")
            .map(str::trim)
            .unwrap_or("");
        if tail.is_empty() {
            self.open_chat_picker();
            return;
        }
        if tail == "save" {
            self.save_current_chat(None);
            return;
        }
        if let Some(path) = tail.strip_prefix("save ") {
            self.save_current_chat(Some(path.trim()));
            return;
        }
        if let Some(path) = tail.strip_prefix("load ") {
            self.load_chat_by_path(path.trim());
            return;
        }
        if tail == "load" {
            self.messages.push(ChatMessage {
                role: MessageRole::Agent,
                content: t!("tui.session.load_usage").into_owned(),
                tool_block: None,
            });
            return;
        }
        self.messages.push(ChatMessage {
            role: MessageRole::Agent,
            content: t!("tui.session.usage").into_owned(),
            tool_block: None,
        });
    }

    pub(crate) fn handle_rewind_slash(&mut self, message: &str) {
        self.discard_last_matching_user_command(message);
        let tail = message.strip_prefix("/rewind").map(str::trim).unwrap_or("");
        if tail.is_empty() {
            self.open_rewind_picker();
            return;
        }
        self.handle_rewind_with_args(tail);
    }

    fn handle_rewind_with_args(&mut self, rest: &str) {
        let Some((index_text, replacement_text)) = split_first_token(rest) else {
            self.push_agent_message(t!("tui.session.rewind.usage").into_owned());
            return;
        };

        let Ok(target_ordinal) = index_text.parse::<usize>() else {
            self.push_agent_message(
                t!("tui.session.rewind.invalid_ordinal", value = index_text).into_owned(),
            );
            return;
        };
        if target_ordinal == 0 {
            self.push_agent_message(t!("tui.session.rewind.ordinal_from_one").into_owned());
            return;
        }

        let targets = self.rewind_targets();
        let Some((message_id, _preview)) = targets
            .get(target_ordinal - 1)
            .map(|(_, message_id, preview)| (*message_id, preview.clone()))
        else {
            self.push_agent_message(
                t!("tui.session.rewind.not_found", ordinal = target_ordinal).into_owned(),
            );
            return;
        };

        let result = if replacement_text.trim().is_empty() {
            self.rewind_to_message(message_id)
        } else {
            self.rewind_message_and_submit(message_id, replacement_text)
        };
        if let Err(err) = result {
            self.push_agent_message(t!("tui.session.rewind.failed", err = err).into_owned());
        }
    }

    pub fn open_rewind_picker(&mut self) {
        if self.runtime.is_busy() {
            self.push_agent_message(t!("tui.busy.pending_reply").into_owned());
            return;
        }
        let targets = self.rewind_targets();
        if targets.is_empty() {
            self.push_agent_message(t!("tui.session.rewind.empty").into_owned());
            return;
        }
        self.reset_primary_picker_overlay();
        self.clear_conversation_selection();
        self.rewind_picker_index = targets.len().saturating_sub(1);
        self.enter_rewind_picker_mode();
        self.scroll_history_to_bottom();
    }

    pub fn cancel_rewind_picker(&mut self) {
        self.exit_rewind_picker_mode();
        self.scroll_history_to_bottom();
    }

    pub fn select_next_rewind_target(&mut self) {
        let targets = self.rewind_targets();
        let total = targets.len();
        if total == 0 {
            return;
        }
        let current_message_id = targets[self.rewind_picker_index.min(total.saturating_sub(1))].1;
        self.rewind_picker_index = (self.rewind_picker_index + 1) % total;
        let next_message_id = targets[self.rewind_picker_index].1;
        self.conversation
            .anchor_rewind_message_to_current_row(current_message_id, next_message_id);
    }

    pub fn select_prev_rewind_target(&mut self) {
        let targets = self.rewind_targets();
        let total = targets.len();
        if total == 0 {
            return;
        }
        let current_message_id = targets[self.rewind_picker_index.min(total.saturating_sub(1))].1;
        if self.rewind_picker_index == 0 {
            self.rewind_picker_index = total - 1;
        } else {
            self.rewind_picker_index -= 1;
        }
        let next_message_id = targets[self.rewind_picker_index].1;
        self.conversation
            .anchor_rewind_message_to_current_row(current_message_id, next_message_id);
    }

    pub fn confirm_rewind_picker(&mut self) {
        let Some((message_id, _preview)) = self
            .rewind_targets()
            .get(self.rewind_picker_index)
            .map(|(_, message_id, preview)| (*message_id, preview.clone()))
        else {
            self.cancel_rewind_picker();
            return;
        };

        self.cancel_rewind_picker();
        if let Err(err) = self.rewind_to_message(message_id) {
            self.push_agent_message(t!("tui.session.rewind.failed", err = err).into_owned());
        }
    }

    pub fn is_rewind_picker_active(&self) -> bool {
        self.rewind_picker_active
    }

    pub(super) fn rewind_targets(&self) -> Vec<(usize, usize, String)> {
        let mut targets = Vec::new();
        for (index, message) in self.messages.iter().enumerate() {
            let message_id = index + 1;
            if message.role != MessageRole::User || !self.runtime.can_rewind_message(message_id) {
                continue;
            }
            targets.push((
                targets.len() + 1,
                message_id,
                if message.content.trim().is_empty() {
                    t!("ui.rewind.empty_message").into_owned()
                } else {
                    truncate_rewind_preview(&message.content)
                },
            ));
        }
        targets
    }

    pub(crate) fn handle_fork_slash(&mut self, message: &str) {
        self.discard_last_matching_user_command(message);
        let tail = message.strip_prefix("/fork").map(str::trim).unwrap_or("");
        if !tail.is_empty() {
            self.push_agent_message(t!("tui.session.fork.usage").into_owned());
            return;
        }
        self.open_fork_picker();
    }

    pub fn open_fork_picker(&mut self) {
        if self.runtime.is_busy() {
            self.push_agent_message(t!("tui.busy.pending_reply").into_owned());
            return;
        }
        let targets = self.fork_targets();
        if targets.is_empty() {
            self.push_agent_message(t!("tui.session.fork.empty").into_owned());
            return;
        }
        self.reset_primary_picker_overlay();
        self.clear_conversation_selection();
        self.fork_picker_index = targets.len().saturating_sub(1);
        self.enter_fork_picker_mode();
        self.scroll_history_to_bottom();
    }

    pub fn cancel_fork_picker(&mut self) {
        self.exit_fork_picker_mode();
        self.scroll_history_to_bottom();
    }

    pub fn select_next_fork_target(&mut self) {
        let targets = self.fork_targets();
        let total = targets.len();
        if total == 0 {
            return;
        }
        let current_message_id = targets[self.fork_picker_index.min(total.saturating_sub(1))].1;
        self.fork_picker_index = (self.fork_picker_index + 1) % total;
        let next_message_id = targets[self.fork_picker_index].1;
        self.conversation
            .anchor_rewind_message_to_current_row(current_message_id, next_message_id);
    }

    pub fn select_prev_fork_target(&mut self) {
        let targets = self.fork_targets();
        let total = targets.len();
        if total == 0 {
            return;
        }
        let current_message_id = targets[self.fork_picker_index.min(total.saturating_sub(1))].1;
        if self.fork_picker_index == 0 {
            self.fork_picker_index = total - 1;
        } else {
            self.fork_picker_index -= 1;
        }
        let next_message_id = targets[self.fork_picker_index].1;
        self.conversation
            .anchor_rewind_message_to_current_row(current_message_id, next_message_id);
    }

    pub fn confirm_fork_picker(&mut self) {
        let Some((message_id, _preview)) = self
            .fork_targets()
            .get(self.fork_picker_index)
            .map(|(_, message_id, preview)| (*message_id, preview.clone()))
        else {
            self.cancel_fork_picker();
            return;
        };

        self.cancel_fork_picker();
        if let Err(err) = self.fork_to_message(message_id) {
            self.push_agent_message(t!("tui.session.fork.failed", err = err).into_owned());
        }
    }

    pub fn is_fork_picker_active(&self) -> bool {
        self.fork_picker_active
    }

    pub(super) fn fork_targets(&self) -> Vec<(usize, usize, String)> {
        let mut targets = Vec::new();
        for (index, message) in self.messages.iter().enumerate() {
            let message_id = index + 1;
            if message.role != MessageRole::Agent {
                continue;
            }
            if self.pending_assistant_msg_index == Some(index) {
                continue;
            }
            let preview = if !message.content.trim().is_empty() {
                truncate_rewind_preview(&message.content)
            } else if let Some(tool) = message.tool_block.as_ref() {
                truncate_rewind_preview(&tool.headline)
            } else {
                t!("ui.fork.empty_message").into_owned()
            };
            targets.push((targets.len() + 1, message_id, preview));
        }
        targets
    }

    fn discard_last_matching_user_command(&mut self, command: &str) {
        let should_pop = self.messages.last().is_some_and(|message| {
            message.role == MessageRole::User
                && message.tool_block.is_none()
                && message.content.trim() == command.trim()
        });
        if should_pop {
            self.messages.pop();
        }
    }

    pub(crate) fn handle_subagents_slash(&mut self, message: &str) {
        let tail = message
            .strip_prefix("/subagent")
            .map(str::trim)
            .unwrap_or("");

        if tail.is_empty() || tail == "list" {
            self.open_subagent_picker();
            return;
        }

        if tail == "close" {
            self.close_subagent_view();
            return;
        }

        if let Some(session_id) = tail.strip_prefix("open ") {
            self.open_subagent_view(session_id.trim());
            return;
        }

        self.messages.push(ChatMessage {
            role: MessageRole::Agent,
            content: t!("tui.subagents.usage").into_owned(),
            tool_block: None,
        });
    }

    pub(crate) fn handle_image_slash(&mut self, message: &str) {
        let tail = message.strip_prefix("/image").map(str::trim).unwrap_or("");

        if tail == "clear" {
            let cleared = self.runtime.clear_pending_images();
            self.messages.push(ChatMessage {
                role: MessageRole::Agent,
                content: t!("tui.image_queue.cleared", count = cleared).into_owned(),
                tool_block: None,
            });
            return;
        }

        if tail.is_empty() {
            self.messages.push(ChatMessage {
                role: MessageRole::Agent,
                content: t!("tui.image.usage").into_owned(),
                tool_block: None,
            });
            return;
        }

        if tail == "pick" {
            self.open_image_picker();
            return;
        }

        let (raw_path, prompt) = parse_image_path_and_prompt(tail);
        if raw_path.is_empty() {
            self.messages.push(ChatMessage {
                role: MessageRole::Agent,
                content: t!("tui.image.path_usage").into_owned(),
                tool_block: None,
            });
            return;
        }
        if !is_supported_image_path(raw_path) {
            self.messages.push(ChatMessage {
                role: MessageRole::Agent,
                content: t!("tui.image.unsupported_type").into_owned(),
                tool_block: None,
            });
            return;
        }
        if !Path::new(raw_path).exists() {
            self.messages.push(ChatMessage {
                role: MessageRole::Agent,
                content: t!("tui.image.not_found", path = raw_path).into_owned(),
                tool_block: None,
            });
            return;
        }

        if !prompt.is_empty() {
            if self.runtime.is_busy() {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: t!("tui.busy.pending_reply").into_owned(),
                    tool_block: None,
                });
                return;
            }
            self.scroll_history_to_bottom();
            self.messages.push(ChatMessage {
                role: MessageRole::User,
                content: t!("tui.user.attached_image", prompt = prompt, path = raw_path)
                    .into_owned(),
                tool_block: None,
            });
            let _ =
                self.submit_runtime_user_turn(prompt.to_string(), Some(vec![raw_path.to_string()]));
            return;
        }

        self.runtime.add_pending_image(raw_path.to_string());
        self.messages.push(ChatMessage {
            role: MessageRole::Agent,
            content: t!(
                "tui.image_queue.added_auto_attach",
                count = self.runtime.session().pending_image_paths().len()
            )
            .into_owned(),
            tool_block: None,
        });
    }

    pub(crate) fn handle_log_slash(&mut self, args: &[&str]) {
        match args {
            [] => match self.open_cli_log_file() {
                Ok(path) => {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: t!("tui.log.opened", path = path.display()).into_owned(),
                        tool_block: None,
                    });
                }
                Err(err) => {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: t!("tui.log.open_failed", err = err).into_owned(),
                        tool_block: None,
                    });
                }
            },
            ["export"] => match self.export_cli_log_to_temp() {
                Ok(path) => {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: t!("tui.log.exported", path = path.display()).into_owned(),
                        tool_block: None,
                    });
                }
                Err(err) => {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: t!("tui.log.export_failed", err = err).into_owned(),
                        tool_block: None,
                    });
                }
            },
            ["session", "export"] => match self.export_llm_history_json_to_temp() {
                Ok(path) => {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: t!("tui.log.session_exported", path = path.display()).into_owned(),
                        tool_block: None,
                    });
                }
                Err(err) => {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: t!("tui.log.session_export_failed", err = err).into_owned(),
                        tool_block: None,
                    });
                }
            },
            _ => {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: t!("tui.log.usage").into_owned(),
                    tool_block: None,
                });
            }
        }
    }

    pub(crate) fn handle_approval_slash(&mut self, args: &[&str]) {
        match args {
            [] => self.open_approval_picker(),
            [level] => {
                let normalized = crate::ports::normalize_approval_level(level);
                match self.runtime.set_approval_level(&normalized) {
                    Ok(()) => self.push_agent_message(
                        t!(
                            "tui.approval.changed",
                            level = crate::ui::approval_level_label(&normalized)
                        )
                        .into_owned(),
                    ),
                    Err(err) => {
                        self.push_agent_message(t!("tui.approval.failed", err = err).into_owned())
                    }
                }
            }
            _ => self.push_agent_message(t!("tui.approval.usage").into_owned()),
        }
    }

    pub(crate) fn handle_networks_slash(&mut self, args: &[&str]) {
        match args {
            [] => self.open_network_picker(),
            [version] => self.persist_llm_http_version(version),
            _ => self.push_agent_message(t!("tui.networks.usage").into_owned()),
        }
    }

    pub(crate) fn handle_tui_slash(&mut self, args: &[&str]) {
        match args {
            [] => self.open_tui_picker(),
            [mode] => self.persist_tui_mode(mode),
            _ => self.push_agent_message(t!("tui.tui.usage").into_owned()),
        }
    }

    pub(crate) fn handle_language_slash(&mut self, args: &[&str]) {
        match args {
            [] => self.open_language_picker(),
            [locale_code] => {
                let Some(normalized) = locale::parse_ui_locale(locale_code) else {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: t!(
                            "tui.language.unsupported",
                            locale = *locale_code,
                            available = locale::supported_ui_locales().join(", ")
                        )
                        .into_owned(),
                        tool_block: None,
                    });
                    return;
                };
                self.switch_ui_locale(&normalized);
            }
            _ => self.push_agent_message(
                t!(
                    "tui.language.usage",
                    available = locale::available_ui_locales_csv()
                )
                .into_owned(),
            ),
        }
    }

    pub(crate) fn handle_rules_slash(&mut self, args: &[&str]) {
        if !args.is_empty() {
            self.push_agent_message(t!("tui.rules.usage").into_owned());
            return;
        }

        if let Err(err) = self.refresh_rules_from_disk() {
            self.messages.push(ChatMessage {
                role: MessageRole::Agent,
                content: t!("tui.rules.read_failed", err = err).into_owned(),
                tool_block: None,
            });
            return;
        }

        self.open_rules_form();
        self.messages.push(ChatMessage {
            role: MessageRole::Agent,
            content: t!("tui.rules.opened").into_owned(),
            tool_block: None,
        });
    }

    pub(crate) fn handle_skills_slash(&mut self, args: &[&str]) {
        if !args.is_empty() {
            self.push_agent_message(t!("tui.skills.usage").into_owned());
            return;
        }

        if let Err(err) = self.refresh_skills_from_disk() {
            self.messages.push(ChatMessage {
                role: MessageRole::Agent,
                content: t!("tui.skills.read_failed", err = err).into_owned(),
                tool_block: None,
            });
            return;
        }

        self.open_skills_form();
        self.messages.push(ChatMessage {
            role: MessageRole::Agent,
            content: t!("tui.skills.opened").into_owned(),
            tool_block: None,
        });
    }

    pub(crate) fn handle_extensions_slash(&mut self, message: &str) {
        let tail = message
            .strip_prefix("/extension")
            .map(str::trim)
            .unwrap_or("");
        if tail.is_empty() {
            if let Err(err) = self.refresh_extensions_from_disk() {
                self.push_agent_message(t!("tui.extensions.read_failed", err = err).into_owned());
                return;
            }

            self.open_extensions_form();
            self.push_agent_message(t!("tui.extensions.opened").into_owned());
            return;
        }

        let Some(subcommand) = tail.split_whitespace().next() else {
            self.push_agent_message(t!("tui.extensions.usage").into_owned());
            return;
        };

        match subcommand {
            "list" if tail == "list" => match self.refresh_extensions_from_disk() {
                Ok(()) => {
                    self.push_agent_message(format_extension_list_message(self.extension_entries()))
                }
                Err(err) => self
                    .push_agent_message(t!("tui.extensions.read_failed", err = err).into_owned()),
            },
            "import" => {
                let raw_path = tail.strip_prefix("import").map(str::trim).unwrap_or("");
                let archive_path = trim_wrapped_quotes(raw_path);
                if archive_path.is_empty() {
                    self.push_agent_message(t!("tui.extensions.usage").into_owned());
                    return;
                }

                let archive_bytes = match fs::read(archive_path) {
                    Ok(bytes) => bytes,
                    Err(err) => {
                        self.push_agent_message(
                            t!("tui.extensions.import_read_failed", err = err).into_owned(),
                        );
                        return;
                    }
                };

                let file_name = Path::new(archive_path)
                    .file_name()
                    .and_then(|value| value.to_str())
                    .map(|value| value.to_string());

                match self
                    .runtime
                    .import_extension_archive(&archive_bytes, file_name.as_deref())
                {
                    Ok(extension) => {
                        if let Err(err) = self.refresh_extensions_from_disk() {
                            self.push_agent_message(
                                t!("tui.extensions.refresh_failed", err = err).into_owned(),
                            );
                            return;
                        }

                        logging::log_event(&format!(
                            "[extensions] import ok id={} version={}",
                            extension.id, extension.version
                        ));
                        self.push_agent_message(format!(
                            "{}\nid: {}\nversion: {}",
                            t!("tui.extensions.imported", name = extension.display_name),
                            extension.id,
                            extension.version,
                        ));
                    }
                    Err(err) => {
                        logging::log_event(&format!("[extensions] import failed: {}", err));
                        self.push_agent_message(
                            t!("tui.extensions.import_failed", err = err).into_owned(),
                        );
                    }
                }
            }
            "remove" => {
                let id = tail.strip_prefix("remove").map(str::trim).unwrap_or("");
                if id.is_empty() {
                    self.push_agent_message(t!("tui.extensions.usage").into_owned());
                    return;
                }

                match self.runtime.delete_extension(id) {
                    Ok(()) => {
                        if let Err(err) = self.refresh_extensions_from_disk() {
                            self.push_agent_message(
                                t!("tui.extensions.refresh_failed", err = err).into_owned(),
                            );
                            return;
                        }

                        self.push_agent_message(t!("tui.extensions.removed", id = id).into_owned());
                    }
                    Err(err) => {
                        self.push_agent_message(
                            t!("tui.extensions.remove_failed", err = err).into_owned(),
                        );
                    }
                }
            }
            _ => self.push_agent_message(t!("tui.extensions.usage").into_owned()),
        }
    }

    pub(crate) fn handle_marketplace_slash(&mut self, message: &str) {
        let tail = message
            .strip_prefix("/marketplace")
            .map(str::trim)
            .unwrap_or("");
        if tail.is_empty() {
            self.open_marketplace_picker(None);
            return;
        }

        let Some(subcommand) = tail.split_whitespace().next() else {
            self.push_agent_message(t!("tui.marketplace.usage").into_owned());
            return;
        };

        match subcommand {
            "list" if tail == "list" => match self.reload_marketplace_catalog(None) {
                Ok(()) => self
                    .push_agent_message(format_marketplace_list_message(&self.marketplace_catalog)),
                Err(err) => self
                    .push_agent_message(t!("tui.marketplace.read_failed", err = err).into_owned()),
            },
            "install" => {
                let id = tail.strip_prefix("install").map(str::trim).unwrap_or("");
                if id.is_empty() {
                    self.push_agent_message(t!("tui.marketplace.usage").into_owned());
                    return;
                }

                match self.runtime.install_built_in_extension(id) {
                    Ok(extension) => {
                        if let Err(err) = self.refresh_extensions_from_disk() {
                            self.push_agent_message(
                                t!("tui.extensions.refresh_failed", err = err).into_owned(),
                            );
                            return;
                        }

                        self.push_agent_message(
                            t!("tui.marketplace.installed", name = extension.display_name)
                                .into_owned(),
                        );
                    }
                    Err(err) => self.push_agent_message(
                        t!("tui.marketplace.install_failed", err = err).into_owned(),
                    ),
                }
            }
            "remove" => {
                let id = tail.strip_prefix("remove").map(str::trim).unwrap_or("");
                if id.is_empty() {
                    self.push_agent_message(t!("tui.marketplace.usage").into_owned());
                    return;
                }

                match self.runtime.delete_extension(id) {
                    Ok(()) => {
                        if let Err(err) = self.refresh_extensions_from_disk() {
                            self.push_agent_message(
                                t!("tui.extensions.refresh_failed", err = err).into_owned(),
                            );
                            return;
                        }

                        self.push_agent_message(
                            t!("tui.marketplace.removed", id = id).into_owned(),
                        );
                    }
                    Err(err) => self.push_agent_message(
                        t!("tui.marketplace.remove_failed", err = err).into_owned(),
                    ),
                }
            }
            _ => self.open_marketplace_picker(Some(tail)),
        }
    }

    pub(crate) fn handle_start_implementing_slash(&mut self) {
        if self.runtime.is_busy() {
            self.messages.push(ChatMessage {
                role: MessageRole::Agent,
                content: t!("tui.busy.pending_reply").into_owned(),
                tool_block: None,
            });
            return;
        }

        self.set_input_mode(MainInputMode::Agent);
        let user_turn = plan::build_start_implementing_user_turn(self.runtime.active_plan_path());
        let _ = self.submit_runtime_user_turn(user_turn, None);
    }

    pub(crate) fn handle_continue_slash(&mut self) {
        if !self.can_continue_last_turn() {
            self.push_agent_message(t!("tui.continue.unavailable").into_owned());
            return;
        }

        if self.runtime.is_busy() {
            self.messages.push(ChatMessage {
                role: MessageRole::Agent,
                content: t!("tui.busy.pending_reply").into_owned(),
                tool_block: None,
            });
            return;
        }

        match self.runtime.continue_assistant_completion() {
            Ok(()) => {
                self.last_turn_can_continue = false;
                self.apply_runtime_events();
            }
            Err(err) => {
                self.push_agent_message(t!("tui.continue.failed", err = err).into_owned());
            }
        }
    }

    pub(crate) fn handle_loop_slash(&mut self, args: &[&str]) {
        let current = self.runtime.loop_enabled();
        let next = match args {
            [] => Some(!current),
            ["on"] => Some(true),
            ["off"] => Some(false),
            ["status"] => {
                self.push_agent_message(if current {
                    t!("tui.loop.status_on").into_owned()
                } else {
                    t!("tui.loop.status_off").into_owned()
                });
                None
            }
            _ => {
                self.push_agent_message(t!("tui.loop.usage").into_owned());
                None
            }
        };

        let Some(enabled) = next else {
            return;
        };

        match self.runtime.set_loop_enabled(enabled) {
            Ok(()) => {
                self.push_agent_message(if enabled {
                    t!("tui.loop.enabled").into_owned()
                } else {
                    t!("tui.loop.disabled").into_owned()
                });
            }
            Err(err) => {
                self.push_agent_message(t!("tui.loop.failed", err = err).into_owned());
            }
        }
    }

    pub(crate) fn handle_skill_alias_slash(&mut self, message: &str) -> bool {
        let Some((command, user_message)) = split_first_token(message) else {
            return false;
        };
        let Some(skill_name) = slash::resolve_skill_slash_command(self, command) else {
            return false;
        };

        self.activate_skill_slash(&skill_name, user_message);
        true
    }

    fn activate_skill_slash(&mut self, skill_name: &str, user_message: &str) {
        let Some(skill) = self.find_enabled_skill_entry(skill_name) else {
            self.push_agent_message(
                t!("tui.skills.activate_missing", name = skill_name).into_owned(),
            );
            return;
        };

        if self.runtime.is_busy() {
            self.messages.push(ChatMessage {
                role: MessageRole::Agent,
                content: t!("tui.busy.pending_reply").into_owned(),
                tool_block: None,
            });
            return;
        }

        let payload = match skills::build_active_skill_payload(skill) {
            Ok(payload) => payload,
            Err(err) => {
                self.push_agent_message(t!("tui.skills.activate_failed", err = err).into_owned());
                return;
            }
        };
        if let Err(err) = self.runtime.activate_skill(payload) {
            self.push_agent_message(t!("tui.skills.activate_failed", err = err).into_owned());
            return;
        }

        let user_turn = skills::build_activate_skill_user_turn(skill_name, user_message);
        let _ = self.submit_runtime_user_turn(user_turn, None);
    }

    pub(crate) fn handle_mcp_slash(&mut self, message: &str) {
        let tail = message.strip_prefix("/mcp").map(str::trim).unwrap_or("");

        if tail.is_empty() || tail == "list" {
            self.push_mcp_overview();
            return;
        }

        if tail == "add" {
            self.open_mcp_add_form();
            self.messages.push(ChatMessage {
                role: MessageRole::Agent,
                content: t!("tui.mcp.add_form_opened").into_owned(),
                tool_block: None,
            });
            return;
        }

        if tail == "inspect" || tail.starts_with("inspect ") {
            let server = if tail == "inspect" {
                match self.resolve_default_mcp_server("inspect") {
                    Some(server) => server,
                    None => return,
                }
            } else {
                tail.strip_prefix("inspect ")
                    .unwrap_or_default()
                    .trim()
                    .to_string()
            };

            match self.runtime.inspect_mcp_server(&server) {
                Ok(inspection) => {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: format!(
                            "server: {}\ndisplay: {}\nprotocol: {}\npeer: {} {}\ncapabilities: tools={} resources={} prompts={}\ncounts: tools={} resources={} prompts={}",
                            inspection.name,
                            inspection.display_name,
                            inspection.protocol_version,
                            inspection.server_name,
                            inspection.server_version,
                            inspection.supports_tools,
                            inspection.supports_resources,
                            inspection.supports_prompts,
                            inspection.tools_count,
                            inspection.resources_count,
                            inspection.prompts_count,
                        ),
                        tool_block: None,
                    });
                }
                Err(err) => self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: t!("tui.mcp.inspect_failed", err = err).into_owned(),
                    tool_block: None,
                }),
            }
            return;
        }

        if tail == "tools" || tail.starts_with("tools ") {
            let server = if tail == "tools" {
                match self.resolve_default_mcp_server("tools") {
                    Some(server) => server,
                    None => return,
                }
            } else {
                tail.strip_prefix("tools ")
                    .unwrap_or_default()
                    .trim()
                    .to_string()
            };

            match self.runtime.list_mcp_tools(&server) {
                Ok(tools) if tools.is_empty() => self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: t!("tui.mcp.tools_empty", server = server).into_owned(),
                    tool_block: None,
                }),
                Ok(tools) => {
                    let lines = tools
                        .into_iter()
                        .map(|tool| {
                            let desc = tool
                                .description
                                .unwrap_or_else(|| t!("tui.mcp.no_description").into_owned());
                            format!("- {}: {}", tool.name, desc)
                        })
                        .collect::<Vec<_>>()
                        .join("\n");
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: format!("MCP tools:\n{}", lines),
                        tool_block: None,
                    });
                }
                Err(err) => self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: t!("tui.mcp.tools_read_failed", err = err).into_owned(),
                    tool_block: None,
                }),
            }
            return;
        }

        if tail == "resources" || tail.starts_with("resources ") {
            let server = if tail == "resources" {
                match self.resolve_default_mcp_server("resources") {
                    Some(server) => server,
                    None => return,
                }
            } else {
                tail.strip_prefix("resources ")
                    .unwrap_or_default()
                    .trim()
                    .to_string()
            };

            match self.runtime.list_mcp_resources(&server) {
                Ok(resources) if resources.is_empty() => self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: t!("tui.mcp.resources_empty", server = server).into_owned(),
                    tool_block: None,
                }),
                Ok(resources) => {
                    let lines = resources
                        .into_iter()
                        .map(|resource| format!("- {} ({})", resource.uri, resource.name))
                        .collect::<Vec<_>>()
                        .join("\n");
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: format!("MCP resources:\n{}", lines),
                        tool_block: None,
                    });
                }
                Err(err) => self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: t!("tui.mcp.resources_read_failed", err = err).into_owned(),
                    tool_block: None,
                }),
            }
            return;
        }

        if tail == "prompts" || tail.starts_with("prompts ") {
            let server = if tail == "prompts" {
                match self.resolve_default_mcp_server("prompts") {
                    Some(server) => server,
                    None => return,
                }
            } else {
                tail.strip_prefix("prompts ")
                    .unwrap_or_default()
                    .trim()
                    .to_string()
            };

            match self.runtime.list_mcp_prompts(&server) {
                Ok(prompts) if prompts.is_empty() => self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: t!("tui.mcp.prompts_empty", server = server).into_owned(),
                    tool_block: None,
                }),
                Ok(prompts) => {
                    let lines = prompts
                        .into_iter()
                        .map(|prompt| {
                            let desc = prompt
                                .description
                                .unwrap_or_else(|| t!("tui.mcp.no_description").into_owned());
                            format!("- {}: {}", prompt.name, desc)
                        })
                        .collect::<Vec<_>>()
                        .join("\n");
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: format!("MCP prompts:\n{}", lines),
                        tool_block: None,
                    });
                }
                Err(err) => self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: t!("tui.mcp.prompts_read_failed", err = err).into_owned(),
                    tool_block: None,
                }),
            }
            return;
        }

        if let Some(rest) = tail.strip_prefix("prompt ") {
            let tail = rest.trim();
            let (server, rest) = match split_first_token(tail) {
                Some((candidate_server, remainder))
                    if self.server_exists(candidate_server) && !remainder.is_empty() =>
                {
                    (candidate_server.to_string(), remainder)
                }
                _ => {
                    let server = match self.resolve_default_mcp_server("prompt") {
                        Some(server) => server,
                        None => return,
                    };
                    (server, tail)
                }
            };

            let Some((prompt_name, prompt_tail)) = split_first_token(rest) else {
                self.push_mcp_usage();
                return;
            };
            match self.resolve_mcp_prompt_definition(&server, prompt_name) {
                Ok(prompt_definition) => {
                    match classify_prompt_tail(&prompt_definition, prompt_tail) {
                        PromptTail::ArgsJson(args_json) => {
                            self.apply_mcp_prompt_command(
                                &server,
                                prompt_name,
                                Some(args_json),
                                None,
                            );
                        }
                        PromptTail::UserMessage(user_message)
                            if prompt_definition.arguments.is_empty() =>
                        {
                            self.apply_mcp_prompt_command(
                                &server,
                                prompt_name,
                                None,
                                Some(user_message),
                            );
                        }
                        PromptTail::Empty if prompt_definition.arguments.is_empty() => {
                            self.apply_mcp_prompt_command(&server, prompt_name, None, None);
                        }
                        PromptTail::Empty => {
                            self.open_mcp_prompt_form(&server, &prompt_definition, None);
                            self.messages.push(ChatMessage {
                                role: MessageRole::Agent,
                                content: t!(
                                    "tui.bottom_form.prompt_opened",
                                    server = server,
                                    prompt = prompt_name
                                )
                                .into_owned(),
                                tool_block: None,
                            });
                        }
                        PromptTail::UserMessage(user_message) => {
                            self.open_mcp_prompt_form(
                                &server,
                                &prompt_definition,
                                Some(user_message),
                            );
                            self.messages.push(ChatMessage {
                                role: MessageRole::Agent,
                                content: t!(
                                    "tui.bottom_form.prompt_opened",
                                    server = server,
                                    prompt = prompt_name
                                )
                                .into_owned(),
                                tool_block: None,
                            });
                        }
                    }
                }
                Err(err) => self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: t!("tui.mcp.prompt_args_read_failed", err = err).into_owned(),
                    tool_block: None,
                }),
            }
            return;
        }

        if let Some(rest) = tail.strip_prefix("tool call ") {
            let Some((server, rest)) = split_first_token(rest) else {
                self.push_mcp_usage();
                return;
            };
            let Some((tool, args_json)) = split_first_token(rest) else {
                self.push_mcp_usage();
                return;
            };
            match self
                .runtime
                .execute_mcp_tool(server, tool, non_empty_opt(args_json))
            {
                Ok(()) => self.apply_runtime_events(),
                Err(err) => self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: t!("tui.mcp.tool_call_failed", err = err).into_owned(),
                    tool_block: None,
                }),
            }
            return;
        }

        if let Some(rest) = tail.strip_prefix("resource attach ") {
            let Some((server, rest)) = split_first_token(rest) else {
                self.push_mcp_usage();
                return;
            };
            let uri = rest.trim();
            if uri.is_empty() {
                self.push_mcp_usage();
                return;
            }
            match self.runtime.attach_mcp_resource(server, uri) {
                Ok(label) => self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: t!(
                        "tui.mcp.resource_attached",
                        count = self.runtime.session().pending_mcp_resources().len(),
                        label = label
                    )
                    .into_owned(),
                    tool_block: None,
                }),
                Err(err) => self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: t!("tui.mcp.resource_attach_failed", err = err).into_owned(),
                    tool_block: None,
                }),
            }
            return;
        }

        if tail == "resource clear" {
            let cleared = self.runtime.clear_pending_mcp_resources();
            self.messages.push(ChatMessage {
                role: MessageRole::Agent,
                content: t!("tui.mcp.resource_queue_cleared", count = cleared).into_owned(),
                tool_block: None,
            });
            return;
        }

        self.push_mcp_usage();
    }

    pub(crate) fn handle_hooks_slash(&mut self, message: &str) {
        let tail = message.strip_prefix("/hook").map(str::trim).unwrap_or("");

        if tail.is_empty() || tail == "list" {
            self.push_hooks_overview();
            return;
        }

        if tail == "add" {
            self.open_hook_add_form();
            return;
        }

        self.push_hooks_usage();
    }

    pub(crate) fn handle_prompt_alias_slash(&mut self, message: &str) -> bool {
        let Some((command, rest)) = split_first_token(message) else {
            return false;
        };

        let Some(resolved) = slash::resolve_prompt_slash_command(self, command) else {
            return false;
        };

        let server = resolved.server;
        let prompt = resolved.prompt;

        match classify_prompt_tail(&prompt, rest) {
            PromptTail::ArgsJson(args_json) => {
                self.apply_mcp_prompt_command(&server, &prompt.name, Some(args_json), None);
            }
            PromptTail::UserMessage(user_message) if prompt.arguments.is_empty() => {
                self.apply_mcp_prompt_command(&server, &prompt.name, None, Some(user_message));
            }
            PromptTail::Empty if prompt.arguments.is_empty() => {
                self.apply_mcp_prompt_command(&server, &prompt.name, None, None);
            }
            PromptTail::Empty => {
                self.open_mcp_prompt_form(&server, &prompt, None);
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: t!(
                        "tui.bottom_form.prompt_opened",
                        server = server,
                        prompt = prompt.name
                    )
                    .into_owned(),
                    tool_block: None,
                });
            }
            PromptTail::UserMessage(user_message) => {
                self.open_mcp_prompt_form(&server, &prompt, Some(user_message));
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: t!(
                        "tui.bottom_form.prompt_opened",
                        server = server,
                        prompt = prompt.name
                    )
                    .into_owned(),
                    tool_block: None,
                });
            }
        }
        true
    }
}

fn split_first_token(input: &str) -> Option<(&str, &str)> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return None;
    }

    for (idx, ch) in trimmed.char_indices() {
        if ch.is_whitespace() {
            let first = &trimmed[..idx];
            let rest = trimmed[idx..].trim();
            return Some((first, rest));
        }
    }

    Some((trimmed, ""))
}

fn truncate_rewind_preview(input: &str) -> String {
    let single_line = input.lines().next().unwrap_or("").trim();
    let chars = single_line.chars().collect::<Vec<_>>();
    if chars.len() <= 48 {
        return single_line.to_string();
    }

    let mut out = chars.into_iter().take(48).collect::<String>();
    out.push_str("...");
    out
}

fn format_extension_list_message(entries: &[CliExtensionEntry]) -> String {
    if entries.is_empty() {
        return t!("tui.extensions.list_empty").into_owned();
    }

    let mut lines = vec![t!("tui.extensions.list_header").into_owned()];
    for entry in entries {
        lines.push(format!("- {}", entry.display_name));
        lines.push(format!("  id: {}", entry.id));
        lines.push(format!("  version: {}", entry.version));
        if let Some(description) = entry
            .description
            .as_ref()
            .filter(|value| !value.trim().is_empty())
        {
            lines.push(format!("  description: {}", description));
        }
        if let Some(author) = entry
            .author
            .as_ref()
            .map(|value| value.name.trim())
            .filter(|value| !value.is_empty())
        {
            lines.push(format!("  author: {}", author));
        }
        if let Some(main) = entry.main.as_ref().filter(|value| !value.trim().is_empty()) {
            lines.push(format!("  main: {}", main));
        }
        if let Some(file_name) = entry
            .archive_file_name
            .as_ref()
            .filter(|value| !value.trim().is_empty())
        {
            lines.push(format!("  source: {}", file_name));
        }
    }

    lines.join("\n")
}

fn format_marketplace_list_message(entries: &[CliExtensionEntry]) -> String {
    if entries.is_empty() {
        return t!("tui.marketplace.list_empty").into_owned();
    }

    let mut lines = vec![t!("tui.marketplace.list_header").into_owned()];
    for entry in entries {
        lines.push(format!("- {}", entry.display_name));
        lines.push(format!("  id: {}", entry.id));
        lines.push(format!("  version: {}", entry.version));
        lines.push(format!(
            "  installed: {}",
            if entry.installed { "yes" } else { "no" }
        ));
        if let Some(description) = entry
            .description
            .as_ref()
            .filter(|value| !value.trim().is_empty())
        {
            lines.push(format!("  description: {}", description));
        }
        if let Some(source) = entry
            .install_source
            .as_ref()
            .filter(|value| !value.trim().is_empty())
        {
            lines.push(format!("  source: {}", source));
        }
    }

    lines.join("\n")
}
