import { Buffer } from "node:buffer";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  deleteKeyringPassword,
  getKeyringPassword,
  setKeyringPassword,
} from "@spiritagent/config/keyring-secret";

export { loadToggleState, saveToggleState } from "@spiritagent/config/toggle-state";

export const EXTENSIONS_DIR_NAME = "extensions";
export const EXTENSIONS_INDEX_FILE_NAME = "extensions.json";
export const EXTENSIONS_STATE_FILE_NAME = "extensions-state.json";
export const EXTENSION_STATE_DIR_NAME = "extension-state";
export const SUPPORTED_EXTENSION_HOST_KINDS = ["desktop", "cli"] as const;

export type ExtensionHostKind = (typeof SUPPORTED_EXTENSION_HOST_KINDS)[number];
export type ExtensionSettingValue = string | number | boolean | null;

export interface ExtensionStateStore {
  loadSettings(extensionId: string): Promise<Record<string, ExtensionSettingValue>>;
  saveSettings(extensionId: string, values: Record<string, ExtensionSettingValue>): Promise<void>;
  loadSecret?(extensionId: string, key: string): Promise<string | undefined>;
  saveSecret?(extensionId: string, key: string, value: string): Promise<void>;
  deleteSecret?(extensionId: string, key: string): Promise<void>;
  hasSecret?(extensionId: string, key: string): Promise<boolean>;
}

const KEYRING_SERVICE = "Spirit";

function extensionSecretAccount(extensionId: string, key: string): string {
  return `extension::${extensionId}::secret::${key}`;
}

export interface ExtensionManagementContext {
  spiritDataDir: string;
  hostKind: ExtensionHostKind;
  stateStore?: ExtensionStateStore;
  /** Current UI locale; a callback keeps long-lived managers reactive to language changes. */
  locale?: string | (() => string);
}

export interface ExtensionPaths {
  extensionsDir: string;
  extensionsIndexFile: string;
  extensionsStateFile: string;
  extensionStateDir: string;
}

export function resolveExtensionPaths(context: ExtensionManagementContext): ExtensionPaths {
  const hostRoot = path.join(context.spiritDataDir, EXTENSIONS_DIR_NAME, context.hostKind);
  return {
    extensionsDir: hostRoot,
    extensionsIndexFile: path.join(hostRoot, EXTENSIONS_INDEX_FILE_NAME),
    extensionsStateFile: path.join(hostRoot, EXTENSIONS_STATE_FILE_NAME),
    extensionStateDir: path.join(hostRoot, EXTENSION_STATE_DIR_NAME),
  };
}

export function createFileExtensionStateStore(
  context: ExtensionManagementContext,
): ExtensionStateStore {
  const paths = resolveExtensionPaths(context);
  return {
    async loadSettings(extensionId) {
      const filePath = extensionSettingsFilePath(paths, extensionId);
      if (!existsSync(filePath)) {
        return {};
      }
      try {
        const raw = await readFile(filePath, "utf8");
        const parsed = JSON.parse(raw) as Record<string, ExtensionSettingValue>;
        return isExtensionSettingsRecord(parsed) ? parsed : {};
      } catch {
        return {};
      }
    },
    async saveSettings(extensionId, values) {
      const filePath = extensionSettingsFilePath(paths, extensionId);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, `${JSON.stringify(values, null, 2)}\n`, "utf8");
    },
  };
}

export function createKeyringExtensionStateStore(
  context: ExtensionManagementContext,
  onSecretsChanged?: (extensionId: string) => void,
): ExtensionStateStore {
  const fileStore = createFileExtensionStateStore(context);
  return {
    loadSettings: (extensionId) => fileStore.loadSettings(extensionId),
    saveSettings: (extensionId, values) => fileStore.saveSettings(extensionId, values),
    async loadSecret(extensionId, key) {
      return getKeyringPassword(KEYRING_SERVICE, extensionSecretAccount(extensionId, key));
    },
    async saveSecret(extensionId, key, value) {
      setKeyringPassword(KEYRING_SERVICE, extensionSecretAccount(extensionId, key), value);
      onSecretsChanged?.(extensionId);
    },
    async deleteSecret(extensionId, key) {
      deleteKeyringPassword(KEYRING_SERVICE, extensionSecretAccount(extensionId, key));
      onSecretsChanged?.(extensionId);
    },
    async hasSecret(extensionId, key) {
      const value = getKeyringPassword(KEYRING_SERVICE, extensionSecretAccount(extensionId, key));
      return value !== undefined && value.length > 0;
    },
  };
}

function extensionSettingsFilePath(paths: ExtensionPaths, extensionId: string): string {
  return path.join(paths.extensionStateDir, `${encodeExtensionStorageName(extensionId)}.json`);
}

function encodeExtensionStorageName(extensionId: string): string {
  return `ext-${Buffer.from(extensionId, "utf8").toString("base64url")}`;
}

function isExtensionSettingsRecord(
  value: Record<string, ExtensionSettingValue> | unknown,
): value is Record<string, ExtensionSettingValue> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every(
    (entry) =>
      entry === null ||
      typeof entry === "string" ||
      typeof entry === "number" ||
      typeof entry === "boolean",
  );
}
