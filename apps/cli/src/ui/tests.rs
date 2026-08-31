use super::*;
use crate::{
    model_registry::AppConfig,
    ports::{ChatSessionListItem, SubagentSessionStatus},
    view::{
        AssistantAuxData, BottomFormFieldEditorView, BottomFormFieldView, BottomFormView,
        ForkPickerView, MainInputMode, PendingAssistantAux, PendingSubagentApprovalView,
        RewindPickerView, SubagentSessionDetailView, SubagentSessionSummaryView,
    },
};
use ratatui::{Terminal, backend::TestBackend};
use rust_i18n::t;
use std::{collections::HashMap, fs};
use unicode_width::UnicodeWidthStr;

fn render_text_lines(lines: Vec<Line<'static>>) -> Vec<String> {
    lines
        .into_iter()
        .map(|line| {
            line.spans
                .into_iter()
                .map(|span| span.content.into_owned().replace('\u{00a0}', " "))
                .collect::<String>()
        })
        .collect()
}

fn render_ui_lines(app: &TuiViewModel, width: u16, height: u16) -> Vec<String> {
    render_ui_snapshot(app, width, height).0
}

fn render_ui_snapshot(
    app: &TuiViewModel,
    width: u16,
    height: u16,
) -> (Vec<String>, ratatui::buffer::Buffer) {
    let backend = TestBackend::new(width, height);
    let mut terminal = Terminal::new(backend).expect("test terminal initializes");
    let mut runtime = UiRuntimeState::default();
    terminal
        .draw(|frame| {
            draw_ui(frame, app, &mut runtime);
        })
        .expect("ui renders");

    let buffer = terminal.backend().buffer().clone();
    let lines = (0..height)
        .map(|y| {
            let mut line = String::new();
            for x in 0..width {
                line.push_str(buffer[(x, y)].symbol());
            }
            line
        })
        .collect();

    (lines, buffer)
}

fn test_image_path(label: &str) -> std::path::PathBuf {
    let unique = uuid::Uuid::new_v4().simple().to_string();
    let short = &unique[..8];
    std::env::temp_dir().join(format!("spirit-ui-{label}-{short}.png"))
}

fn build_view_model(message: ChatMessage) -> TuiViewModel {
    TuiViewModel {
        input: String::new(),
        input_cursor: 0,
        input_mode: MainInputMode::Agent,
        shell_mode_active: false,
        pending_image_paths: vec![],
        pending_mcp_resources: vec![],
        loop_enabled: false,
        approval_level: "default".to_string(),
        history_truncated_before: 0,
        messages: vec![message],
        assistant_aux_by_message: HashMap::new(),
        config: AppConfig::default(),
        show_aux_details: true,
        input_suggestion_kind: None,
        input_suggestion_loading: false,
        slash_suggestions: vec![],
        selected_suggestion: 0,
        rewind_picker: None,
        fork_picker: None,
        model_picker_active: false,
        model_picker_index: 0,
        model_display_titles: HashMap::new(),
        language_picker_active: false,
        language_picker_index: 0,
        approval_picker_active: false,
        approval_picker_index: 0,
        network_picker_active: false,
        network_picker_index: 0,
        tui_picker_active: false,
        tui_picker_index: 0,
        chat_picker_active: false,
        chat_picker_index: 0,
        chat_picker_sessions: vec![],
        subagent_picker_active: false,
        subagent_picker_index: 0,
        subagent_sessions: vec![],
        subagent_view: None,
        subagent_history_offset_from_bottom: 0,
        pending_subagent_approval: None,
        subagent_approval_input: None,
        image_picker_active: false,
        image_picker_index: 0,
        image_picker_files: vec![],
        bottom_form: None,
        history_offset_from_bottom: 0,
        pending_response_active: false,
        pending_assistant_msg_index: None,
        pending_aux: None,
        thinking_spinner_index: 0,
        persisted_standalone_pending_aux: None,
        persisted_standalone_pending_aux_anchor: None,
        cli_ui_hooks: vec![],
        todo_strip: None,
        conversation_sel_anchor: None,
        conversation_sel_head: None,
        inline_mode: false,
        committed_history_lines: 0,
    }
}

fn build_bottom_form_view(value: &str, footer_hint: &str) -> BottomFormView {
    BottomFormView {
        kind: crate::view::BottomFormKind::McpAdd,
        title: "Add MCP Server".to_string(),
        fields: vec![
            BottomFormFieldView {
                label: "Name".to_string(),
                help: String::new(),
                editor: BottomFormFieldEditorView::Text {
                    value: "github".to_string(),
                    placeholder: "Name, for example github".to_string(),
                    cursor: 0,
                    mask: false,
                    disabled: false,
                },
            },
            BottomFormFieldView {
                label: "Save Location".to_string(),
                help: String::new(),
                editor: BottomFormFieldEditorView::Choice {
                    options: vec!["User".to_string(), "Workspace .spirit".to_string()],
                    selected: 1,
                },
            },
            BottomFormFieldView {
                label: "Type".to_string(),
                help: String::new(),
                editor: BottomFormFieldEditorView::Choice {
                    options: vec!["STDIO".to_string(), "HTTP".to_string()],
                    selected: 0,
                },
            },
            BottomFormFieldView {
                label: "Command".to_string(),
                help: String::new(),
                editor: BottomFormFieldEditorView::Text {
                    value: value.to_string(),
                    placeholder: "Command, for example npx -y @modelcontextprotocol/server-github"
                        .to_string(),
                    cursor: 0,
                    mask: false,
                    disabled: false,
                },
            },
            BottomFormFieldView {
                label: "Environment Variables".to_string(),
                help: String::new(),
                editor: BottomFormFieldEditorView::Text {
                    value: "GITHUB_TOKEN=demo".to_string(),
                    placeholder: "Environment variables, optional, for example GITHUB_TOKEN=demo"
                        .to_string(),
                    cursor: 0,
                    mask: false,
                    disabled: false,
                },
            },
        ],
        selected_field: 2,
        scroll_offset: 0,
        footer_hint: footer_hint.to_string(),
    }
}

fn chat_picker_item(path: &str, display_name: &str) -> ChatSessionListItem {
    ChatSessionListItem {
        path: path.to_string(),
        display_name: display_name.to_string(),
        modified_at_unix_ms: 0,
    }
}

fn chat_picker_item_at(
    path: &str,
    display_name: &str,
    modified_at_unix_ms: u128,
) -> ChatSessionListItem {
    ChatSessionListItem {
        path: path.to_string(),
        display_name: display_name.to_string(),
        modified_at_unix_ms,
    }
}

fn build_subagent_detail_view(
    pending_aux: Option<PendingAssistantAux>,
) -> SubagentSessionDetailView {
    SubagentSessionDetailView {
        summary: SubagentSessionSummaryView {
            session_id: "subagent-1".to_string(),
            title: "Check sub-session status".to_string(),
            status: crate::ports::SubagentSessionStatus::Running,
            updated_at_unix_ms: 0,
            latest_message: None,
        },
        messages: vec![],
        pending_aux,
        final_output: None,
        error: None,
    }
}

#[test]
fn bottom_form_block_height_grows_for_multiline_text() {
    let single = build_bottom_form_view(
        "npx -y @modelcontextprotocol/server-github",
        "Enter Save Esc Cancel",
    );
    let multi = build_bottom_form_view(
        "npx -y @modelcontextprotocol/server-github\n--stdio\n--verbose",
        "Enter Save Esc Cancel",
    );

    assert!(bottom_form_block_height(&multi, 80) > bottom_form_block_height(&single, 80));
}

#[test]
fn bottom_form_block_height_grows_for_wrapped_footer_hint() {
    let form = build_bottom_form_view(
        "npx -y @modelcontextprotocol/server-github",
        "↑/↓ Switch field  ←/→ Move cursor or switch type  Enter Save  Shift+Enter New line  Esc Cancel",
    );

    assert!(bottom_form_block_height(&form, 28) > bottom_form_block_height(&form, 96));
}

#[test]
fn input_cursor_matches_wrapped_render_for_exact_width_line_before_newline() {
    let mut app = build_view_model(ChatMessage::new(MessageRole::Agent, "welcome"));
    app.input = "你好你好\nA".to_string();
    app.input_cursor = app.input.chars().count();

    let lines = render_text_lines(build_input_lines(&app, 8, false));
    let (row, col) = input_cursor_position(&app, 8);

    assert_eq!(lines, vec!["你好你好", "A"]);
    assert_eq!((row, col), (1, 1));
}

#[test]
fn input_cursor_moves_to_trailing_empty_row_when_last_line_fills_width() {
    let mut app = build_view_model(ChatMessage::new(MessageRole::Agent, "welcome"));
    app.input = "你好你好".to_string();
    app.input_cursor = app.input.chars().count();

    let lines = render_text_lines(build_input_lines(&app, 8, false));
    let (row, col) = input_cursor_position(&app, 8);

    assert_eq!(lines, vec!["你好你好", ""]);
    assert_eq!((row, col), (1, 0));
}

#[test]
fn plan_mode_input_uses_yellow_border_and_text_and_plan_title() {
    let title = input_mode_title(MainInputMode::Plan);
    let border = input_block_border_style(false, MainInputMode::Plan, false);
    let text = input_text_style(false, MainInputMode::Plan, false);

    assert_eq!(title, t!("ui.input.title_plan").into_owned());
    assert_eq!(border.fg, Some(Color::Yellow));
    assert_eq!(text.fg, Some(Color::Yellow));
}

#[test]
fn agent_mode_input_softens_only_border_text_stays_white() {
    let border = input_block_border_style(false, MainInputMode::Agent, false);
    let text = input_text_style(false, MainInputMode::Agent, false);

    assert_eq!(border.fg, conversation_body_text_style().fg);
    assert_eq!(text.fg, Some(Color::White));
}

#[test]
fn footer_shows_mode_without_tab_toggle_hint() {
    let agent_footer = render_text_lines(vec![build_footer_line(
        &build_view_model(ChatMessage::new(MessageRole::Agent, "welcome")),
        80,
    )]);

    let mut plan_app = build_view_model(ChatMessage::new(MessageRole::Agent, "welcome"));
    plan_app.input_mode = MainInputMode::Plan;
    let plan_footer = render_text_lines(vec![build_footer_line(&plan_app, 80)]);

    assert!(!agent_footer[0].contains("Tab"));
    assert!(!plan_footer[0].contains("Tab"));
    assert!(agent_footer[0].contains(t!("ui.footer.mode.agent").as_ref()));
    assert!(plan_footer[0].contains(t!("ui.footer.mode.plan").as_ref()));
    assert!(!agent_footer[0].contains(t!("ui.footer.preview").as_ref()));
    assert!(agent_footer[0].contains(t!("ui.footer.approval.default").as_ref()));
    let approval_pos = agent_footer[0]
        .find(t!("ui.footer.approval.default").as_ref())
        .expect("approval label");
    let loop_pos = agent_footer[0]
        .find(t!("ui.footer.loop.off").as_ref())
        .expect("loop label");
    assert!(
        approval_pos < loop_pos,
        "approval should appear before loop in footer"
    );
}

#[test]
fn footer_auto_approval_uses_blue_style() {
    let mut app = build_view_model(ChatMessage::new(MessageRole::Agent, "welcome"));
    app.approval_level = "auto-approval".to_string();
    let line = build_footer_line(&app, 80);
    assert!(
        line.spans
            .iter()
            .any(|span| { span.style.fg == Some(Color::Rgb(96, 165, 250)) })
    );
}

#[test]
fn footer_bypass_approval_uses_yellow_style() {
    let mut app = build_view_model(ChatMessage::new(MessageRole::Agent, "welcome"));
    app.approval_level = "bypass-approval".to_string();
    let line = build_footer_line(&app, 80);
    assert!(
        line.spans
            .iter()
            .any(|span| span.style.fg == Some(Color::Yellow))
    );
}

#[test]
fn inline_picker_window_keeps_selection_near_middle() {
    assert_eq!(inline_picker_bounds(8, 0, 5), (0, 5));
    assert_eq!(inline_picker_bounds(8, 2, 5), (0, 5));
    assert_eq!(inline_picker_bounds(8, 3, 5), (1, 6));
    assert_eq!(inline_picker_bounds(8, 7, 5), (3, 8));
}

#[test]
fn horizontal_viewport_scroll_keeps_selection_near_middle() {
    // Equal-width item mapping: total=8, viewport=5 matches the inline_picker_bounds window
    assert_eq!(horizontal_viewport_scroll_start(8, 0, 1, 5), 0);
    assert_eq!(horizontal_viewport_scroll_start(8, 2, 1, 5), 0);
    assert_eq!(horizontal_viewport_scroll_start(8, 3, 1, 5), 1);
    assert_eq!(horizontal_viewport_scroll_start(8, 7, 1, 5), 3);
}

#[test]
fn horizontal_viewport_scroll_does_not_scroll_when_content_fits() {
    assert_eq!(horizontal_viewport_scroll_start(10, 4, 2, 20), 0);
}

#[test]
fn slice_styled_runs_from_display_column_skips_and_limits_width() {
    use ratatui::style::Style;
    let runs = vec![
        ("abc".to_string(), Style::default()),
        ("   ".to_string(), Style::default()),
        ("def".to_string(), Style::default()),
    ];
    let spans = slice_styled_runs_from_display_column(&runs, 2, 4);
    let text: String = spans.iter().map(|span| span.content.as_ref()).collect();
    assert_eq!(text, "c   ");
}

#[test]
fn sessions_picker_reuses_inline_picker_styles_and_scroll_window() {
    let mut app = build_view_model(ChatMessage::new(MessageRole::User, "/sessions"));
    app.chat_picker_sessions = (0..7)
        .map(|idx| chat_picker_item(&format!("session-{idx}.json"), &format!("session-{idx}")))
        .collect();
    app.chat_picker_index = 3;

    let lines = build_chat_picker_lines(&app, 5);
    let text = render_text_lines(lines.clone());

    assert!(text[0].starts_with("  session-1 "));
    assert!(text[2].starts_with("> session-3 "));
    assert_eq!(lines[0].spans[0].style.fg, subtle_aux_text_style().fg);
    assert_eq!(lines[2].spans[0].style.fg, Some(Color::White));
}

#[test]
fn subagent_picker_reuses_inline_picker_styles_and_scroll_window() {
    let mut app = build_view_model(ChatMessage::new(MessageRole::User, "/subagents"));
    app.subagent_sessions = (0..7)
        .map(|idx| SubagentSessionSummaryView {
            session_id: format!("subagent-{idx}"),
            title: format!("task-{idx}"),
            status: SubagentSessionStatus::Running,
            updated_at_unix_ms: 0,
            latest_message: None,
        })
        .collect();
    app.subagent_picker_index = 3;

    let lines = build_subagent_picker_lines(&app, 5);
    let text = render_text_lines(lines.clone());

    assert_eq!(text[0], "  task-1  [running]");
    assert_eq!(text[2], "> task-3  [running]");
    assert_eq!(lines[0].spans[0].style.fg, subtle_aux_text_style().fg);
    assert_eq!(lines[2].spans[0].style.fg, Some(Color::White));
}

#[test]
fn subagent_picker_uses_inline_layout_without_border_or_title() {
    let mut app = build_view_model(ChatMessage::new(MessageRole::User, "/subagents"));
    app.subagent_picker_active = true;
    app.subagent_sessions = vec![
        SubagentSessionSummaryView {
            session_id: "subagent-1".to_string(),
            title: "first-task".to_string(),
            status: SubagentSessionStatus::Completed,
            updated_at_unix_ms: 0,
            latest_message: None,
        },
        SubagentSessionSummaryView {
            session_id: "subagent-2".to_string(),
            title: "second-task".to_string(),
            status: SubagentSessionStatus::Running,
            updated_at_unix_ms: 0,
            latest_message: None,
        },
    ];
    app.subagent_picker_index = 1;

    let lines = render_ui_lines(&app, 80, 20);

    assert!(lines.iter().any(|line| line.contains("> second-task")));
    assert!(!lines.iter().any(|line| line.contains("SubAgent Sessions")));
}

#[test]
fn sessions_picker_uses_inline_layout_without_footer_or_title() {
    let mut app = build_view_model(ChatMessage::new(MessageRole::User, "/sessions"));
    app.chat_picker_active = true;
    app.chat_picker_sessions = vec![
        chat_picker_item("session-0.json", "session-0"),
        chat_picker_item("session-1.json", "session-1"),
        chat_picker_item("session-2.json", "session-2"),
    ];
    app.chat_picker_index = 1;

    let lines = render_ui_lines(&app, 80, 20);

    assert!(lines.iter().any(|line| line.contains("> session-1")));
    assert!(
        !lines
            .iter()
            .any(|line| line.contains(t!("ui.picker.sessions").as_ref()))
    );
    assert!(
        !lines
            .iter()
            .any(|line| line.contains(t!("ui.footer.preview").as_ref()))
    );
}

#[test]
fn sessions_picker_shows_relative_time_without_parentheses() {
    let mut app = build_view_model(ChatMessage::new(MessageRole::User, "/sessions"));
    app.config.ui_locale = Some("en".to_string());
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    app.chat_picker_sessions = vec![
        chat_picker_item_at(
            "session.json",
            "My session",
            now_ms.saturating_sub(3 * 60 * 1000),
        ),
        chat_picker_item("other.json", "Other"),
    ];
    app.chat_picker_index = 1;

    let lines = build_chat_picker_lines(&app, 5);
    let text = render_text_lines(lines.clone());

    assert!(
        text[0] == "  My session 3 minutes ago" || text[0] == "  My session 3 分钟前",
        "unexpected picker line: {}",
        text[0]
    );
    assert!(!text[0].contains('(') && !text[0].contains(')'));
    assert_eq!(lines[0].spans.len(), 3);
    assert_eq!(
        lines[0].spans[2].style.fg,
        inline_picker_meta_style(false).fg
    );
}

#[test]
fn slash_suggestions_reuse_inline_picker_styles_and_scroll_window() {
    let mut app = build_view_model(ChatMessage::new(MessageRole::User, "/"));
    app.input_suggestion_kind = Some(InputSuggestionKind::Slash);
    app.slash_suggestions = (0..7)
        .map(|idx| InputSuggestion {
            label: format!("/cmd-{idx}"),
            replacement: format!("/cmd-{idx}"),
            summary: format!("summary-{idx}"),
            details: Vec::new(),
        })
        .collect();
    app.selected_suggestion = 3;

    let lines = build_suggestion_lines(&app, 5, 48);
    let text = render_text_lines(lines.clone());

    assert!(suggestions_use_inline_picker(&app));
    assert!(text[0].starts_with("  /cmd-1"));
    assert!(text[2].starts_with("> /cmd-3"));
    assert_eq!(lines[0].spans[0].style.fg, subtle_aux_text_style().fg);
    assert_eq!(lines[2].spans[0].style.fg, Some(Color::White));
}

#[test]
fn slash_suggestions_use_inline_layout_without_footer_or_title() {
    let mut app = build_view_model(ChatMessage::new(MessageRole::User, "/"));
    app.input_suggestion_kind = Some(InputSuggestionKind::Slash);
    app.slash_suggestions = vec![
        InputSuggestion::simple("/help"),
        InputSuggestion::simple("/model"),
        InputSuggestion::simple("/sessions"),
    ];
    app.selected_suggestion = 1;

    let lines = render_ui_lines(&app, 80, 20);

    assert!(lines.iter().any(|line| line.contains("> /model")));
    assert!(
        !lines
            .iter()
            .any(|line| line.contains(t!("ui.suggestion.title.slash").as_ref()))
    );
    assert!(
        !lines
            .iter()
            .any(|line| line.contains(t!("ui.footer.preview").as_ref()))
    );
}

#[test]
fn single_slash_suggestion_details_align_with_usage_heading() {
    let mut app = build_view_model(ChatMessage::new(MessageRole::User, "/model"));
    app.input_suggestion_kind = Some(InputSuggestionKind::Slash);
    app.slash_suggestions = vec![InputSuggestion::simple("/model")];

    let lines = render_text_lines(build_suggestion_lines(&app, 5, 64));
    let usage_idx = lines
        .iter()
        .position(|line| line == "Usage")
        .expect("usage heading exists");

    assert_eq!(lines[usage_idx + 1], "/model list");
    assert_eq!(lines[usage_idx + 2], "/model use <name>");
}

#[test]
fn start_implementing_slash_suggestion_shows_summary() {
    let suggestion = InputSuggestion::simple("/start-implementing");
    let summary = super::pickers::suggestion_summary(&suggestion);

    assert_eq!(
        summary,
        t!("ui.suggestion.summary.start_implementing").into_owned()
    );
    assert!(!summary.is_empty());
}

#[test]
fn file_reference_suggestions_reuse_inline_picker_styles_and_scroll_window() {
    let mut app = build_view_model(ChatMessage::new(MessageRole::User, "@src/"));
    app.input_suggestion_kind = Some(InputSuggestionKind::FileReference);
    app.slash_suggestions = (0..7)
        .map(|idx| InputSuggestion {
            label: format!("src/file-{idx}.rs"),
            replacement: format!("src/file-{idx}.rs"),
            summary: String::new(),
            details: Vec::new(),
        })
        .collect();
    app.selected_suggestion = 3;

    let lines = build_suggestion_lines(&app, 5, 48);
    let text = render_text_lines(lines.clone());

    assert!(suggestions_use_inline_picker(&app));
    assert!(text[0].starts_with("  src/file-1.rs"));
    assert!(text[2].starts_with("> src/file-3.rs"));
    assert_eq!(lines[0].spans[0].style.fg, subtle_aux_text_style().fg);
    assert_eq!(lines[2].spans[0].style.fg, Some(Color::White));
}

#[test]
fn file_reference_suggestions_use_inline_layout_without_footer_or_title() {
    let mut app = build_view_model(ChatMessage::new(MessageRole::User, "@src/"));
    app.input_suggestion_kind = Some(InputSuggestionKind::FileReference);
    app.slash_suggestions = vec![InputSuggestion::simple("src/ui.rs")];

    let lines = render_ui_lines(&app, 80, 20);

    assert!(lines.iter().any(|line| line.contains("> src/ui.rs")));
    assert!(
        !lines
            .iter()
            .any(|line| line.contains(t!("ui.suggestion.title.file_reference").as_ref()))
    );
    assert!(
        !lines
            .iter()
            .any(|line| line.contains(t!("ui.footer.preview").as_ref()))
    );
}

#[test]
fn bottom_form_wrap_preserves_zero_width_combining_marks() {
    let lines = bottom_form_wrap_logical_line("e\u{301}", 1);

    assert_eq!(lines, vec!["e\u{301}".to_string(), String::new()]);
}

#[test]
fn bottom_form_wrap_skips_glyphs_wider_than_available_width() {
    let lines = bottom_form_wrap_logical_line("你A", 1);

    assert_eq!(lines, vec!["A".to_string(), String::new()]);
}

#[test]
fn truncate_from_left_keeps_combining_marks_on_tail() {
    assert_eq!(truncate_from_left_to_width("abce\u{301}", 3), "…ce\u{301}");
}

#[test]
fn rewind_picker_renders_selected_message_in_history_panel() {
    let mut app = build_view_model(ChatMessage::new(
        MessageRole::User,
        "Confirm requirements first",
    ));
    app.messages.push(ChatMessage::new(
        MessageRole::Agent,
        "Let me look at the context first.",
    ));
    app.messages.push(ChatMessage::new(
        MessageRole::User,
        "Then organize the implementation plan",
    ));
    app.rewind_picker = Some(RewindPickerView {
        selected_message_id: 3,
        selectable_message_ids: vec![1, 3],
    });

    let history_lines = render_text_lines(build_history_lines(&app, 120));
    let selected_lines = render_message_lines(&app, &app.messages[2], 2);

    assert!(
        history_lines
            .iter()
            .any(|line| line.contains("Let me look at the context first."))
    );
    assert!(
        history_lines
            .iter()
            .any(|line| line.contains("Then organize the implementation plan"))
    );
    assert!(
        history_lines
            .iter()
            .all(|line| !line.contains(t!("ui.rewind.title").as_ref()))
    );
    assert_eq!(selected_lines[0].spans[0].style.fg, Some(Color::White));
    assert!(
        selected_lines[0]
            .spans
            .iter()
            .skip(1)
            .any(|span| span.style.fg == Some(Color::White))
    );
}

#[test]
fn rewind_picker_deemphasizes_assistant_messages() {
    let mut app = build_view_model(ChatMessage::new(
        MessageRole::Agent,
        "Let me look at the context first.",
    ));
    app.rewind_picker = Some(RewindPickerView {
        selected_message_id: 2,
        selectable_message_ids: vec![2],
    });

    let lines = render_message_lines(&app, &app.messages[0], 0);

    assert!(
        lines[0]
            .spans
            .iter()
            .all(|span| span.style.add_modifier.contains(Modifier::DIM))
    );
}

#[test]
fn rewind_picker_deemphasizes_tool_messages() {
    let mut app = build_view_model(ChatMessage::with_tool_block(
        MessageRole::Agent,
        "",
        ToolUiBlock {
            tool_call_id: Some("tool-1".to_string()),
            tool_name: "read_file".to_string(),
            phase: ToolUiPhase::Succeeded,
            headline: "Read a file".to_string(),
            detail_lines: vec!["/tmp/demo.txt".to_string()],
            image_paths: Vec::new(),
            video_paths: Vec::new(),
            args_excerpt: None,
            output_excerpt: None,
            suppress_expand: None,
        },
    ));
    app.rewind_picker = Some(RewindPickerView {
        selected_message_id: 2,
        selectable_message_ids: vec![2],
    });

    let lines = render_message_lines(&app, &app.messages[0], 0);

    assert!(lines.iter().all(|line| {
        line.spans
            .iter()
            .all(|span| span.style.add_modifier.contains(Modifier::DIM))
    }));
}

#[test]
fn rewind_picker_deemphasizes_non_selectable_user_messages() {
    let mut app = build_view_model(ChatMessage::new(MessageRole::User, "/sessions"));
    app.messages.push(ChatMessage::new(
        MessageRole::User,
        "The message actually sent to the model",
    ));
    app.rewind_picker = Some(RewindPickerView {
        selected_message_id: 2,
        selectable_message_ids: vec![2],
    });

    let lines = render_message_lines(&app, &app.messages[0], 0);

    assert!(
        lines[0]
            .spans
            .iter()
            .all(|span| span.style.add_modifier.contains(Modifier::DIM))
    );
}

#[test]
fn streaming_tool_preview_renders_tool_card_on_separate_message_row() {
    let mut app = build_view_model(ChatMessage::new(
        MessageRole::Agent,
        "I'll run this command for you.",
    ));
    app.messages.push(ChatMessage::with_tool_block(
        MessageRole::Agent,
        String::new(),
        ToolUiBlock {
            tool_call_id: Some("call-preview-shell".to_string()),
            tool_name: "shell".to_string(),
            phase: ToolUiPhase::Preview,
            headline: "Run command".to_string(),
            detail_lines: vec!["echo hello".to_string()],
            image_paths: Vec::new(),
            video_paths: Vec::new(),
            args_excerpt: None,
            output_excerpt: None,
            suppress_expand: None,
        },
    ));

    let body_lines = render_text_lines(render_message_lines(&app, &app.messages[0], 0));
    let preview_lines = render_text_lines(render_message_lines(&app, &app.messages[1], 1));

    assert!(
        body_lines
            .iter()
            .any(|line| line.contains("I'll run this command for you."))
    );
    assert!(
        preview_lines
            .iter()
            .any(|line| line.contains("Run command"))
    );
}

#[test]
fn real_thinking_stays_before_agent_message_body() {
    let mut app = build_view_model(ChatMessage::new(
        MessageRole::Agent,
        "I'll run this command for you.",
    ));
    app.assistant_aux_by_message.insert(
        0,
        AssistantAuxData {
            thinking: Some("Check the command arguments for safety first.".to_string()),
            compaction: None,
        },
    );

    let lines = render_text_lines(render_message_lines(&app, &app.messages[0], 0));
    let thinking_idx = lines
        .iter()
        .position(|line| line.contains("Check the command arguments for safety first."))
        .expect("thinking line exists");
    let body_idx = lines
        .iter()
        .position(|line| line.contains("I'll run this command for you."))
        .expect("body line exists");

    assert!(thinking_idx < body_idx);
}

#[test]
fn embedded_thinking_renders_in_aux_details_without_raw_tags() {
    let app = build_view_model(ChatMessage::new(
        MessageRole::Agent,
        "<think>Let me review the project structure first.</think>\n\nI've finished reviewing the main modules.",
    ));

    let lines = render_text_lines(render_message_lines(&app, &app.messages[0], 0));
    let thinking_idx = lines
        .iter()
        .position(|line| line.contains("Let me review the project structure first."))
        .expect("embedded thinking line exists");
    let body_idx = lines
        .iter()
        .position(|line| line.contains("I've finished reviewing the main modules."))
        .expect("body line exists");

    assert!(thinking_idx < body_idx);
    assert!(lines.iter().all(|line| !line.contains("<think>")));
    assert!(lines.iter().all(|line| !line.contains("</think>")));
}

#[test]
fn embedded_thinking_is_hidden_when_aux_details_collapsed() {
    let mut app = build_view_model(ChatMessage::new(
        MessageRole::Agent,
        "<think>Let me review the project structure first.</think>\n\nI've finished reviewing the main modules.",
    ));
    app.show_aux_details = false;

    let lines = render_text_lines(render_message_lines(&app, &app.messages[0], 0));

    assert!(
        lines
            .iter()
            .any(|line| line.contains("I've finished reviewing the main modules."))
    );
    assert!(
        lines
            .iter()
            .all(|line| !line.contains("Let me review the project structure first."))
    );
    assert!(lines.iter().all(|line| !line.contains("<think>")));
}

#[test]
fn thinking_only_message_stays_invisible_when_aux_details_collapsed() {
    let mut app = build_view_model(ChatMessage::new(
        MessageRole::Agent,
        "<think>Let me review the project structure first.</think>",
    ));
    app.show_aux_details = false;

    let lines = render_text_lines(render_message_lines(&app, &app.messages[0], 0));

    assert!(lines.is_empty());
}

#[test]
fn pending_thinking_detail_is_hidden_when_aux_details_collapsed() {
    let mut app = build_view_model(ChatMessage::new(
        MessageRole::Agent,
        "I'll handle this issue.",
    ));
    app.show_aux_details = false;
    app.pending_response_active = true;
    app.pending_assistant_msg_index = Some(0);
    app.pending_aux = Some(PendingAssistantAux {
        kind: AssistantAuxKind::Thinking,
        status_text: "Thinking...".to_string(),
        detail_text: Some("Check the current render branch first.".to_string()),
    });

    let lines = render_text_lines(render_message_lines(&app, &app.messages[0], 0));

    assert!(lines.iter().any(|line| line.contains("Thinking...")));
    assert!(
        lines
            .iter()
            .any(|line| line.contains("I'll handle this issue."))
    );
    assert!(
        lines
            .iter()
            .all(|line| !line.contains("Check the current render branch first."))
    );
}

#[test]
fn pending_thinking_detail_is_visible_when_aux_details_expanded() {
    let mut app = build_view_model(ChatMessage::new(
        MessageRole::Agent,
        "I'll handle this issue.",
    ));
    app.pending_response_active = true;
    app.pending_assistant_msg_index = Some(0);
    app.pending_aux = Some(PendingAssistantAux {
        kind: AssistantAuxKind::Thinking,
        status_text: "Thinking...".to_string(),
        detail_text: Some("Check the current render branch first.".to_string()),
    });

    let lines = render_text_lines(render_message_lines(&app, &app.messages[0], 0));

    assert!(lines.iter().any(|line| line.contains("Thinking...")));
    assert!(
        lines
            .iter()
            .any(|line| line.contains("Check the current render branch first."))
    );
}

#[test]
fn pending_thinking_spinner_is_drawn_by_cli_ui() {
    let mut app = build_view_model(ChatMessage::new(MessageRole::Agent, ""));
    app.pending_response_active = true;
    app.pending_assistant_msg_index = Some(0);
    app.pending_aux = Some(PendingAssistantAux {
        kind: AssistantAuxKind::Thinking,
        status_text: String::new(),
        detail_text: None,
    });

    app.thinking_spinner_index = 0;
    let lines_pipe = render_text_lines(render_message_lines(&app, &app.messages[0], 0));
    assert!(lines_pipe.iter().any(|line| line.contains("| Thinking...")));

    app.thinking_spinner_index = 1;
    let lines_slash = render_text_lines(render_message_lines(&app, &app.messages[0], 0));
    assert!(
        lines_slash
            .iter()
            .any(|line| line.contains("/ Thinking..."))
    );
}

#[test]
fn standalone_subagent_pending_aux_renders_in_history() {
    let mut app = build_view_model(ChatMessage::new(MessageRole::Agent, "Processing started."));
    app.pending_response_active = true;
    app.pending_assistant_msg_index = None;
    app.pending_aux = Some(PendingAssistantAux {
        kind: AssistantAuxKind::Thinking,
        status_text: "| official news fetch: Running".to_string(),
        detail_text: None,
    });

    let lines = render_text_lines(build_history_lines(&app, 120));

    assert!(
        lines
            .iter()
            .any(|line| line.contains("Processing started."))
    );
    assert!(
        lines
            .iter()
            .any(|line| line.contains("official news fetch: Running"))
    );
    assert!(
        lines
            .iter()
            .all(|line| !line.contains("| official news fetch: Running"))
    );
}

#[test]
fn standalone_pending_aux_hides_detail_when_collapsed() {
    let mut app = build_view_model(ChatMessage::new(MessageRole::Agent, "Processing started."));
    app.show_aux_details = false;
    app.pending_response_active = true;
    app.pending_assistant_msg_index = None;
    app.pending_aux = Some(PendingAssistantAux {
        kind: AssistantAuxKind::Thinking,
        status_text: "| Thinking...".to_string(),
        detail_text: Some("Keep waiting for the sub-session to return.".to_string()),
    });

    let lines = render_text_lines(build_history_lines(&app, 120));

    assert!(lines.iter().any(|line| line.contains("Thinking...")));
    assert!(
        lines
            .iter()
            .all(|line| !line.contains("Keep waiting for the sub-session to return."))
    );
}

#[test]
fn persisted_standalone_subagent_pending_aux_renders_after_completion() {
    let mut app = build_view_model(ChatMessage::new(
        MessageRole::Agent,
        "The subagent has finished the task.",
    ));
    app.pending_response_active = false;
    app.pending_assistant_msg_index = None;
    app.pending_aux = None;
    app.persisted_standalone_pending_aux = Some(PendingAssistantAux {
        kind: AssistantAuxKind::Thinking,
        status_text: "| official news fetch: Done".to_string(),
        detail_text: None,
    });
    app.persisted_standalone_pending_aux_anchor = Some(0);

    let lines = render_text_lines(build_history_lines(&app, 120));

    assert!(
        lines
            .iter()
            .any(|line| line.contains("The subagent has finished the task."))
    );
    assert!(
        lines
            .iter()
            .any(|line| line.contains("official news fetch: Done"))
    );
}

#[test]
fn persisted_subagent_status_wins_over_generic_pending_thinking() {
    let mut app = build_view_model(ChatMessage::new(
        MessageRole::Agent,
        "The parent session is about to summarize results.",
    ));
    app.messages
        .push(ChatMessage::new(MessageRole::Agent, String::new()));
    app.pending_response_active = true;
    app.pending_assistant_msg_index = Some(1);
    app.pending_aux = Some(PendingAssistantAux {
        kind: AssistantAuxKind::Thinking,
        status_text: "| Thinking...".to_string(),
        detail_text: Some("Keep waiting for the parent session to wrap up.".to_string()),
    });
    app.persisted_standalone_pending_aux = Some(PendingAssistantAux {
        kind: AssistantAuxKind::Thinking,
        status_text: "| summarize current session results: Done".to_string(),
        detail_text: None,
    });
    app.persisted_standalone_pending_aux_anchor = Some(1);

    let lines = render_text_lines(build_history_lines(&app, 120));
    let status_idx = lines
        .iter()
        .position(|line| line.contains("summarize current session results: Done"))
        .expect("status line exists");
    let thinking_idx = lines
        .iter()
        .position(|line| line.contains("Thinking..."))
        .expect("thinking line exists");

    assert!(status_idx < thinking_idx);
}

#[test]
fn persisted_subagent_status_renders_before_parent_streaming_reply() {
    let mut app = build_view_model(ChatMessage::new(
        MessageRole::Agent,
        "The subagent has finished the task.",
    ));
    app.messages.push(ChatMessage::new(
        MessageRole::Agent,
        "Tool call succeeded! The subagent returned structured results.",
    ));
    app.pending_response_active = true;
    app.pending_assistant_msg_index = Some(1);
    app.pending_aux = Some(PendingAssistantAux {
        kind: AssistantAuxKind::Thinking,
        status_text: "| Thinking...".to_string(),
        detail_text: Some("The parent session is still organizing the summary.".to_string()),
    });
    app.persisted_standalone_pending_aux = Some(PendingAssistantAux {
        kind: AssistantAuxKind::Thinking,
        status_text: "| run a crazy stress test: Done".to_string(),
        detail_text: None,
    });
    app.persisted_standalone_pending_aux_anchor = Some(1);

    let lines = render_text_lines(build_history_lines(&app, 120));
    let status_idx = lines
        .iter()
        .position(|line| line.contains("run a crazy stress test: Done"))
        .expect("status line exists");
    let thinking_idx = lines
        .iter()
        .position(|line| line.contains("Thinking..."))
        .expect("thinking line exists");
    let parent_idx = lines
        .iter()
        .position(|line| {
            line.contains("Tool call succeeded! The subagent returned structured results.")
        })
        .expect("parent reply line exists");

    assert!(status_idx < parent_idx);
    assert!(thinking_idx < parent_idx);
}

#[test]
fn persisted_subagent_status_stays_above_parent_reply_after_completion() {
    let mut app = build_view_model(ChatMessage::new(
        MessageRole::Agent,
        "The subagent has finished the task.",
    ));
    app.messages.push(ChatMessage::new(
        MessageRole::Agent,
        "Developer debug test task: subagent test task executed successfully.",
    ));
    app.pending_response_active = false;
    app.pending_assistant_msg_index = None;
    app.pending_aux = None;
    app.persisted_standalone_pending_aux = Some(PendingAssistantAux {
        kind: AssistantAuxKind::Thinking,
        status_text: "| subagent debug task: Done".to_string(),
        detail_text: None,
    });
    app.persisted_standalone_pending_aux_anchor = Some(1);

    let lines = render_text_lines(build_history_lines(&app, 120));
    let status_idx = lines
        .iter()
        .position(|line| line.contains("subagent debug task: Done"))
        .expect("status line exists");
    let parent_idx = lines
        .iter()
        .position(|line| {
            line.contains("Developer debug test task: subagent test task executed successfully.")
        })
        .expect("parent reply line exists");

    assert!(status_idx < parent_idx);
}

#[test]
fn persisted_subagent_status_stays_anchored_after_later_user_message() {
    let mut app = build_view_model(ChatMessage::new(
        MessageRole::Agent,
        "The subagent has finished the task.",
    ));
    app.messages.push(ChatMessage::new(
        MessageRole::Agent,
        "Developer debug test task: subagent test task executed successfully.",
    ));
    app.messages
        .push(ChatMessage::new(MessageRole::User, "/model"));
    app.pending_response_active = false;
    app.pending_assistant_msg_index = None;
    app.pending_aux = None;
    app.persisted_standalone_pending_aux = Some(PendingAssistantAux {
        kind: AssistantAuxKind::Thinking,
        status_text: "| subagent debug task: Done".to_string(),
        detail_text: None,
    });
    app.persisted_standalone_pending_aux_anchor = Some(1);

    let lines = render_text_lines(build_history_lines(&app, 120));
    let status_idx = lines
        .iter()
        .position(|line| line.contains("subagent debug task: Done"))
        .expect("status line exists");
    let parent_idx = lines
        .iter()
        .position(|line| {
            line.contains("Developer debug test task: subagent test task executed successfully.")
        })
        .expect("parent reply line exists");
    let later_user_idx = lines
        .iter()
        .position(|line| line.contains("/model"))
        .expect("later user line exists");

    assert!(status_idx < parent_idx);
    assert!(parent_idx < later_user_idx);
}

#[test]
fn persisted_subagent_status_renders_as_separate_message_before_parent_reply_after_later_user_message()
 {
    let mut app = build_view_model(ChatMessage::new(
        MessageRole::Agent,
        "The subagent has finished the task.",
    ));
    app.messages.push(ChatMessage::new(
        MessageRole::Agent,
        "Developer debug test task: subagent test task executed successfully.",
    ));
    app.messages
        .push(ChatMessage::new(MessageRole::User, "/model"));
    app.pending_response_active = false;
    app.pending_assistant_msg_index = None;
    app.pending_aux = None;
    app.persisted_standalone_pending_aux = Some(PendingAssistantAux {
        kind: AssistantAuxKind::Thinking,
        status_text: "| subagent debug task: Done".to_string(),
        detail_text: None,
    });
    app.persisted_standalone_pending_aux_anchor = Some(1);

    let lines = render_text_lines(build_history_lines(&app, 120));
    let status_idx = lines
        .iter()
        .position(|line| line.contains("subagent debug task: Done"))
        .expect("status line exists");
    let parent_idx = lines
        .iter()
        .position(|line| {
            line.contains("Developer debug test task: subagent test task executed successfully.")
        })
        .expect("parent reply line exists");

    assert!(lines[status_idx].starts_with("> "));
    assert!(lines[parent_idx].starts_with("> "));
    assert!(parent_idx > status_idx + 1);
}

#[test]
fn subagent_pending_aux_detail_is_hidden_when_aux_details_collapsed() {
    let view = build_subagent_detail_view(Some(PendingAssistantAux {
        kind: AssistantAuxKind::Thinking,
        status_text: "| Thinking...".to_string(),
        detail_text: Some("Check the sub-session's current progress first.".to_string()),
    }));

    let lines = render_text_lines(build_subagent_history_lines(&view, false, 0));

    assert!(lines.iter().any(|line| line.contains("Thinking...")));
    assert!(
        lines
            .iter()
            .all(|line| !line.contains("Check the sub-session's current progress first."))
    );
}

#[test]
fn subagent_pending_aux_detail_is_visible_when_aux_details_expanded() {
    let view = build_subagent_detail_view(Some(PendingAssistantAux {
        kind: AssistantAuxKind::Thinking,
        status_text: "| Thinking...".to_string(),
        detail_text: Some("Check the sub-session's current progress first.".to_string()),
    }));

    let lines = render_text_lines(build_subagent_history_lines(&view, true, 0));

    assert!(lines.iter().any(|line| line.contains("Thinking...")));
    assert!(
        lines
            .iter()
            .any(|line| line.contains("Check the sub-session's current progress first."))
    );
}

#[test]
fn subagent_tool_card_hides_output_when_aux_details_collapsed() {
    let tool = ToolUiBlock {
        tool_call_id: Some("call-1".to_string()),
        tool_name: "grep".to_string(),
        phase: ToolUiPhase::Succeeded,
        headline: "Search completed".to_string(),
        detail_lines: vec!["Query: recent changes".to_string()],
        image_paths: Vec::new(),
        video_paths: Vec::new(),
        args_excerpt: Some("{\n  \"limit\": 3\n}".to_string()),
        output_excerpt: Some("3 results found.".to_string()),
        suppress_expand: None,
    };
    let message = ChatMessage::with_tool_block(MessageRole::Agent, String::new(), tool);

    let lines = render_text_lines(render_subagent_message_lines(&message, false));

    assert!(lines.iter().any(|line| line.contains("Search completed")));
    assert!(lines.iter().all(|line| !line.contains("3 results found.")));
    assert!(lines.iter().all(|line| !line.contains("\"limit\": 3")));
}

#[test]
fn subagent_tool_card_shows_output_when_aux_details_expanded() {
    let tool = ToolUiBlock {
        tool_call_id: Some("call-1".to_string()),
        tool_name: "grep".to_string(),
        phase: ToolUiPhase::Succeeded,
        headline: "Search completed".to_string(),
        detail_lines: vec!["Query: recent changes".to_string()],
        image_paths: Vec::new(),
        video_paths: Vec::new(),
        args_excerpt: Some("{\n  \"limit\": 3\n}".to_string()),
        output_excerpt: Some("3 results found.".to_string()),
        suppress_expand: None,
    };
    let message = ChatMessage::with_tool_block(MessageRole::Agent, String::new(), tool);

    let lines = render_text_lines(render_subagent_message_lines(&message, true));

    assert!(lines.iter().any(|line| line.contains("Search completed")));
    assert!(lines.iter().any(|line| line.contains("3 results found.")));
    assert!(lines.iter().any(|line| line.contains("\"limit\": 3")));
}

#[test]
fn shell_pending_approval_title_line_shows_reason_instead_of_call_id() {
    let app = build_view_model(ChatMessage::with_tool_block(
        MessageRole::Agent,
        String::new(),
        ToolUiBlock {
            tool_call_id: Some("call_00_demo_reason".to_string()),
            tool_name: "shell".to_string(),
            phase: ToolUiPhase::PendingApproval,
            headline: "check build output".to_string(),
            detail_lines: vec![
                "High-risk tool call: shell".to_string(),
                "Command: cargo test -p spirit".to_string(),
            ],
            image_paths: Vec::new(),
            video_paths: Vec::new(),
            args_excerpt: None,
            output_excerpt: None,
            suppress_expand: None,
        },
    ));

    let lines = render_text_lines(render_message_lines(&app, &app.messages[0], 0));

    assert!(lines[0].contains("shell"));
    assert!(lines[0].contains(t!("ui.tool.phase.pending_approval").as_ref()));
    assert!(lines[0].contains("check build output"));
    assert!(!lines[0].contains("call_00_demo_reason"));
    assert!(!lines.iter().any(|line| line == "  ▌ check build output"));
}

#[test]
fn generate_image_tool_card_shows_structured_path_when_aux_details_collapsed() {
    let mut app = build_view_model(ChatMessage::with_tool_block(
        MessageRole::Agent,
        String::new(),
        ToolUiBlock {
            tool_call_id: Some("call-image-1".to_string()),
            tool_name: "generate_image".to_string(),
            phase: ToolUiPhase::Succeeded,
            headline: "Image generated".to_string(),
            detail_lines: Vec::new(),
            image_paths: vec![
                "C:/Users/pc/AppData/Roaming/Spirit/generated-images/example.png"
                    .to_string(),
            ],
            video_paths: Vec::new(),
            args_excerpt: Some("{\n  \"prompt\": \"draw a picture\"\n}".to_string()),
            output_excerpt: Some("[generated image]\npath: C:/Users/pc/AppData/Roaming/Spirit/generated-images/example.png".to_string()),
            suppress_expand: None,
        },
    ));
    app.show_aux_details = false;

    let lines = render_text_lines(render_message_lines(&app, &app.messages[0], 0));

    assert!(lines.iter().any(|line| line.contains("Image generated")));
    assert!(lines.iter().any(|line| {
        line.contains(
            t!(
                "tui.tool.detail.path",
                path = "C:/Users/pc/AppData/Roaming/Spirit/generated-images/example.png"
            )
            .as_ref(),
        )
    }));
    assert!(
        lines
            .iter()
            .all(|line| !line.contains("\"prompt\": \"draw a picture\""))
    );
    assert!(lines.iter().all(|line| !line.contains("[generated image]")));
}

#[test]
fn generate_video_tool_card_shows_managed_uri_when_aux_details_collapsed() {
    let mut app = build_view_model(ChatMessage::with_tool_block(
        MessageRole::Agent,
        String::new(),
        ToolUiBlock {
            tool_call_id: Some("call-video-1".to_string()),
            tool_name: "generate_video".to_string(),
            phase: ToolUiPhase::Succeeded,
            headline: "Video generated".to_string(),
            detail_lines: Vec::new(),
            image_paths: Vec::new(),
            video_paths: vec!["spirit://generated/video/example.mp4".to_string()],
            args_excerpt: Some("{\n  \"prompt\": \"generate a video\"\n}".to_string()),
            output_excerpt: Some(
                "[generated video]\nvideo_ref: spirit://generated/video/example.mp4".to_string(),
            ),
            suppress_expand: None,
        },
    ));
    app.show_aux_details = false;

    let lines = render_text_lines(render_message_lines(&app, &app.messages[0], 0));

    assert!(lines.iter().any(|line| line.contains("Video generated")));
    assert!(lines.iter().any(|line| {
        line.contains(
            t!(
                "tui.tool.detail.path",
                path = "spirit://generated/video/example.mp4"
            )
            .as_ref(),
        )
    }));
}

#[test]
fn generate_image_tool_card_keeps_rail_on_wrapped_path_lines() {
    let mut app = build_view_model(ChatMessage::with_tool_block(
        MessageRole::Agent,
        String::new(),
        ToolUiBlock {
            tool_call_id: Some("call-image-wrap".to_string()),
            tool_name: "generate_image".to_string(),
            phase: ToolUiPhase::Succeeded,
            headline: "Image generated".to_string(),
            detail_lines: vec![
                t!("tui.tool.detail.path", path = "C:/Users/pc/AppData/Roaming/Spirit/generated-images/this-is-a-very-long-image-name-that-must-wrap/example-output.png")
                    .into_owned(),
            ],
            image_paths: Vec::new(),
        video_paths: Vec::new(),
            args_excerpt: None,
        output_excerpt: None,
        suppress_expand: None,
    },
    ));
    app.show_aux_details = false;

    let (flat, _) = crate::conversation_select::flatten_wrapped_history(
        render_message_lines(&app, &app.messages[0], 0),
        28,
        None,
    );
    let lines = render_text_lines(flat);
    let path_line_index = lines
        .iter()
        .position(|line| line.contains(t!("tui.tool.detail.path", path = "").trim_end()))
        .expect("path line exists");

    assert!(
        lines
            .get(path_line_index + 1)
            .is_some_and(|line| line.starts_with("  ▌ ")),
        "wrapped path continuation should keep tool rail: {lines:#?}"
    );
}

#[test]
fn generate_image_tool_card_selection_highlights_wrapped_rail_consistently() {
    let mut app = build_view_model(ChatMessage::with_tool_block(
        MessageRole::Agent,
        String::new(),
        ToolUiBlock {
            tool_call_id: Some("call-image-select-wrap".to_string()),
            tool_name: "generate_image".to_string(),
            phase: ToolUiPhase::Succeeded,
            headline: "Image generated".to_string(),
            detail_lines: vec![
                t!("tui.tool.detail.path", path = "C:/Users/pc/AppData/Roaming/Spirit/generated-images/this-is-a-very-long-image-name-that-must-wrap/example-output.png")
                    .into_owned(),
            ],
            image_paths: Vec::new(),
        video_paths: Vec::new(),
            args_excerpt: None,
        output_excerpt: None,
        suppress_expand: None,
    },
    ));
    app.show_aux_details = false;

    let message_lines = render_message_lines(&app, &app.messages[0], 0);
    let (flat, _) =
        crate::conversation_select::flatten_wrapped_history(message_lines.clone(), 28, None);
    let plain_lines = render_text_lines(flat);
    let continuation_index = plain_lines
        .iter()
        .position(|line| line.starts_with("  ▌ "))
        .expect("wrapped continuation line exists");

    let selection = crate::conversation_select::normalize_selection(
        crate::conversation_select::CellPointer {
            line: continuation_index,
            col: 0,
        },
        crate::conversation_select::CellPointer {
            line: continuation_index,
            col: 3,
        },
    );
    let (selected_flat, _) =
        crate::conversation_select::flatten_wrapped_history(message_lines, 28, Some(selection));
    let selected_line = &selected_flat[continuation_index];

    let mut covered_width = 0usize;
    let mut covered_spans = 0usize;
    for span in &selected_line.spans {
        let width = UnicodeWidthStr::width(span.content.as_ref());
        if width == 0 {
            continue;
        }
        covered_width += width;
        covered_spans += 1;
        assert!(
            span.style.add_modifier.contains(Modifier::REVERSED),
            "wrapped continuation prefix should be selection-highlighted: {selected_line:#?}"
        );
        if covered_width >= 4 {
            break;
        }
    }

    assert!(covered_spans > 0);
    assert!(covered_width >= 4);
}

#[test]
fn generate_image_history_render_reserves_image_block() {
    let app = build_view_model(ChatMessage::with_tool_block(
        MessageRole::Agent,
        String::new(),
        ToolUiBlock {
            tool_call_id: Some("call-image-range".to_string()),
            tool_name: "generate_image".to_string(),
            phase: ToolUiPhase::Succeeded,
            headline: "Image generated".to_string(),
            detail_lines: vec![t!("tui.tool.detail.path", path = "demo.png").into_owned()],
            image_paths: vec!["demo.png".to_string()],
            video_paths: Vec::new(),
            args_excerpt: None,
            output_excerpt: None,
            suppress_expand: None,
        },
    ));

    let render = build_history_render_result(&app, 80);

    assert_eq!(render.image_blocks.len(), 1);
    assert!(render.image_blocks[0].reserved_rows >= 6);
    assert!(render.image_blocks[0].x_offset > 0);
}

#[test]
fn generate_image_ui_renders_halfblock_preview_from_local_file() {
    let file_path = test_image_path("halfblock-preview");
    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent).expect("create ui test image dir");
    }
    let image = image::RgbaImage::from_pixel(16, 16, image::Rgba([255, 0, 0, 255]));
    image.save(&file_path).expect("save temp image");

    let app = build_view_model(ChatMessage::with_tool_block(
        MessageRole::Agent,
        String::new(),
        ToolUiBlock {
            tool_call_id: Some("call-image-render".to_string()),
            tool_name: "generate_image".to_string(),
            phase: ToolUiPhase::Succeeded,
            headline: "Image generated".to_string(),
            detail_lines: vec![
                t!(
                    "tui.tool.detail.path",
                    path = file_path.display().to_string()
                )
                .into_owned(),
            ],
            image_paths: vec![file_path.to_string_lossy().to_string()],
            video_paths: Vec::new(),
            args_excerpt: None,
            output_excerpt: None,
            suppress_expand: None,
        },
    ));

    let (lines, buffer) = render_ui_snapshot(&app, 80, 36);
    let path_marker = "spirit-ui-halfblock";
    let path_index = lines
        .iter()
        .position(|line| line.contains(path_marker))
        .expect("path line exists");

    let has_red_pixels = ((path_index + 1) as u16..=(path_index + 12) as u16).any(|y| {
        (0..80).any(|x| {
            let cell = &buffer[(x, y)];
            cell.fg == ratatui::style::Color::Rgb(255, 0, 0)
                || cell.bg == ratatui::style::Color::Rgb(255, 0, 0)
        })
    });

    assert!(
        has_red_pixels,
        "expected colored image pixels below generated path"
    );

    let _ = fs::remove_file(file_path);
}

#[test]
fn assistant_prefix_stays_with_first_wrapped_cjk_line() {
    let app = build_view_model(ChatMessage::new(
        MessageRole::Agent,
        "我注意到您使用了中文表达情绪。请问有什么我可以帮助您解决的问题吗？",
    ));

    let (flat, _) = crate::conversation_select::flatten_wrapped_history(
        render_message_lines(&app, &app.messages[0], 0),
        18,
        None,
    );
    let lines = render_text_lines(flat);

    assert!(lines.first().is_some_and(|line| line.contains("我")));
    assert!(lines.first().is_some_and(|line| !line.trim().eq(">")));
}

#[test]
fn assistant_soft_wrap_continuation_aligns_with_text_column() {
    let app = build_view_model(ChatMessage::new(
        MessageRole::Agent,
        "我理解您可能感到沮丧或生气，但使用粗口并不能帮助我们解决问题。如果您遇到了什么困难或需要帮助，请告诉我具体的情况，我会尽力为您提供有用的支持和建议。",
    ));

    let (flat, _) = crate::conversation_select::flatten_wrapped_history(
        render_message_lines(&app, &app.messages[0], 0),
        28,
        None,
    );
    let lines = render_text_lines(flat);

    assert!(lines.first().is_some_and(|line| line.starts_with("> ")));
    assert!(lines.get(1).is_some_and(|line| line.starts_with("  ")));
    assert!(lines.get(1).is_some_and(|line| !line.starts_with("> ")));
}

#[test]
fn inline_mode_pins_input_below_live_content_not_window_bottom() {
    let mut app = build_view_model(ChatMessage::new(MessageRole::User, "hello"));
    app.inline_mode = true;
    app.committed_history_lines = usize::MAX;
    app.input = "typed".to_string();

    let lines = render_ui_lines(&app, 80, 20);
    let snapshot = lines.join("\n");
    assert!(
        lines.iter().take(5).any(|line| line.contains("Agent")),
        "idle inline viewport should keep the input near the top, got:\n{snapshot}"
    );
    assert!(
        !lines[lines.len().saturating_sub(3)..]
            .iter()
            .any(|line| line.contains("Agent")),
        "inline input should not be pinned to the window bottom, got:\n{snapshot}"
    );
}

#[test]
fn inline_mode_skips_tool_image_blocks() {
    let mut app = build_view_model(ChatMessage::with_tool_block(
        MessageRole::Agent,
        String::new(),
        ToolUiBlock {
            tool_call_id: Some("call-image-inline".to_string()),
            tool_name: "generate_image".to_string(),
            phase: ToolUiPhase::Succeeded,
            headline: "Image generated".to_string(),
            detail_lines: vec![t!("tui.tool.detail.path", path = "demo.png").into_owned()],
            image_paths: vec!["demo.png".to_string()],
            video_paths: Vec::new(),
            args_excerpt: None,
            output_excerpt: None,
            suppress_expand: None,
        },
    ));
    app.inline_mode = true;

    let render = build_history_render_result(&app, 80);
    assert!(render.image_blocks.is_empty());
}

#[test]
fn inline_mode_keeps_input_below_uncommitted_live_tail() {
    let mut app = build_view_model(ChatMessage::new(
        MessageRole::Agent,
        "streaming reply that should sit above the composer",
    ));
    app.inline_mode = true;
    app.pending_response_active = true;
    app.committed_history_lines = 0;
    app.input = "next".to_string();

    let lines = render_ui_lines(&app, 80, 20);
    let snapshot = lines.join("\n");
    let input_row = lines.iter().position(|line| line.contains("┌Agent"));
    let live_row = lines
        .iter()
        .position(|line| line.contains("streaming reply"));
    assert!(
        input_row.is_some() && live_row.is_some() && live_row.unwrap() + 1 < input_row.unwrap(),
        "live stream should sit above the input box with a one-row gap, got:\n{snapshot}"
    );
}

#[test]
fn inline_mode_keeps_footer_directly_below_input() {
    let mut app = build_view_model(ChatMessage::new(MessageRole::User, "hello"));
    app.inline_mode = true;
    app.committed_history_lines = usize::MAX;

    let lines = render_ui_lines(&app, 80, 20);
    let snapshot = lines.join("\n");
    let input_bottom = lines.iter().position(|line| line.contains("└"));
    let footer_row = lines.iter().position(|line| {
        line.contains(t!("ui.footer.approval.default").as_ref())
            && line.contains(t!("ui.footer.loop.off").as_ref())
    });
    assert!(
        input_bottom.is_some() && footer_row == Some(input_bottom.unwrap() + 1),
        "inline footer should sit directly below the input box, got:\n{snapshot}"
    );
    let input_top = lines.iter().position(|line| line.contains("┌Agent"));
    assert_eq!(
        input_top,
        Some(1),
        "idle inline viewport should keep a one-row gap above the input box, got:\n{snapshot}"
    );
    assert!(
        lines
            .iter()
            .any(|line| line.contains(app.config.active_model_name())),
        "inline footer should include the active model name, got:\n{snapshot}"
    );
}

#[test]
fn inline_rewind_picker_shows_committed_history() {
    let mut app = build_view_model(ChatMessage::new(
        MessageRole::User,
        "Confirm requirements first",
    ));
    app.messages.push(ChatMessage::new(
        MessageRole::Agent,
        "Let me look at the context first.",
    ));
    app.messages.push(ChatMessage::new(
        MessageRole::User,
        "Then organize the implementation plan",
    ));
    app.inline_mode = true;
    app.committed_history_lines = usize::MAX;
    app.rewind_picker = Some(RewindPickerView {
        selected_message_id: 3,
        selectable_message_ids: vec![1, 3],
    });

    let lines = render_ui_lines(&app, 80, 20);
    let snapshot = lines.join("\n");
    let collapsed = snapshot.replace([' ', '\u{00a0}'], "");
    assert!(
        collapsed.contains(
            "Then organize the implementation plan"
                .replace(' ', "")
                .as_str()
        ),
        "inline rewind picker should surface committed history, got:\n{snapshot}"
    );
}

#[test]
fn inline_fork_picker_shows_committed_history() {
    let mut app = build_view_model(ChatMessage::new(
        MessageRole::User,
        "Confirm requirements first",
    ));
    app.messages.push(ChatMessage::new(
        MessageRole::Agent,
        "Let me look at the context first.",
    ));
    app.inline_mode = true;
    app.committed_history_lines = usize::MAX;
    app.fork_picker = Some(ForkPickerView {
        selected_message_id: 2,
        selectable_message_ids: vec![2],
    });

    let lines = render_ui_lines(&app, 80, 20);
    let snapshot = lines.join("\n");
    let collapsed = snapshot.replace([' ', '\u{00a0}'], "");
    assert!(
        collapsed.contains("Let me look at the context first".replace(' ', "").as_str()),
        "inline fork picker should surface committed history, got:\n{snapshot}"
    );
}

#[test]
fn inline_mode_renders_subagent_viewer_and_approval() {
    let mut app = build_view_model(ChatMessage::new(MessageRole::User, "hello"));
    app.inline_mode = true;
    app.committed_history_lines = usize::MAX;
    app.subagent_view = Some(SubagentSessionDetailView {
        summary: SubagentSessionSummaryView {
            session_id: "sub-1".to_string(),
            title: "demo-subagent".to_string(),
            status: SubagentSessionStatus::Blocked,
            updated_at_unix_ms: 1,
            latest_message: None,
        },
        messages: vec![ChatMessage::new(MessageRole::Agent, "subagent working")],
        pending_aux: None,
        final_output: None,
        error: None,
    });
    app.pending_subagent_approval = Some(PendingSubagentApprovalView {
        session_id: "sub-1".to_string(),
        session_title: "demo-subagent".to_string(),
        tool_name: "shell".to_string(),
        prompt: "run ls".to_string(),
    });

    let snapshot = render_ui_lines(&app, 80, 20).join("\n");
    let collapsed = snapshot.replace([' ', '\u{00a0}'], "");
    assert!(
        collapsed.contains("SubAgent:demo-subagent"),
        "inline mode should draw the SubAgent viewer, got:\n{snapshot}"
    );
    let footer = t!("tui.subagents.view.footer_approval").into_owned();
    let y_hint = footer
        .split('|')
        .find_map(|seg| seg.trim().strip_prefix('Y').map(|_| seg.replace(' ', "")))
        .expect("footer has a Y shortcut segment");
    let n_hint = footer
        .split('|')
        .find_map(|seg| seg.trim().strip_prefix('N').map(|_| seg.replace(' ', "")))
        .expect("footer has an N shortcut segment");
    assert!(
        collapsed.contains(&y_hint) && collapsed.contains(&n_hint),
        "inline SubAgent viewer should show the approval shortcuts, got:\n{snapshot}"
    );
}

#[test]
fn inline_viewport_uses_reserved_height_not_fullscreen() {
    use ratatui::{TerminalOptions, Viewport};

    let backend = TestBackend::new(80, 24);
    let mut terminal = Terminal::with_options(
        backend,
        TerminalOptions {
            viewport: Viewport::Inline(8),
        },
    )
    .expect("inline viewport initializes on TestBackend");
    let mut app = build_view_model(ChatMessage::new(MessageRole::User, "hello"));
    app.inline_mode = true;
    app.committed_history_lines = usize::MAX;
    let mut runtime = UiRuntimeState::default();
    let mut content_bottom = None;
    terminal
        .draw(|frame| {
            assert!(
                frame.area().height <= 8,
                "inline live viewport should stay within Inline height, got {}",
                frame.area().height
            );
            let feedback = draw_ui(frame, &app, &mut runtime);
            content_bottom = feedback.inline_content_bottom;
        })
        .expect("inline ui renders in inline viewport");
    assert_eq!(
        content_bottom,
        Some(5),
        "idle inline content should end after gap + input + footer (rows 0..5)"
    );
}

#[test]
fn idle_inline_needed_viewport_height_is_content_not_reserved_24() {
    let mut app = build_view_model(ChatMessage::new(MessageRole::User, "hello"));
    app.inline_mode = true;
    app.committed_history_lines = usize::MAX;
    assert_eq!(
        inline_needed_viewport_height(&app, 80, 24),
        5,
        "idle inline should request gap + input + footer, not a fixed 24-row viewport"
    );
    app.input_suggestion_kind = Some(crate::view::InputSuggestionKind::Slash);
    assert_eq!(
        inline_needed_viewport_height(&app, 80, 24),
        16,
        "slash suggestions should grow the viewport to gap + input + suggestion block"
    );
}

#[test]
fn history_omits_brand_header() {
    let mut inline_app = build_view_model(ChatMessage::new(MessageRole::Agent, "hello"));
    inline_app.inline_mode = true;
    let fullscreen = build_view_model(ChatMessage::new(MessageRole::Agent, "hello"));

    for (label, app) in [("inline", &inline_app), ("fullscreen", &fullscreen)] {
        let snapshot = render_text_lines(build_history_lines(app, 80)).join("\n");
        assert!(
            !snapshot.contains("Spirit Agent")
                && !snapshot.contains('█')
                && !snapshot.contains('┌')
                && !snapshot.contains("/help"),
            "{label} history should not render a brand header, got:\n{snapshot}"
        );
        assert!(
            snapshot.contains("hello"),
            "{label} history should still render messages, got:\n{snapshot}"
        );
    }
}
