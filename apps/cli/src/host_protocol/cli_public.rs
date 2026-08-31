use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;

use crate::{plan::PlanMetadata, rules::RuleEntry, skills::SkillEntry};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliHostMetadataSnapshot {
    pub rule_entries: Vec<RuleEntry>,
    pub skill_entries: Vec<SkillEntry>,
    #[serde(default)]
    pub extension_skill_entries: Vec<CliExtensionSkillSlashEntry>,
    pub plan_metadata: PlanMetadata,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliExtensionToolEntry {
    pub name: String,
    pub description: String,
    pub approval_mode: Option<String>,
    pub execution_mode: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliExtensionSettingOptionEntry {
    pub value: String,
    pub label: String,
    pub description: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliExtensionDesktopCssEntry {
    pub path: String,
    pub media: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliExtensionCliUiHookTokensEntry {
    pub foreground: Option<String>,
    pub border: Option<String>,
    pub accent: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliExtensionCliUiHookEntry {
    pub slot: String,
    pub variant: Option<String>,
    pub tokens: Option<CliExtensionCliUiHookTokensEntry>,
    pub prefix: Option<String>,
    pub suffix: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliExtensionDesktopContributes {
    pub css: Option<Vec<CliExtensionDesktopCssEntry>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliExtensionCliContributes {
    pub hooks: Option<Vec<CliExtensionCliUiHookEntry>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliExtensionSettingEntry {
    pub key: String,
    pub r#type: String,
    pub title: String,
    pub description: Option<String>,
    pub placeholder: Option<String>,
    pub required: Option<bool>,
    pub default_value: Option<Value>,
    pub options: Option<Vec<CliExtensionSettingOptionEntry>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliExtensionSecretSlotEntry {
    pub key: String,
    pub title: String,
    pub description: Option<String>,
    pub required: Option<bool>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliExtensionContributes {
    pub tools: Option<Vec<CliExtensionToolEntry>>,
    pub desktop: Option<CliExtensionDesktopContributes>,
    pub cli: Option<CliExtensionCliContributes>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliExtensionMcpContributionSummary {
    pub name: String,
    #[serde(default)]
    pub display_name: Option<String>,
    pub transport: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliExtensionSkillContributionSummary {
    pub name: String,
    #[serde(default)]
    pub description: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliExtensionRuleContributionSummary {
    #[serde(default)]
    pub content: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CliExtensionInstructionContributions {
    #[serde(default)]
    pub mcp: Option<Vec<CliExtensionMcpContributionSummary>>,
    #[serde(default)]
    pub hooks: Option<Vec<String>>,
    #[serde(default)]
    pub skills: Option<Vec<CliExtensionSkillContributionSummary>>,
    #[serde(default)]
    pub rules: Option<CliExtensionRuleContributionSummary>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliExtensionSkillSlashEntry {
    pub id: String,
    pub name: String,
    pub description: String,
    pub path: PathBuf,
    pub content: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliExtensionEntry {
    pub id: String,
    pub display_name: String,
    pub version: String,
    pub enabled: bool,
    pub description: Option<String>,
    pub author: Option<String>,
    pub homepage: Option<String>,
    pub main: Option<String>,
    pub supported_hosts: Vec<String>,
    pub activation_events: Option<Vec<String>>,
    pub requested_capabilities: Option<Vec<String>>,
    pub contributes: Option<CliExtensionContributes>,
    #[serde(default)]
    pub instruction_contributions: Option<CliExtensionInstructionContributions>,
    pub settings_schema: Option<Vec<CliExtensionSettingEntry>>,
    pub secret_slots: Option<Vec<CliExtensionSecretSlotEntry>>,
    pub archive_file_name: Option<String>,
    pub installed_at_unix_ms: u64,
}
