use super::*;
use crate::model_registry::DEFAULT_API_BASE;

impl TuiShell {
    pub(super) fn open_cli_log_file(&self) -> Result<std::path::PathBuf> {
        let path = self.ensure_cli_log_file()?;
        logging::log_event(&format!("[cli-log] open path={}", path.display()));
        open_path_in_os(&path)?;
        Ok(path)
    }

    pub(super) fn export_cli_log_to_temp(&self) -> Result<std::path::PathBuf> {
        let source = self.ensure_cli_log_file()?;
        let exported_at_unix_secs = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let target = env::temp_dir().join(format!(
            "spirit-cli-log-{exported_at_unix_secs}-{}.log",
            std::process::id()
        ));
        fs::copy(&source, &target).with_context(|| {
            t!(
                "tui.log.export_copy_failed",
                src = source.display(),
                dst = target.display()
            )
            .into_owned()
        })?;
        logging::log_event(&format!(
            "[cli-log] export source={} target={}",
            source.display(),
            target.display()
        ));
        Ok(target)
    }

    fn ensure_cli_log_file(&self) -> Result<std::path::PathBuf> {
        let path = self.app_paths.log_file();
        OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .with_context(|| {
                t!("tui.log.file_access_failed", path = path.display()).into_owned()
            })?;
        Ok(path)
    }

    pub(super) fn export_llm_history_json_to_temp(&mut self) -> Result<std::path::PathBuf> {
        let export_state = self.runtime.export_llm_state()?;
        let active_model = self.runtime.config().active_model.clone();
        let api_base = env::var("SPIRIT_API_BASE").unwrap_or_else(|_| {
            self.runtime
                .config()
                .active_model_profile()
                .map(|m| m.api_base.clone())
                .unwrap_or_else(|| DEFAULT_API_BASE.to_string())
        });
        let working_directory = self.app_paths.workspace_root().display().to_string();
        let exported_at_unix_secs = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let export = serde_json::json!({
            "export_version": 2,
            "exported_at_unix_secs": exported_at_unix_secs,
            "active_model": active_model,
            "api_base": api_base,
            "working_directory": working_directory,
            "system_prompts": export_state.system_prompts,
            "note": "messages: API shape of the in-memory llm_history. api_request_trace: each model inference step is one tool_agent_chat_completions call with stream=true, including tools; multi-round tool use yields multiple traces (one HTTP request per round), and failed rounds still keep the last request body. system_prompts holds the transport-exported system copy (e.g. tool_agent) for debugging and export.",
            "message_count": export_state.api_messages.len(),
            "messages": export_state.api_messages,
            "api_request_trace_count": export_state.api_request_trace.len(),
            "api_request_trace": export_state.api_request_trace,
        });

        let json = serde_json::to_string_pretty(&export)
            .context(t!("tui.log.serialize_failed").into_owned())?;
        let path = env::temp_dir().join(format!(
            "spirit-llm-export-{exported_at_unix_secs}-{}.json",
            std::process::id()
        ));
        fs::write(&path, json)
            .with_context(|| t!("tui.log.write_failed", path = path.display()).into_owned())?;
        Ok(path)
    }
}

fn open_path_in_os(path: &Path) -> Result<()> {
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer.exe")
            .arg(path.as_os_str())
            .spawn()
            .with_context(|| {
                t!("tui.log.system_open_failed", path = path.display()).into_owned()
            })?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open").arg(path).spawn().with_context(|| {
            t!("tui.log.system_open_failed", path = path.display()).into_owned()
        })?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(path)
            .spawn()
            .with_context(|| {
                t!("tui.log.system_open_failed", path = path.display()).into_owned()
            })?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err(anyhow::anyhow!(
        t!("tui.platform.open_log_unsupported", path = path.display()).into_owned()
    ))
}
