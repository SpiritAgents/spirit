use std::collections::HashMap;

use image::ImageReader;
use ratatui::{
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Clear, Paragraph, Wrap},
};
use ratatui_image::picker::Picker;
use ratatui_image::{Resize, StatefulImage, protocol::StatefulProtocol};
use rust_i18n::t;
use unicode_width::{UnicodeWidthChar, UnicodeWidthStr};

mod conversation;
mod forms;
mod input;
mod markdown;
mod marketplace;
mod pickers;
mod subagent;
mod text;
mod theme;

pub(crate) use pickers::{approval_level_label, llm_http_version_label, tui_mode_label};

use conversation::*;
use forms::*;
use input::*;
use markdown::*;
use marketplace::*;
use pickers::*;
use subagent::*;
use text::*;
use theme::*;

use crate::{
    conversation_select::{CellPointer, NormRange, flatten_wrapped_history, normalize_selection},
    logging,
    ports::SubagentSessionStatus,
    session::PendingMcpResource,
    shell::{
        ask_questions as ask_questions_form, manual_shell, workspace_trust as workspace_trust_form,
    },
    view::{
        AskQuestionsOptionView, AskQuestionsQuestionView, AssistantAuxKind,
        BottomFormFieldEditorView, BottomFormFieldView, BottomFormKind, BottomFormView,
        ChatMessage, CliUiHookSlot, ConversationPanelHit, InputSuggestion, InputSuggestionKind,
        MainInputMode, MarketplaceViewModel, MessageRole, PendingAssistantAux,
        PendingSubagentApprovalView, SubagentApprovalInputView, SubagentSessionDetailView,
        ToolUiBlock, ToolUiPhase, TuiViewModel,
    },
};

/// Nested host prompts (e.g. workspace capability trust) redraw via this entry.
pub fn draw_nested_bottom_form(
    frame: &mut ratatui::Frame<'_>,
    area: ratatui::layout::Rect,
    form: &BottomFormView,
) {
    let _ = draw_bottom_form(frame, area, form);
}

const SLASH_SUGGESTION_VISIBLE_ITEMS: usize = 10;
const SLASH_SUGGESTION_BLOCK_HEIGHT: u16 = 12;
#[derive(Clone, Debug, Default)]
pub struct UiRenderFeedback {
    pub conversation_panel: Option<ConversationPanelRenderFeedback>,
    pub bottom_form_scroll_offset: Option<usize>,
    pub subagent_history_offset_from_bottom: Option<usize>,
    /// Inline: the row after the last drawn content block (ratatui `Rect::bottom`, excluding that row).
    pub inline_content_bottom: Option<u16>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ConversationMessageRenderRange {
    pub message_id: usize,
    pub start_line: usize,
    pub end_line: usize,
}

#[derive(Clone, Debug)]
pub struct ConversationPanelRenderFeedback {
    pub hit: ConversationPanelHit,
    pub plain_rows: Vec<String>,
    pub message_ranges: Vec<ConversationMessageRenderRange>,
    pub history_offset_from_bottom: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ImageRenderBackend {
    QueriedProtocol,
    HalfblocksFallback,
}

enum CachedRenderedImage {
    Ready(Box<StatefulProtocol>),
    Failed,
}

pub struct ImageRenderState {
    picker: Picker,
    backend: ImageRenderBackend,
    cache: HashMap<String, CachedRenderedImage>,
}

impl ImageRenderState {
    pub fn from_terminal_query() -> Self {
        match Picker::from_query_stdio() {
            Ok(picker) => {
                logging::log_event(
                    "[ui:image] initialized ratatui-image picker from terminal query",
                );
                Self {
                    picker,
                    backend: ImageRenderBackend::QueriedProtocol,
                    cache: HashMap::new(),
                }
            }
            Err(err) => {
                logging::log_event(&format!(
                    "[ui:image] terminal query failed, falling back to halfblocks: {err:#}"
                ));
                Self::halfblocks()
            }
        }
    }

    pub fn halfblocks() -> Self {
        Self {
            picker: Picker::halfblocks(),
            backend: ImageRenderBackend::HalfblocksFallback,
            cache: HashMap::new(),
        }
    }

    pub fn backend(&self) -> ImageRenderBackend {
        self.backend
    }

    pub fn picker(&self) -> &Picker {
        &self.picker
    }

    pub fn picker_mut(&mut self) -> &mut Picker {
        &mut self.picker
    }

    pub fn render_path_in_area(&mut self, frame: &mut ratatui::Frame<'_>, path: &str, area: Rect) {
        if area.width == 0 || area.height == 0 || path.trim().is_empty() {
            return;
        }

        if !self.cache.contains_key(path) {
            self.cache.insert(
                path.to_string(),
                load_cached_rendered_image(path, &self.picker),
            );
        }

        let mut encoding_error = None;
        if let Some(CachedRenderedImage::Ready(protocol)) = self.cache.get_mut(path) {
            frame.render_stateful_widget(
                StatefulImage::default().resize(Resize::Fit(None)),
                area,
                protocol.as_mut(),
            );
            encoding_error = protocol
                .last_encoding_result()
                .and_then(Result::err)
                .map(|err| format!("{err:#}"));
        }

        if let Some(err) = encoding_error {
            logging::log_event(&format!(
                "[ui:image] rendering failed for {}: {}",
                path, err
            ));
            self.cache
                .insert(path.to_string(), CachedRenderedImage::Failed);
        }
    }
}

fn load_cached_rendered_image(path: &str, picker: &Picker) -> CachedRenderedImage {
    match ImageReader::open(path) {
        Ok(reader) => match reader.decode() {
            Ok(image) => CachedRenderedImage::Ready(Box::new(picker.new_resize_protocol(image))),
            Err(err) => {
                let message = format!("decode failed: {err:#}");
                logging::log_event(&format!(
                    "[ui:image] failed to decode {}: {}",
                    path, message
                ));
                CachedRenderedImage::Failed
            }
        },
        Err(err) => {
            let message = format!("open failed: {err:#}");
            logging::log_event(&format!("[ui:image] failed to open {}: {}", path, message));
            CachedRenderedImage::Failed
        }
    }
}

pub struct UiRuntimeState {
    image_render: ImageRenderState,
}

impl Default for UiRuntimeState {
    fn default() -> Self {
        Self {
            image_render: ImageRenderState::halfblocks(),
        }
    }
}

impl UiRuntimeState {
    pub fn from_terminal_query() -> Self {
        Self {
            image_render: ImageRenderState::from_terminal_query(),
        }
    }

    pub fn image_render(&self) -> &ImageRenderState {
        &self.image_render
    }

    pub fn image_render_mut(&mut self) -> &mut ImageRenderState {
        &mut self.image_render
    }
}

pub fn draw_ui(
    frame: &mut ratatui::Frame<'_>,
    app: &TuiViewModel,
    runtime: &mut UiRuntimeState,
) -> UiRenderFeedback {
    if app.inline_mode {
        return draw_inline_ui(frame, app, runtime);
    }
    let mut feedback = UiRenderFeedback::default();
    set_active_cli_ui_hooks(app.cli_ui_hooks.clone());
    let show_model_picker = app.model_picker_active;
    let show_language_picker = app.language_picker_active;
    let show_approval_picker = app.approval_picker_active;
    let show_network_picker = app.network_picker_active;
    let show_tui_picker = app.tui_picker_active;
    let show_chat_picker = app.chat_picker_active;
    let show_subagent_picker = app.subagent_picker_active;
    let show_image_picker = app.image_picker_active;
    let show_marketplace = app.marketplace_view.is_some();
    let show_rewind_picker = app.rewind_picker.is_some();
    let show_bottom_form = app.bottom_form.is_some();
    let show_inline_picker = show_model_picker
        || show_language_picker
        || show_chat_picker
        || show_subagent_picker
        || show_approval_picker
        || show_network_picker
        || show_tui_picker
        || show_image_picker;

    let show_picker = show_model_picker
        || show_language_picker
        || show_approval_picker
        || show_network_picker
        || show_tui_picker
        || show_chat_picker
        || show_subagent_picker
        || show_image_picker;

    let show_suggestions = app.input_suggestion_kind.is_some()
        && !show_picker
        && !show_rewind_picker
        && !show_bottom_form;

    let root_chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints(
            if show_suggestions || show_bottom_form || show_inline_picker {
                vec![Constraint::Min(0)]
            } else {
                vec![Constraint::Min(0), Constraint::Length(1)]
            },
        )
        .split(frame.area());
    let content_area = root_chunks[0];
    let input_inner_width = content_area.width.saturating_sub(2) as usize;
    let input_height = input_block_height(app, input_inner_width);
    let bottom_form_height = app
        .bottom_form
        .as_ref()
        .map(|f| {
            bottom_form_display_height(f, content_area.width, content_area.height, input_height)
        })
        .unwrap_or(0);

    let marketplace_height = app
        .marketplace_view
        .as_ref()
        .map(|view| marketplace_panel_height(view, content_area.height, input_height))
        .unwrap_or(0);

    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints(if show_inline_picker {
            vec![
                Constraint::Min(5),
                Constraint::Length(input_height),
                Constraint::Length(7),
            ]
        } else if show_picker {
            vec![
                Constraint::Min(5),
                Constraint::Length(input_height),
                Constraint::Length(7),
                Constraint::Length(1),
            ]
        } else if show_marketplace {
            vec![
                Constraint::Min(0),
                Constraint::Length(input_height),
                Constraint::Length(marketplace_height),
            ]
        } else if show_bottom_form {
            vec![
                Constraint::Min(0),
                Constraint::Length(input_height),
                Constraint::Length(bottom_form_height),
            ]
        } else if show_suggestions {
            vec![
                Constraint::Min(5),
                Constraint::Length(input_height),
                Constraint::Length(SLASH_SUGGESTION_BLOCK_HEIGHT),
            ]
        } else {
            vec![
                Constraint::Min(4),
                Constraint::Length(input_height),
                Constraint::Length(1),
            ]
        })
        .split(content_area);

    let history_render =
        build_history_render_result(app, chunks[0].width.saturating_sub(1) as usize);
    let history_image_blocks = history_render.image_blocks.clone();
    let history_message_ranges = history_render.message_ranges.clone();
    let history_lines = history_render.lines;
    // The conversation area has no border; content and hit area fill chunks[0].
    let inner_x = chunks[0].x;
    let inner_y = chunks[0].y;
    let inner_w = chunks[0].width.max(1);
    let inner_h = chunks[0].height.max(1);
    let history_view_height = inner_h as usize;
    let w = inner_w.max(1) as u16;
    let history_lines_for_images = history_lines.clone();
    let logical_line_visual_offsets = build_visual_row_offsets(&history_lines_for_images, w);
    // WordWrapper wrapping is authoritative, to avoid scroll misalignment when Paragraph::line_count and custom wrapping disagree at certain widths/CJK.
    let (flat_measure, _) = flatten_wrapped_history(history_lines.clone(), w, None);
    let total_visual_lines = flat_measure.len();
    let norm = conversation_norm_for_paint(app, total_visual_lines);
    let (flat, plain) = flatten_wrapped_history(history_lines, w, norm);
    debug_assert_eq!(flat.len(), total_visual_lines);
    let max_scroll = flat.len().saturating_sub(history_view_height);
    let offset_bottom = app.history_offset_from_bottom.min(max_scroll);
    let history_scroll = max_scroll.saturating_sub(offset_bottom);
    let visible: Vec<Line<'static>> = flat
        .into_iter()
        .skip(history_scroll)
        .take(history_view_height)
        .collect();
    let history = Paragraph::new(visible);
    frame.render_widget(history, chunks[0]);
    render_history_tool_images(
        frame,
        chunks[0],
        history_scroll,
        history_view_height,
        &history_image_blocks,
        &logical_line_visual_offsets,
        runtime,
    );
    feedback.conversation_panel = Some(ConversationPanelRenderFeedback {
        hit: ConversationPanelHit {
            x: inner_x,
            y: inner_y,
            w: inner_w,
            h: inner_h,
            scroll: history_scroll,
            total_lines: total_visual_lines,
        },
        plain_rows: plain,
        message_ranges: history_message_ranges,
        history_offset_from_bottom: offset_bottom,
    });

    draw_input_block(frame, app, chunks[1], show_bottom_form);

    let overlay_area = if show_inline_picker
        || show_picker
        || show_marketplace
        || show_bottom_form
        || show_suggestions
    {
        Some(chunks[2])
    } else {
        None
    };
    draw_aux_overlay(
        frame,
        app,
        chunks[1],
        overlay_area,
        &AuxOverlayFlags {
            show_model_picker,
            show_language_picker,
            show_approval_picker,
            show_network_picker,
            show_tui_picker,
            show_chat_picker,
            show_subagent_picker,
            show_image_picker,
            show_marketplace,
            show_picker,
            show_bottom_form,
            show_suggestions,
        },
        &mut feedback,
    );

    if !show_suggestions && !show_bottom_form && !show_marketplace && !show_inline_picker {
        let help_idx = if show_picker { 3 } else { 2 };
        let footer = Paragraph::new(build_footer_line(app, chunks[help_idx].width as usize));
        frame.render_widget(footer, chunks[help_idx]);
        frame.render_widget(Clear, root_chunks[1]);
    }

    if let Some(view) = &app.subagent_view {
        feedback.subagent_history_offset_from_bottom = draw_subagent_viewer(
            frame,
            frame.area(),
            view,
            app.subagent_history_offset_from_bottom,
            app.show_aux_details,
            app.pending_subagent_approval.as_ref(),
            app.subagent_approval_input.as_ref(),
            app.thinking_spinner_index,
        );
    }

    clear_active_cli_ui_hooks();
    feedback
}

pub(crate) fn inline_history_visual_lines(app: &TuiViewModel, width: u16) -> Vec<Line<'static>> {
    let history_render = build_history_render_result(app, width.saturating_sub(1) as usize);
    flatten_wrapped_history(history_render.lines, width.max(1), None).0
}

struct InlineChromeLayout {
    input_height: u16,
    overlay_h: u16,
    footer_h: u16,
    gap_h: u16,
    live_h: u16,
}

impl InlineChromeLayout {
    fn total(&self) -> u16 {
        self.live_h
            .saturating_add(self.gap_h)
            .saturating_add(self.input_height)
            .saturating_add(self.footer_h)
            .saturating_add(self.overlay_h)
    }
}

struct InlineSurfaceFlags {
    show_model_picker: bool,
    show_language_picker: bool,
    show_approval_picker: bool,
    show_network_picker: bool,
    show_tui_picker: bool,
    show_chat_picker: bool,
    show_subagent_picker: bool,
    show_image_picker: bool,
    show_marketplace: bool,
    show_picker: bool,
    show_inline_picker: bool,
    show_bottom_form: bool,
    show_suggestions: bool,
}

fn inline_surface_flags(app: &TuiViewModel) -> InlineSurfaceFlags {
    let show_model_picker = app.model_picker_active;
    let show_language_picker = app.language_picker_active;
    let show_approval_picker = app.approval_picker_active;
    let show_network_picker = app.network_picker_active;
    let show_tui_picker = app.tui_picker_active;
    let show_chat_picker = app.chat_picker_active;
    let show_subagent_picker = app.subagent_picker_active;
    let show_image_picker = app.image_picker_active;
    let show_marketplace = app.marketplace_view.is_some();
    let show_rewind_picker = app.rewind_picker.is_some();
    let show_fork_picker = app.fork_picker.is_some();
    let show_bottom_form = app.bottom_form.is_some();
    let show_inline_picker = show_model_picker
        || show_language_picker
        || show_chat_picker
        || show_subagent_picker
        || show_approval_picker
        || show_network_picker
        || show_tui_picker
        || show_image_picker;

    let show_picker = show_model_picker
        || show_language_picker
        || show_approval_picker
        || show_network_picker
        || show_tui_picker
        || show_chat_picker
        || show_subagent_picker
        || show_image_picker;

    let show_suggestions = app.input_suggestion_kind.is_some()
        && !show_picker
        && !show_rewind_picker
        && !show_fork_picker
        && !show_bottom_form;
    InlineSurfaceFlags {
        show_model_picker,
        show_language_picker,
        show_approval_picker,
        show_network_picker,
        show_tui_picker,
        show_chat_picker,
        show_subagent_picker,
        show_image_picker,
        show_marketplace,
        show_picker,
        show_inline_picker,
        show_bottom_form,
        show_suggestions,
    }
}

fn inline_history_picker_active(app: &TuiViewModel) -> bool {
    app.rewind_picker.is_some() || app.fork_picker.is_some()
}

fn inline_uncommitted_live_count(app: &TuiViewModel, width: u16) -> u16 {
    let live_lines = inline_history_visual_lines(app, width.max(1));
    if inline_history_picker_active(app) {
        return live_lines.len() as u16;
    }
    let committed = app.committed_history_lines.min(live_lines.len());
    live_lines.len().saturating_sub(committed) as u16
}

fn measure_inline_chrome(
    app: &TuiViewModel,
    width: u16,
    viewport_h: u16,
    live_count: u16,
    flags: &InlineSurfaceFlags,
) -> InlineChromeLayout {
    let input_inner_width = width.saturating_sub(2) as usize;
    let input_height = input_block_height(app, input_inner_width);
    let bottom_form_height = app
        .bottom_form
        .as_ref()
        .map(|f| bottom_form_display_height(f, width, viewport_h, input_height))
        .unwrap_or(0);

    let overlay_h = if flags.show_inline_picker || flags.show_picker {
        7
    } else if flags.show_marketplace {
        app.marketplace_view
            .as_ref()
            .map(|view| marketplace_panel_height(view, viewport_h, input_height))
            .unwrap_or(0)
    } else if flags.show_bottom_form {
        bottom_form_height
    } else if flags.show_suggestions {
        SLASH_SUGGESTION_BLOCK_HEIGHT
    } else {
        0
    };
    let show_footer =
        !flags.show_suggestions && !flags.show_bottom_form && !flags.show_inline_picker;
    let footer_h: u16 = if show_footer { 1 } else { 0 };
    let overlay_h = overlay_h.min(
        viewport_h
            .saturating_sub(input_height)
            .saturating_sub(footer_h),
    );
    let reserved_below_live = input_height
        .saturating_add(overlay_h)
        .saturating_add(footer_h);
    let gap_h: u16 = if viewport_h > reserved_below_live {
        1
    } else {
        0
    };
    let max_live_h = viewport_h
        .saturating_sub(reserved_below_live)
        .saturating_sub(gap_h);
    let live_h = live_count.min(max_live_h);
    InlineChromeLayout {
        input_height,
        overlay_h,
        footer_h,
        gap_h,
        live_h,
    }
}

/// The inline viewport height is determined by the current inline layout (input box + gap + footer + visible live/overlay),
/// capped at the terminal row count. Do not pre-compensate with a fixed 24 rows.
pub(crate) fn inline_needed_viewport_height(
    app: &TuiViewModel,
    term_width: u16,
    term_rows: u16,
) -> u16 {
    if app.subagent_view.is_some() {
        return term_rows.max(1);
    }
    let flags = inline_surface_flags(app);
    let live_count = inline_uncommitted_live_count(app, term_width);
    measure_inline_chrome(app, term_width, term_rows, live_count, &flags)
        .total()
        .max(1)
        .min(term_rows.max(1))
}

fn draw_inline_ui(
    frame: &mut ratatui::Frame<'_>,
    app: &TuiViewModel,
    _runtime: &mut UiRuntimeState,
) -> UiRenderFeedback {
    let mut feedback = UiRenderFeedback::default();
    set_active_cli_ui_hooks(app.cli_ui_hooks.clone());
    let flags = inline_surface_flags(app);
    let area = frame.area();
    let history_picker = inline_history_picker_active(app);
    let (live, picker_meta) = if history_picker {
        let history_render =
            build_history_render_result(app, area.width.saturating_sub(1) as usize);
        let ranges = history_render.message_ranges.clone();
        let (flat, plain) = flatten_wrapped_history(history_render.lines, area.width.max(1), None);
        (flat, Some((plain, ranges)))
    } else {
        let live_lines = inline_history_visual_lines(app, area.width.max(1));
        let committed = app.committed_history_lines.min(live_lines.len());
        (live_lines.into_iter().skip(committed).collect(), None)
    };
    let layout = measure_inline_chrome(app, area.width, area.height, live.len() as u16, &flags);
    let InlineChromeLayout {
        input_height,
        overlay_h,
        footer_h,
        gap_h,
        live_h,
    } = layout;

    let mut constraints = Vec::new();
    if live_h > 0 {
        constraints.push(Constraint::Length(live_h));
    }
    if gap_h > 0 {
        constraints.push(Constraint::Length(gap_h));
    }
    constraints.push(Constraint::Length(input_height));
    if footer_h > 0 {
        constraints.push(Constraint::Length(footer_h));
    }
    if overlay_h > 0 {
        constraints.push(Constraint::Length(overlay_h));
    }
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints(constraints)
        .split(area);

    let mut idx = 0;
    if live_h > 0 {
        let live_area = chunks[idx];
        let live_visible = if history_picker {
            let max_scroll = live.len().saturating_sub(live_h as usize);
            let offset_bottom = app.history_offset_from_bottom.min(max_scroll);
            let history_scroll = max_scroll.saturating_sub(offset_bottom);
            let visible: Vec<Line<'static>> = live
                .iter()
                .skip(history_scroll)
                .take(live_h as usize)
                .cloned()
                .collect();
            if let Some((plain, message_ranges)) = picker_meta {
                feedback.conversation_panel = Some(ConversationPanelRenderFeedback {
                    hit: ConversationPanelHit {
                        x: live_area.x,
                        y: live_area.y,
                        w: live_area.width.max(1),
                        h: live_area.height.max(1),
                        scroll: history_scroll,
                        total_lines: live.len(),
                    },
                    plain_rows: plain,
                    message_ranges,
                    history_offset_from_bottom: offset_bottom,
                });
            }
            visible
        } else if live.len() as u16 > live_h {
            live[live.len().saturating_sub(live_h as usize)..].to_vec()
        } else {
            live
        };
        frame.render_widget(Paragraph::new(live_visible), live_area);
        idx += 1;
    }
    if gap_h > 0 {
        idx += 1;
    }
    let input_area = chunks[idx];
    idx += 1;
    let footer_area = if footer_h > 0 {
        let area = chunks[idx];
        idx += 1;
        Some(area)
    } else {
        None
    };
    let overlay_area = if overlay_h > 0 {
        Some(chunks[idx])
    } else {
        None
    };

    draw_input_block(frame, app, input_area, flags.show_bottom_form);
    if let Some(footer_area) = footer_area {
        let footer = Paragraph::new(build_footer_line(app, footer_area.width as usize));
        frame.render_widget(footer, footer_area);
    }
    draw_aux_overlay(
        frame,
        app,
        input_area,
        overlay_area,
        &AuxOverlayFlags {
            show_model_picker: flags.show_model_picker,
            show_language_picker: flags.show_language_picker,
            show_approval_picker: flags.show_approval_picker,
            show_network_picker: flags.show_network_picker,
            show_tui_picker: flags.show_tui_picker,
            show_chat_picker: flags.show_chat_picker,
            show_subagent_picker: flags.show_subagent_picker,
            show_image_picker: flags.show_image_picker,
            show_marketplace: flags.show_marketplace,
            show_picker: flags.show_picker,
            show_bottom_form: flags.show_bottom_form,
            show_suggestions: flags.show_suggestions,
        },
        &mut feedback,
    );

    let mut content_bottom = input_area.bottom();
    if let Some(footer) = footer_area {
        content_bottom = content_bottom.max(footer.bottom());
    }
    if let Some(overlay) = overlay_area {
        content_bottom = content_bottom.max(overlay.bottom());
    }
    feedback.inline_content_bottom = Some(content_bottom);

    if let Some(view) = &app.subagent_view {
        feedback.subagent_history_offset_from_bottom = draw_subagent_viewer(
            frame,
            frame.area(),
            view,
            app.subagent_history_offset_from_bottom,
            app.show_aux_details,
            app.pending_subagent_approval.as_ref(),
            app.subagent_approval_input.as_ref(),
            app.thinking_spinner_index,
        );
    }

    clear_active_cli_ui_hooks();
    feedback
}

struct AuxOverlayFlags {
    show_model_picker: bool,
    show_language_picker: bool,
    show_approval_picker: bool,
    show_network_picker: bool,
    show_tui_picker: bool,
    show_chat_picker: bool,
    show_subagent_picker: bool,
    show_image_picker: bool,
    show_marketplace: bool,
    show_picker: bool,
    show_bottom_form: bool,
    show_suggestions: bool,
}

fn draw_input_block(
    frame: &mut ratatui::Frame<'_>,
    app: &TuiViewModel,
    area: Rect,
    show_bottom_form: bool,
) {
    let (input_cursor_row, input_cursor_col) =
        input_cursor_position(app, area.width.saturating_sub(2) as usize);
    maybe_log_input_cursor_diagnostics(
        app,
        area.width.saturating_sub(2) as usize,
        input_cursor_row,
        input_cursor_col,
    );
    let input_border_style =
        input_block_border_style(app.shell_mode_active, app.input_mode, show_bottom_form);
    let input_title = if app.shell_mode_active {
        t!("ui.input.title_shell").into_owned()
    } else {
        input_mode_title(app.input_mode)
    };
    let input = Paragraph::new(build_input_lines(
        app,
        area.width.saturating_sub(2) as usize,
        show_bottom_form,
    ))
    .block(
        Block::default()
            .borders(Borders::ALL)
            .border_style(input_border_style)
            .title(Line::from(Span::styled(input_title, input_border_style))),
    );
    frame.render_widget(input, area);
}

fn set_main_input_cursor(frame: &mut ratatui::Frame<'_>, app: &TuiViewModel, input_area: Rect) {
    let (input_cursor_row, input_cursor_col) =
        input_cursor_position(app, input_area.width.saturating_sub(2) as usize);
    let max_cursor_offset = input_area.width.saturating_sub(3) as usize;
    let cursor_offset = input_cursor_col.min(max_cursor_offset as u16) as usize;
    let cursor_x = input_area.x + 1 + cursor_offset as u16;
    let cursor_y = input_area.y + 1 + input_cursor_row;
    frame.set_cursor_position((cursor_x, cursor_y));
}

fn draw_aux_overlay(
    frame: &mut ratatui::Frame<'_>,
    app: &TuiViewModel,
    input_area: Rect,
    overlay: Option<Rect>,
    flags: &AuxOverlayFlags,
    feedback: &mut UiRenderFeedback,
) {
    if flags.show_bottom_form {
        if let (Some(form), Some(overlay)) = (&app.bottom_form, overlay) {
            let render = draw_bottom_form(frame, overlay, form);
            if let Some(scroll_offset) = render.scroll_offset {
                feedback.bottom_form_scroll_offset = Some(scroll_offset);
            }
            if let Some((cursor_x, cursor_y)) = render.cursor {
                frame.set_cursor_position((cursor_x, cursor_y));
            }
        }
        return;
    }
    if flags.show_marketplace {
        if let (Some(view), Some(overlay)) = (&app.marketplace_view, overlay) {
            draw_marketplace_view(frame, overlay, view);
        }
        return;
    }
    if !flags.show_picker {
        set_main_input_cursor(frame, app, input_area);
    }

    let Some(overlay) = overlay else {
        return;
    };
    if flags.show_model_picker {
        let picker_lines = build_model_picker_lines(app, 5);
        draw_inline_picker(frame, overlay, picker_lines);
    } else if flags.show_approval_picker {
        let picker_lines = build_approval_picker_lines(app, 5);
        draw_inline_picker(frame, overlay, picker_lines);
    } else if flags.show_network_picker {
        let picker_lines = build_network_picker_lines(app, 5);
        draw_inline_picker(frame, overlay, picker_lines);
    } else if flags.show_tui_picker {
        let picker_lines = build_tui_picker_lines(app, 5);
        draw_inline_picker(frame, overlay, picker_lines);
    } else if flags.show_language_picker {
        let picker_lines = build_language_picker_lines(app, 5);
        draw_inline_picker(frame, overlay, picker_lines);
    } else if flags.show_chat_picker {
        let picker_lines = build_chat_picker_lines(app, 5);
        draw_inline_picker(frame, overlay, picker_lines);
    } else if flags.show_subagent_picker {
        let picker_lines = build_subagent_picker_lines(app, 5);
        draw_inline_picker(frame, overlay, picker_lines);
    } else if flags.show_image_picker {
        let picker_lines = build_image_picker_lines(app, 5);
        draw_inline_picker(frame, overlay, picker_lines);
    } else if flags.show_suggestions {
        let use_inline_suggestions = suggestions_use_inline_picker(app);
        let suggestion_content_width = if use_inline_suggestions {
            inline_picker_area(overlay).width as usize
        } else {
            overlay.width.saturating_sub(2) as usize
        };
        let suggestions = build_suggestion_lines(
            app,
            SLASH_SUGGESTION_VISIBLE_ITEMS,
            suggestion_content_width,
        );
        if use_inline_suggestions {
            draw_inline_picker(frame, overlay, suggestions);
        } else {
            let suggestion_frame_style = patch_style_border(
                conversation_body_text_style(),
                cli_ui_border_color(CliUiHookSlot::SlashSuggestions)
                    .or(cli_ui_accent_color(CliUiHookSlot::SlashSuggestions)),
            );
            let suggestion_title = input_suggestion_title(app);
            let suggestions_widget = Paragraph::new(suggestions)
                .block(
                    Block::default()
                        .borders(Borders::ALL)
                        .border_style(suggestion_frame_style)
                        .title(Line::from(Span::styled(
                            suggestion_title,
                            suggestion_frame_style,
                        ))),
                )
                .wrap(Wrap { trim: true });
            frame.render_widget(suggestions_widget, overlay);
        }
    }
}

fn render_history_tool_images(
    frame: &mut ratatui::Frame<'_>,
    history_area: Rect,
    history_scroll: usize,
    history_view_height: usize,
    image_blocks: &[HistoryImageRenderBlock],
    logical_line_visual_offsets: &[usize],
    runtime: &mut UiRuntimeState,
) {
    for block in image_blocks {
        let visual_top = logical_line_visual_offsets
            .get(block.logical_top_line)
            .copied()
            .unwrap_or_else(|| logical_line_visual_offsets.last().copied().unwrap_or(0));
        let visual_bottom = visual_top.saturating_add(block.reserved_rows as usize);
        let view_bottom = history_scroll.saturating_add(history_view_height);
        if visual_top < history_scroll || visual_bottom > view_bottom {
            continue;
        }

        let local_top = visual_top.saturating_sub(history_scroll) as u16;
        let x_offset = block.x_offset.min(history_area.width);
        let render_width = history_area.width.saturating_sub(x_offset);
        if render_width == 0 {
            continue;
        }

        let render_area = Rect {
            x: history_area.x.saturating_add(x_offset),
            y: history_area.y.saturating_add(local_top),
            width: render_width,
            height: block
                .reserved_rows
                .min(history_area.height.saturating_sub(local_top)),
        };
        runtime
            .image_render_mut()
            .render_path_in_area(frame, &block.path, render_area);
    }
}

fn build_visual_row_offsets(logical_lines: &[Line<'static>], wrap_width: u16) -> Vec<usize> {
    let mut offsets = Vec::with_capacity(logical_lines.len() + 1);
    let mut total = 0usize;

    for line in logical_lines {
        offsets.push(total);
        total = total.saturating_add(
            flatten_wrapped_history(vec![line.clone()], wrap_width, None)
                .0
                .len(),
        );
    }

    offsets.push(total);
    offsets
}

#[cfg(test)]
mod tests;
