//! TUI slash command helpers.

use crate::{
    locale,
    mcp_types::McpDiscoveredPrompt,
    tui::TuiShell,
    view::{InputSuggestion, MainInputMode},
};
use rust_i18n::t;

#[derive(Debug, Default)]
pub(crate) struct SlashState {
    pub(crate) commands: Vec<String>,
    pub(crate) prompt_commands: Vec<PromptSlashCommand>,
    pub(crate) suggestions: Vec<InputSuggestion>,
    pub(crate) selected_suggestion: usize,
}

impl SlashState {
    pub(crate) fn new() -> Self {
        Self {
            commands: default_commands(),
            prompt_commands: Vec::new(),
            suggestions: Vec::new(),
            selected_suggestion: 0,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct PromptSlashCommand {
    pub(crate) alias: String,
    pub(crate) server: String,
    pub(crate) prompt: McpDiscoveredPrompt,
}

const START_IMPLEMENTING_SLASH: &str = "/start-implementing";

const DEFAULT_SLASH_COMMANDS: &[&str] = &[
    "/help",
    "/clear",
    "/new",
    "/quit",
    "/exit",
    "/continue",
    "/loop",
    "/model",
    "/compact",
    "/sessions",
    "/rewind",
    "/fork",
    "/subagents",
    "/image",
    "/mcp",
    "/hooks",
    "/rules",
    "/skills",
    "/extensions",
    "/log",
    "/language",
    "/approval",
    "/networks",
    "/tui",
];

const RESERVED_SLASH_COMMANDS: &[&str] = &[
    "/help",
    "/clear",
    "/new",
    "/quit",
    "/exit",
    "/continue",
    "/loop",
    START_IMPLEMENTING_SLASH,
    "/model",
    "/compact",
    "/sessions",
    "/rewind",
    "/fork",
    "/subagents",
    "/image",
    "/mcp",
    "/hooks",
    "/rules",
    "/skills",
    "/extensions",
    "/log",
    "/language",
    "/approval",
    "/networks",
    "/tui",
];

pub(crate) fn default_commands() -> Vec<String> {
    DEFAULT_SLASH_COMMANDS
        .iter()
        .map(|command| (*command).to_string())
        .collect()
}

pub(crate) fn slash_commands_for_shell(shell: &TuiShell) -> Vec<String> {
    let mut commands = default_commands();
    if shell.has_active_plan()
        && let Some(index) = commands.iter().position(|command| command == "/compact")
    {
        commands.insert(index, START_IMPLEMENTING_SLASH.to_string());
    }
    commands
}

pub(crate) fn current_query(input: &str) -> Option<&str> {
    if !input.starts_with('/') || input.contains('\n') {
        return None;
    }
    Some(input)
}

pub(crate) fn compute_suggestions(
    shell: &mut TuiShell,
    query: &str,
    slash_commands: &[String],
) -> Vec<InputSuggestion> {
    let mut suggestions = slash_commands
        .iter()
        .filter(|cmd| command_visible(shell, cmd))
        .filter(|cmd| cmd.starts_with(query))
        .map(|cmd| command_suggestion(cmd))
        .collect::<Vec<_>>();

    suggestions.extend(prompt_alias_suggestions(shell, query));
    suggestions.extend(skill_alias_suggestions(shell, query));

    if suggestions.is_empty() {
        suggestions = contextual_suggestions(shell, query);
    }

    suggestions
}

fn command_suggestion(command: &str) -> InputSuggestion {
    InputSuggestion {
        label: command.to_string(),
        replacement: command_replacement(command),
        summary: String::new(),
        details: Vec::new(),
    }
}

fn command_replacement(command: &str) -> String {
    match command {
        "/model" | "/sessions" | "/rewind" | "/fork" | "/subagents" | "/image" | "/mcp"
        | "/hooks" | "/log" | "/language" | "/approval" | "/networks" | "/tui" | "/extensions" => {
            format!("{} ", command)
        }
        _ => command.to_string(),
    }
}

/// When the user continues past the primary slash command (e.g. `/model add …`), top-level
/// [`slash_commands`] no longer prefix-match, so we fall back here. We intentionally return a
/// **single** suggestion whose `label` is the primary command (e.g. `/model`) so the TUI can show
/// the static usage block (`ui.rs` only renders it when there is exactly one slash suggestion).
/// `replacement` preserves the full query so applying the suggestion does not erase typed args.
fn primary_help_suggestion(primary: &str, query: &str) -> InputSuggestion {
    InputSuggestion {
        label: primary.to_string(),
        replacement: query.to_string(),
        summary: String::new(),
        details: Vec::new(),
    }
}

fn contextual_suggestions(shell: &mut TuiShell, query: &str) -> Vec<InputSuggestion> {
    if query == "/model" || query.starts_with("/model ") {
        return vec![primary_help_suggestion("/model", query)];
    }

    if shell.can_continue_last_turn() && (query == "/continue" || query.starts_with("/continue ")) {
        return vec![primary_help_suggestion("/continue", query)];
    }

    if query == "/loop" || query.starts_with("/loop ") {
        return vec![primary_help_suggestion("/loop", query)];
    }

    if shell.has_active_plan()
        && (query == START_IMPLEMENTING_SLASH
            || query.starts_with(format!("{START_IMPLEMENTING_SLASH} ").as_str()))
    {
        return vec![primary_help_suggestion(START_IMPLEMENTING_SLASH, query)];
    }

    if query == "/sessions" || query.starts_with("/sessions ") {
        return vec![primary_help_suggestion("/sessions", query)];
    }

    if query == "/rewind" || query.starts_with("/rewind ") {
        return vec![primary_help_suggestion("/rewind", query)];
    }
    if query == "/fork" || query.starts_with("/fork ") {
        return vec![primary_help_suggestion("/fork", query)];
    }

    if query == "/subagents" || query.starts_with("/subagents ") {
        return vec![primary_help_suggestion("/subagents", query)];
    }

    if query == "/image" || query.starts_with("/image ") {
        return vec![primary_help_suggestion("/image", query)];
    }

    if query == "/mcp" || query.starts_with("/mcp ") {
        return vec![primary_help_suggestion("/mcp", query)];
    }

    if query == "/hooks" || query.starts_with("/hooks ") {
        return vec![primary_help_suggestion("/hooks", query)];
    }

    if query == "/rules" || query.starts_with("/rules ") {
        return vec![primary_help_suggestion("/rules", query)];
    }

    if query == "/skills" || query.starts_with("/skills ") {
        return vec![primary_help_suggestion("/skills", query)];
    }

    if query == "/extensions" || query.starts_with("/extensions ") {
        return vec![primary_help_suggestion("/extensions", query)];
    }

    if query == "/log" || query.starts_with("/log ") {
        return vec![primary_help_suggestion("/log", query)];
    }

    if query == "/language" || query.starts_with("/language ") {
        return vec![primary_help_suggestion("/language", query)];
    }
    if query == "/approval" || query.starts_with("/approval ") {
        return vec![primary_help_suggestion("/approval", query)];
    }
    if query == "/networks" || query.starts_with("/networks ") {
        return vec![primary_help_suggestion("/networks", query)];
    }
    if query == "/tui" || query.starts_with("/tui ") {
        return vec![primary_help_suggestion("/tui", query)];
    }

    Vec::new()
}

fn skill_alias_suggestions(shell: &mut TuiShell, query: &str) -> Vec<InputSuggestion> {
    shell
        .enabled_skill_entries()
        .filter_map(|entry| {
            let alias = skill_slash_alias(&entry.source.name);
            if !alias.starts_with(query) || is_reserved_skill_alias(shell, &alias) {
                return None;
            }

            Some(InputSuggestion {
                label: alias.clone(),
                replacement: format!("{} ", alias),
                summary: entry.source.description.clone(),
                details: vec![format!("path: {}", entry.source.path.display())],
            })
        })
        .collect()
}

fn prompt_alias_suggestions(shell: &mut TuiShell, query: &str) -> Vec<InputSuggestion> {
    let mut commands = shell.prompt_slash_commands().to_vec();
    commands.retain(|command| command.alias.starts_with(query));
    commands.into_iter().map(prompt_suggestion).collect()
}

pub(crate) fn resolve_prompt_slash_command(
    shell: &TuiShell,
    command: &str,
) -> Option<PromptSlashCommand> {
    let normalized = command.trim();
    shell
        .prompt_slash_commands()
        .iter()
        .cloned()
        .into_iter()
        .find(|candidate| candidate.alias == normalized)
}

pub(crate) fn resolve_skill_slash_command(shell: &TuiShell, command: &str) -> Option<String> {
    let normalized = command.trim();
    shell.enabled_skill_entries().find_map(|entry| {
        let alias = skill_slash_alias(&entry.source.name);
        if alias == normalized && !is_reserved_skill_alias(shell, &alias) {
            Some(entry.source.name.clone())
        } else {
            None
        }
    })
}

pub(crate) fn prompt_slash_alias(server: &str, prompt_name: &str) -> String {
    format!("/{}_{}", server, prompt_name)
}

pub(crate) fn skill_slash_alias(skill_name: &str) -> String {
    format!("/{}", skill_name)
}

fn is_reserved_skill_alias(shell: &TuiShell, alias: &str) -> bool {
    RESERVED_SLASH_COMMANDS.contains(&alias)
        || shell
            .prompt_slash_commands()
            .iter()
            .any(|command| command.alias == alias)
}

fn prompt_suggestion(command: PromptSlashCommand) -> InputSuggestion {
    let PromptSlashCommand {
        alias,
        server,
        prompt,
    } = command;
    let replacement = if prompt.arguments.is_empty() {
        alias.clone()
    } else {
        format!("{} ", alias)
    };

    let required_args = prompt
        .arguments
        .iter()
        .filter(|argument| argument.required)
        .map(|argument| argument.name.clone())
        .collect::<Vec<_>>();
    let summary = prompt
        .description
        .clone()
        .or_else(|| prompt.title.clone())
        .unwrap_or_else(|| {
            if prompt.arguments.is_empty() {
                "MCP prompt".to_string()
            } else {
                t!(
                    "tui.slash.prompt_args_count",
                    count = prompt.arguments.len()
                )
                .into_owned()
            }
        });

    let mut details = vec![format!("server: {}", server)];
    if !required_args.is_empty() {
        details.push(
            t!(
                "tui.slash.prompt_required_args",
                args = required_args.join(", ")
            )
            .into_owned(),
        );
    } else if !prompt.arguments.is_empty() {
        details.push(
            t!(
                "tui.slash.prompt_optional_args",
                count = prompt.arguments.len()
            )
            .into_owned(),
        );
    }

    InputSuggestion {
        label: alias,
        replacement,
        summary,
        details,
    }
}

fn command_visible_in_mode(_command: &str, _input_mode: MainInputMode) -> bool {
    true
}

fn command_visible(shell: &TuiShell, command: &str) -> bool {
    match command {
        "/continue" => shell.can_continue_last_turn(),
        START_IMPLEMENTING_SLASH => shell.has_active_plan(),
        _ => command_visible_in_mode(command, shell.input_mode()),
    }
}

pub(crate) fn help_text(has_active_plan: bool, can_continue_last_turn: bool) -> String {
    let mut lines = vec![
        t!("tui.help.available_commands").into_owned(),
        "- /help".to_string(),
        "- /clear".to_string(),
        "- /new".to_string(),
        "- /quit".to_string(),
    ];

    if can_continue_last_turn {
        lines.push("- /continue".to_string());
    }

    if has_active_plan {
        lines.push(format!("- {START_IMPLEMENTING_SLASH}"));
    }
    lines.push("- /loop [on|off|status]".to_string());

    lines.extend([
        "- /model [list|use <name>|add|add <name> <api_base> <api_key>|remove <name>]".to_string(),
        "- /compact".to_string(),
        "- /sessions".to_string(),
        "- /sessions save [path]".to_string(),
        "- /sessions load <file>".to_string(),
        "- /rewind".to_string(),
        "- /rewind <index> [new_message]".to_string(),
        "- /fork".to_string(),
        "- /subagents [list|open <session_id>|close]".to_string(),
        "- /image <path> [prompt]".to_string(),
        "- /image pick".to_string(),
        "- /image clear".to_string(),
        "- /mcp [list|add|inspect|tools|resources|prompts]".to_string(),
        "- /hooks [list|add]".to_string(),
        "- /<server>_<prompt> [args_json | user_message]".to_string(),
        "- /rules".to_string(),
        "- /skills".to_string(),
        "- /extensions [list|import <zip>|remove <id>]".to_string(),
        t!("tui.help.skill_usage").into_owned(),
        t!("tui.help.log_variants").into_owned(),
        format!("- /language [{}]", locale::available_ui_locales_csv()),
        "".to_string(),
        t!("tui.help.notes_header").into_owned(),
    ]);

    if can_continue_last_turn {
        lines.push(t!("tui.help.continue").into_owned());
    }

    lines.extend([
        t!("tui.session.help.open_selector").into_owned(),
        t!("tui.session.help.rewind").into_owned(),
        t!("tui.session.help.fork").into_owned(),
        t!("tui.loop.help").into_owned(),
        t!("tui.help.subagents").into_owned(),
        t!("tui.help.image_pick").into_owned(),
        t!("tui.help.image_queue").into_owned(),
        t!("tui.help.file_reference").into_owned(),
        t!("tui.help.mcp_add").into_owned(),
        t!("tui.help.hooks_add").into_owned(),
        t!("tui.help.model_add").into_owned(),
        t!("tui.help.mcp_prompt_alias").into_owned(),
        t!("tui.help.mcp_prompt_form").into_owned(),
        t!("tui.help.rules").into_owned(),
        t!("tui.help.skills").into_owned(),
        t!("tui.help.extensions").into_owned(),
        t!("tui.help.skill_alias").into_owned(),
        t!("tui.help.mcp_server_optional").into_owned(),
        t!("tui.help.log").into_owned(),
        t!("tui.help.language").into_owned(),
        t!("tui.help.approval").into_owned(),
        t!("tui.help.networks").into_owned(),
        t!("tui.tui.help").into_owned(),
        t!("tui.help.mouse").into_owned(),
        t!("tui.help.ctrl_o").into_owned(),
        "".to_string(),
        t!("tui.help.api_key_priority").into_owned(),
    ]);

    lines.join("\n")
}

pub(crate) fn handle_command(shell: &mut TuiShell, message: &str) {
    if shell.handle_prompt_alias_slash(message) {
        return;
    }

    let parts: Vec<&str> = message.split_whitespace().collect();
    let Some(cmd) = parts.first().copied() else {
        return;
    };

    match cmd {
        "/quit" | "/exit" => {
            shell.push_agent_message(t!("tui.quit.message").into_owned());
            shell.request_quit();
        }
        "/help" => shell.push_agent_message(help_text(
            shell.has_active_plan(),
            shell.can_continue_last_turn(),
        )),
        "/clear" | "/new" => shell.start_new_session_for_slash(),
        "/continue" => shell.handle_continue_slash(),
        "/loop" => shell.handle_loop_slash(&parts[1..]),
        START_IMPLEMENTING_SLASH => shell.handle_start_implementing_slash(),
        "/model" => shell.handle_model_slash(&parts[1..]),
        "/compact" => shell.compact_history_for_slash(),
        "/sessions" => shell.handle_sessions_slash(message),
        "/rewind" => shell.handle_rewind_slash(message),
        "/fork" => shell.handle_fork_slash(message),
        "/subagents" => shell.handle_subagents_slash(message),
        "/image" => shell.handle_image_slash(message),
        "/mcp" => shell.handle_mcp_slash(message),
        "/hooks" => shell.handle_hooks_slash(message),
        "/rules" => shell.handle_rules_slash(&parts[1..]),
        "/skills" => shell.handle_skills_slash(&parts[1..]),
        "/extensions" => shell.handle_extensions_slash(message),
        "/log" => shell.handle_log_slash(&parts[1..]),
        "/language" => shell.handle_language_slash(&parts[1..]),
        "/approval" => shell.handle_approval_slash(&parts[1..]),
        "/networks" => shell.handle_networks_slash(&parts[1..]),
        "/tui" => shell.handle_tui_slash(&parts[1..]),
        _ => {
            if !shell.handle_skill_alias_slash(message) {
                shell.push_agent_message(t!("tui.slash.unknown_command").into_owned());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn current_query_rejects_multiline_input_and_preserves_trailing_space() {
        assert_eq!(current_query("/mcp list"), Some("/mcp list"));
        assert_eq!(
            current_query("/github_issue_to_fix_workflow "),
            Some("/github_issue_to_fix_workflow ")
        );
        assert_eq!(current_query("/mcp\nlist"), None);
        assert_eq!(current_query("hello"), None);
    }

    #[test]
    fn prompt_slash_alias_joins_server_and_prompt_name() {
        assert_eq!(
            prompt_slash_alias("github", "issue_to_fix_workflow"),
            "/github_issue_to_fix_workflow"
        );
    }

    #[test]
    fn default_commands_include_new_session_slash() {
        let commands = default_commands();
        assert!(commands.contains(&"/new".to_string()));
        assert!(commands.contains(&"/clear".to_string()));
    }

    #[test]
    fn help_text_mentions_bottom_form_shortcuts() {
        let help = help_text(false, false);

        assert!(help.contains("/mcp add"));
        assert!(help.contains("/model add"));
        assert!(help.contains(t!("tui.help.mcp_add").as_ref()));
        assert!(help.contains("/rules"));
        assert!(help.contains("/skills"));
        assert!(help.contains("/extensions"));
        assert!(help.contains("/tui"));
        assert!(help.contains(t!("tui.help.extensions").as_ref()));
        assert!(help.contains(t!("tui.help.skill_usage").as_ref()));
        assert!(help.contains(t!("tui.help.hooks_add").as_ref()));
        assert!(help.contains(t!("tui.help.file_reference").as_ref()));
    }

    #[test]
    fn default_commands_hide_legacy_skill_alias() {
        let commands = default_commands();
        assert!(commands.contains(&"/skills".to_string()));
        assert!(commands.contains(&"/extensions".to_string()));
        assert_eq!(
            commands,
            DEFAULT_SLASH_COMMANDS
                .iter()
                .map(|command| (*command).to_string())
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn start_implementing_command_only_appears_with_active_plan() {
        assert!(!help_text(false, false).contains(START_IMPLEMENTING_SLASH));
        assert!(help_text(true, false).contains(START_IMPLEMENTING_SLASH));
    }

    #[test]
    fn continue_command_only_appears_when_available() {
        assert!(!help_text(false, false).contains("/continue"));
        assert!(help_text(false, true).contains("/continue"));
    }

    #[test]
    fn skill_slash_alias_is_first_level() {
        assert_eq!(skill_slash_alias("llm-debug"), "/llm-debug");
    }

    #[test]
    fn extensions_command_completion_appends_space() {
        assert_eq!(command_replacement("/extensions"), "/extensions ");
    }

    #[test]
    fn extensions_context_keeps_primary_help_suggestion() {
        let suggestion = primary_help_suggestion("/extensions", "/extensions ");

        assert_eq!(suggestion.label, "/extensions");
        assert_eq!(suggestion.replacement, "/extensions ");
    }
}
