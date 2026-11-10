use anyhow::{Result, anyhow};
use serde_json::{Value, json};
use std::{io::Write, time::Duration};

use crate::{RemoteCommand, daemon::DaemonRuntime};

pub fn handle_remote_cli(command: RemoteCommand) -> Result<()> {
    let workspace = std::env::current_dir()?;
    let mut runtime = DaemonRuntime::new_host_only(workspace)?;
    match command {
        RemoteCommand::Enable { host, port } => {
            configure(&mut runtime, host, port)?;
            let state = call(&mut runtime, "remote.enable", json!({}))?;
            print_state(&state);
        }
        RemoteCommand::Disable => {
            let state = call(&mut runtime, "remote.disable", json!({}))?;
            print_state(&state);
        }
        RemoteCommand::Status => print_state(&call(&mut runtime, "remote.getState", json!({}))?),
        RemoteCommand::Config { host, port } => {
            configure(&mut runtime, host, port)?;
            print_state(&call(&mut runtime, "remote.getState", json!({}))?);
        }
        RemoteCommand::List => print_state(&call(&mut runtime, "remote.getState", json!({}))?),
        RemoteCommand::Rename { device_id, name } => {
            let state = call(
                &mut runtime,
                "remote.renameDevice",
                json!({ "deviceId": device_id, "name": name }),
            )?;
            print_state(&state);
        }
        RemoteCommand::Revoke { device_id } => {
            let state = call(
                &mut runtime,
                "remote.revokeDevice",
                json!({ "deviceId": device_id }),
            )?;
            print_state(&state);
        }
        RemoteCommand::Pair { name, origin } => pair_interactive(&mut runtime, name, origin)?,
    }
    Ok(())
}

fn configure(runtime: &mut DaemonRuntime, host: Option<String>, port: Option<u16>) -> Result<()> {
    if host.is_none() && port.is_none() {
        return Ok(());
    }
    let mut params = json!({});
    if let Some(host) = host {
        params["host"] = json!(host);
    }
    if let Some(port) = port {
        params["port"] = json!(port);
    }
    call(runtime, "remote.configure", params)?;
    Ok(())
}

fn call(runtime: &mut DaemonRuntime, method: &str, params: Value) -> Result<Value> {
    runtime.call_daemon(method, Some(params))
}

fn print_state(state: &Value) {
    println!(
        "Remote Control: {} ({}:{})",
        if state["enabled"].as_bool() == Some(true) {
            "enabled"
        } else {
            "disabled"
        },
        state["host"].as_str().unwrap_or("127.0.0.1"),
        state["port"].as_u64().unwrap_or(7788),
    );
    let devices = state["devices"].as_array().cloned().unwrap_or_default();
    println!("Devices: {}", devices.len());
    for device in devices {
        println!(
            "- {} | {} | created {} | last {} | IP {} | UA {}",
            device["id"].as_str().unwrap_or("unknown"),
            device["name"].as_str().unwrap_or("Unnamed Device"),
            device["createdAt"].as_str().unwrap_or("unknown"),
            device["lastConnectedAt"].as_str().unwrap_or("never"),
            device["lastIp"].as_str().unwrap_or("unknown"),
            device["lastUserAgent"].as_str().unwrap_or("unknown"),
        );
    }
}

fn pair_interactive(
    runtime: &mut DaemonRuntime,
    name: Option<String>,
    origin: Option<String>,
) -> Result<()> {
    use std::io::IsTerminal;
    if !std::io::stdin().is_terminal() || !std::io::stdout().is_terminal() {
        return Err(anyhow!("remote pair requires an interactive terminal"));
    }
    let state = call(runtime, "remote.getState", json!({}))?;
    let origin = origin.unwrap_or_else(|| {
        format!(
            "http://{}:{}",
            state["host"].as_str().unwrap_or("127.0.0.1"),
            state["port"].as_u64().unwrap_or(7788)
        )
    });
    let owner = format!("cli-{}", std::process::id());
    let mut params = json!({
        "ownerClientId": owner,
        "origin": origin,
        "output": "terminal",
    });
    if let Some(name) = name {
        params["name"] = json!(name);
    }
    let mut enrollment = call(runtime, "remote.pair", params)?;
    print_enrollment(&enrollment);
    loop {
        let state = call(runtime, "remote.getState", json!({}))?;
        let pending = &state["pendingPairing"];
        if pending["id"].as_str() != enrollment["pairingId"].as_str() {
            return Err(anyhow!("pairing was cancelled"));
        }
        if pending["request"].is_object() {
            println!(
                "Access request: UA {} | IP {}",
                pending["request"]["userAgent"]
                    .as_str()
                    .unwrap_or("unknown"),
                pending["request"]["ip"].as_str().unwrap_or("unknown"),
            );
            print!("Allow this device? [y/N] ");
            std::io::stdout().flush()?;
            let mut answer = String::new();
            std::io::stdin().read_line(&mut answer)?;
            if answer.trim().eq_ignore_ascii_case("y") {
                call(
                    runtime,
                    "remote.approvePairing",
                    json!({ "pairingId": enrollment["pairingId"], "ownerClientId": owner }),
                )?;
                println!("Device approved.");
                return Ok(());
            }
            enrollment = call(
                runtime,
                "remote.rejectPairing",
                json!({
                    "pairingId": enrollment["pairingId"],
                    "ownerClientId": owner,
                    "output": "terminal",
                }),
            )?;
            print_enrollment(&enrollment);
            continue;
        }
        std::thread::sleep(Duration::from_millis(500));
    }
}

fn print_enrollment(enrollment: &Value) {
    if let Some(qr) = enrollment["qrCodeTerminal"].as_str() {
        println!("{qr}");
    }
    if let Some(url) = enrollment["url"].as_str() {
        println!("Pairing URL: {url}");
    }
}
