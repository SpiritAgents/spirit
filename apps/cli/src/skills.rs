use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SkillScope {
    Workspace,
    User,
    Extension,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SkillRootKind {
    WorkspaceSpirit,
    WorkspaceAgents,
    User,
    Extension,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillSource {
    pub id: String,
    pub scope: SkillScope,
    pub root_kind: SkillRootKind,
    pub name: String,
    pub description: String,
    pub short_label: String,
    pub path: PathBuf,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillPreview {
    pub excerpt: String,
    #[serde(default)]
    pub truncated: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillEntry {
    pub source: SkillSource,
    pub enabled: bool,
    pub content: String,
    pub preview: SkillPreview,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveSkillResourceEntry {
    pub kind: String,
    pub path: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveSkillPayload {
    pub id: String,
    pub scope: SkillScope,
    pub name: String,
    pub description: String,
    pub path: PathBuf,
    pub content: String,
    pub truncated: bool,
    #[serde(default)]
    pub resources: Vec<ActiveSkillResourceEntry>,
    #[serde(default)]
    pub resources_truncated: bool,
}

pub fn build_activate_skill_user_turn(skill_name: &str, extra_note: &str) -> String {
    let trimmed = extra_note.trim();
    if trimmed.is_empty() {
        return format!(
            "Handle the current task according to the activated skill \"{}\".",
            skill_name
        );
    }

    trimmed.to_string()
}

#[cfg(test)]
mod tests {
    use super::build_activate_skill_user_turn;

    #[test]
    fn build_activate_skill_user_turn_falls_back_when_note_is_empty() {
        assert!(build_activate_skill_user_turn("code-review", "  ").contains("code-review"));
        assert_eq!(
            build_activate_skill_user_turn("code-review", "Focus on risks and regressions"),
            "Focus on risks and regressions"
        );
    }
}
