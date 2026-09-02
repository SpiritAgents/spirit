use anyhow::{Result, anyhow};
use clap::{ArgAction, CommandFactory, Parser, Subcommand};
use crossterm::{
    cursor::MoveTo,
    event::{
        self, DisableBracketedPaste, DisableMouseCapture, EnableBracketedPaste, EnableMouseCapture,
        Event, KeyCode, KeyEventKind, KeyModifiers, KeyboardEnhancementFlags, MouseButton,
        MouseEventKind, PopKeyboardEnhancementFlags, PushKeyboardEnhancementFlags,
    },
    execute,
    terminal::{
        Clear, ClearType, DisableLineWrap, EnableLineWrap, EnterAlternateScreen,
        LeaveAlternateScreen, disable_raw_mode, enable_raw_mode, supports_keyboard_enhancement,
    },
};
use ratatui::{Terminal, TerminalOptions, Viewport};
use std::{
    io,
    time::{Duration, Instant},
};

use spirit::tui::InlineRecreate;
use spirit::{
    ConfigCommand, ExtensionCommand, GlobalCliOptions, HookCommand, KeyCommand, MarketplaceCommand,
    McpCommand, ModelAddCommand, ModelCommand, PermissionCommand, TuiShell, bootstrap_config,
    handle_config_cli, handle_extension_cli, handle_hooks_cli, handle_marketplace_cli,
    handle_mcp_cli, handle_model_cli, handle_permissions_cli, logging, print_skills_stub,
    resolve_session_tui_mode, run_headless_prompt, run_serve, tui, ui,
};

const MAX_EVENT_BATCH_PER_TICK: usize = 2048;
const IMPLICIT_PASTE_MAX_GAP: Duration = Duration::from_millis(180);
const EXPLICIT_PASTE_REPLAY_MAX_GAP: Duration = Duration::from_millis(750);

#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LSHIFT, VK_RSHIFT};

// A haiku for every Rustacean chasing determinism in async:
// Async futures wake  /  Borrow checker guards the stack  /  CLI whispers back
#[derive(Parser)]
#[command(name = "spirit")]
#[command(version)]
#[command(disable_version_flag = true)]
#[command(about = "Spirit — AI productivity agent", long_about = None)]
struct Cli {
    /// Print version
    #[arg(short = 'v', long = "version", action = ArgAction::SetTrue)]
    version: bool,

    /// Switch to this model (persisted). Used by headless and TUI.
    #[arg(short = 'm', long, value_name = "model")]
    model: Option<String>,

    /// Set approval level: default, auto-approval, bypass-approval (persisted for the session).
    #[arg(short = 'a', long, value_name = "approval")]
    approval: Option<String>,

    /// UI language locale code (persisted).
    #[arg(long = "language", short = 'l', value_name = "language")]
    language: Option<String>,

    /// TUI layout for this process only: inline or fullscreen (not persisted).
    #[arg(short = 't', long = "tui", value_name = "tui", global = true)]
    tui: Option<String>,

    #[command(subcommand)]
    command: Option<Commands>,

    /// Headless prompt (must be last). Remaining tokens after -p/--prompt are the prompt,
    /// including values that look like flags (e.g. -a), so put -m/-a/-l before -p.
    #[arg(
        short = 'p',
        long,
        value_name = "prompt",
        allow_hyphen_values = true,
        trailing_var_arg = true,
        num_args = 1..
    )]
    prompt: Vec<String>,
}

#[derive(Subcommand)]
enum Commands {
    Skill,
    Interactive,
    /// Run the Spirit Server daemon in the foreground (WebSocket backend for hosts)
    Serve,
    Model {
        #[command(subcommand)]
        action: ModelAction,
    },
    Config {
        #[command(subcommand)]
        action: ConfigAction,
    },
    Mcp {
        #[command(subcommand)]
        action: McpAction,
    },
    Extension {
        #[command(subcommand)]
        action: ExtensionAction,
    },
    Marketplace {
        #[command(subcommand)]
        action: MarketplaceAction,
    },
    Hook {
        #[command(subcommand)]
        action: HookAction,
    },
    Permission {
        #[command(subcommand)]
        action: PermissionAction,
    },
}

#[derive(Subcommand)]
// clap derive cannot Box-allocate the Add subcommand fields without breaking the Subcommand derive
#[allow(clippy::large_enum_variant)]
enum ModelAction {
    List,
    Add {
        #[arg(value_name = "name")]
        name: String,
        #[arg(long, value_name = "api_base")]
        api_base: Option<String>,
        #[arg(long, value_name = "provider", value_parser = ["deepseek", "xai", "moonshot-ai", "kimi-code", "z-ai", "zhipu-ai", "minimax", "xiaomi", "siliconflow", "alibaba", "anthropic", "vercel-ai-gateway", "openrouter", "fireworks-ai", "together-ai", "groq", "deepinfra", "baseten", "hugging-face", "cohere", "openai", "google", "volcengine", "byteplus", "azure", "amazon-bedrock", "custom"])]
        provider: Option<String>,
        #[arg(long, value_name = "transport_kind", value_parser = ["openai-compatible", "open-responses", "anthropic", "bedrock"])]
        transport_kind: Option<String>,
        #[arg(long, value_name = "reasoning_effort")]
        reasoning_effort: Option<String>,
        #[arg(long = "capability", value_name = "capability", value_parser = ["chat", "image", "imageGeneration", "video", "videoGeneration"])]
        capabilities: Vec<String>,
        #[arg(long, value_name = "context_length")]
        context_length: Option<u64>,
        #[arg(long, value_name = "key")]
        key: Option<String>,
        #[arg(long, value_name = "azure_resource_name")]
        azure_resource_name: Option<String>,
        #[arg(long, value_name = "provider_site")]
        provider_site: Option<String>,
        #[arg(long, value_name = "alibaba_workspace_id")]
        alibaba_workspace_id: Option<String>,
    },
    Remove {
        #[arg(value_name = "name")]
        name: String,
    },
    Use {
        #[arg(value_name = "name")]
        name: String,
    },
    Current,
}

#[derive(Subcommand)]
enum ConfigAction {
    Show,
    SetBase {
        #[arg(value_name = "url")]
        url: String,
    },
    SetImageModel {
        #[arg(value_name = "name")]
        name: String,
    },
    ClearImageModel,
    SetVideoModel {
        #[arg(value_name = "name")]
        name: String,
    },
    ClearVideoModel,
    Key {
        #[command(subcommand)]
        action: KeyAction,
    },
}

#[derive(Subcommand)]
enum KeyAction {
    Set {
        #[arg(value_name = "value")]
        value: Option<String>,
    },
    Remove,
    Status,
}

#[derive(Subcommand)]
enum McpAction {
    List,
    Show,
    Init {
        #[arg(long, default_value_t = false)]
        force: bool,
    },
    Enable {
        #[arg(value_name = "name")]
        name: String,
    },
    Disable {
        #[arg(value_name = "name")]
        name: String,
    },
    Inspect {
        #[arg(value_name = "name")]
        name: String,
    },
    Tools {
        #[arg(value_name = "name")]
        name: String,
    },
    CallTool {
        #[arg(value_name = "name")]
        name: String,
        #[arg(value_name = "tool")]
        tool: String,
        #[arg(long, value_name = "args_json")]
        args_json: Option<String>,
    },
    Resources {
        #[arg(value_name = "name")]
        name: String,
    },
    Prompts {
        #[arg(value_name = "name")]
        name: String,
    },
    ReadResource {
        #[arg(value_name = "name")]
        name: String,
        #[arg(value_name = "uri")]
        uri: String,
    },
    GetPrompt {
        #[arg(value_name = "name")]
        name: String,
        #[arg(value_name = "prompt")]
        prompt: String,
        #[arg(long, value_name = "args_json")]
        args_json: Option<String>,
    },
}

#[derive(Subcommand)]
enum HookAction {
    List {
        #[arg(long, value_name = "path")]
        workspace: Option<std::path::PathBuf>,
    },
    Validate {
        #[arg(long, value_name = "path")]
        workspace: Option<std::path::PathBuf>,
    },
}

#[derive(Subcommand)]
enum PermissionAction {
    /// Check a shell command or read_file path against the permission allowlist.
    /// Rule evaluation runs daemon-side, so a reachable Spirit daemon is required.
    Check {
        /// Shell command to check
        #[arg(
            long,
            value_name = "command",
            conflicts_with = "read_file",
            required_unless_present = "read_file"
        )]
        shell: Option<String>,
        /// read_file path to check
        #[arg(long, value_name = "path")]
        read_file: Option<String>,
    },
}

#[derive(Subcommand)]
enum ExtensionAction {
    List,
    Import {
        #[arg(value_name = "archive")]
        archive: String,
    },
    Remove {
        #[arg(value_name = "id")]
        id: String,
    },
}

#[derive(Subcommand)]
enum MarketplaceAction {
    List,
    Install {
        #[arg(value_name = "id")]
        id: String,
    },
    Remove {
        #[arg(value_name = "id")]
        id: String,
    },
}

fn main() -> Result<()> {
    spirit::logging::init_logging();
    let cli = Cli::parse();
    if cli.version {
        print!("{}", Cli::command().render_version());
        return Ok(());
    }
    let prompt = if cli.prompt.is_empty() {
        None
    } else {
        Some(cli.prompt.join(" "))
    };
    let options = GlobalCliOptions {
        prompt: prompt.clone(),
        model: cli.model.clone(),
        approval: cli.approval.clone(),
        language: cli.language.clone(),
        tui: cli.tui.clone(),
    };

    let config = bootstrap_config(&options)?;

    // --prompt always wins (including when combined with `interactive`).
    if let Some(prompt) = prompt.as_deref() {
        return run_headless_prompt(prompt, &options, config);
    }

    match cli.command {
        Some(Commands::Skill) => print_skills_stub(),
        Some(Commands::Serve) => run_serve()?,
        Some(Commands::Interactive) | None => run_interactive(&options, &config)?,
        Some(Commands::Model { action }) => handle_model_cli(into_model_command(action))?,
        Some(Commands::Config { action }) => handle_config_cli(into_config_command(action))?,
        Some(Commands::Mcp { action }) => handle_mcp_cli(into_mcp_command(action))?,
        Some(Commands::Hook { action }) => handle_hooks_cli(into_hook_command(action))?,
        Some(Commands::Permission { action }) => {
            handle_permissions_cli(into_permission_command(action))?
        }
        Some(Commands::Extension { action }) => {
            handle_extension_cli(into_extension_command(action))?
        }
        Some(Commands::Marketplace { action }) => {
            handle_marketplace_cli(into_marketplace_command(action))?
        }
    }

    Ok(())
}

fn into_model_command(action: ModelAction) -> ModelCommand {
    match action {
        ModelAction::List => ModelCommand::List,
        ModelAction::Add {
            name,
            api_base,
            provider,
            transport_kind,
            reasoning_effort,
            capabilities,
            context_length,
            key,
            azure_resource_name,
            provider_site,
            alibaba_workspace_id,
        } => ModelCommand::Add(Box::new(ModelAddCommand {
            name,
            api_base,
            provider,
            transport_kind,
            reasoning_effort,
            capabilities,
            context_length,
            key,
            azure_resource_name,
            provider_site,
            alibaba_workspace_id,
        })),
        ModelAction::Remove { name } => ModelCommand::Remove { name },
        ModelAction::Use { name } => ModelCommand::Use { name },
        ModelAction::Current => ModelCommand::Current,
    }
}

fn into_config_command(action: ConfigAction) -> ConfigCommand {
    match action {
        ConfigAction::Show => ConfigCommand::Show,
        ConfigAction::SetBase { url } => ConfigCommand::SetBase { url },
        ConfigAction::SetImageModel { name } => ConfigCommand::SetImageModel { name },
        ConfigAction::ClearImageModel => ConfigCommand::ClearImageModel,
        ConfigAction::SetVideoModel { name } => ConfigCommand::SetVideoModel { name },
        ConfigAction::ClearVideoModel => ConfigCommand::ClearVideoModel,
        ConfigAction::Key { action } => ConfigCommand::Key {
            action: into_key_command(action),
        },
    }
}

fn into_extension_command(action: ExtensionAction) -> ExtensionCommand {
    match action {
        ExtensionAction::List => ExtensionCommand::List,
        ExtensionAction::Import { archive } => ExtensionCommand::Import { archive },
        ExtensionAction::Remove { id } => ExtensionCommand::Remove { id },
    }
}

fn into_marketplace_command(action: MarketplaceAction) -> MarketplaceCommand {
    match action {
        MarketplaceAction::List => MarketplaceCommand::List,
        MarketplaceAction::Install { id } => MarketplaceCommand::Install { id },
        MarketplaceAction::Remove { id } => MarketplaceCommand::Remove { id },
    }
}

fn into_key_command(action: KeyAction) -> KeyCommand {
    match action {
        KeyAction::Set { value } => KeyCommand::Set { value },
        KeyAction::Remove => KeyCommand::Remove,
        KeyAction::Status => KeyCommand::Status,
    }
}

fn into_mcp_command(action: McpAction) -> McpCommand {
    match action {
        McpAction::List => McpCommand::List,
        McpAction::Show => McpCommand::Show,
        McpAction::Init { force } => McpCommand::Init { force },
        McpAction::Enable { name } => McpCommand::Enable { name },
        McpAction::Disable { name } => McpCommand::Disable { name },
        McpAction::Inspect { name } => McpCommand::Inspect { name },
        McpAction::Tools { name } => McpCommand::Tools { name },
        McpAction::CallTool {
            name,
            tool,
            args_json,
        } => McpCommand::CallTool {
            name,
            tool,
            args_json,
        },
        McpAction::Resources { name } => McpCommand::Resources { name },
        McpAction::Prompts { name } => McpCommand::Prompts { name },
        McpAction::ReadResource { name, uri } => McpCommand::ReadResource { name, uri },
        McpAction::GetPrompt {
            name,
            prompt,
            args_json,
        } => McpCommand::GetPrompt {
            name,
            prompt,
            args_json,
        },
    }
}

fn into_hook_command(action: HookAction) -> HookCommand {
    match action {
        HookAction::List { workspace } => HookCommand::List { workspace },
        HookAction::Validate { workspace } => HookCommand::Validate { workspace },
    }
}

fn into_permission_command(action: PermissionAction) -> PermissionCommand {
    match action {
        PermissionAction::Check { shell, read_file } => {
            PermissionCommand::Check { shell, read_file }
        }
    }
}

fn is_inline_tui(mode: &str) -> bool {
    mode == spirit::ports::TUI_MODE_INLINE
}

fn create_tui_terminal(inline: bool) -> Result<Terminal<tui::InlineBackend>> {
    if inline {
        execute!(io::stdout(), DisableLineWrap)?;
        // Inline(1) → append_lines(0). No layout height is reserved at load time; the first frame grows to fit the actual content.
        Terminal::with_options(
            tui::InlineBackend::new(),
            TerminalOptions {
                viewport: Viewport::Inline(tui::INLINE_BOOTSTRAP_HEIGHT),
            },
        )
        .map_err(|err| anyhow!("{err}"))
    } else {
        execute!(io::stdout(), EnterAlternateScreen)?;
        Terminal::new(tui::InlineBackend::new()).map_err(|err| anyhow!("{err}"))
    }
}

fn teardown_tui_viewport(
    terminal: &mut Terminal<tui::InlineBackend>,
    inline: bool,
    last_inline_viewport: ratatui::layout::Rect,
) -> Result<()> {
    if inline {
        // When leaving fullscreen, we cannot leave_inline_prompt: that only moves the cursor below the box, while the live chrome stays on the main screen.
        // EnterAlternateScreen saves that main screen; on return, the input box and picker would overlap the newly created inline UI.
        let origin_y = if last_inline_viewport.height > 0 {
            last_inline_viewport.y
        } else {
            crossterm::cursor::position().map(|(_, y)| y).unwrap_or(0)
        };
        execute!(
            io::stdout(),
            MoveTo(0, origin_y),
            Clear(ClearType::FromCursorDown),
            EnableLineWrap
        )?;
    } else {
        execute!(
            terminal.backend_mut(),
            DisableMouseCapture,
            LeaveAlternateScreen
        )?;
    }
    Ok(())
}

fn apply_session_tui_switch(
    terminal: &mut Terminal<tui::InlineBackend>,
    shell: &mut TuiShell,
    inline: &mut bool,
    last_inline_viewport: &mut ratatui::layout::Rect,
    last_inline_content_bottom: &mut u16,
    inline_h: &mut u16,
    next: &str,
) -> Result<()> {
    let next_inline = is_inline_tui(next);
    if next_inline == *inline {
        return Ok(());
    }
    if *inline {
        // Push uncommitted live lines into the system scrollback before erasing the chrome, so the conversation does not live only in the viewport about to be cleared.
        shell.sync_inline_scrollback(terminal)?;
    }
    teardown_tui_viewport(terminal, *inline, *last_inline_viewport)?;
    *terminal = create_tui_terminal(next_inline)?;
    if !next_inline {
        execute!(terminal.backend_mut(), EnableMouseCapture)?;
    }
    let _ = terminal.hide_cursor();
    shell.apply_tui_mode(next_inline);
    *inline = next_inline;
    *last_inline_viewport = ratatui::layout::Rect::default();
    *last_inline_content_bottom = 0;
    *inline_h = tui::INLINE_BOOTSTRAP_HEIGHT;
    Ok(())
}

fn run_interactive(
    options: &GlobalCliOptions,
    config: &spirit::model_registry::AppConfig,
) -> Result<()> {
    let mut inline = is_inline_tui(&resolve_session_tui_mode(options, config));
    enable_raw_mode()?;
    let mut terminal = create_tui_terminal(inline)?;
    let supports_keyboard_enhancement = matches!(supports_keyboard_enhancement(), Ok(true));
    logging::log_event(&format!(
        "[tui] mode={} supports_keyboard_enhancement={supports_keyboard_enhancement}",
        if inline { "inline" } else { "fullscreen" }
    ));

    if supports_keyboard_enhancement {
        execute!(
            terminal.backend_mut(),
            PushKeyboardEnhancementFlags(
                KeyboardEnhancementFlags::DISAMBIGUATE_ESCAPE_CODES
                    | KeyboardEnhancementFlags::REPORT_ALL_KEYS_AS_ESCAPE_CODES
                    | KeyboardEnhancementFlags::REPORT_ALTERNATE_KEYS
                    | KeyboardEnhancementFlags::REPORT_EVENT_TYPES
            )
        )?;
    }

    execute!(terminal.backend_mut(), EnableBracketedPaste)?;

    let run_result = run_app(&mut terminal, options, &mut inline);

    let _ = disable_raw_mode();
    if supports_keyboard_enhancement {
        let _ = execute!(
            terminal.backend_mut(),
            PopKeyboardEnhancementFlags,
            DisableBracketedPaste
        );
    } else {
        let _ = execute!(terminal.backend_mut(), DisableBracketedPaste);
    }
    if inline {
        let _ = execute!(io::stdout(), EnableLineWrap);
    } else {
        let _ = execute!(
            terminal.backend_mut(),
            LeaveAlternateScreen,
            DisableMouseCapture
        );
    }
    let _ = terminal.show_cursor();
    run_result
}

fn run_app(
    terminal: &mut Terminal<tui::InlineBackend>,
    options: &GlobalCliOptions,
    inline: &mut bool,
) -> Result<()> {
    let mut shell = TuiShell::new_with_mode(*inline)?;
    if let Some(approval) = options.approval.as_deref() {
        shell.apply_cli_approval_level(approval)?;
    }
    shell.run_deferred_session_start(terminal)?;
    let mut paste_tracker = PasteReplayTracker::default();
    shell.refresh_suggestions();
    if !*inline {
        execute!(terminal.backend_mut(), EnableMouseCapture)?;
    }
    let mut last_inline_viewport = ratatui::layout::Rect::default();
    let mut last_inline_content_bottom = 0u16;
    let mut inline_h = tui::INLINE_BOOTSTRAP_HEIGHT;

    while !shell.should_quit() {
        if let Some(next) = shell.take_pending_tui_mode() {
            apply_session_tui_switch(
                terminal,
                &mut shell,
                inline,
                &mut last_inline_viewport,
                &mut last_inline_content_bottom,
                &mut inline_h,
                &next,
            )?;
        }
        shell.poll_runtime();
        shell.handle_stream_stall_timeout();
        shell.tick();
        if *inline {
            if let Ok(size) = terminal.size() {
                let needed = shell.inline_needed_viewport_height(size.width, size.height);
                let origin_y = if last_inline_viewport.height > 0 {
                    last_inline_viewport.y
                } else {
                    crossterm::cursor::position().map(|(_, y)| y).unwrap_or(0)
                };
                let width_shrunk =
                    last_inline_viewport.width > 0 && size.width < last_inline_viewport.width;
                if width_shrunk {
                    terminal.recreate_inline_at_row(origin_y, needed)?;
                    inline_h = needed;
                } else if needed != inline_h {
                    terminal.set_inline_height(origin_y, inline_h, needed)?;
                    inline_h = needed;
                }
            }
        }
        shell.sync_inline_scrollback(terminal)?;
        let completed = terminal.draw(|frame| {
            let app = shell.view_model();
            let feedback = ui::draw_ui(frame, &app, shell.ui_runtime_state_mut());
            if let Some(bottom) = feedback.inline_content_bottom {
                last_inline_content_bottom = bottom;
            }
            shell.apply_render_feedback(feedback);
        })?;
        if *inline {
            last_inline_viewport = completed.buffer.area;
        }

        if !event::poll(Duration::from_millis(100))? {
            continue;
        }

        let mut events = vec![event::read()?];
        while events.len() < MAX_EVENT_BATCH_PER_TICK && event::poll(Duration::from_millis(0))? {
            events.push(event::read()?);
        }

        process_event_batch(&mut shell, events, &mut paste_tracker);
    }

    if *inline {
        tui::leave_inline_prompt(terminal, last_inline_content_bottom)?;
    }

    Ok(())
}

fn process_event_batch(
    shell: &mut TuiShell,
    events: Vec<Event>,
    paste_tracker: &mut PasteReplayTracker,
) {
    maybe_log_event_batch(shell, &events);
    let mut pending_text = String::new();
    let mut bracketed_paste_chars = 0usize;
    let mut bracketed_paste_lines = 0usize;
    let now = Instant::now();

    paste_tracker.expire_if_idle(now);

    for evt in events {
        match evt {
            Event::Resize(_, _) => continue,
            Event::Mouse(mouse) => {
                if shell.is_inline_mode() {
                    continue;
                }
                flush_pending_text(shell, &mut pending_text);
                match mouse.kind {
                    MouseEventKind::ScrollUp => {
                        if shell.is_subagent_view_active() {
                            shell.scroll_subagent_view_up(3)
                        } else if !shell.scroll_active_bottom_form_up(3) {
                            shell.scroll_history_up(3)
                        }
                    }
                    MouseEventKind::ScrollDown => {
                        if shell.is_subagent_view_active() {
                            shell.scroll_subagent_view_down(3)
                        } else if !shell.scroll_active_bottom_form_down(3) {
                            shell.scroll_history_down(3)
                        }
                    }
                    MouseEventKind::Down(MouseButton::Left) => {
                        shell.conversation_left_down(mouse.column, mouse.row);
                    }
                    MouseEventKind::Drag(MouseButton::Left) => {
                        shell.conversation_left_drag(mouse.column, mouse.row);
                    }
                    MouseEventKind::Up(MouseButton::Left) => {
                        shell.conversation_left_up();
                    }
                    MouseEventKind::Up(MouseButton::Right) => {
                        if let Err(e) = shell.copy_conversation_selection() {
                            logging::log_event(&format!("clipboard copy failed: {}", e));
                        }
                    }
                    _ => {}
                }
            }
            Event::Paste(text) => {
                if shell.is_model_list_overlay_active()
                    || shell.is_language_picker_active()
                    || shell.is_approval_picker_active()
                    || shell.is_network_picker_active()
                    || shell.is_tui_picker_active()
                    || shell.is_chat_picker_active()
                    || shell.is_rewind_picker_active()
                    || shell.is_fork_picker_active()
                    || shell.is_subagent_picker_active()
                    || shell.is_subagent_view_active()
                    || shell.is_image_picker_active()
                    || shell.is_marketplace_picker_active()
                {
                    continue;
                }
                let normalized = normalize_pasted_text(&text);
                bracketed_paste_chars += normalized.chars().count();
                bracketed_paste_lines += normalized.lines().count().max(1);
                let Some(target) = paste_target(shell) else {
                    continue;
                };
                paste_tracker.prime_explicit_replay_suppression(&normalized, target, now);
                pending_text.push_str(&normalized);
            }
            Event::Key(key) => {
                if !matches!(key.kind, KeyEventKind::Press | KeyEventKind::Repeat) {
                    continue;
                }

                match paste_tracker.intercept_key(&key, paste_target(shell), now) {
                    PasteKeyHandling::InsertText(text) => {
                        pending_text.push_str(&text);
                        continue;
                    }
                    PasteKeyHandling::Suppress => continue,
                    PasteKeyHandling::Passthrough => {}
                }

                if !shell.is_model_list_overlay_active()
                    && !shell.is_language_picker_active()
                    && !shell.is_approval_picker_active()
                    && !shell.is_network_picker_active()
                    && !shell.is_tui_picker_active()
                    && !shell.is_chat_picker_active()
                    && !shell.is_rewind_picker_active()
                    && !shell.is_fork_picker_active()
                    && !shell.is_subagent_picker_active()
                    && !shell.is_subagent_view_active()
                    && !shell.is_image_picker_active()
                    && !shell.is_marketplace_picker_active()
                    && !shell.is_bottom_form_active()
                    && pending_text.is_empty()
                    && matches!(key.code, KeyCode::Char('!'))
                    && !key.modifiers.contains(KeyModifiers::CONTROL)
                    && shell.can_enter_shell_mode()
                {
                    flush_pending_text(shell, &mut pending_text);
                    shell.enter_shell_mode();
                    continue;
                }

                if !shell.is_model_list_overlay_active()
                    && !shell.is_language_picker_active()
                    && !shell.is_approval_picker_active()
                    && !shell.is_network_picker_active()
                    && !shell.is_tui_picker_active()
                    && !shell.is_chat_picker_active()
                    && !shell.is_rewind_picker_active()
                    && !shell.is_fork_picker_active()
                    && !shell.is_subagent_picker_active()
                    && !shell.is_subagent_view_active()
                    && !shell.is_image_picker_active()
                    && !shell.is_marketplace_picker_active()
                    && let Some(ch) = batched_text_char(&key)
                {
                    pending_text.push(ch);
                    continue;
                }

                flush_pending_text(shell, &mut pending_text);
                process_key_event(shell, key, paste_tracker, now);
            }
            _ => {}
        }
    }

    flush_pending_text(shell, &mut pending_text);
    if bracketed_paste_chars > 0 {
        logging::log_event(&format!(
            "[paste] chars={} lines={}",
            bracketed_paste_chars,
            bracketed_paste_lines.max(1)
        ));
    }
}

fn flush_pending_text(shell: &mut TuiShell, pending_text: &mut String) {
    if pending_text.is_empty() {
        return;
    }

    if shell.is_bottom_form_active() {
        shell.bottom_form_insert_text(pending_text);
    } else {
        shell.insert_text_at_cursor(pending_text);
        shell.clamp_cursor();
        shell.refresh_suggestions();
    }
    pending_text.clear();
}

fn batched_text_char(key: &crossterm::event::KeyEvent) -> Option<char> {
    match key.code {
        KeyCode::Char(ch) if !key.modifiers.contains(KeyModifiers::CONTROL) => Some(ch),
        _ => None,
    }
}

fn process_key_event(
    shell: &mut TuiShell,
    key: crossterm::event::KeyEvent,
    paste_tracker: &mut PasteReplayTracker,
    now: Instant,
) {
    if shell.is_model_picker_active() {
        match key.code {
            KeyCode::Esc => shell.cancel_model_picker(),
            KeyCode::Up => shell.select_prev_model(),
            KeyCode::Down => shell.select_next_model(),
            KeyCode::Enter => shell.confirm_model_picker(),
            KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                shell.request_quit();
            }
            _ => {}
        }
        return;
    }

    if shell.is_language_picker_active() {
        match key.code {
            KeyCode::Esc => shell.cancel_language_picker(),
            KeyCode::Up => shell.select_prev_language(),
            KeyCode::Down => shell.select_next_language(),
            KeyCode::Enter => shell.confirm_language_picker(),
            KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                shell.request_quit();
            }
            _ => {}
        }
        return;
    }

    if shell.is_approval_picker_active() {
        match key.code {
            KeyCode::Esc => shell.cancel_approval_picker(),
            KeyCode::Up => shell.select_prev_approval_level(),
            KeyCode::Down => shell.select_next_approval_level(),
            KeyCode::Enter => shell.confirm_approval_picker(),
            KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                shell.request_quit();
            }
            _ => {}
        }
        return;
    }

    if shell.is_network_picker_active() {
        match key.code {
            KeyCode::Esc => shell.cancel_network_picker(),
            KeyCode::Up => shell.select_prev_network_version(),
            KeyCode::Down => shell.select_next_network_version(),
            KeyCode::Enter => shell.confirm_network_picker(),
            KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                shell.request_quit();
            }
            _ => {}
        }
        return;
    }

    if shell.is_tui_picker_active() {
        match key.code {
            KeyCode::Esc => shell.cancel_tui_picker(),
            KeyCode::Up => shell.select_prev_tui_mode(),
            KeyCode::Down => shell.select_next_tui_mode(),
            KeyCode::Enter => shell.confirm_tui_picker(),
            KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                shell.request_quit();
            }
            _ => {}
        }
        return;
    }

    if shell.is_chat_picker_active() {
        match key.code {
            KeyCode::Esc => shell.cancel_chat_picker(),
            KeyCode::Up => shell.select_prev_chat(),
            KeyCode::Down => shell.select_next_chat(),
            KeyCode::Enter => shell.confirm_chat_picker(),
            KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                shell.request_quit();
            }
            _ => {}
        }
        return;
    }

    if shell.is_rewind_picker_active() {
        match key.code {
            KeyCode::Esc => shell.cancel_rewind_picker(),
            KeyCode::Up => shell.select_prev_rewind_target(),
            KeyCode::Down => shell.select_next_rewind_target(),
            KeyCode::Enter => shell.confirm_rewind_picker(),
            KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                shell.request_quit();
            }
            _ => {}
        }
        return;
    }

    if shell.is_fork_picker_active() {
        match key.code {
            KeyCode::Esc => shell.cancel_fork_picker(),
            KeyCode::Up => shell.select_prev_fork_target(),
            KeyCode::Down => shell.select_next_fork_target(),
            KeyCode::Enter => shell.confirm_fork_picker(),
            KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                shell.request_quit();
            }
            _ => {}
        }
        return;
    }

    if shell.is_subagent_picker_active() {
        match key.code {
            KeyCode::Esc => shell.cancel_subagent_picker(),
            KeyCode::Up => shell.select_prev_subagent(),
            KeyCode::Down => shell.select_next_subagent(),
            KeyCode::Enter => shell.confirm_subagent_picker(),
            KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                shell.request_quit();
            }
            _ => {}
        }
        return;
    }

    if shell.is_subagent_view_active() {
        match key.code {
            KeyCode::Esc => {
                if shell.is_subagent_approval_input_active() {
                    shell.cancel_subagent_approval_input();
                } else {
                    shell.close_subagent_view();
                }
            }
            KeyCode::Char('o') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                shell.toggle_aux_details()
            }
            KeyCode::Char(ch)
                if ch.eq_ignore_ascii_case(&'v')
                    && key.modifiers.contains(KeyModifiers::CONTROL)
                    && shell.has_active_subagent_viewer_approval() =>
            {
                if let Err(e) = shell.paste_subagent_approval_from_clipboard() {
                    logging::log_event(&format!("clipboard paste failed: {}", e));
                }
            }
            KeyCode::Char(ch)
                if !key.modifiers.contains(KeyModifiers::CONTROL)
                    && shell.has_active_subagent_viewer_approval()
                    && !shell.is_subagent_approval_input_active()
                    && ch.eq_ignore_ascii_case(&'y') =>
            {
                shell.respond_to_active_subagent_approval("y")
            }
            KeyCode::Char(ch)
                if !key.modifiers.contains(KeyModifiers::CONTROL)
                    && shell.has_active_subagent_viewer_approval()
                    && !shell.is_subagent_approval_input_active()
                    && ch.eq_ignore_ascii_case(&'n') =>
            {
                shell.respond_to_active_subagent_approval("n")
            }
            KeyCode::Char(ch)
                if !key.modifiers.contains(KeyModifiers::CONTROL)
                    && shell.has_active_subagent_viewer_approval()
                    && !shell.is_subagent_approval_input_active()
                    && ch.eq_ignore_ascii_case(&'t') =>
            {
                shell.respond_to_active_subagent_approval("t")
            }
            KeyCode::Enter if shell.has_active_subagent_viewer_approval() => {
                if shell.is_subagent_approval_input_active() {
                    shell.submit_subagent_approval_input();
                } else {
                    shell.begin_subagent_approval_input();
                }
            }
            KeyCode::Backspace if shell.is_subagent_approval_input_active() => {
                shell.backspace_subagent_approval_input()
            }
            KeyCode::Delete if shell.is_subagent_approval_input_active() => {
                shell.delete_subagent_approval_input()
            }
            KeyCode::Left if shell.is_subagent_approval_input_active() => {
                shell.move_subagent_approval_cursor_left()
            }
            KeyCode::Right if shell.is_subagent_approval_input_active() => {
                shell.move_subagent_approval_cursor_right()
            }
            KeyCode::Home if shell.is_subagent_approval_input_active() => {
                shell.move_subagent_approval_cursor_home()
            }
            KeyCode::End if shell.is_subagent_approval_input_active() => {
                shell.move_subagent_approval_cursor_end()
            }
            KeyCode::Char(ch)
                if !key.modifiers.contains(KeyModifiers::CONTROL)
                    && shell.is_subagent_approval_input_active() =>
            {
                shell.insert_subagent_approval_char(ch)
            }
            KeyCode::Up => shell.scroll_subagent_view_up(2),
            KeyCode::Down => shell.scroll_subagent_view_down(2),
            KeyCode::PageUp => shell.scroll_subagent_view_up(8),
            KeyCode::PageDown => shell.scroll_subagent_view_down(8),
            KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                shell.request_quit();
            }
            _ => {}
        }
        return;
    }

    if shell.is_image_picker_active() {
        match key.code {
            KeyCode::Esc => shell.cancel_image_picker(),
            KeyCode::Up => shell.select_prev_image(),
            KeyCode::Down => shell.select_next_image(),
            KeyCode::Enter => shell.confirm_image_picker(),
            KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                shell.request_quit();
            }
            _ => {}
        }
        return;
    }

    if shell.is_marketplace_picker_active() {
        match key.code {
            KeyCode::Esc => shell.cancel_marketplace_picker(),
            KeyCode::Up => shell.select_prev_marketplace_item(),
            KeyCode::Down => shell.select_next_marketplace_item(),
            KeyCode::Enter => shell.confirm_marketplace_picker(),
            KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                shell.request_quit();
            }
            _ => {}
        }
        return;
    }

    if shell.is_bottom_form_active() {
        match key.code {
            KeyCode::Esc => shell.dismiss_bottom_form(),
            KeyCode::Up => shell.select_prev_bottom_form_field(),
            KeyCode::Down => shell.select_next_bottom_form_field(),
            KeyCode::Left => shell.bottom_form_move_left(),
            KeyCode::Right => shell.bottom_form_move_right(),
            KeyCode::Home => shell.bottom_form_move_home(),
            KeyCode::End => shell.bottom_form_move_end(),
            KeyCode::Enter if enter_should_insert_newline(key.modifiers) => {
                shell.bottom_form_insert_char('\n');
            }
            KeyCode::Enter => shell.activate_bottom_form(),
            KeyCode::Char(ch)
                if ch.eq_ignore_ascii_case(&'v')
                    && key.modifiers.contains(KeyModifiers::CONTROL) =>
            {
                if let Err(e) = shell.paste_bottom_form_from_clipboard() {
                    logging::log_event(&format!("clipboard paste failed: {}", e));
                } else if let Some(text) = load_clipboard_text() {
                    let target = if shell.bottom_form_preserves_newline() {
                        PasteTarget::BottomFormMultiline
                    } else {
                        PasteTarget::BottomFormSingleLine
                    };
                    paste_tracker.prime_explicit_replay_suppression(&text, target, now);
                }
            }
            KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                shell.request_quit();
            }
            KeyCode::Backspace => shell.bottom_form_backspace(),
            KeyCode::Delete => shell.bottom_form_delete(),
            KeyCode::Char(ch) if !key.modifiers.contains(KeyModifiers::CONTROL) => {
                shell.bottom_form_insert_char(ch)
            }
            _ => {}
        }
        return;
    }

    let suggestion_mode =
        shell.is_input_suggestion_active() && !shell.view_model().slash_suggestions.is_empty();
    let should_insert_newline =
        matches!(key.code, KeyCode::Enter) && enter_should_insert_newline(key.modifiers);
    maybe_log_key_event(&key, should_insert_newline);

    if matches!(key.code, KeyCode::Esc) && shell.handle_interrupt_escape_key(now) {
        return;
    }
    if !matches!(key.code, KeyCode::Esc) {
        shell.clear_interrupt_escape_arm();
    }

    match key.code {
        KeyCode::Esc => shell.request_quit(),
        KeyCode::Char(ch)
            if ch.eq_ignore_ascii_case(&'c')
                && key.modifiers.contains(KeyModifiers::CONTROL)
                && key.modifiers.contains(KeyModifiers::SHIFT)
                && !shell.is_inline_mode() =>
        {
            if let Err(e) = shell.copy_conversation_selection() {
                logging::log_event(&format!("clipboard copy failed: {}", e));
            }
        }
        KeyCode::Char(ch)
            if ch.eq_ignore_ascii_case(&'v') && key.modifiers.contains(KeyModifiers::CONTROL) =>
        {
            // Try paste image first
            if let Some(image_path) = load_clipboard_image() {
                shell.add_pending_image_with_feedback(image_path);
            } else if let Err(e) = shell.paste_from_clipboard() {
                logging::log_event(&format!("clipboard paste failed: {}", e));
            } else if let Some(text) = load_clipboard_text() {
                paste_tracker.prime_explicit_replay_suppression(&text, PasteTarget::MainInput, now);
            }
        }
        KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => shell.request_quit(),
        KeyCode::Char('o') if key.modifiers.contains(KeyModifiers::CONTROL) => {
            shell.toggle_aux_details()
        }
        KeyCode::Up if suggestion_mode => shell.select_prev_suggestion(),
        KeyCode::Down if suggestion_mode => shell.select_next_suggestion(),
        KeyCode::Up => {
            shell.recall_previous_input();
        }
        KeyCode::Down => {
            shell.recall_next_input();
        }
        KeyCode::Tab if suggestion_mode => shell.apply_selected_suggestion(),
        KeyCode::Tab if !shell.is_shell_mode_active() => shell.toggle_input_mode(),
        KeyCode::PageUp if !shell.is_inline_mode() => shell.scroll_history_up(8),
        KeyCode::PageDown if !shell.is_inline_mode() => shell.scroll_history_down(8),
        KeyCode::Home
            if key.modifiers.contains(KeyModifiers::CONTROL) && !shell.is_inline_mode() =>
        {
            shell.scroll_history_to_top()
        }
        KeyCode::End
            if key.modifiers.contains(KeyModifiers::CONTROL) && !shell.is_inline_mode() =>
        {
            shell.scroll_history_to_bottom()
        }
        KeyCode::Left => shell.move_cursor_left(),
        KeyCode::Right => shell.move_cursor_right(),
        KeyCode::Home => shell.move_cursor_home(),
        KeyCode::End => shell.move_cursor_end(),
        KeyCode::Enter if should_insert_newline => {
            shell.insert_newline_at_cursor();
            shell.clamp_cursor();
            shell.refresh_suggestions();
        }
        KeyCode::Enter if suggestion_mode => shell.apply_selected_suggestion(),
        KeyCode::Enter
            if shell.is_file_reference_mode_active()
                && (shell.view_model().input_suggestion_loading
                    || !shell.view_model().slash_suggestions.is_empty()) =>
        {
            shell.confirm_selected_file_reference();
        }
        KeyCode::Enter => shell.submit_input(),
        KeyCode::Backspace if shell.should_exit_shell_mode_on_backspace() => {
            shell.exit_shell_mode();
        }
        KeyCode::Backspace => {
            shell.backspace_at_cursor();
            shell.clamp_cursor();
            shell.refresh_suggestions();
        }
        KeyCode::Delete => {
            shell.delete_at_cursor();
            shell.clamp_cursor();
            shell.refresh_suggestions();
        }
        KeyCode::Char(ch) if !key.modifiers.contains(KeyModifiers::CONTROL) => {
            shell.insert_char_at_cursor(ch);
            shell.clamp_cursor();
            shell.refresh_suggestions();
        }
        _ => {}
    }
}

fn enter_should_insert_newline(modifiers: KeyModifiers) -> bool {
    if modifiers.contains(KeyModifiers::CONTROL) {
        return false;
    }

    // Windows Terminal / ConPTY often omit SHIFT on Shift+Enter; `shift_pressed_fallback` fixes that.
    // Some builds map Shift+Enter to Alt+Enter instead.
    shift_pressed_fallback()
        || modifiers.contains(KeyModifiers::SHIFT)
        || modifiers.contains(KeyModifiers::ALT)
}

fn maybe_log_key_event(key: &crossterm::event::KeyEvent, should_insert_newline: bool) {
    if !matches!(key.code, KeyCode::Enter | KeyCode::Char('\\')) {
        return;
    }

    logging::log_event(&format!(
        "[keyboard] key={:?} shift_fallback={} insert_newline={}",
        key,
        shift_pressed_fallback(),
        should_insert_newline
    ));
}

fn normalize_pasted_text(text: &str) -> String {
    text.replace("\r\n", "\n").replace('\r', "\n")
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum PasteTarget {
    MainInput,
    BottomFormSingleLine,
    BottomFormMultiline,
}

impl PasteTarget {
    fn newline_text(self) -> &'static str {
        match self {
            Self::MainInput => "\n",
            Self::BottomFormSingleLine => " ",
            Self::BottomFormMultiline => "\n",
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::MainInput => "main-input",
            Self::BottomFormSingleLine => "bottom-form-single-line",
            Self::BottomFormMultiline => "bottom-form-multiline",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum PasteKeyHandling {
    Passthrough,
    InsertText(String),
    Suppress,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum PasteTrackingMode {
    ImplicitReplay,
    ExplicitReplaySuppression,
}

#[derive(Debug)]
struct PasteTrackingState {
    mode: PasteTrackingMode,
    source_text: Vec<char>,
    cursor: usize,
    first_seen_at: Instant,
    last_seen_at: Instant,
    target: PasteTarget,
    logged: bool,
}

#[derive(Debug, Default)]
struct PasteReplayTracker {
    state: Option<PasteTrackingState>,
}

impl PasteReplayTracker {
    fn expire_if_idle(&mut self, now: Instant) {
        let Some(state) = self.state.as_ref() else {
            return;
        };

        let max_gap = match state.mode {
            PasteTrackingMode::ImplicitReplay => IMPLICIT_PASTE_MAX_GAP,
            PasteTrackingMode::ExplicitReplaySuppression => EXPLICIT_PASTE_REPLAY_MAX_GAP,
        };
        if now.duration_since(state.last_seen_at) > max_gap {
            self.state = None;
        }
    }

    fn prime_explicit_replay_suppression(&mut self, text: &str, target: PasteTarget, now: Instant) {
        let normalized = normalize_pasted_text(text);
        if normalized.is_empty() {
            self.state = None;
            return;
        }

        logging::log_event(&format!(
            "[paste] primed explicit replay suppression chars={} lines={}",
            normalized.chars().count(),
            normalized.lines().count().max(1)
        ));

        self.state = Some(PasteTrackingState {
            mode: PasteTrackingMode::ExplicitReplaySuppression,
            source_text: normalized.chars().collect(),
            cursor: 0,
            first_seen_at: now,
            last_seen_at: now,
            target,
            logged: false,
        });
    }

    fn intercept_key(
        &mut self,
        key: &crossterm::event::KeyEvent,
        target: Option<PasteTarget>,
        now: Instant,
    ) -> PasteKeyHandling {
        self.expire_if_idle(now);

        let Some(unit) = key_to_paste_unit(key) else {
            if matches!(key.code, KeyCode::Esc) {
                self.state = None;
            }
            return PasteKeyHandling::Passthrough;
        };

        if self.advance_existing_state(unit, target, now) {
            return self.resolve_existing_state(unit, now);
        }

        let Some(target) = target else {
            return PasteKeyHandling::Passthrough;
        };

        let Some(clipboard_text) = load_multiline_clipboard_text() else {
            return PasteKeyHandling::Passthrough;
        };
        let clipboard_chars: Vec<char> = clipboard_text.chars().collect();
        if clipboard_chars.first().copied() != Some(unit) {
            return PasteKeyHandling::Passthrough;
        }

        self.state = Some(PasteTrackingState {
            mode: PasteTrackingMode::ImplicitReplay,
            source_text: clipboard_chars,
            cursor: 1,
            first_seen_at: now,
            last_seen_at: now,
            target,
            logged: false,
        });

        logging::log_event(&format!(
            "[paste] detected implicit replay candidate target={} first_char={:?}",
            target.as_str(),
            unit
        ));

        self.resolve_existing_state(unit, now)
    }

    fn advance_existing_state(
        &mut self,
        unit: char,
        target: Option<PasteTarget>,
        now: Instant,
    ) -> bool {
        let Some(state) = self.state.as_mut() else {
            return false;
        };

        if state.mode == PasteTrackingMode::ImplicitReplay && Some(state.target) != target {
            self.state = None;
            return false;
        }

        if state.source_text.get(state.cursor).copied() != Some(unit) {
            self.state = None;
            return false;
        }

        state.cursor += 1;
        state.last_seen_at = now;
        true
    }

    fn resolve_existing_state(&mut self, unit: char, now: Instant) -> PasteKeyHandling {
        let Some(state) = self.state.as_mut() else {
            return PasteKeyHandling::Passthrough;
        };

        let handling = match state.mode {
            PasteTrackingMode::ExplicitReplaySuppression => {
                if !state.logged {
                    logging::log_event(
                        "[paste] suppressed replayed key stream after explicit clipboard paste",
                    );
                    state.logged = true;
                }
                PasteKeyHandling::Suppress
            }
            PasteTrackingMode::ImplicitReplay => {
                if unit == '\n'
                    && now.duration_since(state.first_seen_at) <= IMPLICIT_PASTE_MAX_GAP
                    && state.cursor > 2
                {
                    logging::log_event(&format!(
                        "[paste] translated replayed newline target={} elapsed_ms={} matched_chars={}",
                        state.target.as_str(),
                        now.duration_since(state.first_seen_at).as_millis(),
                        state.cursor.saturating_sub(1)
                    ));
                    PasteKeyHandling::InsertText(state.target.newline_text().to_string())
                } else if unit == '\n' {
                    self.state = None;
                    return PasteKeyHandling::Passthrough;
                } else {
                    PasteKeyHandling::InsertText(unit.to_string())
                }
            }
        };

        let should_clear = state.cursor >= state.source_text.len();
        if should_clear {
            self.state = None;
        }
        handling
    }
}

fn paste_target(shell: &TuiShell) -> Option<PasteTarget> {
    if shell.is_model_list_overlay_active()
        || shell.is_language_picker_active()
        || shell.is_approval_picker_active()
        || shell.is_network_picker_active()
        || shell.is_tui_picker_active()
        || shell.is_chat_picker_active()
        || shell.is_rewind_picker_active()
        || shell.is_fork_picker_active()
        || shell.is_image_picker_active()
        || shell.is_marketplace_picker_active()
    {
        None
    } else if shell.is_bottom_form_active() {
        Some(if shell.bottom_form_preserves_newline() {
            PasteTarget::BottomFormMultiline
        } else {
            PasteTarget::BottomFormSingleLine
        })
    } else {
        Some(PasteTarget::MainInput)
    }
}

fn load_clipboard_text() -> Option<String> {
    let text = arboard::Clipboard::new().ok()?.get_text().ok()?;
    let normalized = normalize_pasted_text(&text);
    (!normalized.is_empty()).then_some(normalized)
}

fn load_clipboard_image() -> Option<std::path::PathBuf> {
    use image::{ImageBuffer, Rgba};
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    let mut clipboard = match arboard::Clipboard::new() {
        Ok(c) => c,
        Err(e) => {
            logging::log_event(&format!("[clipboard] cannot access clipboard: {}", e));
            return None;
        }
    };

    let image = match clipboard.get_image() {
        Ok(i) => i,
        Err(_) => return None,
    };

    let temp_dir = std::env::temp_dir().join("spirit").join("clipboard-images");
    if let Err(e) = fs::create_dir_all(&temp_dir) {
        logging::log_event(&format!("[clipboard] cannot create temp directory: {}", e));
        return None;
    }

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_nanos();
    let filename = format!("clipboard_{}.png", timestamp);
    let path = temp_dir.join(filename);

    let rgba: Vec<u8> = image
        .bytes
        .chunks_exact(4)
        .flat_map(|bgra| [bgra[2], bgra[1], bgra[0], bgra[3]])
        .collect();

    let img =
        match ImageBuffer::<Rgba<u8>, _>::from_vec(image.width as u32, image.height as u32, rgba) {
            Some(i) => i,
            None => {
                logging::log_event("[clipboard] image format conversion failed");
                return None;
            }
        };

    if let Err(e) = img.save_with_format(&path, image::ImageFormat::Png) {
        logging::log_event(&format!("[clipboard] cannot save image: {}", e));
        return None;
    }

    Some(path)
}

fn load_multiline_clipboard_text() -> Option<String> {
    let normalized = load_clipboard_text()?;
    normalized.contains('\n').then_some(normalized)
}

fn key_to_paste_unit(key: &crossterm::event::KeyEvent) -> Option<char> {
    if key.modifiers.contains(KeyModifiers::CONTROL) {
        return None;
    }

    match key.code {
        KeyCode::Char(ch) => Some(ch),
        KeyCode::Enter => Some('\n'),
        _ => None,
    }
}

fn maybe_log_event_batch(shell: &TuiShell, events: &[Event]) {
    let mut key_events = 0usize;
    let mut char_keys = 0usize;
    let mut enter_keys = 0usize;
    let mut paste_events = 0usize;

    for event in events {
        match event {
            Event::Paste(_) => paste_events += 1,
            Event::Key(key) if matches!(key.kind, KeyEventKind::Press | KeyEventKind::Repeat) => {
                key_events += 1;
                match key.code {
                    KeyCode::Char(_) => char_keys += 1,
                    KeyCode::Enter => enter_keys += 1,
                    _ => {}
                }
            }
            _ => {}
        }
    }

    if paste_events == 0 && !(enter_keys > 0 && char_keys >= 4) {
        return;
    }

    logging::log_event(&format!(
        "[input-batch] target={} events={} keys={} chars={} enters={} paste_events={} busy={} bottom_form={}",
        paste_target(shell)
            .map(PasteTarget::as_str)
            .unwrap_or("picker"),
        events.len(),
        key_events,
        char_keys,
        enter_keys,
        paste_events,
        shell.view_model().pending_response_active,
        shell.is_bottom_form_active()
    ));
}

#[cfg(target_os = "windows")]
fn shift_pressed_fallback() -> bool {
    unsafe {
        (GetAsyncKeyState(VK_LSHIFT as i32) as u16 & 0x8000) != 0
            || (GetAsyncKeyState(VK_RSHIFT as i32) as u16 & 0x8000) != 0
    }
}

#[cfg(not(target_os = "windows"))]
fn shift_pressed_fallback() -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use crossterm::event::{KeyCode, KeyEvent, KeyEventKind, KeyEventState, KeyModifiers};

    #[test]
    fn prompt_trailing_absorbs_lookalike_flags() {
        let cli = Cli::try_parse_from(["spirit", "-p", "x", "-a", "bypass-approval"])
            .expect("trailing tokens after -p should parse as prompt");
        assert_eq!(cli.prompt, vec!["x", "-a", "bypass-approval"]);
        assert!(cli.approval.is_none());
    }

    #[test]
    fn approval_before_prompt_still_applies() {
        let cli = Cli::try_parse_from(["spirit", "-a", "bypass-approval", "-p", "hello"])
            .expect("options before -p should parse normally");
        assert_eq!(cli.approval.as_deref(), Some("bypass-approval"));
        assert_eq!(cli.prompt, vec!["hello"]);
    }

    fn key(code: KeyCode) -> KeyEvent {
        KeyEvent {
            code,
            modifiers: KeyModifiers::NONE,
            kind: KeyEventKind::Press,
            state: KeyEventState::NONE,
        }
    }

    fn ctrl_v() -> KeyEvent {
        KeyEvent {
            code: KeyCode::Char('v'),
            modifiers: KeyModifiers::CONTROL,
            kind: KeyEventKind::Press,
            state: KeyEventState::NONE,
        }
    }

    impl PasteReplayTracker {
        fn intercept_key_with_clipboard(
            &mut self,
            key: &KeyEvent,
            target: Option<PasteTarget>,
            now: Instant,
            clipboard_text: Option<&str>,
        ) -> PasteKeyHandling {
            self.expire_if_idle(now);

            let Some(unit) = key_to_paste_unit(key) else {
                return PasteKeyHandling::Passthrough;
            };

            if self.advance_existing_state(unit, target, now) {
                return self.resolve_existing_state(unit, now);
            }

            let Some(target) = target else {
                return PasteKeyHandling::Passthrough;
            };
            let Some(clipboard_text) = clipboard_text else {
                return PasteKeyHandling::Passthrough;
            };
            let normalized = normalize_pasted_text(clipboard_text);
            if !normalized.contains('\n') {
                return PasteKeyHandling::Passthrough;
            }
            let chars: Vec<char> = normalized.chars().collect();
            if chars.first().copied() != Some(unit) {
                return PasteKeyHandling::Passthrough;
            }

            self.state = Some(PasteTrackingState {
                mode: PasteTrackingMode::ImplicitReplay,
                source_text: chars,
                cursor: 1,
                first_seen_at: now,
                last_seen_at: now,
                target,
                logged: false,
            });
            self.resolve_existing_state(unit, now)
        }
    }

    #[test]
    fn implicit_multiline_replay_inserts_newline_in_main_input() {
        let mut tracker = PasteReplayTracker::default();
        let clipboard = "Hello\nThis is a test\nbro";
        let start = Instant::now();

        assert_eq!(
            tracker.intercept_key_with_clipboard(
                &key(KeyCode::Char('H')),
                Some(PasteTarget::MainInput),
                start,
                Some(clipboard)
            ),
            PasteKeyHandling::InsertText("H".to_string())
        );

        for (ch, offset) in [('e', 5), ('l', 10), ('l', 15), ('o', 20)] {
            assert_eq!(
                tracker.intercept_key_with_clipboard(
                    &key(KeyCode::Char(ch)),
                    Some(PasteTarget::MainInput),
                    start + Duration::from_millis(offset),
                    Some(clipboard)
                ),
                PasteKeyHandling::InsertText(ch.to_string())
            );
        }

        assert_eq!(
            tracker.intercept_key_with_clipboard(
                &key(KeyCode::Enter),
                Some(PasteTarget::MainInput),
                start + Duration::from_millis(25),
                Some(clipboard)
            ),
            PasteKeyHandling::InsertText("\n".to_string())
        );
    }

    #[test]
    fn implicit_multiline_replay_normalizes_newline_in_single_line_bottom_form() {
        let mut tracker = PasteReplayTracker::default();
        let clipboard = "Header\nBearer";
        let start = Instant::now();

        for (index, ch) in ['H', 'e', 'a', 'd', 'e', 'r'].into_iter().enumerate() {
            assert_eq!(
                tracker.intercept_key_with_clipboard(
                    &key(KeyCode::Char(ch)),
                    Some(PasteTarget::BottomFormSingleLine),
                    start + Duration::from_millis(index as u64 * 5),
                    Some(clipboard)
                ),
                PasteKeyHandling::InsertText(ch.to_string())
            );
        }

        assert_eq!(
            tracker.intercept_key_with_clipboard(
                &key(KeyCode::Enter),
                Some(PasteTarget::BottomFormSingleLine),
                start + Duration::from_millis(35),
                Some(clipboard)
            ),
            PasteKeyHandling::InsertText(" ".to_string())
        );
    }

    #[test]
    fn implicit_multiline_replay_preserves_newline_in_multiline_bottom_form() {
        let mut tracker = PasteReplayTracker::default();
        let clipboard = "line1\nline2";
        let start = Instant::now();

        for (index, ch) in ['l', 'i', 'n', 'e', '1'].into_iter().enumerate() {
            assert_eq!(
                tracker.intercept_key_with_clipboard(
                    &key(KeyCode::Char(ch)),
                    Some(PasteTarget::BottomFormMultiline),
                    start + Duration::from_millis(index as u64 * 5),
                    Some(clipboard)
                ),
                PasteKeyHandling::InsertText(ch.to_string())
            );
        }

        assert_eq!(
            tracker.intercept_key_with_clipboard(
                &key(KeyCode::Enter),
                Some(PasteTarget::BottomFormMultiline),
                start + Duration::from_millis(30),
                Some(clipboard)
            ),
            PasteKeyHandling::InsertText("\n".to_string())
        );
    }

    #[test]
    fn delayed_enter_is_not_treated_as_implicit_paste() {
        let mut tracker = PasteReplayTracker::default();
        let clipboard = "Hello\nWorld";
        let start = Instant::now();

        for (index, ch) in ['H', 'e', 'l', 'l', 'o'].into_iter().enumerate() {
            assert_eq!(
                tracker.intercept_key_with_clipboard(
                    &key(KeyCode::Char(ch)),
                    Some(PasteTarget::MainInput),
                    start + Duration::from_millis(index as u64 * 80),
                    Some(clipboard)
                ),
                if index == 0 {
                    PasteKeyHandling::InsertText("H".to_string())
                } else {
                    PasteKeyHandling::InsertText(ch.to_string())
                }
            );
        }

        assert_eq!(
            tracker.intercept_key_with_clipboard(
                &key(KeyCode::Enter),
                Some(PasteTarget::MainInput),
                start + Duration::from_millis(500),
                Some(clipboard)
            ),
            PasteKeyHandling::Passthrough
        );
    }

    #[test]
    fn explicit_paste_suppresses_following_replay() {
        let mut tracker = PasteReplayTracker::default();
        let start = Instant::now();
        tracker.prime_explicit_replay_suppression("Hello\nWorld", PasteTarget::MainInput, start);

        assert_eq!(
            tracker.intercept_key(&ctrl_v(), Some(PasteTarget::MainInput), start),
            PasteKeyHandling::Passthrough
        );
        assert_eq!(
            tracker.intercept_key(
                &key(KeyCode::Char('H')),
                Some(PasteTarget::MainInput),
                start + Duration::from_millis(5)
            ),
            PasteKeyHandling::Suppress
        );
        for (index, ch) in ['e', 'l', 'l', 'o'].into_iter().enumerate() {
            assert_eq!(
                tracker.intercept_key(
                    &key(KeyCode::Char(ch)),
                    Some(PasteTarget::MainInput),
                    start + Duration::from_millis(10 + index as u64 * 5)
                ),
                PasteKeyHandling::Suppress
            );
        }
        assert_eq!(
            tracker.intercept_key(
                &key(KeyCode::Enter),
                Some(PasteTarget::MainInput),
                start + Duration::from_millis(35)
            ),
            PasteKeyHandling::Suppress
        );
    }
}
