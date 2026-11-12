use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    env,
    path::{Path, PathBuf},
};

const MCP_CONFIG_FILE_NAME: &str = "mcp.json";
const SPIRIT_DIR_NAME: &str = crate::product::WORKSPACE_DATA_FOLDER_NAME;
const ENV_SPIRIT_DATA_DIR: &str = "SPIRIT_DATA_DIR";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum McpScope {
    User,
    Workspace,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
pub struct McpConfigFile {
    #[serde(default)]
    pub servers: BTreeMap<String, McpServerConfig>,
}

impl McpConfigFile {
    pub fn is_empty(&self) -> bool {
        self.servers.is_empty()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct McpServerConfig {
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub capabilities: McpCapabilityToggles,
    #[serde(flatten)]
    pub transport: McpTransportConfig,
}

impl McpServerConfig {
    pub fn display_label(&self, fallback_name: &str) -> String {
        self.display_name
            .clone()
            .unwrap_or_else(|| fallback_name.to_string())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct McpCapabilityToggles {
    #[serde(default = "default_true")]
    pub tools: bool,
    #[serde(default = "default_true")]
    pub resources: bool,
    #[serde(default = "default_true")]
    pub prompts: bool,
}

impl Default for McpCapabilityToggles {
    fn default() -> Self {
        Self {
            tools: true,
            resources: true,
            prompts: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum McpTransportConfig {
    Stdio {
        command: String,
        #[serde(default)]
        args: Vec<String>,
        #[serde(default)]
        env: BTreeMap<String, String>,
        #[serde(default)]
        cwd: Option<String>,
        #[serde(default)]
        timeout_ms: Option<u64>,
    },
    Http {
        url: String,
        #[serde(default)]
        headers: BTreeMap<String, String>,
        #[serde(default)]
        timeout_ms: Option<u64>,
    },
}

impl McpTransportConfig {
    pub fn summary(&self) -> String {
        match self {
            Self::Stdio {
                command,
                args,
                cwd,
                timeout_ms,
                ..
            } => {
                let args_text = if args.is_empty() {
                    String::new()
                } else {
                    format!(" {}", args.join(" "))
                };
                let cwd_text = cwd
                    .as_deref()
                    .map(|v| format!(", cwd={}", v))
                    .unwrap_or_default();
                let timeout_text = timeout_ms
                    .map(|v| format!(", timeout={}ms", v))
                    .unwrap_or_default();
                format!("stdio {}{}{}{}", command, args_text, cwd_text, timeout_text)
            }
            Self::Http {
                url, timeout_ms, ..
            } => {
                let timeout_text = timeout_ms
                    .map(|v| format!(", timeout={}ms", v))
                    .unwrap_or_default();
                format!("http {}{}", url, timeout_text)
            }
        }
    }
}

#[derive(Debug, Clone)]
pub struct LoadedMcpConfig {
    pub user_path: PathBuf,
    pub workspace_path: PathBuf,
    pub config: McpConfigFile,
}

pub fn parse_shared_config(
    mut value: serde_json::Value,
) -> Result<McpConfigFile, serde_json::Error> {
    if let Some(servers) = value
        .get_mut("servers")
        .and_then(serde_json::Value::as_object_mut)
    {
        for server in servers.values_mut() {
            let Some(server) = server.as_object_mut() else {
                continue;
            };
            if let Some(display_name) = server.remove("displayName") {
                server.insert("display_name".to_string(), display_name);
            }
            if let Some(transport) = server
                .remove("transport")
                .and_then(|value| value.as_object().cloned())
            {
                for (key, value) in transport {
                    server.insert(key, value);
                }
            }
        }
    }
    serde_json::from_value(value)
}

pub fn spirit_data_dir() -> PathBuf {
    if let Ok(dir) = env::var(ENV_SPIRIT_DATA_DIR) {
        let trimmed = dir.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }

    let home_variable = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    let home = env::var(home_variable)
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(env::home_dir)
        .filter(|value| !value.as_os_str().to_string_lossy().trim().is_empty())
        .expect("Cannot resolve the user home directory for product storage");
    home.join(crate::product::USER_DATA_FOLDER_NAME)
}

pub fn user_mcp_config_path() -> PathBuf {
    spirit_data_dir().join(MCP_CONFIG_FILE_NAME)
}

pub fn workspace_mcp_config_path(workspace_root: &Path) -> PathBuf {
    workspace_root
        .join(SPIRIT_DIR_NAME)
        .join(MCP_CONFIG_FILE_NAME)
}

pub fn example_github_mcp_config() -> McpConfigFile {
    let mut servers = BTreeMap::new();
    servers.insert("github".to_string(), github_preset_config());
    McpConfigFile { servers }
}

fn default_true() -> bool {
    true
}

fn github_preset_config() -> McpServerConfig {
    let mut env = BTreeMap::new();
    env.insert(
        "GITHUB_PERSONAL_ACCESS_TOKEN".to_string(),
        "${env:GITHUB_PERSONAL_ACCESS_TOKEN}".to_string(),
    );

    McpServerConfig {
        display_name: Some("GitHub MCP".to_string()),
        enabled: true,
        capabilities: McpCapabilityToggles::default(),
        transport: McpTransportConfig::Stdio {
            command: "npx".to_string(),
            args: vec![
                "-y".to_string(),
                "@modelcontextprotocol/server-github".to_string(),
            ],
            env,
            cwd: None,
            timeout_ms: Some(20_000),
        },
    }
}
