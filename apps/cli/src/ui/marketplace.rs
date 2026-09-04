use super::*;

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
    input_height: u16,
) -> u16 {
    let available = panel_height.saturating_sub(input_height).max(8);
    match view.step {
        crate::view::MarketplaceFlowStep::CatalogPicker => {
            let half = available.saturating_add(1) / 2;
            available.min(half.max(8))
        }
        _ => {
            let expanded = available.saturating_mul(4) / 5;
            available.min(expanded.max(22))
        }
    }
}

/// Catalog step: search line on top, the borderless source bar below it, then
/// the filtered list (matching the Desktop "search above, source bar below" order).
pub(in crate::ui) fn draw_marketplace_catalog_picker(
    frame: &mut ratatui::Frame<'_>,
    area: Rect,
    view: &MarketplaceViewModel,
) {
    let source_bar_height: u16 = 1;
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(source_bar_height), Constraint::Min(1)])
        .split(area);

    draw_marketplace_source_bar(frame, chunks[0], view);
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

pub(in crate::ui) fn draw_marketplace_detail_page(
    frame: &mut ratatui::Frame<'_>,
    area: Rect,
    view: &MarketplaceViewModel,
) {
    let border_style = input_block_border_style(false, MainInputMode::Agent, false);
    let panel_title_style = Style::default().fg(Color::Rgb(225, 225, 225));
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(border_style)
        .title(Line::from(Span::styled(
            t!("tui.marketplace.detail_title").into_owned(),
            border_style,
        )));
    frame.render_widget(block.clone(), area);
    let inner = block.inner(area);
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Min(6), Constraint::Length(8)])
        .split(inner);

    render_marketplace_overview(
        frame,
        chunks[0],
        view,
        panel_title_style,
        subtle_aux_text_style(),
    );
    draw_slash_flow_panel(frame, chunks[1], &view.slash, view.error.as_deref());
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

    lines.push(Line::from(vec![
        Span::styled("id ", subtle_style),
        Span::styled(
            detail.id.clone(),
            Style::default().fg(Color::Rgb(205, 205, 205)),
        ),
    ]));

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

    frame.render_widget(Paragraph::new(lines).wrap(Wrap { trim: true }), area);
}

pub(in crate::ui) fn draw_slash_flow_panel(
    frame: &mut ratatui::Frame<'_>,
    area: Rect,
    flow: &crate::view::SlashFlowView,
    error: Option<&str>,
) {
    let border_style = input_block_border_style(false, MainInputMode::Agent, false);
    let title_style = Style::default().fg(Color::Rgb(225, 225, 225));
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(border_style)
        .title(Line::from(Span::styled(flow.title.clone(), title_style)));
    frame.render_widget(block.clone(), area);
    let inner = block.inner(area);
    draw_slash_flow_body(frame, inner, flow, error);
}

pub(in crate::ui) fn draw_slash_flow_body(
    frame: &mut ratatui::Frame<'_>,
    area: Rect,
    flow: &crate::view::SlashFlowView,
    error: Option<&str>,
) {
    let subtle_style = subtle_aux_text_style();
    let title_style = Style::default().fg(Color::Rgb(225, 225, 225));
    let header_height = if flow.search.is_some() {
        if error.is_some() { 3 } else { 2 }
    } else if error.is_some() {
        1
    } else {
        0
    };
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

            lines.push(Line::from(""));
            lines
        })
        .collect()
}
