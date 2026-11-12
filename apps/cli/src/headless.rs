use anyhow::{Result, anyhow};
use rust_i18n::t;
use std::{
    thread,
    time::{Duration, Instant},
};

use crate::{
    adapters::{DefaultAppPaths, JsonConfigStore},
    cli_bootstrap::GlobalCliOptions,
    daemon::DaemonRuntime,
    host_runtime::RuntimeEvent,
    ports::{AppPaths, ConfigStore},
    view::MessageRole,
};

const POLL_INTERVAL: Duration = Duration::from_millis(50);
const DEFAULT_TURN_TIMEOUT: Duration = Duration::from_secs(60 * 30);

/// Run a single non-interactive turn. stdout receives only the final assistant text.
pub fn run_headless_prompt(
    prompt: &str,
    options: &GlobalCliOptions,
    _config: crate::model_registry::AppConfig,
) -> Result<()> {
    let trimmed = prompt.trim();
    if trimmed.is_empty() {
        return Err(anyhow!("{}", t!("cli.headless.prompt_empty")));
    }

    let app_paths = DefaultAppPaths::new();
    let workspace_root = app_paths.workspace_root();
    let config = JsonConfigStore.load()?;
    let mut runtime = DaemonRuntime::new(config, workspace_root)?;

    if let Some(approval) = options.approval.as_deref() {
        let level = crate::cli_bootstrap::parse_cli_approval_level(approval)?;
        runtime.set_approval_level(&level)?;
    }

    runtime.run_session_start("startup")?;
    runtime.submit_user_turn(trimmed.to_string(), None)?;

    let deadline = Instant::now() + DEFAULT_TURN_TIMEOUT;
    let result = run_daemon_headless_turn(&mut runtime, deadline);
    runtime.close_session();
    result
}

fn run_daemon_headless_turn(runtime: &mut DaemonRuntime, deadline: Instant) -> Result<()> {
    let mut pending_assistant = String::new();
    let mut final_assistant = String::new();
    let mut has_pending_assistant = false;
    let mut runtime_error_hint: Option<String> = None;

    loop {
        if Instant::now() > deadline {
            return Err(anyhow!("{}", t!("cli.headless.timeout")));
        }

        for event in runtime.drain_events() {
            match event {
                RuntimeEvent::BeginAssistantResponse => {
                    pending_assistant.clear();
                    has_pending_assistant = true;
                }
                RuntimeEvent::AssistantChunk(chunk) => {
                    if has_pending_assistant {
                        pending_assistant.push_str(&chunk);
                    }
                }
                RuntimeEvent::ReplacePendingAssistant(content) => {
                    pending_assistant = content;
                    has_pending_assistant = true;
                }
                RuntimeEvent::AssistantResponseCompleted => {
                    if has_pending_assistant {
                        final_assistant = pending_assistant.clone();
                        has_pending_assistant = false;
                    }
                }
                RuntimeEvent::RemovePendingAssistant => {
                    pending_assistant.clear();
                    has_pending_assistant = false;
                }
                RuntimeEvent::OpenAskQuestions { .. } => {
                    return Err(anyhow!("{}", t!("cli.headless.blocked_questions")));
                }
                RuntimeEvent::PushMessage(message)
                    if message.role == MessageRole::Agent
                        && message.tool_block.is_none()
                        && !message.content.trim().is_empty() =>
                {
                    runtime_error_hint = Some(message.content.trim().to_string());
                }
                _ => {}
            }
        }

        if runtime.has_pending_tool_approval() {
            runtime.respond_to_pending_tool_approval("n");
            return Err(anyhow!("{}", t!("cli.headless.blocked_approval")));
        }

        if runtime.pending_subagent_approval().is_some() {
            return Err(anyhow!("{}", t!("cli.headless.blocked_approval")));
        }

        if !runtime.is_busy() {
            break;
        }

        thread::sleep(POLL_INTERVAL);
    }

    if final_assistant.trim().is_empty() && !pending_assistant.trim().is_empty() {
        final_assistant = pending_assistant;
    }
    if final_assistant.trim().is_empty() {
        if let Some(hint) = runtime_error_hint {
            return Err(anyhow!("{}", t!("cli.headless.runtime_failed", err = hint)));
        }
        return Err(anyhow!("{}", t!("cli.headless.empty_response")));
    }
    println!("{final_assistant}");
    Ok(())
}
