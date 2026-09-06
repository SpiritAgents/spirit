use ratatui::layout::Alignment;

use super::*;
use crate::word_wrap::{LineComposer, WordWrapper};

/// Row count of `lines` rendered with `Wrap { trim: true }` at `width`,
/// measured with the vendored WordWrapper — the repo's authoritative wrapping
/// pipeline. ratatui's `Paragraph::line_count` stays unstable-gated upstream
/// (ratatui#293); see SPIRIT-8 for adopting it once stabilized.
fn wrapped_line_count(lines: &[Line<'static>], width: u16) -> usize {
    let mut count = 0;
    for line in lines {
        let alignment = line.alignment.unwrap_or(Alignment::Left);
        let graphemes = line.styled_graphemes(Style::default()).collect::<Vec<_>>();
        let mut composer = WordWrapper::new(
            std::iter::once((graphemes.into_iter(), alignment)),
            width,
            true,
        );
        while composer.next_line().is_some() {
            count += 1;
        }
    }
    count
}

pub(in crate::ui) fn marketplace_review_label(status: &str) -> String {
    match status.trim() {
        "verified" => t!("tui.marketplace.status_verified").into_owned(),
        "revoked" => t!("tui.marketplace.status_revoked").into_owned(),
        _ => t!("tui.marketplace.status_unverified").into_owned(),
    }
}

pub(in crate::ui) fn review_status_style(status: &str) -> Style {
    match status.trim() {
        "verified" => Style::default()
            .fg(Color::Rgb(228, 228, 228))
            .add_modifier(Modifier::BOLD),
        "revoked" => Style::default()
            .fg(Color::Rgb(135, 135, 135))
            .add_modifier(Modifier::DIM),
        _ => Style::default().fg(Color::Rgb(175, 175, 175)),
    }
}

pub(in crate::ui) fn draw_marketplace_view(
    frame: &mut ratatui::Frame<'_>,
    area: Rect,
    view: &MarketplaceViewModel,
) {
    frame.render_widget(Clear, area);
    match view.step {
        crate::view::MarketplaceFlowStep::CatalogPicker => {
            draw_marketplace_catalog_picker(frame, area, view);
        }
        _ => draw_marketplace_detail_page(frame, area, view),
    }
}

pub(in crate::ui) fn marketplace_panel_height(
    view: &MarketplaceViewModel,
    panel_height: u16,
    panel_width: u16,
    input_height: u16,
) -> u16 {
    let available = panel_height.saturating_sub(input_height).max(8);
    match view.step {
        crate::view::MarketplaceFlowStep::CatalogPicker => {
            let half = available.saturating_add(1) / 2;
            available.min(half.max(8))
        }
        _ => {
            // The detail page hugs its content: wrap-aware overview height
            // plus a one-row gap and the borderless actions form, capped by
            // the available space.
            let content_width = inline_picker_area(Rect::new(0, 0, panel_width, 1)).width;
            let overview_lines = view
                .detail
                .as_ref()
                .map(|detail| {
                    wrapped_line_count(
                        &build_marketplace_overview_lines(
                            detail,
                            Style::default(),
                            Style::default(),
                        ),
                        content_width,
                    )
                })
                .unwrap_or(1);
            let needed = (overview_lines as u16)
                .saturating_add(1)
                .saturating_add(marketplace_detail_actions_height(view, content_width));
            available.min(needed)
        }
    }
}

/// Height of the detail page's borderless actions form: header rows (search /
/// error) plus the rendered item lines.
fn marketplace_detail_actions_height(view: &MarketplaceViewModel, width: u16) -> u16 {
    let header = slash_flow_header_height(&view.slash, view.error.as_deref());
    let items = build_slash_flow_lines(
        &view.slash,
        width.saturating_sub(1) as usize,
        view.slash.compact_items,
    )
    .len() as u16;
    header + items
}

/// Catalog step: search line on top, the borderless source bar below it, then
/// the filtered list (matching the Desktop "search above, source bar below" order).
pub(in crate::ui) fn draw_marketplace_catalog_picker(
    frame: &mut ratatui::Frame<'_>,
    area: Rect,
    view: &MarketplaceViewModel,
) {
    // The source bar hides when no source tab is visible (all sources empty).
    let source_bar_height: u16 = if view.sources.is_empty() { 0 } else { 1 };
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(source_bar_height), Constraint::Min(1)])
        .split(area);

    if source_bar_height > 0 {
        // Same inset as the list body below, so the bar starts where the ">" indicator does.
        draw_marketplace_source_bar(frame, inline_picker_area(chunks[0]), view);
    }
    draw_slash_flow_body(
        frame,
        inline_picker_area(chunks[1]),
        &view.slash,
        view.error.as_deref(),
    );
}

/// Horizontal source bar without a border; the active source is highlighted.
/// Left/Right switches sources while the list keeps focus.
fn draw_marketplace_source_bar(
    frame: &mut ratatui::Frame<'_>,
    area: Rect,
    view: &MarketplaceViewModel,
) {
    let mut spans = vec![Span::styled(
        t!("tui.marketplace.source_bar_label").into_owned(),
        subtle_aux_text_style(),
    )];
    for (index, source) in view.sources.iter().enumerate() {
        let active = index == view.active_source_index;
        spans.push(Span::raw("  "));
        spans.push(Span::styled(
            source.label.clone(),
            if active {
                inline_picker_text_style(true)
            } else {
                subtle_aux_text_style()
            },
        ));
    }
    frame.render_widget(Paragraph::new(Line::from(spans)), area);
}

/// Borderless detail page, matching the catalog's minimal style: overview on
/// top, a one-row gap, then the actions form. The gap keeps the actionable
/// form visually separate from the read-only info above.
pub(in crate::ui) fn draw_marketplace_detail_page(
    frame: &mut ratatui::Frame<'_>,
    area: Rect,
    view: &MarketplaceViewModel,
) {
    let content = inline_picker_area(area);
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Min(1),
            Constraint::Length(1),
            Constraint::Length(marketplace_detail_actions_height(view, content.width)),
        ])
        .split(content);

    render_marketplace_overview(
        frame,
        chunks[0],
        view,
        Style::default().fg(Color::Rgb(225, 225, 225)),
        subtle_aux_text_style(),
    );
    draw_slash_flow_body(frame, chunks[2], &view.slash, view.error.as_deref());
}

/// Overview content lines of the detail page. Shared by the renderer and the
/// panel-height measurement so the two never drift.
fn build_marketplace_overview_lines(
    detail: &crate::view::MarketplaceDetailView,
    title_style: Style,
    subtle_style: Style,
) -> Vec<Line<'static>> {
    let mut lines = vec![Line::from(vec![
        Span::styled(detail.display_name.clone(), title_style),
        Span::raw("  "),
        Span::styled(format!("@{}", detail.version), subtle_style),
        Span::raw("  "),
        Span::styled(
            marketplace_review_label(&detail.review_status),
            review_status_style(&detail.review_status),
        ),
        Span::raw("  "),
        Span::styled(
            detail
                .installed_version
                .as_ref()
                .map(|installed| {
                    t!("tui.marketplace.installed_version", version = installed).into_owned()
                })
                .unwrap_or_else(|| t!("tui.marketplace.not_installed").into_owned()),
            Style::default().fg(Color::Rgb(215, 215, 215)),
        ),
    ])];

    if !detail.description.trim().is_empty() {
        let mut description = String::new();
        if let Some(author) = detail.author.as_deref() {
            description.push_str(author);
            description.push_str(" · ");
        }
        description.push_str(&detail.description);
        lines.push(Line::from(Span::styled(description, subtle_style)));
    }

    if !detail.supported_hosts.is_empty() || !detail.requested_capabilities.is_empty() {
        let mut capability_spans = vec![Span::styled(
            t!("tui.marketplace.detail_capabilities_label").into_owned(),
            subtle_style,
        )];
        capability_spans.push(Span::styled(
            detail.supported_hosts.join(", "),
            Style::default().fg(Color::Rgb(185, 185, 185)),
        ));
        if !detail.requested_capabilities.is_empty() {
            capability_spans.push(Span::raw("  ·  "));
            capability_spans.push(Span::styled(
                detail.requested_capabilities.join(", "),
                Style::default().fg(Color::Rgb(185, 185, 185)),
            ));
        }
        lines.push(Line::from(capability_spans));
    }

    for line in &detail.contribution_lines {
        lines.push(Line::from(Span::styled(line.clone(), subtle_style)));
    }

    lines
}

pub(in crate::ui) fn render_marketplace_overview(
    frame: &mut ratatui::Frame<'_>,
    area: Rect,
    view: &MarketplaceViewModel,
    title_style: Style,
    subtle_style: Style,
) {
    let Some(detail) = view.detail.as_ref() else {
        frame.render_widget(
            Paragraph::new(t!("tui.marketplace.detail_not_found").into_owned())
                .wrap(Wrap { trim: true }),
            area,
        );
        return;
    };

    let lines = build_marketplace_overview_lines(detail, title_style, subtle_style);
    frame.render_widget(Paragraph::new(lines).wrap(Wrap { trim: true }), area);
}

/// Header rows of a slash flow body: the search line (plus its blank spacer)
/// and/or the error line.
fn slash_flow_header_height(flow: &crate::view::SlashFlowView, error: Option<&str>) -> u16 {
    if flow.search.is_some() {
        if error.is_some() { 3 } else { 2 }
    } else if error.is_some() {
        1
    } else {
        0
    }
}

pub(in crate::ui) fn draw_slash_flow_body(
    frame: &mut ratatui::Frame<'_>,
    area: Rect,
    flow: &crate::view::SlashFlowView,
    error: Option<&str>,
) {
    let subtle_style = subtle_aux_text_style();
    let title_style = Style::default().fg(Color::Rgb(225, 225, 225));
    let header_height = slash_flow_header_height(flow, error);
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(header_height), Constraint::Min(1)])
        .split(area);

    if header_height > 0 {
        let mut header_lines = Vec::new();
        if let Some(search) = flow.search.as_ref() {
            header_lines.push(Line::from(vec![
                Span::styled(
                    t!("tui.marketplace.search_label").into_owned(),
                    subtle_style,
                ),
                Span::styled(
                    if search.value.trim().is_empty() {
                        search.placeholder.clone()
                    } else {
                        search.value.clone()
                    },
                    if search.value.trim().is_empty() {
                        subtle_style.add_modifier(Modifier::DIM)
                    } else {
                        title_style
                    },
                ),
            ]));
            header_lines.push(Line::from(""));
        }
        if let Some(error) = error {
            header_lines.push(Line::from(Span::styled(
                truncate_to_width(error, chunks[0].width.saturating_sub(1) as usize),
                Style::default().fg(Color::Rgb(220, 220, 220)),
            )));
        }
        frame.render_widget(
            Paragraph::new(header_lines).wrap(Wrap { trim: true }),
            chunks[0],
        );
    }

    let body_lines = build_slash_flow_lines(
        flow,
        chunks[1].width.saturating_sub(1) as usize,
        flow.compact_items,
    );
    frame.render_widget(
        Paragraph::new(body_lines).wrap(Wrap { trim: false }),
        chunks[1],
    );
}

pub(in crate::ui) fn build_slash_flow_lines(
    flow: &crate::view::SlashFlowView,
    width: usize,
    compact_items: bool,
) -> Vec<Line<'static>> {
    if flow.items.is_empty() {
        return vec![Line::from(Span::styled(
            flow.empty_text.clone(),
            subtle_aux_text_style(),
        ))];
    }

    flow.items
        .iter()
        .enumerate()
        .flat_map(|(index, item)| {
            let is_selected = index == flow.selected_index;
            let label_style = if item.disabled {
                Style::default().fg(Color::Rgb(125, 125, 125))
            } else if is_selected {
                inline_picker_text_style(true)
            } else if item.muted {
                Style::default().fg(Color::Rgb(155, 155, 155))
            } else {
                inline_picker_text_style(false)
            };
            let mut lines = vec![Line::from(vec![
                Span::styled(picker_selection_prefix(is_selected), label_style),
                Span::styled(
                    truncate_to_width(&item.label, width.saturating_sub(2)),
                    label_style,
                ),
            ])];

            if !item.summary.trim().is_empty() {
                let summary_indent = "  ";
                let summary_width = width.saturating_sub(summary_indent.len());
                lines.push(Line::from(Span::styled(
                    format!(
                        "{}{}",
                        summary_indent,
                        truncate_to_width(&item.summary, summary_width)
                    ),
                    if item.disabled {
                        Style::default().fg(Color::Rgb(115, 115, 115))
                    } else {
                        inline_picker_meta_style(is_selected)
                    },
                )));
            }

            if !compact_items {
                for detail in &item.details {
                    if detail.trim().is_empty() {
                        continue;
                    }
                    lines.push(Line::from(Span::styled(
                        format!("  {}", truncate_to_width(detail, width.saturating_sub(2))),
                        Style::default().fg(Color::Rgb(145, 145, 145)),
                    )));
                }
            }

            // Multi-row items (summary / details) read as cards: separate them
            // with a blank row. Single-line action rows pack tight.
            if lines.len() > 1 {
                lines.push(Line::from(""));
            }
            lines
        })
        .collect()
}
