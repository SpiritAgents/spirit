use super::*;

impl TuiShell {
    pub(super) fn push_hooks_usage(&mut self) {
        self.messages.push(ThreadMessage {
            role: MessageRole::Agent,
            content: t!("tui.hooks.usage").into_owned(),
            tool_block: None,
        });
    }

    pub(super) fn push_hooks_overview(&mut self) {
        match self.runtime.list_hook_entries() {
            Ok(items) if items.is_empty() => {
                self.messages.push(ThreadMessage {
                    role: MessageRole::Agent,
                    content: t!("tui.hooks.empty").into_owned(),
                    tool_block: None,
                });
            }
            Ok(items) => {
                let summary = items
                    .into_iter()
                    .map(|item| {
                        format!(
                            "- {} ({}) #{}  {}",
                            item.event,
                            hook_scope_label(&item.scope),
                            item.index,
                            item.command,
                        )
                    })
                    .collect::<Vec<_>>()
                    .join("\n");
                self.messages.push(ThreadMessage {
                    role: MessageRole::Agent,
                    content: t!("tui.hooks.overview", summary = summary).into_owned(),
                    tool_block: None,
                });
            }
            Err(err) => {
                self.messages.push(ThreadMessage {
                    role: MessageRole::Agent,
                    content: t!("tui.hooks.list_failed", err = err).into_owned(),
                    tool_block: None,
                });
            }
        }
    }
}

fn hook_scope_label(scope: &str) -> String {
    if scope == "workspace" {
        t!("tui.hooks.scope.workspace").into_owned()
    } else {
        t!("tui.hooks.scope.user").into_owned()
    }
}
