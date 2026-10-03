use anyhow::{Context, Result, anyhow};
use rust_i18n::t;
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    env, fs,
    path::{Path, PathBuf},
};

#[cfg(windows)]
use crate::logging;

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

pub fn mcp_config_path_for_scope(scope: McpScope, workspace_root: &Path) -> PathBuf {
    match scope {
        McpScope::User => user_mcp_config_path(),
        McpScope::Workspace => workspace_mcp_config_path(workspace_root),
    }
}

fn merge_mcp_config_files(user: &McpConfigFile, workspace: &McpConfigFile) -> McpConfigFile {
    let mut servers = user.servers.clone();
    servers.extend(workspace.servers.clone());
    McpConfigFile { servers }
}

pub fn load_mcp_config(workspace_root: &Path) -> Result<LoadedMcpConfig> {
    let user_path = user_mcp_config_path();
    let workspace_path = workspace_mcp_config_path(workspace_root);
    let user = load_mcp_config_file(&user_path)?.unwrap_or_default();
    let workspace = load_mcp_config_file(&workspace_path)?.unwrap_or_default();
    let config = merge_mcp_config_files(&user, &workspace);
    Ok(LoadedMcpConfig {
        user_path,
        workspace_path,
        config,
    })
}

pub fn assert_mcp_server_name_available(workspace_root: &Path, name: &str) -> Result<()> {
    let server_name = name.trim();
    if server_name.is_empty() {
        return Err(anyhow!(t!("tui.mcp.server_name_empty").into_owned()));
    }

    let user_path = user_mcp_config_path();
    let workspace_path = workspace_mcp_config_path(workspace_root);
    let user = load_mcp_config_file(&user_path)?.unwrap_or_default();
    let workspace = load_mcp_config_file(&workspace_path)?.unwrap_or_default();
    if user.servers.contains_key(server_name) || workspace.servers.contains_key(server_name) {
        return Err(anyhow!(
            t!("tui.mcp.server_exists", name = server_name).into_owned()
        ));
    }
    Ok(())
}

fn resolve_mcp_server_scope(workspace_root: &Path, name: &str) -> Result<(McpScope, PathBuf)> {
    let user_path = user_mcp_config_path();
    let workspace_path = workspace_mcp_config_path(workspace_root);
    if let Some(config) = load_mcp_config_file(&user_path)?
        && config.servers.contains_key(name)
    {
        return Ok((McpScope::User, user_path));
    }
    if let Some(config) = load_mcp_config_file(&workspace_path)?
        && config.servers.contains_key(name)
    {
        return Ok((McpScope::Workspace, workspace_path));
    }
    Err(anyhow!(
        t!("tui.mcp.server_not_found", name = name).into_owned()
    ))
}

pub fn save_mcp_config(path: &Path, config: &McpConfigFile, overwrite: bool) -> Result<()> {
    if path.exists() && !overwrite {
        return Err(anyhow!(
            t!("tui.mcp.config_exists", path = path.display()).into_owned()
        ));
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).with_context(|| {
            t!("tui.mcp.config_dir_create_failed", path = parent.display()).into_owned()
        })?;
    }

    let content = serde_json::to_string_pretty(config)?;
    fs::write(path, content)
        .with_context(|| t!("tui.mcp.config_write_failed", path = path.display()).into_owned())
}

pub fn example_github_mcp_config() -> McpConfigFile {
    let mut servers = BTreeMap::new();
    servers.insert("github".to_string(), github_preset_config());
    McpConfigFile { servers }
}

pub fn add_mcp_server(
    workspace_root: &Path,
    scope: McpScope,
    name: &str,
    server_config: McpServerConfig,
) -> Result<PathBuf> {
    let server_name = name.trim();
    if server_name.is_empty() {
        return Err(anyhow!(t!("tui.mcp.server_name_empty").into_owned()));
    }

    assert_mcp_server_name_available(workspace_root, server_name)?;

    let path = mcp_config_path_for_scope(scope, workspace_root);
    let mut config = load_mcp_config_file(&path)?.unwrap_or_default();
    config
        .servers
        .insert(server_name.to_string(), server_config);
    save_mcp_config(&path, &config, true)?;
    Ok(path)
}

pub fn resolve_env_value(value: &str) -> Result<String> {
    resolve_env_placeholders(value, resolve_single_env_value)
}

fn resolve_env_placeholders(
    value: &str,
    mut resolver: impl FnMut(&str) -> Result<String>,
) -> Result<String> {
    let mut rendered = String::with_capacity(value.len());
    let mut remaining = value;

    while let Some(start) = remaining.find("${env:") {
        rendered.push_str(&remaining[..start]);
        let placeholder = &remaining[start + 6..];
        let end = placeholder.find('}').ok_or_else(|| {
            anyhow!(t!("tui.mcp.env_placeholder_invalid", value = value).into_owned())
        })?;
        let var_name = &placeholder[..end];
        if var_name.trim().is_empty() {
            return Err(anyhow!(
                t!("tui.mcp.env_placeholder_invalid", value = value).into_owned()
            ));
        }

        rendered.push_str(&resolver(var_name)?);
        remaining = &placeholder[end + 1..];
    }

    rendered.push_str(remaining);
    Ok(rendered)
}

fn resolve_single_env_value(var_name: &str) -> Result<String> {
    if let Ok(resolved) = env::var(var_name) {
        return Ok(resolved);
    }

    #[cfg(windows)]
    if let Some(resolved) = resolve_windows_persisted_env(var_name) {
        logging::log_event(&format!(
            "[mcp] env placeholder {} resolved from Windows persisted environment",
            var_name
        ));
        return Ok(resolved);
    }

    Err(anyhow!(
        t!("tui.mcp.env_missing", name = var_name).into_owned()
    ))
}

#[cfg(windows)]
fn resolve_windows_persisted_env(var_name: &str) -> Option<String> {
    use winreg::{
        RegKey,
        enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE},
    };

    let user_env = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey("Environment")
        .ok()
        .and_then(|key| key.get_value::<String, _>(var_name).ok());
    if user_env.is_some() {
        return user_env;
    }

    RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey("SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment")
        .ok()
        .and_then(|key| key.get_value::<String, _>(var_name).ok())
}

pub fn resolve_env_map(env_map: &BTreeMap<String, String>) -> Result<BTreeMap<String, String>> {
    env_map
        .iter()
        .map(|(key, value)| Ok((key.clone(), resolve_env_value(value)?)))
        .collect()
}

pub fn set_server_enabled(workspace_root: &Path, name: &str, enabled: bool) -> Result<PathBuf> {
    mutate_existing_server(workspace_root, name, |server| {
        server.enabled = enabled;
    })
}

fn mutate_existing_server(
    workspace_root: &Path,
    name: &str,
    mutator: impl FnOnce(&mut McpServerConfig),
) -> Result<PathBuf> {
    let (_scope, path) = resolve_mcp_server_scope(workspace_root, name)?;
    let mut config = load_mcp_config_file(&path)?
        .ok_or_else(|| anyhow!(t!("tui.mcp.server_not_found", name = name).into_owned()))?;
    let server = config
        .servers
        .get_mut(name)
        .ok_or_else(|| anyhow!(t!("tui.mcp.server_not_found", name = name).into_owned()))?;
    mutator(server);
    save_mcp_config(&path, &config, true)?;
    Ok(path)
}

fn load_mcp_config_file(path: &Path) -> Result<Option<McpConfigFile>> {
    if !path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(path)
        .with_context(|| t!("tui.mcp.config_read_failed", path = path.display()).into_owned())?;
    let config = serde_json::from_str::<McpConfigFile>(&content)
        .with_context(|| t!("tui.mcp.config_parse_failed", path = path.display()).into_owned())?;
    Ok(Some(config))
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{ScopedEnv, shared_env_lock};

    #[test]
    fn spirit_data_dir_uses_product_directory_under_home() {
        let _guard = shared_env_lock()
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        let home = unique_test_workspace("macos-data-dir");
        std::fs::create_dir_all(&home).expect("create temp home");
        let _home = ScopedEnv::set("HOME", &home);
        let _profile = ScopedEnv::set("USERPROFILE", &home);
        let _appdata = ScopedEnv::set("APPDATA", home.join("legacy-appdata"));
        let _xdg = ScopedEnv::set("XDG_DATA_HOME", home.join("legacy-xdg"));
        let _data_dir = ScopedEnv::remove(ENV_SPIRIT_DATA_DIR);

        assert_eq!(
            spirit_data_dir(),
            home.join(crate::product::USER_DATA_FOLDER_NAME)
        );

        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn spirit_data_dir_honors_env_override() {
        let _guard = shared_env_lock()
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        let override_dir = unique_test_workspace("data-dir-override");
        let _data_dir = ScopedEnv::set(ENV_SPIRIT_DATA_DIR, &override_dir);

        assert_eq!(spirit_data_dir(), override_dir);

        let _ = fs::remove_dir_all(&override_dir);
    }

    #[test]
    fn load_config_reads_single_user_file() {
        let temp_root = unique_test_workspace("single-config");
        let path = temp_root.join(MCP_CONFIG_FILE_NAME);
        let mut config = McpConfigFile::default();
        config.servers.insert(
            "github".to_string(),
            McpServerConfig {
                display_name: Some("GitHub MCP".to_string()),
                enabled: false,
                capabilities: McpCapabilityToggles {
                    tools: true,
                    resources: false,
                    prompts: false,
                },
                transport: McpTransportConfig::Stdio {
                    command: "uvx".to_string(),
                    args: vec!["server".to_string()],
                    env: BTreeMap::new(),
                    cwd: None,
                    timeout_ms: None,
                },
            },
        );
        save_mcp_config(&path, &config, true).expect("seed config file");

        let loaded = load_mcp_config_file(&path)
            .expect("load config")
            .expect("config should exist");
        let server = loaded.servers.get("github").expect("github server exists");

        assert!(!server.enabled);
        match &server.transport {
            McpTransportConfig::Stdio { command, args, .. } => {
                assert_eq!(command, "uvx");
                assert_eq!(args, &vec!["server".to_string()]);
            }
            other => panic!("unexpected transport: {other:?}"),
        }

        if let Some(parent) = path.parent() {
            let _ = fs::remove_dir_all(parent);
        }
    }

    #[test]
    fn resolve_plain_and_placeholder_env_values() {
        assert_eq!(
            resolve_env_value("literal").expect("literal resolves"),
            "literal"
        );

        let path_value = resolve_env_value("${env:PATH}").expect("PATH should exist");
        assert!(!path_value.trim().is_empty());
    }

    #[test]
    fn resolve_env_value_supports_inline_placeholders() {
        let rendered = resolve_env_placeholders(
            "Authorization: Bearer ${env:GITHUB_TOKEN}",
            |name| match name {
                "GITHUB_TOKEN" => Ok("token123".to_string()),
                other => Err(anyhow!("unexpected env variable: {}", other)),
            },
        )
        .expect("inline placeholder resolves");

        assert_eq!(rendered, "Authorization: Bearer token123");
    }

    #[test]
    fn resolve_env_value_rejects_unclosed_placeholder() {
        let err =
            resolve_env_placeholders("Bearer ${env:GITHUB_TOKEN", |_| Ok("ignored".to_string()))
                .expect_err("unclosed placeholder should fail");

        assert!(
            err.to_string()
                .contains("Invalid environment variable placeholder")
        );
    }

    #[test]
    fn github_template_points_to_real_package_shape() {
        let cfg = example_github_mcp_config();
        let github = cfg.servers.get("github").expect("github config exists");

        match &github.transport {
            McpTransportConfig::Stdio {
                command, args, env, ..
            } => {
                assert_eq!(command, "npx");
                assert!(args.contains(&"@modelcontextprotocol/server-github".to_string()));
                assert_eq!(
                    env.get("GITHUB_PERSONAL_ACCESS_TOKEN"),
                    Some(&"${env:GITHUB_PERSONAL_ACCESS_TOKEN}".to_string())
                );
            }
            other => panic!("unexpected transport: {other:?}"),
        }
    }

    #[test]
    fn workspace_config_path_lives_under_spirit_dir() {
        let workspace_root = PathBuf::from("C:/workspace/spirit");
        let path = workspace_mcp_config_path(&workspace_root);

        assert_eq!(
            path,
            workspace_root
                .join(SPIRIT_DIR_NAME)
                .join(MCP_CONFIG_FILE_NAME)
        );
    }

    #[test]
    fn merge_mcp_config_combines_user_and_workspace_servers() {
        let mut user = McpConfigFile::default();
        user.servers
            .insert("user-server".to_string(), github_preset_config());
        let mut workspace = McpConfigFile::default();
        workspace
            .servers
            .insert("workspace-server".to_string(), github_preset_config());

        let merged = merge_mcp_config_files(&user, &workspace);
        assert!(merged.servers.contains_key("user-server"));
        assert!(merged.servers.contains_key("workspace-server"));
    }

    fn unique_test_workspace(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time ok")
            .as_nanos();
        std::env::temp_dir().join(format!("spirit-{tag}-{nanos}"))
    }
}
