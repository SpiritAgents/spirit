import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  emptyModelRef,
  SPIRIT_CONFIG_SCHEMA_VERSION,
  validateSpiritConfig,
  type SpiritConfigFile,
} from "./schema.js";
import { withSpiritConfigWriteLock } from "./write-lock.js";

export interface ConfigStore {
  read(): Promise<SpiritConfigFile>;
  write(
    config: SpiritConfigFile,
    options?: { preserveSections?: readonly string[] },
  ): Promise<void>;
  update(mutate: (current: SpiritConfigFile) => SpiritConfigFile): Promise<SpiritConfigFile>;
  readSection<T>(section: string, normalize: (value: unknown) => T): Promise<T>;
  updateSection<T>(
    section: string,
    normalize: (value: unknown) => T,
    mutate: (current: T) => T,
  ): Promise<T>;
}

export function createConfigStore(options: { dataDir: string }): ConfigStore {
  const path = join(options.dataDir, "config.json");
  const read = async (): Promise<SpiritConfigFile> => {
    try {
      const raw = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
      validateSpiritConfig(raw);
      return raw as SpiritConfigFile;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyConfig();
      throw error;
    }
  };
  const update = async (
    mutate: (current: SpiritConfigFile) => SpiritConfigFile,
  ): Promise<SpiritConfigFile> =>
    withSpiritConfigWriteLock(options.dataDir, async () => {
      const updated = mutate(await read());
      validateSpiritConfig(updated);
      await writeAtomic(path, updated);
      return updated;
    });
  const updateSection = async <T>(
    section: string,
    normalize: (value: unknown) => T,
    mutate: (current: T) => T,
  ): Promise<T> => {
    let projected!: T;
    await update((current) => {
      projected = mutate(normalize(current[section]));
      return { ...current, [section]: projected };
    });
    return projected;
  };

  return {
    read,
    async write(config, options = {}) {
      await update((current) => {
        const next = { ...config };
        for (const section of options.preserveSections ?? []) {
          if (current[section] !== undefined) next[section] = current[section];
        }
        return next;
      });
    },
    update,
    async readSection(section, normalize) {
      return normalize((await read())[section]);
    },
    updateSection,
  };
}

function emptyConfig(): SpiritConfigFile {
  return {
    schemaVersion: SPIRIT_CONFIG_SCHEMA_VERSION,
    providers: [],
    activeModel: emptyModelRef(),
  };
}

async function writeAtomic(path: string, config: SpiritConfigFile): Promise<void> {
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}
