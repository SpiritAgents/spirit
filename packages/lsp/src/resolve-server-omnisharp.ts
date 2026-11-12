import { access } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

import { resolveCommandOnPath, type ResolvedLanguageServerCommand } from "./resolve-server.js";

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function omnisharpDllCandidates(env: NodeJS.ProcessEnv): string[] {
  const home = env.HOME ?? env.USERPROFILE ?? "";
  return [
    env.OMNISHARP_PATH,
    path.join(home, ".omnisharp", "OmniSharp.dll"),
    path.join(home, ".cache", "omnisharp", "OmniSharp.dll"),
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
}

export async function resolveOmnisharpOnPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<ResolvedLanguageServerCommand | undefined> {
  const onPath = await resolveCommandOnPath("OmniSharp", env, platform, ["--languageserver"]);
  if (onPath) {
    return onPath;
  }

  const dotnet = await resolveCommandOnPath("dotnet", env, platform, []);
  if (!dotnet) {
    return undefined;
  }

  for (const candidate of omnisharpDllCandidates(env)) {
    if (await fileExists(candidate)) {
      return {
        command: dotnet.command,
        args: [candidate, "--languageserver"],
      };
    }
  }

  return undefined;
}
