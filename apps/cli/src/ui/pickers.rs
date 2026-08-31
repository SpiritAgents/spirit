use super::subagent::subagent_status_badge;
use super::*;
use rust_i18n::t;

pub(in crate::ui) fn inline_picker_bounds(
    total: usize,
    selected: usize,
    max_items: usize,
) -> (usize, usize) {
    let window = max_items.max(1);
    let pivot = window / 2;
    let max_start = total.saturating_sub(window);
    let start = selected.saturating_sub(pivot).min(max_start);
    let end = (start + window).min(total);
    (start, end)
}

/// Horizontal viewport scroll start: tries to keep the selected item centered unless already scrolled to either end (same semantics as [`inline_picker_bounds`]).
pub(in crate::ui) fn horizontal_viewport_scroll_start(
    total_extent: usize,
    selected_start: usize,
    selected_extent: usize,
    viewport: usize,
) -> usize {
    if total_extent <= viewport || viewport == 0 {
        return 0;
    }
    let selected_center = selected_start.saturating_add(selected_extent / 2);
    let pivot = viewport / 2;
    let max_start = total_extent.saturating_sub(viewport);
    selected_center.saturating_sub(pivot).min(max_start)
}

pub(in crate::ui) fn inline_picker_text_style(is_selected: bool) -> Style {
    if is_selected {
        Style::default().fg(Color::White)
    } else {
        subtle_aux_text_style()
    }
}

pub(in crate::ui) fn inline_picker_meta_style(is_selected: bool) -> Style {
    if is_selected {
        inline_picker_text_style(true)
    } else {
        subtle_aux_text_style().add_modifier(Modifier::DIM)
    }
}

pub(in crate::ui) fn picker_selection_prefix(is_selected: bool) -> &'static str {
    if is_selected { "> " } else { "  " }
}

pub(in crate::ui) fn inline_picker_area(area: Rect) -> Rect {
    let offset = (if area.width >= 12 { 1 } else { 0 }).min(area.width.saturating_sub(1));

    Rect {
        x: area.x.saturating_add(offset),
        y: area.y,
        width: area.width.saturating_sub(offset),
        height: area.height,
    }
}

pub(in crate::ui) fn draw_inline_picker(
    frame: &mut ratatui::Frame<'_>,
    area: Rect,
    lines: Vec<Line<'static>>,
) {
    let picker_widget = Paragraph::new(lines).wrap(Wrap { trim: false });
    frame.render_widget(Clear, area);
    frame.render_widget(picker_widget, inline_picker_area(area));
}

pub(in crate::ui) fn suggestions_use_inline_picker(app: &TuiViewModel) -> bool {
    matches!(
        app.input_suggestion_kind,
        Some(InputSuggestionKind::Slash | InputSuggestionKind::FileReference)
    )
}

fn inline_suggestion_detail_line(detail: String) -> String {
    detail.trim_start().to_string()
}

pub(in crate::ui) fn build_suggestion_lines(
    app: &TuiViewModel,
    max_items: usize,
    max_width: usize,
) -> Vec<Line<'static>> {
    let default_style = subtle_aux_text_style();
    let selected_style = Style::default().fg(Color::White);

    match app.input_suggestion_kind {
        Some(InputSuggestionKind::Slash) => {}
        Some(InputSuggestionKind::FileReference) if app.input_suggestion_loading => {
            return vec![Line::from(Span::styled(
                t!("tui.file_reference.indexing").into_owned(),
                default_style,
            ))];
        }
        Some(InputSuggestionKind::FileReference) => {}
        None => {
            return vec![Line::from(Span::styled(
                t!("ui.suggestion.hint.trigger").into_owned(),
                default_style,
            ))];
        }
    }

    if app.slash_suggestions.is_empty() {
        let message = match app.input_suggestion_kind {
            Some(InputSuggestionKind::Slash) => t!("ui.suggestion.empty.slash").into_owned(),
            Some(InputSuggestionKind::FileReference) => {
                t!("ui.suggestion.empty.file_reference").into_owned()
            }
            None => t!("ui.suggestion.empty.generic").into_owned(),
        };
        return vec![Line::from(Span::styled(message, default_style))];
    }

    if matches!(
        app.input_suggestion_kind,
        Some(InputSuggestionKind::FileReference)
    ) {
        return build_file_reference_suggestion_lines(
            app,
            max_items,
            default_style,
            selected_style,
        );
    }

    let selected = app.selected_suggestion;
    let total = app.slash_suggestions.len();
    let (start, end) = inline_picker_bounds(total, selected, max_items);
    let visible_commands = &app.slash_suggestions[start..end];
    let command_column_width = visible_commands
        .iter()
        .map(|suggestion| {
            UnicodeWidthStr::width(
                format!("{}{}", picker_selection_prefix(true), suggestion.label).as_str(),
            )
        })
        .max()
        .unwrap_or(0);
    let description_gap = if max_width >= 40 {
        4
    } else if max_width >= 24 {
        3
    } else {
        2
    };

    let mut lines = Vec::new();
    for idx in start..end {
        let suggestion = &app.slash_suggestions[idx];
        let is_selected = idx == selected;
        let command_style = inline_picker_text_style(is_selected);
        let summary_style = inline_picker_meta_style(is_selected);
        let command_text = format!(
            "{}{}",
            picker_selection_prefix(is_selected),
            suggestion.label
        );
        let summary = suggestion_summary(suggestion);

        if summary.is_empty() || max_width == 0 {
            lines.push(Line::from(Span::styled(command_text, command_style)));
            continue;
        }

        let command_width = UnicodeWidthStr::width(command_text.as_str());
        let summary_width = max_width.saturating_sub(command_column_width + description_gap);
        if summary_width == 0 {
            lines.push(Line::from(Span::styled(command_text, command_style)));
            continue;
        }

        let spacing = command_column_width
            .saturating_sub(command_width)
            .saturating_add(description_gap);
        let summary_text = truncate_to_width(&summary, summary_width);

        lines.push(Line::from(vec![
            Span::styled(command_text, command_style),
            Span::styled(" ".repeat(spacing), summary_style),
            Span::styled(summary_text, summary_style),
        ]));
    }

    if total == 1 {
        let details = suggestion_usage_lines(&app.slash_suggestions[selected]);
        if !details.is_empty() {
            lines.push(Line::from(Span::styled("", default_style)));
            for detail in details {
                lines.push(Line::from(Span::styled(
                    inline_suggestion_detail_line(detail),
                    default_style,
                )));
            }
        }
    }

    lines
}

pub(in crate::ui) fn build_file_reference_suggestion_lines(
    app: &TuiViewModel,
    max_items: usize,
    default_style: Style,
    selected_style: Style,
) -> Vec<Line<'static>> {
    let selected = app.selected_suggestion;
    let total = app.slash_suggestions.len();
    let (start, end) = inline_picker_bounds(total, selected, max_items);

    let mut lines = Vec::new();
    for idx in start..end {
        let path = &app.slash_suggestions[idx];
        let is_selected = idx == selected;
        let style = if is_selected {
            selected_style
        } else {
            default_style
        };
        let prefix = picker_selection_prefix(is_selected);
        lines.push(Line::from(Span::styled(
            format!("{}{}", prefix, path.label),
            style,
        )));
    }

    lines
}

pub(in crate::ui) fn input_suggestion_title(app: &TuiViewModel) -> String {
    match app.input_suggestion_kind {
        Some(InputSuggestionKind::Slash) => t!("ui.suggestion.title.slash").into_owned(),
        Some(InputSuggestionKind::FileReference) => {
            t!("ui.suggestion.title.file_reference").into_owned()
        }
        None => t!("ui.suggestion.title.generic").into_owned(),
    }
}

pub(in crate::ui) fn suggestion_summary(suggestion: &InputSuggestion) -> String {
    if !suggestion.summary.is_empty() {
        return suggestion.summary.clone();
    }

    match suggestion.label.as_str() {
        "/help" => t!("ui.suggestion.summary.help").into_owned(),
        "/clear" => t!("ui.suggestion.summary.clear").into_owned(),
        "/new" => t!("ui.suggestion.summary.new").into_owned(),
        "/quit" | "/exit" => t!("ui.suggestion.summary.quit").into_owned(),
        "/continue" => t!("ui.suggestion.summary.continue").into_owned(),
        "/loop" => t!("ui.suggestion.summary.loop").into_owned(),
        "/model" => t!("ui.suggestion.summary.model").into_owned(),
        "/compact" => t!("ui.suggestion.summary.compact").into_owned(),
        "/session" => t!("ui.suggestion.summary.sessions").into_owned(),
        "/rewind" => t!("ui.suggestion.summary.rewind").into_owned(),
        "/fork" => t!("ui.suggestion.summary.fork").into_owned(),
        "/subagent" => t!("ui.suggestion.summary.subagents").into_owned(),
        "/image" => t!("ui.suggestion.summary.image").into_owned(),
        "/mcp" => t!("ui.suggestion.summary.mcp").into_owned(),
        "/hook" => t!("ui.suggestion.summary.hooks").into_owned(),
        "/rule" => t!("ui.suggestion.summary.rules").into_owned(),
        "/skill" => t!("ui.suggestion.summary.skills").into_owned(),
        "/extension" => t!("ui.suggestion.summary.extensions").into_owned(),
        "/log" => t!("ui.suggestion.summary.log").into_owned(),
        "/language" => t!("ui.suggestion.summary.language").into_owned(),
        "/approval" => t!("ui.suggestion.summary.approval").into_owned(),
        "/network" => t!("ui.suggestion.summary.networks").into_owned(),
        "/tui" => t!("ui.suggestion.summary.tui").into_owned(),
        "/start-implementing" => t!("ui.suggestion.summary.start_implementing").into_owned(),
        _ => String::new(),
    }
}

pub(in crate::ui) fn suggestion_usage_lines(suggestion: &InputSuggestion) -> Vec<String> {
    if !suggestion.details.is_empty() {
        let mut lines = vec![t!("ui.suggestion.usage.heading").into_owned()];
        lines.extend(
            suggestion
                .details
                .iter()
                .map(|detail| format!("    {}", detail)),
        );
        return lines;
    }

    match suggestion.label.as_str() {
        "/continue" => vec![
            t!("ui.suggestion.usage.heading").into_owned(),
            "    /continue".to_string(),
            t!("ui.suggestion.usage.continue_note").into_owned(),
        ],
        "/loop" => vec![
            t!("ui.suggestion.usage.heading").into_owned(),
            "    /loop".to_string(),
            "    /loop on".to_string(),
            "    /loop off".to_string(),
            "    /loop status".to_string(),
            t!("ui.suggestion.usage.loop_note").into_owned(),
        ],
        "/model" => vec![
            t!("ui.suggestion.usage.heading").into_owned(),
            "    /model list".to_string(),
            "    /model use <name>".to_string(),
            t!("ui.suggestion.usage.model.add_form").into_owned(),
            t!("ui.suggestion.usage.model.add_cli").into_owned(),
            "    /model remove <name>".to_string(),
        ],
        "/session" => vec![
            t!("ui.suggestion.usage.heading").into_owned(),
            "    /session".to_string(),
            "    /session save [path]".to_string(),
            "    /session load <file>".to_string(),
        ],
        "/rewind" => vec![
            t!("ui.suggestion.usage.heading").into_owned(),
            "    /rewind".to_string(),
            "    /rewind <index> [new_message]".to_string(),
            t!("ui.suggestion.usage.rewind.note").into_owned(),
        ],
        "/fork" => vec![
            t!("ui.suggestion.usage.heading").into_owned(),
            "    /fork".to_string(),
            t!("ui.suggestion.usage.fork.note").into_owned(),
        ],
        "/subagent" => vec![
            t!("ui.suggestion.usage.heading").into_owned(),
            "    /subagent".to_string(),
            "    /subagent list".to_string(),
            "    /subagent open <session_id>".to_string(),
            "    /subagent close".to_string(),
            t!("ui.suggestion.usage.subagents.note").into_owned(),
        ],
        "/image" => vec![
            t!("ui.suggestion.usage.heading").into_owned(),
            "    /image <path> [prompt]".to_string(),
            "    /image pick".to_string(),
            "    /image clear".to_string(),
        ],
        "/mcp" => vec![
            t!("ui.suggestion.usage.heading").into_owned(),
            "    /mcp".to_string(),
            "    /mcp list".to_string(),
            "    /mcp add".to_string(),
            "    /mcp inspect [server]".to_string(),
            "    /mcp tools [server]".to_string(),
            "    /mcp resources [server]".to_string(),
            "    /mcp prompts [server]".to_string(),
            "    /<server>_<prompt> [args_json | user_message]".to_string(),
            t!("ui.suggestion.usage.note").into_owned(),
            t!("ui.suggestion.usage.mcp_note").into_owned(),
        ],
        "/hook" => vec![
            t!("ui.suggestion.usage.heading").into_owned(),
            "    /hook".to_string(),
            "    /hook list".to_string(),
            "    /hook add".to_string(),
            t!("ui.suggestion.usage.note").into_owned(),
            t!("ui.suggestion.usage.hooks_note").into_owned(),
        ],
        "/rule" => vec![
            t!("ui.suggestion.usage.heading").into_owned(),
            "    /rule".to_string(),
        ],
        "/skill" => vec![
            t!("ui.suggestion.usage.heading").into_owned(),
            "    /skill".to_string(),
        ],
        "/extension" => vec![
            t!("ui.suggestion.usage.heading").into_owned(),
            "    /extension".to_string(),
            "    /extension list".to_string(),
            "    /extension import <zip>".to_string(),
            "    /extension remove <id>".to_string(),
        ],
        "/log" => vec![
            t!("ui.suggestion.usage.heading").into_owned(),
            "    /log".to_string(),
            "    /log export".to_string(),
            "    /log session export".to_string(),
        ],
        "/language" => {
            let mut lines = vec![
                t!("ui.suggestion.usage.heading").into_owned(),
                "    /language".to_string(),
            ];
            lines.extend(
                crate::locale::supported_ui_locales()
                    .iter()
                    .map(|locale| format!("    /language {locale}")),
            );
            lines
        }
        "/approval" => vec![
            t!("ui.suggestion.usage.heading").into_owned(),
            "    /approval".to_string(),
            "    /approval default".to_string(),
            "    /approval bypass-approval".to_string(),
        ],
        "/network" => vec![
            t!("ui.suggestion.usage.heading").into_owned(),
            "    /network".to_string(),
            "    /network http1.1".to_string(),
            "    /network http2".to_string(),
        ],
        "/tui" => vec![
            t!("ui.suggestion.usage.heading").into_owned(),
            "    /tui".to_string(),
            "    /tui inline".to_string(),
            "    /tui fullscreen".to_string(),
        ],
        "/start-implementing" => vec![
            t!("ui.suggestion.usage.heading").into_owned(),
            "    /start-implementing".to_string(),
            t!("ui.suggestion.usage.start_implementing_note").into_owned(),
        ],
        _ => Vec::new(),
    }
}

pub(in crate::ui) fn build_model_picker_lines(
    app: &TuiViewModel,
    max_items: usize,
) -> Vec<Line<'static>> {
    let models = app.config.flatten_models();
    if models.is_empty() {
        return vec![Line::from(t!("ui.picker.models.empty").into_owned())];
    }

    let selected = app.model_picker_index.min(models.len().saturating_sub(1));
    let total = models.len();
    let (start, end) = inline_picker_bounds(total, selected, max_items);

    let mut lines = Vec::new();
    for (idx, model) in models.iter().enumerate().take(end).skip(start) {
        let is_selected = idx == selected;
        let is_active = model.group_id == app.config.active_model.group_id
            && model.name == app.config.active_model.name;
        let display_title = crate::model_catalog_display::model_display_title(
            &model.name,
            &app.model_display_titles,
        );

        let active_suffix = if is_active {
            t!("ui.picker.models.current_suffix").into_owned()
        } else {
            String::new()
        };
        let row_style = inline_picker_text_style(is_selected);
        let meta_style = inline_picker_meta_style(is_selected);
        let meta_suffix = if display_title != model.name {
            format!(" ({})", model.name)
        } else {
            format!(" ({})", model.api_base)
        };

        lines.push(Line::from(vec![
            Span::styled(picker_selection_prefix(is_selected), row_style),
            Span::styled(display_title.to_string(), row_style),
            Span::styled(meta_suffix, meta_style),
            Span::styled(active_suffix, meta_style),
        ]));
    }

    lines
}

pub(in crate::ui) fn build_chat_picker_lines(
    app: &TuiViewModel,
    max_items: usize,
) -> Vec<Line<'static>> {
    if app.chat_picker_sessions.is_empty() {
        return vec![Line::from(t!("ui.picker.sessions.empty").into_owned())];
    }

    let selected = app
        .chat_picker_index
        .min(app.chat_picker_sessions.len().saturating_sub(1));
    let total = app.chat_picker_sessions.len();
    let (start, end) = inline_picker_bounds(total, selected, max_items);

    let mut lines = Vec::new();
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let locale = crate::locale::resolve_ui_locale(&app.config);
    let relative_time = crate::relative_time::RelativeTimeEngine::new(&locale);
    for idx in start..end {
        let session = &app.chat_picker_sessions[idx];
        let is_selected = idx == selected;
        let row_style = inline_picker_text_style(is_selected);
        let meta_style = inline_picker_meta_style(is_selected);
        let relative = relative_time.format(session.modified_at_unix_ms, now_ms);
        lines.push(Line::from(vec![
            Span::styled(picker_selection_prefix(is_selected), row_style),
            Span::styled(session.display_name.clone(), row_style),
            Span::styled(format!(" {relative}"), meta_style),
        ]));
    }

    lines
}

pub(in crate::ui) fn build_subagent_picker_lines(
    app: &TuiViewModel,
    max_items: usize,
) -> Vec<Line<'static>> {
    if app.subagent_sessions.is_empty() {
        return vec![Line::from(t!("ui.picker.subagents.empty").into_owned())];
    }

    let selected = app
        .subagent_picker_index
        .min(app.subagent_sessions.len().saturating_sub(1));
    let total = app.subagent_sessions.len();
    let (start, end) = inline_picker_bounds(total, selected, max_items);

    let mut lines = Vec::new();
    for idx in start..end {
        let item = &app.subagent_sessions[idx];
        let is_selected = idx == selected;
        let (status_label, _) = subagent_status_badge(item.status, false);
        let row_style = inline_picker_text_style(is_selected);
        let meta_style = inline_picker_meta_style(is_selected);
        lines.push(Line::from(vec![
            Span::styled(picker_selection_prefix(is_selected), row_style),
            Span::styled(item.title.clone(), row_style),
            Span::styled(format!("  [{status_label}]"), meta_style),
        ]));
    }

    lines
}

pub(crate) fn approval_level_label(level: &str) -> String {
    match crate::ports::normalize_approval_level(level).as_str() {
        "bypass-approval" => t!("ui.footer.approval.bypass").into_owned(),
        "auto-approval" => t!("ui.footer.approval.auto").into_owned(),
        _ => t!("ui.footer.approval.default").into_owned(),
    }
}

/// Footer accent for approval levels (TUI palette; loosely aligned with Desktop).
pub(in crate::ui) fn approval_level_accent_color(level: &str) -> Option<Color> {
    match crate::ports::normalize_approval_level(level).as_str() {
        "bypass-approval" => Some(Color::Yellow),
        "auto-approval" => Some(Color::Rgb(96, 165, 250)),
        _ => None,
    }
}

pub(crate) fn llm_http_version_label(version: &str) -> String {
    if crate::ports::normalize_llm_http_version(version) == "http1.1" {
        t!("ui.footer.networks.http11").into_owned()
    } else {
        t!("ui.footer.networks.http2").into_owned()
    }
}

pub(crate) fn tui_mode_label(mode: &str) -> String {
    if crate::ports::normalize_tui_mode(mode) == crate::ports::TUI_MODE_FULLSCREEN {
        t!("ui.picker.tui.fullscreen").into_owned()
    } else {
        t!("ui.picker.tui.inline").into_owned()
    }
}

pub(in crate::ui) fn build_approval_picker_lines(
    app: &TuiViewModel,
    max_items: usize,
) -> Vec<Line<'static>> {
    const OPTIONS: [&str; 3] = ["default", "auto-approval", "bypass-approval"];
    let selected = app
        .approval_picker_index
        .min(OPTIONS.len().saturating_sub(1));
    let total = OPTIONS.len();
    let (start, end) = inline_picker_bounds(total, selected, max_items);

    let mut lines = Vec::new();
    for (idx, level) in OPTIONS.iter().enumerate().take(end).skip(start) {
        let is_selected = idx == selected;
        let row_style = inline_picker_text_style(is_selected);
        lines.push(Line::from(vec![
            Span::styled(picker_selection_prefix(is_selected), row_style),
            Span::styled(approval_level_label(level), row_style),
        ]));
    }

    lines
}

pub(in crate::ui) fn build_network_picker_lines(
    app: &TuiViewModel,
    max_items: usize,
) -> Vec<Line<'static>> {
    const OPTIONS: [&str; 2] = ["http1.1", "http2"];
    let selected = app
        .network_picker_index
        .min(OPTIONS.len().saturating_sub(1));
    let total = OPTIONS.len();
    let (start, end) = inline_picker_bounds(total, selected, max_items);

    let mut lines = Vec::new();
    for (idx, version) in OPTIONS.iter().enumerate().take(end).skip(start) {
        let is_selected = idx == selected;
        let row_style = inline_picker_text_style(is_selected);
        lines.push(Line::from(vec![
            Span::styled(picker_selection_prefix(is_selected), row_style),
            Span::styled(llm_http_version_label(version), row_style),
        ]));
    }

    lines
}

pub(in crate::ui) fn build_tui_picker_lines(
    app: &TuiViewModel,
    max_items: usize,
) -> Vec<Line<'static>> {
    const OPTIONS: [&str; 2] = [
        crate::ports::TUI_MODE_INLINE,
        crate::ports::TUI_MODE_FULLSCREEN,
    ];
    let selected = app.tui_picker_index.min(OPTIONS.len().saturating_sub(1));
    let total = OPTIONS.len();
    let (start, end) = inline_picker_bounds(total, selected, max_items);

    let mut lines = Vec::new();
    for (idx, mode) in OPTIONS.iter().enumerate().take(end).skip(start) {
        let is_selected = idx == selected;
        let row_style = inline_picker_text_style(is_selected);
        lines.push(Line::from(vec![
            Span::styled(picker_selection_prefix(is_selected), row_style),
            Span::styled(tui_mode_label(mode), row_style),
        ]));
    }

    lines
}

pub(in crate::ui) fn build_language_picker_lines(
    app: &TuiViewModel,
    max_items: usize,
) -> Vec<Line<'static>> {
    let locales = crate::locale::supported_ui_locales();
    let selected = app
        .language_picker_index
        .min(locales.len().saturating_sub(1));
    let total = locales.len();
    let window = max_items.max(1);
    let start = (selected + 1).saturating_sub(window);
    let end = (start + window).min(total);

    let current_locale = rust_i18n::locale().to_string();
    let mut lines = Vec::new();
    for (idx, locale_code) in locales.iter().enumerate().take(end).skip(start) {
        let is_selected = idx == selected;
        let is_active = *locale_code == current_locale.as_str();
        let active_suffix = if is_active {
            t!("ui.picker.languages.current_suffix").into_owned()
        } else {
            String::new()
        };
        let style = if is_selected {
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD | Modifier::REVERSED)
        } else if is_active {
            Style::default()
                .fg(Color::Green)
                .add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(Color::White)
        };
        lines.push(Line::from(Span::styled(
            format!(
                "{}{} ({}){}",
                picker_selection_prefix(is_selected),
                crate::locale::language_display_name(locale_code),
                locale_code,
                active_suffix
            ),
            style,
        )));
    }

    lines
}

pub(in crate::ui) fn build_image_picker_lines(
    app: &TuiViewModel,
    max_items: usize,
) -> Vec<Line<'static>> {
    if app.image_picker_files.is_empty() {
        return vec![Line::from(t!("ui.picker.images.empty").into_owned())];
    }

    let selected = app
        .image_picker_index
        .min(app.image_picker_files.len().saturating_sub(1));
    let total = app.image_picker_files.len();
    let window = max_items.max(1);
    let start = (selected + 1).saturating_sub(window);
    let end = (start + window).min(total);

    let mut lines = Vec::new();
    for idx in start..end {
        let name = &app.image_picker_files[idx];
        let is_selected = idx == selected;
        let style = if is_selected {
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD | Modifier::REVERSED)
        } else {
            Style::default().fg(Color::White)
        };
        lines.push(Line::from(Span::styled(
            format!("{}{}", picker_selection_prefix(is_selected), name),
            style,
        )));
    }

    lines
}
