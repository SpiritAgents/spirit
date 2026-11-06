use std::time::{Duration, Instant};

use crate::view::{ChatMessage, ToolUiPhase};

const MOVE_BACKGROUND_HINT_DELAY: Duration = Duration::from_secs(10);

pub(crate) fn first_moveable_background_tool_call_id(messages: &[ChatMessage]) -> Option<&str> {
    messages.iter().find_map(|message| {
        let tool = message.tool_block.as_ref()?;
        if !matches!(tool.tool_name.as_str(), "shell" | "subagent")
            || tool.phase != ToolUiPhase::Running
            || tool.metadata.contains_key("backgroundTask")
            || tool.metadata.contains_key("taskNotification")
        {
            return None;
        }
        tool.tool_call_id
            .as_deref()
            .map(str::trim)
            .filter(|tool_call_id| !tool_call_id.is_empty())
    })
}

#[derive(Default)]
pub(crate) struct MoveBackgroundHintState {
    target: Option<(String, Instant)>,
}

impl MoveBackgroundHintState {
    pub(crate) fn sync(&mut self, messages: &[ChatMessage], now: Instant) {
        let target_id = first_moveable_background_tool_call_id(messages).map(str::to_owned);
        if self.target_id() == target_id.as_deref() {
            return;
        }
        self.target = target_id.map(|tool_call_id| (tool_call_id, now));
    }

    pub(crate) fn visible(&self, now: Instant) -> bool {
        self.target.as_ref().is_some_and(|(_, started_at)| {
            now.duration_since(*started_at) >= MOVE_BACKGROUND_HINT_DELAY
        })
    }

    fn target_id(&self) -> Option<&str> {
        self.target
            .as_ref()
            .map(|(tool_call_id, _)| tool_call_id.as_str())
    }
}

#[cfg(test)]
mod tests {
    use serde_json::Map;

    use super::*;
    use crate::view::{MessageRole, ToolUiBlock};

    fn tool_message(tool_call_id: &str, tool_name: &str, phase: ToolUiPhase) -> ChatMessage {
        ChatMessage::with_tool_block(
            MessageRole::Agent,
            "",
            ToolUiBlock {
                metadata: Map::new(),
                tool_call_id: Some(tool_call_id.to_string()),
                tool_name: tool_name.to_string(),
                phase,
                headline: String::new(),
                detail_lines: Vec::new(),
                image_paths: Vec::new(),
                video_paths: Vec::new(),
                args_excerpt: None,
                output_excerpt: None,
                suppress_expand: None,
            },
        )
    }

    #[test]
    fn selects_the_first_running_shell_or_subagent() {
        let messages = vec![
            tool_message("done", "shell", ToolUiPhase::Succeeded),
            tool_message("approval", "shell", ToolUiPhase::PendingApproval),
            tool_message("first", "subagent", ToolUiPhase::Running),
            tool_message("second", "shell", ToolUiPhase::Running),
        ];
        assert_eq!(
            first_moveable_background_tool_call_id(&messages),
            Some("first")
        );
    }

    #[test]
    fn ignores_calls_that_are_already_backgrounded() {
        let mut message = tool_message("detached", "shell", ToolUiPhase::Running);
        message.tool_block.as_mut().expect("tool").metadata.insert(
            "backgroundTask".to_string(),
            serde_json::json!({ "id": "task" }),
        );
        assert_eq!(first_moveable_background_tool_call_id(&[message]), None);
    }

    #[test]
    fn shows_the_hint_after_ten_seconds_on_the_same_target() {
        let now = Instant::now();
        let messages = vec![tool_message("call", "shell", ToolUiPhase::Running)];
        let mut state = MoveBackgroundHintState::default();
        state.sync(&messages, now);
        assert!(!state.visible(now + Duration::from_secs(9)));
        assert!(state.visible(now + MOVE_BACKGROUND_HINT_DELAY));

        let next_messages = vec![tool_message("next", "shell", ToolUiPhase::Running)];
        state.sync(&next_messages, now + MOVE_BACKGROUND_HINT_DELAY);
        assert!(!state.visible(now + MOVE_BACKGROUND_HINT_DELAY));
        assert!(state.visible(now + Duration::from_secs(20)));
    }
}
