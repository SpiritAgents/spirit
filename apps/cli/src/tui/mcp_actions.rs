use super::*;
use crate::ports::{McpStatusSnapshot, McpStatusState};

impl TuiShell {
    pub(super) fn push_mcp_usage(&mut self) {
        self.messages.push(ChatMessage {
            role: MessageRole::Agent,
            content: crate::locale::product_text("tui.mcp.usage").into_owned(),
            tool_block: None,
        });
    }

    pub(super) fn push_mcp_overview(&mut self) {
        match self.runtime.list_mcp_servers() {
            Ok(servers) if servers.is_empty() => {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: t!("tui.mcp.no_servers").into_owned(),
                    tool_block: None,
                });
            }
            Ok(servers) => {
                let summary = servers
                    .into_iter()
                    .map(|server| {
                        format!(
                            "- {} ({})  state={}  capabilities={}",
                            server.name,
                            server.display_name,
                            server.state.label(),
                            server.capability_summary(),
                        )
                    })
                    .collect::<Vec<_>>()
                    .join("\n");
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: t!("tui.mcp.overview", summary = summary).into_owned(),
                    tool_block: None,
                });
            }
            Err(err) => {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: t!("tui.mcp.overview_read_failed", err = err).into_owned(),
                    tool_block: None,
                });
            }
        }
    }

    pub(super) fn resolve_default_mcp_server(&mut self, purpose: &str) -> Option<String> {
        match self.runtime.list_mcp_servers() {
            Ok(servers) if servers.is_empty() => {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: t!("tui.mcp.no_servers").into_owned(),
                    tool_block: None,
                });
                None
            }
            Ok(servers) if servers.len() == 1 => Some(servers[0].name.clone()),
            Ok(servers) => {
                let names = servers
                    .into_iter()
                    .map(|server| server.name)
                    .collect::<Vec<_>>()
                    .join(", ");
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: t!(
                        "tui.mcp.server_required",
                        purpose = purpose,
                        servers = names
                    )
                    .into_owned(),
                    tool_block: None,
                });
                None
            }
            Err(err) => {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: t!("tui.mcp.servers_read_failed", err = err).into_owned(),
                    tool_block: None,
                });
                None
            }
        }
    }

    pub(super) fn server_exists(&mut self, name: &str) -> bool {
        self.runtime
            .list_mcp_servers()
            .map(|servers| servers.into_iter().any(|server| server.name == name))
            .unwrap_or(false)
    }

    pub(super) fn sync_mcp_status(&mut self) {
        let snapshot = self.runtime.mcp_status_snapshot();
        if snapshot.revision == self.last_mcp_status_revision {
            return;
        }
        logging::log_event(&format!(
            "[mcp] snapshot revision={} prev_revision={} state={:?} configured={} loaded={} cached_tools={} last_error={}",
            snapshot.revision,
            self.last_mcp_status_revision,
            snapshot.state,
            snapshot.configured_servers,
            snapshot.loaded_servers,
            snapshot.cached_tools,
            snapshot.last_error.as_deref().unwrap_or("<none>"),
        ));
        self.last_mcp_status_revision = snapshot.revision;
        self.refresh_prompt_slash_commands(&snapshot);
    }

    pub(super) fn refresh_prompt_slash_commands(&mut self, snapshot: &McpStatusSnapshot) {
        if !matches!(snapshot.state, McpStatusState::Ready) {
            if !self.slash.prompt_commands.is_empty() {
                self.slash.prompt_commands.clear();
                if self.current_slash_query().is_some() {
                    self.refresh_suggestions();
                }
            }
            return;
        }

        let commands = match self.build_prompt_slash_commands() {
            Ok(commands) => commands,
            Err(err) => {
                logging::log_event(&format!("[mcp] refresh prompt slash cache failed: {}", err));
                return;
            }
        };
        let changed = self.slash.prompt_commands != commands;
        self.slash.prompt_commands = commands;
        if changed && self.current_slash_query().is_some() {
            self.refresh_suggestions();
        }
    }

    fn build_prompt_slash_commands(&mut self) -> Result<Vec<slash::PromptSlashCommand>> {
        let prompt_servers = self.runtime.list_mcp_servers()?;
        let mut commands = Vec::new();
        for ManagedMcpServer {
            name,
            enabled,
            capabilities,
            ..
        } in prompt_servers
        {
            if !(enabled && capabilities.prompts) {
                continue;
            }

            let prompts = self.runtime.list_cached_mcp_prompts(&name)?;
            commands.extend(prompts.into_iter().map(|prompt| slash::PromptSlashCommand {
                alias: slash::prompt_slash_alias(&name, &prompt.name),
                server: name.clone(),
                prompt,
            }));
        }

        commands.sort_by(|left, right| left.alias.cmp(&right.alias));
        logging::log_event(&format!(
            "[mcp] refreshed prompt slash cache commands={}",
            commands.len()
        ));
        Ok(commands)
    }

    pub(super) fn apply_mcp_prompt_command(
        &mut self,
        server: &str,
        prompt: &str,
        args_json: Option<&str>,
        user_message: Option<&str>,
    ) -> bool {
        match self
            .runtime
            .apply_mcp_prompt(server, prompt, args_json, user_message)
        {
            Ok(_) => {
                self.apply_runtime_events();
                true
            }
            Err(err) => {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: t!("tui.mcp.prompt_apply_failed", err = err).into_owned(),
                    tool_block: None,
                });
                false
            }
        }
    }

    pub(super) fn resolve_mcp_prompt_definition(
        &mut self,
        server: &str,
        prompt_name: &str,
    ) -> Result<McpDiscoveredPrompt> {
        if let Some(prompt) = self
            .slash
            .prompt_commands
            .iter()
            .find(|candidate| candidate.server == server && candidate.prompt.name == prompt_name)
            .map(|candidate| candidate.prompt.clone())
        {
            return Ok(prompt);
        }

        if let Ok(prompts) = self.runtime.list_mcp_prompts(server)
            && let Some(prompt) = prompts
                .into_iter()
                .find(|prompt| prompt.name == prompt_name)
        {
            return Ok(prompt);
        }

        if let Ok(prompts) = self.runtime.list_cached_mcp_prompts(server)
            && let Some(prompt) = prompts
                .into_iter()
                .find(|prompt| prompt.name == prompt_name)
        {
            return Ok(prompt);
        }

        Err(anyhow!(
            t!(
                "tui.mcp.prompt_not_found",
                server = server,
                prompt = prompt_name
            )
            .into_owned()
        ))
    }
}

pub(super) fn non_empty_opt(input: &str) -> Option<&str> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

pub(super) enum PromptTail<'a> {
    Empty,
    ArgsJson(&'a str),
    UserMessage(&'a str),
}

pub(super) fn classify_prompt_tail<'a>(
    prompt: &McpDiscoveredPrompt,
    input: &'a str,
) -> PromptTail<'a> {
    let Some(tail) = non_empty_opt(input) else {
        return PromptTail::Empty;
    };

    if !prompt.arguments.is_empty() && looks_like_prompt_args_json(tail) {
        PromptTail::ArgsJson(tail)
    } else {
        PromptTail::UserMessage(tail)
    }
}

fn looks_like_prompt_args_json(input: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(input)
        .map(|value| value.is_object())
        .unwrap_or(false)
}
