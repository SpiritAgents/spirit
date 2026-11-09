import type {
  RemoteControlConfig,
  RemoteControlDeviceRecord,
  RemoteControlPendingPairing,
} from "./types.js";

export const DEFAULT_REMOTE_CONTROL_HOST = "127.0.0.1";
export const DEFAULT_REMOTE_CONTROL_PORT = 7788;

export function normalizeRemoteControlConfig(raw: unknown): RemoteControlConfig {
  const record = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const host =
    typeof record["host"] === "string" && record["host"].trim()
      ? record["host"].trim()
      : DEFAULT_REMOTE_CONTROL_HOST;
  const port =
    typeof record["port"] === "number" && Number.isInteger(record["port"])
      ? record["port"]
      : DEFAULT_REMOTE_CONTROL_PORT;
  const pendingPairing = normalizePendingPairing(record["pendingPairing"]);
  return {
    enabled: record["enabled"] === true,
    host,
    port: port >= 1 && port <= 65535 ? port : DEFAULT_REMOTE_CONTROL_PORT,
    hasCompletedPairing: record["hasCompletedPairing"] === true,
    devices:
      record["hasCompletedPairing"] === true && Array.isArray(record["devices"])
        ? record["devices"].map(normalizeDevice).filter((device) => device !== undefined)
        : [],
    ...(pendingPairing ? { pendingPairing } : {}),
  };
}

function normalizePendingPairing(value: unknown): RemoteControlConfig["pendingPairing"] {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const id = typeof record["id"] === "string" ? record["id"].trim() : "";
  const tokenHash = typeof record["tokenHash"] === "string" ? record["tokenHash"].trim() : "";
  const origin = typeof record["origin"] === "string" ? record["origin"].trim() : "";
  const ownerClientId =
    typeof record["ownerClientId"] === "string" ? record["ownerClientId"].trim() : "";
  const createdAt = typeof record["createdAt"] === "string" ? record["createdAt"].trim() : "";
  if (!id || !/^[a-f0-9]{64}$/.test(tokenHash) || !origin || !ownerClientId || !createdAt) {
    return undefined;
  }
  const request = normalizeRequestMetadata(record["request"]);
  return {
    id,
    tokenHash,
    origin,
    ownerClientId,
    createdAt,
    ...(typeof record["name"] === "string" && record["name"].trim()
      ? { name: record["name"].trim() }
      : {}),
    ...(request ? { request } : {}),
  };
}

function normalizeRequestMetadata(value: unknown): RemoteControlPendingPairing["request"] {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const requestedAt = typeof record["requestedAt"] === "string" ? record["requestedAt"].trim() : "";
  if (!requestedAt) return undefined;
  return {
    requestedAt,
    ...(typeof record["userAgent"] === "string" && record["userAgent"].trim()
      ? { userAgent: record["userAgent"].trim() }
      : {}),
    ...(typeof record["ip"] === "string" && record["ip"].trim() ? { ip: record["ip"].trim() } : {}),
  };
}

function normalizeDevice(value: unknown): RemoteControlDeviceRecord | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const id = typeof record["id"] === "string" ? record["id"].trim() : "";
  const tokenHash = typeof record["tokenHash"] === "string" ? record["tokenHash"].trim() : "";
  const createdAt = typeof record["createdAt"] === "string" ? record["createdAt"].trim() : "";
  if (!id || !/^[a-f0-9]{64}$/.test(tokenHash) || !createdAt) return undefined;
  const name = typeof record["name"] === "string" ? record["name"].trim() : "";
  return {
    id,
    tokenHash,
    name: name || `Device ${id.slice(0, 8)}`,
    ...(record["customName"] === true ? { customName: true } : {}),
    createdAt,
    ...(typeof record["lastConnectedAt"] === "string" && record["lastConnectedAt"].trim()
      ? { lastConnectedAt: record["lastConnectedAt"].trim() }
      : {}),
    ...(typeof record["lastUserAgent"] === "string" && record["lastUserAgent"].trim()
      ? { lastUserAgent: record["lastUserAgent"].trim() }
      : {}),
    ...(typeof record["lastIp"] === "string" && record["lastIp"].trim()
      ? { lastIp: record["lastIp"].trim() }
      : {}),
  };
}
