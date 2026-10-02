use anyhow::{Result, anyhow};
use std::{
    env,
    path::{Path, PathBuf},
};

use crate::transport_config::constants::{ENV_RUNTIME_BACKEND_NODE_PATH, ENV_SERVER_ENTRY_PATH};

fn release_bundle_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(exe_path) = env::current_exe()
        && let Some(exe_dir) = exe_path.parent()
    {
        roots.push(exe_dir.to_path_buf());
        if let Some(parent) = exe_dir.parent() {
            roots.push(parent.to_path_buf());
        }
    }
    roots
}

pub(crate) fn resolve_node_path() -> PathBuf {
    if let Ok(path) = env::var(ENV_RUNTIME_BACKEND_NODE_PATH) {
        return PathBuf::from(path);
    }

    for root in release_bundle_roots() {
        let candidate = if cfg!(windows) {
            root.join("node").join("node.exe")
        } else {
            root.join("node").join("bin").join("node")
        };
        if candidate.exists() {
            return candidate;
        }
    }

    PathBuf::from("node")
}

pub(crate) fn resolve_server_entry(workspace_root: &Path) -> Result<PathBuf> {
    if let Ok(path) = env::var(ENV_SERVER_ENTRY_PATH) {
        let candidate = PathBuf::from(path);
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    for root in release_bundle_roots() {
        let candidate = root
            .join("packages")
            .join("server")
            .join("dist")
            .join("src")
            .join("entry.js");
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    let from_crate = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("packages")
        .join("server")
        .join("dist")
        .join("src")
        .join("entry.js");
    if from_crate.exists() {
        return Ok(from_crate);
    }

    let mut cursor = workspace_root.to_path_buf();
    loop {
        let candidate = cursor
            .join("packages")
            .join("server")
            .join("dist")
            .join("src")
            .join("entry.js");
        if candidate.exists() {
            return Ok(candidate);
        }
        if !cursor.pop() {
            break;
        }
    }

    Err(anyhow!(
        "{} Server entry.js not found. Run pnpm run build in packages/server first.",
        crate::product::NAME
    ))
}
