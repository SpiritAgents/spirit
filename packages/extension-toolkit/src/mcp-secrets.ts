const EXTENSION_SECRET_PREFIX = "${extension-secret:";
const OPTIONAL_EXTENSION_SECRET_PREFIX = "${extension-secret?:";

export interface ExtensionMcpSecretReference {
  slot: string;
  field?: string;
  optional?: boolean;
}

function findNextSecretPrefix(
  input: string,
): { index: number; prefixLength: number; optional: boolean } | undefined {
  const requiredIndex = input.indexOf(EXTENSION_SECRET_PREFIX);
  const optionalIndex = input.indexOf(OPTIONAL_EXTENSION_SECRET_PREFIX);
  if (requiredIndex < 0 && optionalIndex < 0) return undefined;
  if (optionalIndex >= 0 && (requiredIndex < 0 || optionalIndex < requiredIndex)) {
    return {
      index: optionalIndex,
      prefixLength: OPTIONAL_EXTENSION_SECRET_PREFIX.length,
      optional: true,
    };
  }
  return {
    index: requiredIndex,
    prefixLength: EXTENSION_SECRET_PREFIX.length,
    optional: false,
  };
}

function parseReference(body: string, optional: boolean): ExtensionMcpSecretReference {
  const parts = body.split(":");
  const slot = parts[0]?.trim() ?? "";
  const field = parts.length > 1 ? parts[1]?.trim() : undefined;
  if (!slot || parts.length > 2 || (parts.length === 2 && !field)) {
    throw new Error("Invalid extension secret reference in MCP header.");
  }
  return {
    slot,
    ...(field === undefined ? {} : { field }),
    ...(optional ? { optional: true } : {}),
  };
}

export function findExtensionMcpSecretReferences(template: string): ExtensionMcpSecretReference[] {
  const references: ExtensionMcpSecretReference[] = [];
  let remaining = template;
  while (true) {
    const match = findNextSecretPrefix(remaining);
    if (!match) return references;
    const placeholder = remaining.slice(match.index + match.prefixLength);
    const end = placeholder.indexOf("}");
    if (end < 0) {
      throw new Error("Invalid extension secret reference in MCP header.");
    }
    references.push(parseReference(placeholder.slice(0, end), match.optional));
    remaining = placeholder.slice(end + 1);
  }
}

export function assertExtensionMcpSecretSlotsDeclared(
  template: string,
  declaredSlots: readonly string[],
): void {
  for (const reference of findExtensionMcpSecretReferences(template)) {
    if (!declaredSlots.includes(reference.slot)) {
      throw new Error(
        `MCP header references an undeclared extension secret slot: ${reference.slot}`,
      );
    }
  }
}

/**
 * Resolves `${extension-secret:slot[:field]}` and optional `${extension-secret?:slot[:field]}`
 * templates. Returns `undefined` when an optional secret slot is absent so callers can omit the
 * header and let the MCP server connect without authentication.
 */
export async function resolveExtensionMcpSecretTemplate(
  template: string,
  loadSecret: (slot: string) => Promise<string | undefined>,
): Promise<string | undefined> {
  let rendered = "";
  let remaining = template;
  while (true) {
    const match = findNextSecretPrefix(remaining);
    if (!match) {
      return rendered + remaining;
    }
    rendered += remaining.slice(0, match.index);
    const placeholder = remaining.slice(match.index + match.prefixLength);
    const end = placeholder.indexOf("}");
    if (end < 0) {
      throw new Error("Invalid extension secret reference in MCP header.");
    }
    const reference = parseReference(placeholder.slice(0, end), match.optional);
    const raw = await loadSecret(reference.slot);
    if (raw === undefined || raw.length === 0) {
      if (reference.optional) {
        return undefined;
      }
      throw new Error(`Extension secret is not configured: ${reference.slot}`);
    }
    let value = raw;
    if (reference.field !== undefined) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error(`Extension secret must contain a JSON object: ${reference.slot}`);
      }
      const fieldValue =
        typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)[reference.field]
          : undefined;
      if (typeof fieldValue !== "string" || fieldValue.length === 0) {
        throw new Error(
          `Extension secret field must be a non-empty string: ${reference.slot}:${reference.field}`,
        );
      }
      value = fieldValue;
    }
    rendered += value;
    remaining = placeholder.slice(end + 1);
  }
}
