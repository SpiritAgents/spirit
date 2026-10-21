import i18n from "@/lib/i18n";
import {
  CUSTOM_PROVIDER_PRESET_ID,
  findProviderPreset,
} from "@spiritagent/agent-core/provider-presets";
import type { DesktopTransportKind } from "@/types";

export type ConnectTransportOption = {
  value: DesktopTransportKind;
  label: string;
  summaryKey?: string;
};

const TRANSPORT_OPTION_LABELS: Record<DesktopTransportKind, string> = {
  "openai-compatible": "Chat Completions API",
  anthropic: "Messages API",
  bedrock: "Amazon Bedrock",
  "open-responses": "Responses API",
};

function transportOption(value: DesktopTransportKind): ConnectTransportOption {
  return { value, label: TRANSPORT_OPTION_LABELS[value] };
}

/** A custom endpoint offers every generic transport mechanism. */
const CUSTOM_TRANSPORT_KINDS: readonly DesktopTransportKind[] = [
  "openai-compatible",
  "open-responses",
  "anthropic",
];

/**
 * The transport choices of the connect wizard: the preset manifest's `transports` keys (one key =
 * pinned transport, no picker); a custom connection offers the generic mechanisms.
 */
export function connectTransportOptionsForProvider(providerId: string): ConnectTransportOption[] {
  if (providerId === CUSTOM_PROVIDER_PRESET_ID) {
    return CUSTOM_TRANSPORT_KINDS.map(transportOption);
  }
  const preset = findProviderPreset(providerId);
  if (!preset) {
    return CUSTOM_TRANSPORT_KINDS.map(transportOption);
  }
  return Object.keys(preset.transports).map((kind) =>
    transportOption(kind as DesktopTransportKind),
  );
}

export function defaultConnectTransportKind(providerId: string): DesktopTransportKind {
  if (providerId === CUSTOM_PROVIDER_PRESET_ID) {
    return "openai-compatible";
  }
  return (
    (findProviderPreset(providerId)?.defaultTransport as DesktopTransportKind | undefined) ??
    "openai-compatible"
  );
}

/**
 * Wizard product policy: which presets show an API-type picker at all (the others pin their
 * default transport). Write-time knowledge, never read by the runtime.
 */
const CONNECT_TRANSPORT_PICKER_PROVIDERS: ReadonlySet<string> = new Set([
  "siliconflow",
  "openrouter",
  "cloudflare-ai-gateway",
  "fireworks-ai",
  "volcengine",
  "byteplus",
]);

export function providerShowsConnectTransportPicker(providerId: string | null): boolean {
  if (providerId === null) {
    return false;
  }
  if (providerId === CUSTOM_PROVIDER_PRESET_ID) {
    return true;
  }
  return (
    CONNECT_TRANSPORT_PICKER_PROVIDERS.has(providerId) &&
    connectTransportOptionsForProvider(providerId).length > 1
  );
}

export function resolveConnectTransportKindForProvider(
  providerId: string | null,
  connectTransportKind: DesktopTransportKind,
): DesktopTransportKind | undefined {
  if (providerId === null) {
    return undefined;
  }
  if (!providerShowsConnectTransportPicker(providerId)) {
    return undefined;
  }
  return connectTransportKind;
}

export function connectTransportOptionSummary(
  option: ConnectTransportOption,
  _providerId: string | null,
): string | undefined {
  return option.summaryKey ? i18n.t(option.summaryKey) : undefined;
}
