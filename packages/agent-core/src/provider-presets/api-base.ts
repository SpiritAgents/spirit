import type { LlmTransportKind } from "../llm-provider-shared.js";
import type { ProviderPreset } from "./types.js";

export class ProviderPresetApiBaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderPresetApiBaseError";
  }
}

export interface ResolvePresetApiBaseOptions {
  /** Defaults to the preset's `defaultTransport`. */
  transportKind?: LlmTransportKind;
  /** Site id from the preset's `sites.items`; selecting a billing plan overrides the site. */
  siteId?: string;
  /** Wizard billing-plan option; overrides site/transport resolution with the plan's own bases. */
  billingPlanId?: string;
  /** `{placeholder}` substitutions applied to the resolved template (e.g. `{ workspaceId: "…" }`). */
  templateValues?: Record<string, string>;
}

const TEMPLATE_PLACEHOLDER_PATTERN = /\{([a-zA-Z][a-zA-Z0-9]*)\}/g;

/** Substitutes `{placeholder}` occurrences from `values`; unknown placeholders stay literal. */
export function applyApiBaseTemplateValues(
  apiBase: string,
  templateValues?: Record<string, string>,
): string {
  if (!templateValues) {
    return apiBase;
  }
  return apiBase.replace(TEMPLATE_PLACEHOLDER_PATTERN, (match, key: string) => {
    const value = templateValues[key]?.trim();
    return value ? value : match;
  });
}

/** Placeholder names still unresolved in a resolved apiBase (e.g. `["workspaceId"]`). */
export function listUnresolvedApiBaseTemplateKeys(apiBase: string): string[] {
  return [...apiBase.matchAll(TEMPLATE_PLACEHOLDER_PATTERN)].map((match) => match[1] as string);
}

function pickTransportBase(
  transports: Partial<Record<LlmTransportKind, string>>,
  transport: LlmTransportKind,
  defaultTransport: LlmTransportKind,
): string | undefined {
  return transports[transport] ?? transports[defaultTransport];
}

/**
 * Pure data lookup of the final apiBase: billing plan override, then the selected site
 * (`site.transports[transport]`, falling back to the default transport slot), then the
 * provider-level `transports[transport] ?? transports[defaultTransport]`, then template
 * substitution (`{workspaceId}` etc.).
 */
export function resolvePresetApiBase(
  preset: ProviderPreset,
  options: ResolvePresetApiBaseOptions = {},
): string {
  const transport = options.transportKind ?? preset.defaultTransport;

  let base: string | undefined;
  if (options.billingPlanId !== undefined) {
    const plan = preset.billingPlans?.find((entry) => entry.id === options.billingPlanId);
    if (!plan) {
      throw new ProviderPresetApiBaseError(
        `Provider preset "${preset.id}" has no billing plan "${options.billingPlanId}".`,
      );
    }
    base =
      (plan.transports
        ? pickTransportBase(plan.transports, transport, preset.defaultTransport)
        : undefined) ?? plan.apiBase;
  } else if (options.siteId !== undefined) {
    const selection = preset.sites;
    const site = selection?.items.find((entry) => entry.id === options.siteId);
    if (!selection || !site) {
      throw new ProviderPresetApiBaseError(
        `Provider preset "${preset.id}" has no site "${options.siteId}".`,
      );
    }
    base = site.transports
      ? (pickTransportBase(site.transports, transport, preset.defaultTransport) ??
        pickTransportBase(preset.transports, transport, preset.defaultTransport))
      : site.apiBase;
  } else {
    base = pickTransportBase(preset.transports, transport, preset.defaultTransport);
  }

  if (base === undefined) {
    throw new ProviderPresetApiBaseError(
      `Provider preset "${preset.id}" has no apiBase for transport "${transport}".`,
    );
  }
  return applyApiBaseTemplateValues(base, options.templateValues);
}
