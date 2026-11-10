import { access, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

import { resolveCommandOnPath, type ResolvedLanguageServerCommand } from "./resolve-server.js";

async function isExecutable(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveJavaCommand(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): Promise<string | undefined> {
  const resolved = await resolveCommandOnPath("java", env, platform, []);
  return resolved?.command;
}

function resolveJdtlsHome(env: NodeJS.ProcessEnv): string | undefined {
  const candidates = [
    env.JDTLS_HOME,
    env.jdtls_home,
    path.join(env.HOME ?? env.USERPROFILE ?? "", "jdtls"),
    path.join(env.HOME ?? env.USERPROFILE ?? "", ".local", "share", "jdtls"),
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  return candidates[0]?.trim();
}

function jdtlsConfigDir(jdtlsHome: string, platform: NodeJS.Platform): string {
  if (platform === "win32") {
    return path.join(jdtlsHome, "config_win");
  }
  if (platform === "darwin") {
    return path.join(jdtlsHome, "config_mac");
  }
  return path.join(jdtlsHome, "config_linux");
}

async function findEquinoxLauncherJar(pluginsDir: string): Promise<string | undefined> {
  try {
    const entries = await readdir(pluginsDir);
    const match = entries.find(
      (entry) => entry.startsWith("org.eclipse.equinox.launcher_") && entry.endsWith(".jar"),
    );
    return match ? path.join(pluginsDir, match) : undefined;
  } catch {
    return undefined;
  }
}

export async function buildJdtlsServerCommand(
  workspaceRoot: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<ResolvedLanguageServerCommand | undefined> {
  const javaCommand = await resolveJavaCommand(env, platform);
  const jdtlsHome = resolveJdtlsHome(env);
  if (!javaCommand || !jdtlsHome) {
    return undefined;
  }

  const pluginsDir = path.join(jdtlsHome, "plugins");
  const launcherJar = await findEquinoxLauncherJar(pluginsDir);
  const configDir = jdtlsConfigDir(jdtlsHome, platform);
  if (!launcherJar) {
    return undefined;
  }

  if (!(await isExecutable(javaCommand))) {
    return undefined;
  }

  const dataDir = path.join(path.resolve(workspaceRoot), ".spirit-jdtls-data");

  return {
    command: javaCommand,
    args: [
      "-Declipse.application=org.eclipse.jdt.ls.core.id1",
      "-Dosgi.bundles.defaultStartLevel=4",
      "-Declipse.product=org.eclipse.jdt.ls.core.product",
      "-Dlog.protocol=true",
      "-Dlog.level=ALL",
      "-Xmx1G",
      "--add-modules=ALL-SYSTEM",
      "--add-opens",
      "java.base/java.util=ALL-UNNAMED",
      "--add-opens",
      "java.base/java.lang=ALL-UNNAMED",
      "-jar",
      launcherJar,
      "-configuration",
      configDir,
      "-data",
      dataDir,
    ],
  };
}

export async function resolveJdtlsOnPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<ResolvedLanguageServerCommand | undefined> {
  const javaCommand = await resolveJavaCommand(env, platform);
  const jdtlsHome = resolveJdtlsHome(env);
  if (!javaCommand || !jdtlsHome) {
    return undefined;
  }
  const launcherJar = await findEquinoxLauncherJar(path.join(jdtlsHome, "plugins"));
  if (!launcherJar) {
    return undefined;
  }
  return { command: javaCommand, args: [] };
}
