export {
  resolveAgentsProviderToolsExposure,
  resolveAgentsWebFetchExposure,
  type AgentsProviderToolsExposure,
  type AgentsWebFetchExposure,
} from "./agents-config.js";
export {
  KEYRING_SERVICE,
  providerInternalKeyAccount,
  providerInternalSlotAccount,
  resolveProviderApiKey,
  resolveProviderApiKeyResolution,
  resolveProviderCredentialSlot,
  resolveProviderCredentialSlotResolution,
  type ProviderKeyChannelMiss,
  type ProviderKeyChannelSource,
  type ProviderKeyChannels,
  type ProviderKeyResolution,
  type ResolveProviderKeyOptions,
} from "./provider-key-channels.js";
export {
  hasResolvableCredentials,
  loadActiveModelProfile,
  loadModelProfile,
  profileKeyChannels,
  resolveProfileCredentialSlot,
  resolveStoredApiKeyForProfile,
  saveProviderSetup,
} from "./credentials.js";
export {
  configFilePath,
  loadSpiritConfig,
  resolveSpiritDataDir,
  resolveSpiritModelProfile,
  saveSpiritConfig,
  SpiritConfigSchemaError,
} from "./spirit-config.js";
export { setKeyringStoreForTests, type KeyringStore } from "./keyring-store.js";
export type {
  PermissionConfig,
  PermissionDomainRules,
  PermissionRuleAction,
  ProviderSetupResult,
  SpiritModelProfile,
} from "./types.js";
