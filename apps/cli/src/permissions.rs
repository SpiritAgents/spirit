use anyhow::{Context, Result};
use rust_i18n::t;

use crate::{
    adapters::DefaultAppPaths, daemon::DaemonRuntime, permissions_types::PermissionCheckResult,
    ports::AppPaths,
};

pub enum PermissionCommand {
    Check {
        shell: Option<String>,
        read_file: Option<String>,
    },
}

pub fn handle_permissions_cli(action: PermissionCommand) -> Result<()> {
    let app_paths = DefaultAppPaths::new();
    match action {
        PermissionCommand::Check { shell, read_file } => {
            let (domain, value) = match (shell, read_file) {
                (Some(command), None) => ("shell", command),
                (None, Some(path)) => ("read_file", path),
                // clap enforces exactly one of --shell/--read-file.
                _ => unreachable!("clap enforces exactly one of --shell/--read-file"),
            };
            let workspace_root = app_paths.workspace_root();
            let mut runtime =
                DaemonRuntime::new_host_only(workspace_root.clone()).with_context(|| {
                    crate::locale::product_text("cli.permissions.check.daemon_unreachable")
                        .into_owned()
                })?;
            let result = runtime
                .check_permission(
                    domain,
                    &value,
                    Some(workspace_root.to_string_lossy().as_ref()),
                )
                .with_context(|| {
                    crate::locale::product_text("cli.permissions.check.daemon_unreachable")
                        .into_owned()
                })?;
            print_permission_check(domain, &result);
        }
    }
    Ok(())
}

fn print_permission_check(domain: &str, result: &PermissionCheckResult) {
    println!(
        "{}",
        t!(
            "cli.permissions.check.verdict",
            verdict = result.verdict.as_str()
        )
    );
    if let Some(matched) = &result.matched {
        let mut line = t!(
            "cli.permissions.check.matched",
            rule = format!("permission.{domain}"),
            pattern = matched.pattern.as_str(),
            action = matched.action.as_str(),
        )
        .into_owned();
        // Composite shell commands: cite the segment whose rule decided the verdict.
        if let Some(segments) = &result.segments
            && let Some((index, segment)) = segments.iter().enumerate().find(|(_, segment)| {
                segment.verdict == result.verdict
                    && segment
                        .matched
                        .as_ref()
                        .is_some_and(|m| m.pattern == matched.pattern && m.action == matched.action)
            })
        {
            line.push_str(
                t!(
                    "cli.permissions.check.segment_ref",
                    index = index + 1,
                    segment = segment.segment.as_str(),
                )
                .as_ref(),
            );
        }
        println!("{line}");
    }
    if let Some(segments) = &result.segments {
        let details = segments
            .iter()
            .map(|segment| format!("{} → {}", segment.segment, segment.verdict))
            .collect::<Vec<_>>()
            .join(", ");
        println!(
            "{}",
            t!(
                "cli.permissions.check.segments",
                count = segments.len(),
                details = details,
            )
        );
    }
    for warning in &result.warnings {
        println!(
            "{}",
            t!("cli.permissions.check.warning", warning = warning.as_str())
        );
    }
}
