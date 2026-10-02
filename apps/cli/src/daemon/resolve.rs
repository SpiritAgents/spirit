//! Daemon discovery: read the instance registry, attach to a live daemon,
//! or spawn one. The registry lives under `{spiritDataDir}/server/instances/`
//! and is owned by the daemon itself (it prunes on exit; clients only read).

use anyhow::{Context, Result, anyhow};
use serde::Deserialize;
use std::{
    fs,
    net::TcpStream,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

use crate::daemon::entry::{resolve_node_path, resolve_server_entry};
use crate::mcp::spirit_data_dir;

const SPAWN_TIMEOUT: Duration = Duration::from_secs(15);
const SPAWN_POLL_INTERVAL: Duration = Duration::from_millis(100);
const CONNECT_PROBE_TIMEOUT: Duration = Duration::from_millis(300);

pub(crate) fn is_loopback_host(host: &str) -> bool {
    matches!(host, "127.0.0.1" | "localhost" | "::1")
}

#[cfg(unix)]
fn is_process_alive(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    use std::process::Command;
    Command::new("kill")
        .args(["-0", &pid.to_string()])
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn is_process_alive(pid: u32) -> bool {
    pid != 0
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DaemonInstance {
    #[allow(dead_code)]
    pub(crate) instance_id: String,
    pub(crate) pid: u32,
    pub(crate) host: String,
    pub(crate) port: u16,
    #[allow(dead_code)]
    pub(crate) started_at: String,
    #[allow(dead_code)]
    pub(crate) version: String,
}

fn instances_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("server").join("instances")
}

fn read_instances(data_dir: &Path) -> Vec<DaemonInstance> {
    let dir = instances_dir(data_dir);
    let Ok(entries) = fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut instances = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }
        let Ok(raw) = fs::read_to_string(&path) else {
            continue;
        };
        if let Ok(instance) = serde_json::from_str::<DaemonInstance>(&raw) {
            if is_process_alive(instance.pid) {
                instances.push(instance);
            }
        }
    }
    instances.sort_by(|a, b| a.started_at.cmp(&b.started_at));
    instances
}

/// A registry record counts as live when its TCP port accepts a connection —
/// stronger than pid liveness (a reused pid would not speak WS anyway).
fn probe(instance: &DaemonInstance) -> bool {
    TcpStream::connect_timeout(
        &std::net::SocketAddr::new(
            instance
                .host
                .parse()
                .unwrap_or(std::net::IpAddr::from([127, 0, 0, 1])),
            instance.port,
        ),
        CONNECT_PROBE_TIMEOUT,
    )
    .is_ok()
}

pub(crate) fn find_live_instance(data_dir: &Path) -> Option<DaemonInstance> {
    read_instances(data_dir)
        .into_iter()
        .filter(|instance| is_loopback_host(&instance.host))
        .find(probe)
}

pub(crate) fn read_server_token(data_dir: &Path) -> Result<String> {
    let path = data_dir.join("server.token");
    let token = fs::read_to_string(&path)
        .with_context(|| format!("Failed to read daemon token: {}", path.display()))?;
    let token = token.trim().to_string();
    if token.is_empty() {
        return Err(anyhow!("daemon token file is empty: {}", path.display()));
    }
    Ok(token)
}

/// Attaches to a running daemon or spawns one (`node entry.js serve`,
/// detached, stderr → `{dataDir}/server/daemon.log`).
pub(crate) fn ensure_daemon(workspace_root: &Path) -> Result<(DaemonInstance, String)> {
    let data_dir = std::env::var("SPIRIT_SERVER_DATA_DIR")
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(spirit_data_dir);
    if let Some(instance) = find_live_instance(&data_dir) {
        return Ok((instance, read_server_token(&data_dir)?));
    }

    let entry = resolve_server_entry(workspace_root)?;
    let node = resolve_node_path();
    let log_dir = data_dir.join("server");
    fs::create_dir_all(&log_dir)?;
    let log_file = fs::File::create(log_dir.join("daemon.log"))?;
    let log_err = log_file.try_clone()?;

    let mut command = Command::new(node);
    command
        .arg(entry)
        .arg("serve")
        .env("SPIRIT_SERVER_DATA_DIR", &data_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::from(log_file))
        .stderr(Stdio::from(log_err));
    // Detach from the CLI's process group so the daemon survives the client
    // (terminal close / SIGHUP to the group must not take the daemon down).
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        command.creation_flags(CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS);
    }
    let child = command.spawn().context("spawn spirit-server daemon")?;
    let child_pid = child.id();
    // Deliberately not holding/waiting the child: the daemon outlives the CLI.
    drop(child);

    let deadline = Instant::now() + SPAWN_TIMEOUT;
    loop {
        if let Some(instance) = read_instances(&data_dir)
            .into_iter()
            .find(|instance| instance.pid == child_pid)
        {
            if probe(&instance) {
                return Ok((instance, read_server_token(&data_dir)?));
            }
        }
        if Instant::now() > deadline {
            return Err(anyhow!(
                "daemon startup timed out ({}s). Log: {}",
                SPAWN_TIMEOUT.as_secs(),
                log_dir.join("daemon.log").display()
            ));
        }
        thread::sleep(SPAWN_POLL_INTERVAL);
    }
}
