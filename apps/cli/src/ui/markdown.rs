use comrak::{
    Arena, Options,
    nodes::{AstNode, ListType, NodeValue},
    parse_document,
};
use ratatui::{
    style::{Color, Modifier, Style},
    text::Span,
};
use std::{cell::RefCell, collections::HashMap};
use unicode_width::UnicodeWidthStr;

use super::theme::conversation_body_text_style;

thread_local! {
    static MARKDOWN_CACHE: RefCell<HashMap<String, Vec<Vec<Span<'static>>>>> =
        RefCell::new(HashMap::new());
}

pub(in crate::ui) fn markdown_lines(text: &str) -> Vec<Vec<Span<'static>>> {
    markdown_lines_with_style(text, conversation_body_text_style())
}

pub(in crate::ui) fn markdown_lines_with_style(
    text: &str,
    body_style: Style,
) -> Vec<Vec<Span<'static>>> {
    let cache_key = markdown_cache_key(text, body_style);
    MARKDOWN_CACHE.with(|cache| {
        let mut cache = cache.borrow_mut();
        if let Some(hit) = cache.get(&cache_key) {
            return hit.clone();
        }

        let arena = Arena::new();
        let root = parse_document(&arena, text, &markdown_options());

        let mut builder = MdBuilder::new();
        render_markdown_node(root, &mut builder, body_style, 0, false);
        let parsed = builder.into_lines();

        if cache.len() > 512 {
            cache.clear();
        }
        cache.insert(cache_key, parsed.clone());
        parsed
    })
}

fn markdown_cache_key(text: &str, body_style: Style) -> String {
    format!(
        "{text}\u{1f}fg={:?};mod={:?}",
        body_style.fg, body_style.add_modifier
    )
}

fn markdown_options() -> Options<'static> {
    let mut opts = Options::default();
    opts.extension.strikethrough = true;
    opts.extension.table = true;
    opts.extension.tasklist = true;
    opts.extension.autolink = true;
    opts.extension.superscript = true;
    opts.render.hardbreaks = true;
    opts
}

fn render_markdown_node<'a>(
    node: &'a AstNode<'a>,
    builder: &mut MdBuilder,
    style: Style,
    list_depth: usize,
    in_table_cell: bool,
) {
    match &node.data.borrow().value {
        NodeValue::Document => {
            for child in node.children() {
                render_markdown_node(child, builder, style, list_depth, false);
            }
        }
        NodeValue::Paragraph => {
            for child in node.children() {
                render_markdown_node(child, builder, style, list_depth, in_table_cell);
            }
            if !in_table_cell {
                builder.new_line();
            }
        }
        NodeValue::Heading(heading) => {
            let h_style = style
                .fg(Color::Yellow)
                .add_modifier(Modifier::BOLD)
                .add_modifier(if heading.level <= 2 {
                    Modifier::UNDERLINED
                } else {
                    Modifier::empty()
                });
            for child in node.children() {
                render_markdown_node(child, builder, h_style, list_depth, in_table_cell);
            }
            if !in_table_cell {
                builder.new_line();
            }
        }
        NodeValue::Text(text) => {
            builder.push_span(Span::styled(text.to_string(), style));
        }
        NodeValue::Code(code) => {
            builder.push_span(Span::styled(
                format!("`{}`", code.literal),
                style.fg(Color::Magenta),
            ));
        }
        NodeValue::CodeBlock(code) => {
            builder.new_line();
            let code_style = Style::default().fg(Color::Cyan);
            for line in code.literal.lines() {
                builder.push_span(Span::styled(format!("  {}", line), code_style));
                builder.new_line();
            }
            builder.new_line();
        }
        NodeValue::Strong => {
            let strong_style = style.add_modifier(Modifier::BOLD);
            for child in node.children() {
                render_markdown_node(child, builder, strong_style, list_depth, in_table_cell);
            }
        }
        NodeValue::Emph => {
            let emph_style = style.add_modifier(Modifier::ITALIC);
            for child in node.children() {
                render_markdown_node(child, builder, emph_style, list_depth, in_table_cell);
            }
        }
        NodeValue::Strikethrough => {
            let strike_style = style.add_modifier(Modifier::CROSSED_OUT);
            for child in node.children() {
                render_markdown_node(child, builder, strike_style, list_depth, in_table_cell);
            }
        }
        NodeValue::SoftBreak | NodeValue::LineBreak => {
            if !in_table_cell {
                builder.new_line();
            } else {
                builder.push_span(Span::raw(" "));
            }
        }
        NodeValue::ThematicBreak => {
            builder.push_span(Span::styled(
                "--------------------------------".to_string(),
                style.fg(Color::DarkGray),
            ));
            builder.new_line();
        }
        NodeValue::List(list) => {
            let mut idx = 0usize;
            for item in node.children() {
                idx += 1;
                let indent = "  ".repeat(list_depth);
                let marker = match list.list_type {
                    ListType::Bullet => "- ".to_string(),
                    ListType::Ordered => format!("{}. ", idx),
                };
                builder.push_span(Span::raw(indent));
                builder.push_span(Span::styled(
                    marker,
                    Style::default()
                        .fg(Color::Yellow)
                        .add_modifier(Modifier::BOLD),
                ));
                render_markdown_node(item, builder, style, list_depth + 1, false);
                builder.new_line();
            }
        }
        NodeValue::Item(_) => {
            for child in node.children() {
                render_markdown_node(child, builder, style, list_depth, in_table_cell);
            }
        }
        NodeValue::Link(_) => {
            let link_style = style
                .fg(Color::Blue)
                .add_modifier(Modifier::UNDERLINED | Modifier::BOLD);
            for child in node.children() {
                render_markdown_node(child, builder, link_style, list_depth, in_table_cell);
            }
        }
        NodeValue::Table(_) => {
            render_bordered_table(node, builder, style);
        }
        NodeValue::TableRow(_) | NodeValue::TableCell => {}
        _ => {
            for child in node.children() {
                render_markdown_node(child, builder, style, list_depth, in_table_cell);
            }
        }
    }
}

fn collect_table_rows<'a>(table_node: &'a AstNode<'a>) -> Vec<Vec<String>> {
    table_node
        .children()
        .filter_map(|row_node| match &row_node.data.borrow().value {
            NodeValue::TableRow(_) => Some(
                row_node
                    .children()
                    .map(|cell| extract_inline_plain_text(cell))
                    .collect(),
            ),
            _ => None,
        })
        .collect()
}

fn extract_inline_plain_text<'a>(node: &'a AstNode<'a>) -> String {
    let mut out = String::new();
    extract_inline_plain_text_inner(node, &mut out);
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn extract_inline_plain_text_inner<'a>(node: &'a AstNode<'a>, out: &mut String) {
    match &node.data.borrow().value {
        NodeValue::Text(text) => out.push_str(text),
        NodeValue::Code(code) => out.push_str(&code.literal),
        NodeValue::SoftBreak | NodeValue::LineBreak => out.push(' '),
        _ => {
            for child in node.children() {
                extract_inline_plain_text_inner(child, out);
            }
        }
    }
}

fn compute_column_widths(rows: &[Vec<String>]) -> Vec<usize> {
    let column_count = rows.iter().map(|row| row.len()).max().unwrap_or(0);
    let mut widths = vec![0usize; column_count];
    for row in rows {
        for (index, cell) in row.iter().enumerate() {
            widths[index] = widths[index].max(UnicodeWidthStr::width(cell.as_str()));
        }
    }
    widths.into_iter().map(|width| width.max(1)).collect()
}

fn pad_cell(text: &str, width: usize) -> String {
    let visible_width = UnicodeWidthStr::width(text);
    if visible_width >= width {
        text.to_string()
    } else {
        format!("{text}{}", " ".repeat(width - visible_width))
    }
}

fn table_border_style() -> Style {
    Style::default().fg(Color::DarkGray)
}

fn build_table_row_spans(
    cells: &[String],
    column_widths: &[usize],
    row_style: Style,
) -> Vec<Span<'static>> {
    let border_style = table_border_style();
    let mut spans = Vec::new();
    spans.push(Span::styled("│".to_string(), border_style));
    for (index, width) in column_widths.iter().enumerate() {
        let cell = cells.get(index).map(String::as_str).unwrap_or("");
        spans.push(Span::raw(" ".to_string()));
        spans.push(Span::styled(pad_cell(cell, *width), row_style));
        spans.push(Span::raw(" ".to_string()));
        spans.push(Span::styled("│".to_string(), border_style));
    }
    spans
}

fn horizontal_border(left: char, middle: char, right: char, column_widths: &[usize]) -> String {
    let mut line = String::new();
    line.push(left);
    for (index, width) in column_widths.iter().enumerate() {
        line.push_str(&"─".repeat(width + 2));
        if index + 1 < column_widths.len() {
            line.push(middle);
        }
    }
    line.push(right);
    line
}

fn render_bordered_table<'a>(table_node: &'a AstNode<'a>, builder: &mut MdBuilder, style: Style) {
    let rows = collect_table_rows(table_node);
    if rows.is_empty() {
        return;
    }

    let column_widths = compute_column_widths(&rows);
    let border_style = table_border_style();

    builder.new_line();
    builder.push_line_styled(
        horizontal_border('┌', '┬', '┐', &column_widths),
        border_style,
    );

    for (row_index, row) in rows.iter().enumerate() {
        let row_style = if row_index == 0 {
            style.add_modifier(Modifier::BOLD)
        } else {
            style
        };
        builder.push_line_spans(build_table_row_spans(row, &column_widths, row_style));
        if row_index == 0 && rows.len() > 1 {
            builder.push_line_styled(
                horizontal_border('├', '┼', '┤', &column_widths),
                border_style,
            );
        }
    }

    builder.push_line_styled(
        horizontal_border('└', '┴', '┘', &column_widths),
        border_style,
    );
    builder.new_line();
}

struct MdBuilder {
    lines: Vec<Vec<Span<'static>>>,
}

impl MdBuilder {
    fn new() -> Self {
        Self {
            lines: vec![Vec::new()],
        }
    }

    fn push_span(&mut self, span: Span<'static>) {
        if let Some(last) = self.lines.last_mut() {
            last.push(span);
        }
    }

    fn push_line_styled(&mut self, text: String, style: Style) {
        self.lines.push(vec![Span::styled(text, style)]);
    }

    fn push_line_spans(&mut self, spans: Vec<Span<'static>>) {
        self.lines.push(spans);
    }

    fn new_line(&mut self) {
        if self.lines.last().map(|l| l.is_empty()).unwrap_or(false) {
            return;
        }
        self.lines.push(Vec::new());
    }

    fn into_lines(mut self) -> Vec<Vec<Span<'static>>> {
        while self.lines.len() > 1 && self.lines.last().is_some_and(|l| l.is_empty()) {
            self.lines.pop();
        }
        if self.lines.is_empty() {
            vec![vec![]]
        } else {
            self.lines
        }
    }
}

#[cfg(test)]
mod markdown_table_tests {
    use ratatui::style::{Color, Style};

    use super::{markdown_lines, markdown_lines_with_style};

    #[test]
    fn table_row_pipe_spans_use_dark_gray_border_color() {
        let sample = "| Col A | Col B |\n|-------|-------|\n| Row 1 | Val 1 |";
        let lines = markdown_lines(sample);
        let row = lines
            .iter()
            .find(|line| line.iter().any(|span| span.content == "│"))
            .expect("expected bordered row");
        assert!(row.len() > 1, "expected split border/content spans");
        let pipe_colors: Vec<_> = row
            .iter()
            .filter(|span| span.content == "│")
            .map(|span| span.style.fg)
            .collect();
        assert!(
            pipe_colors
                .iter()
                .all(|color| *color == Some(Color::DarkGray)),
            "expected dark gray pipes, got {pipe_colors:?}"
        );
    }

    #[test]
    fn table_border_color_is_independent_of_body_style() {
        let sample = "| Col A | Col B |\n|-------|-------|\n| Row 1 | Val 1 |";
        let lines = markdown_lines_with_style(sample, Style::default().fg(Color::White));
        let row = lines
            .iter()
            .find(|line| line.iter().any(|span| span.content == "│"))
            .expect("expected bordered row");
        for span in row {
            if span.content == "│" {
                assert_eq!(span.style.fg, Some(Color::DarkGray));
            } else if span.content.trim() == "Row 1" {
                assert_eq!(span.style.fg, Some(Color::White));
            }
        }
    }

    #[test]
    fn table_renders_bordered_grid_with_connected_lines() {
        let sample = "| Col A | Col B | Col C |\n|-------|-------|-------|\n| Row 1 | Val 1 | Val 2 |\n| Row 2 | Val 3 | Val 4 |";
        let lines = markdown_lines(sample);
        let rendered = lines
            .iter()
            .map(|line| {
                line.iter()
                    .map(|span| span.content.as_ref())
                    .collect::<String>()
            })
            .collect::<Vec<_>>();

        assert!(
            rendered
                .iter()
                .any(|line| line.contains('┌') && line.contains('┬')),
            "expected top border: {rendered:?}"
        );
        assert!(
            rendered
                .iter()
                .any(|line| line.contains('├') && line.contains('┼')),
            "expected header separator: {rendered:?}"
        );
        assert!(
            rendered
                .iter()
                .any(|line| line.starts_with('│') && line.ends_with('│')),
            "expected vertical borders on rows: {rendered:?}"
        );
        assert!(
            rendered
                .iter()
                .any(|line| line.contains("Col A") && line.contains("Col B")),
            "expected header cells: {rendered:?}"
        );
    }

    #[test]
    fn pipe_rows_without_separator_stay_plain_text() {
        let sample = "Col A | Col B | Col C\nRow 1 | Val 1 | Val 2";
        let lines = markdown_lines(sample);
        let rendered = lines
            .iter()
            .map(|line| {
                line.iter()
                    .map(|span| span.content.as_ref())
                    .collect::<String>()
            })
            .collect::<Vec<_>>();
        assert!(
            !rendered.iter().any(|line| line.contains('┌')),
            "rows without GFM separator should not become bordered tables: {rendered:?}"
        );
    }
}
