use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use crate::{llm_types::LlmMessage, mcp::spirit_data_dir, ports::ArchivedLlmMessage};

pub const PLANS_DIR_NAME: &str = "plans";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanMetadata {
    pub path: PathBuf,
    pub exists: bool,
    #[serde(default = "default_agent_mode")]
    pub agent_mode: String,
    #[serde(default)]
    pub plan_mode: bool,
}

fn default_agent_mode() -> String {
    "agent".to_string()
}

pub(crate) fn bootstrap_plan_metadata() -> PlanMetadata {
    PlanMetadata {
        path: PathBuf::new(),
        exists: false,
        agent_mode: "agent".to_string(),
        plan_mode: false,
    }
}

pub fn user_plans_dir() -> PathBuf {
    spirit_data_dir().join(PLANS_DIR_NAME)
}

impl PlanMetadata {
    pub fn agent_mode(&self) -> &str {
        match self.agent_mode.as_str() {
            "agent" | "plan" | "ask" | "debug" => self.agent_mode.as_str(),
            _ if self.plan_mode => "plan",
            _ => "agent",
        }
    }
}

pub fn plan_metadata_snapshot(agent_mode: &str, active_plan_path: Option<&Path>) -> PlanMetadata {
    let path = active_plan_path
        .filter(|candidate| !candidate.as_os_str().is_empty())
        .map(PathBuf::from)
        .unwrap_or_default();
    let plan_mode = agent_mode == "plan";
    PlanMetadata {
        exists: !path.as_os_str().is_empty() && path.exists(),
        path,
        agent_mode: agent_mode.to_string(),
        plan_mode,
    }
}

pub fn extract_active_plan_path_from_llm_history(history: &[LlmMessage]) -> Option<PathBuf> {
    for message in history.iter().rev() {
        if message.role != "tool" && message.role != "assistant" {
            continue;
        }
        if let Some(path) = parse_create_plan_path_from_tool_output(&message.content) {
            return Some(PathBuf::from(path));
        }
    }
    None
}

pub fn parse_create_plan_path_from_tool_output(output: &str) -> Option<String> {
    output
        .lines()
        .find_map(|line| line.strip_prefix("path: "))
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .filter(|_| output.contains("[plan]"))
        .map(str::to_string)
}

pub fn extract_active_plan_path_from_archived_llm_history(
    history: &[ArchivedLlmMessage],
) -> Option<PathBuf> {
    for message in history.iter().rev() {
        if message.role != "tool" && message.role != "assistant" {
            continue;
        }
        if let Some(path) = parse_create_plan_path_from_tool_output(&message.text_content()) {
            return Some(PathBuf::from(path));
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::shared_env_lock;

    use std::{
        env, fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn unique_spirit_data_dir(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        env::temp_dir().join(format!(
            "spirit-plan-test-{label}-{nanos}-{}",
            std::process::id()
        ))
    }

    #[test]
    fn plan_metadata_snapshot_uses_active_plan_path() {
        let _guard = shared_env_lock()
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        let spirit_data_dir = unique_spirit_data_dir("snapshot");
        unsafe {
            env::set_var("SPIRIT_DATA_DIR", &spirit_data_dir);
        }
        let plan_path = user_plans_dir().join("demo-plan.md");
        fs::create_dir_all(plan_path.parent().expect("plans parent")).expect("create plans dir");
        fs::write(&plan_path, "# Demo").expect("write plan");

        let metadata = plan_metadata_snapshot("agent", Some(&plan_path));
        unsafe {
            env::remove_var("SPIRIT_DATA_DIR");
        }
        assert_eq!(metadata.path, plan_path);
        assert!(metadata.exists);
    }

    fn llm_tool_message(content: &str) -> LlmMessage {
        LlmMessage {
            role: "tool",
            content: content.to_string(),
            image_paths: Vec::new(),
            tool_call_id: Some("call-1".to_string()),
            tool_calls: None,
            provider_state: None,
        }
    }

    #[test]
    fn extract_active_plan_path_from_llm_history_reads_last_create_plan() {
        let history = vec![
            llm_tool_message("[plan]\npath: /tmp/first.md\naction: create_plan"),
            llm_tool_message("[plan]\npath: /tmp/second.md\naction: create_plan"),
        ];
        assert_eq!(
            extract_active_plan_path_from_llm_history(&history),
            Some(PathBuf::from("/tmp/second.md"))
        );
    }
}
