use anyhow::{Result, anyhow};
use serde_json::{Value, json};
use std::{path::Path, time::Duration};

use super::{
    client::{DaemonClient, validate_product_build},
    resolve::{ensure_daemon, is_loopback_host},
};

/// Calls a management RPC without creating a session. Used during bootstrap,
/// before a full DaemonRuntime exists.
pub(crate) fn call_config_rpc(workspace_root: &Path, method: &str, params: Value) -> Result<Value> {
    let (instance, token) = ensure_daemon(workspace_root)?;
    if !is_loopback_host(&instance.host) {
        return Err(anyhow!("daemon host must be loopback: {}", instance.host));
    }
    let mut client = DaemonClient::connect(&instance.host, instance.port, &token)?;
    let hello = client
        .next_notification(Duration::from_secs(5))?
        .ok_or_else(|| anyhow!("daemon handshake timed out: server.connected not received"))?;
    if hello.get("method").and_then(Value::as_str) != Some("server.connected") {
        return Err(anyhow!(
            "daemon handshake failed: first frame was not server.connected"
        ));
    }
    validate_product_build(&client.call("server.health", json!({}))?)?;
    client.call(
        "server.initialize",
        json!({
            "clientKind": "cli",
            "clientId": format!("cli-config-{}", std::process::id()),
            "workspaceRoot": workspace_root.to_string_lossy(),
        }),
    )?;
    let result = client.call(method, params);
    client.close();
    result
}
