import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface HostToggleState {
  enabledOverrides?: Record<string, boolean>;
}

export async function loadToggleState(filePath: string): Promise<HostToggleState> {
  if (!existsSync(filePath)) {
    return {};
  }
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as HostToggleState;
    return parsed.enabledOverrides ? parsed : {};
  } catch {
    return {};
  }
}

export async function saveToggleState(filePath: string, state: HostToggleState): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}
