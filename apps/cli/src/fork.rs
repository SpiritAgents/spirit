use crate::rewind::{ConversationMessageRole, ConversationMessageSnapshot};

/// Stackable fork title: `My Chat` → `(1) My Chat` → `(2) My Chat`.
pub fn derive_forked_session_display_name(source_display_name: &str) -> String {
    let trimmed = source_display_name.trim();
    if let Some(rest) = trimmed.strip_prefix('(')
        && let Some(close_paren) = rest.find(')')
    {
        let number_text = rest[..close_paren].trim();
        if let Ok(current) = number_text.parse::<u32>() {
            let base = rest[close_paren + 1..].trim_start();
            return format!("({}) {}", current + 1, base);
        }
    }
    format!("(1) {}", source_display_name)
}

pub fn resolve_fork_anchor_index(
    messages: &[ConversationMessageSnapshot],
    message_id: usize,
) -> Option<usize> {
    let index = messages
        .iter()
        .position(|message| message.id == message_id)?;
    let message = messages.get(index)?;
    if message.role != ConversationMessageRole::Assistant || message.pending {
        return None;
    }
    Some(index)
}

pub fn truncate_messages_through_index(
    messages: &[ConversationMessageSnapshot],
    index: usize,
) -> Vec<ConversationMessageSnapshot> {
    if index >= messages.len() {
        return Vec::new();
    }
    sanitize_truncated_messages_for_fork(&messages[..=index])
}

fn sanitize_truncated_messages_for_fork(
    messages: &[ConversationMessageSnapshot],
) -> Vec<ConversationMessageSnapshot> {
    messages
        .iter()
        .map(|message| ConversationMessageSnapshot {
            pending: false,
            ..message.clone()
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{
        derive_forked_session_display_name, resolve_fork_anchor_index,
        truncate_messages_through_index,
    };
    use crate::rewind::{ConversationMessageRole, ConversationMessageSnapshot};

    fn snapshot(
        id: usize,
        role: ConversationMessageRole,
        content: &str,
        pending: bool,
    ) -> ConversationMessageSnapshot {
        ConversationMessageSnapshot {
            id,
            role,
            content: content.to_string(),
            tool: None,
            aux: None,
            pending,
        }
    }

    #[test]
    fn derive_forked_session_display_name_stacks_prefix() {
        assert_eq!(derive_forked_session_display_name("My Chat"), "(1) My Chat");
        assert_eq!(
            derive_forked_session_display_name("(1) My Chat"),
            "(2) My Chat"
        );
        assert_eq!(
            derive_forked_session_display_name("(9) My Chat"),
            "(10) My Chat"
        );
    }

    #[test]
    fn resolve_fork_anchor_index_requires_completed_assistant() {
        let messages = vec![
            snapshot(1, ConversationMessageRole::User, "hi", false),
            snapshot(2, ConversationMessageRole::Assistant, "hello", false),
            snapshot(3, ConversationMessageRole::User, "again", false),
            snapshot(4, ConversationMessageRole::Assistant, "pending", true),
        ];
        assert_eq!(resolve_fork_anchor_index(&messages, 2), Some(1));
        assert_eq!(resolve_fork_anchor_index(&messages, 4), None);
        assert_eq!(resolve_fork_anchor_index(&messages, 1), None);
    }

    #[test]
    fn truncate_messages_through_index_is_inclusive_and_clears_pending() {
        let messages = vec![
            snapshot(1, ConversationMessageRole::User, "hi", false),
            snapshot(2, ConversationMessageRole::Assistant, "hello", true),
        ];
        let truncated = truncate_messages_through_index(&messages, 1);
        assert_eq!(truncated.len(), 2);
        assert!(!truncated[1].pending);
    }
}
