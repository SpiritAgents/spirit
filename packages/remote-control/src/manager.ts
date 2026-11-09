import { randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { withSpiritConfigWriteLock } from "@spiritagent/host-internal";

import { normalizeRemoteControlConfig } from "./config.js";
import {
  buildRemoteControlUrl,
  createRemoteControlQrCode,
  createRemoteControlToken,
  hashRemoteControlToken,
  remoteControlDeviceLabel,
} from "./devices.js";
import { closeRemoteControlConnections, isRemoteControlDeviceOnline } from "./connections.js";
import type {
  RemoteControlConfig,
  RemoteControlDeviceRecord,
  RemoteControlEnrollment,
  RemoteControlRequestMetadata,
  RemoteControlState,
} from "./types.js";

interface RemoteControlManagerOptions {
  dataDir: string;
  onStateChanged?: (state: RemoteControlState) => void;
  onConfirmationRequested?: (pairing: RemoteControlState["pendingPairing"]) => void;
}

export type RemoteControlAccessResult =
  | { code: "OK"; device: Omit<RemoteControlDeviceRecord, "tokenHash"> }
  | { code: "DEVICE_APPROVAL_REQUIRED"; pairingId: string }
  | { code: "TOKEN_REQUIRED" };

export class RemoteControlManager {
  constructor(private readonly options: RemoteControlManagerOptions) {}

  async initialize(): Promise<void> {
    const state = await this.read();
    if (state.pendingPairing) {
      await this.update((current) => ({ ...current, pendingPairing: undefined }));
    }
  }

  async getState(): Promise<RemoteControlState> {
    return projectState(await this.read());
  }

  async enable(): Promise<RemoteControlState> {
    const previous = await this.read();
    await this.update((current) => ({ ...current, enabled: true }));
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      if (await this.hostAvailable()) return this.getState();
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await this.update((current) => ({ ...current, enabled: previous.enabled }));
    throw new Error("Remote Control requires a running Desktop Web Host.");
  }

  async disable(): Promise<RemoteControlState> {
    return this.update((current) => ({
      ...current,
      enabled: false,
      pendingPairing: undefined,
    }));
  }

  async configure(input: { host?: string; port?: number }): Promise<RemoteControlState> {
    return this.update((current) => ({
      ...current,
      ...(input.host?.trim() ? { host: input.host.trim() } : {}),
      ...(input.port !== undefined ? { port: input.port } : {}),
      pendingPairing: undefined,
    }));
  }

  async pair(input: {
    ownerClientId: string;
    origin: string;
    name?: string;
    output?: "svg" | "terminal";
  }): Promise<RemoteControlEnrollment> {
    const state = await this.read();
    if (!state.enabled || !(await this.hostAvailable())) {
      throw new Error("Remote Control requires a running Desktop Web Host.");
    }
    const pairingId = randomUUID();
    const token = createRemoteControlToken();
    const url = buildRemoteControlUrl(input.origin, token);
    const qrCodeSvg =
      input.output === "svg" ? await createRemoteControlQrCode(url, "svg") : undefined;
    const qrCodeTerminal =
      input.output === "terminal" ? await createRemoteControlQrCode(url, "terminal") : undefined;
    await this.update((current) => ({
      ...current,
      pendingPairing: {
        id: pairingId,
        tokenHash: hashRemoteControlToken(token),
        origin: input.origin,
        ownerClientId: input.ownerClientId,
        createdAt: new Date().toISOString(),
        ...(input.name?.trim() ? { name: input.name.trim() } : {}),
      },
    }));
    return {
      pairingId,
      token,
      url,
      ...(qrCodeSvg ? { qrCodeSvg } : {}),
      ...(qrCodeTerminal ? { qrCodeTerminal } : {}),
    };
  }

  async requestAccess(
    token: string,
    metadata: Omit<RemoteControlRequestMetadata, "requestedAt"> & { recordConnection?: boolean },
  ): Promise<RemoteControlAccessResult> {
    const tokenHash = hashRemoteControlToken(token);
    const { recordConnection: _recordConnection, ...auditMetadata } = metadata;
    const state = await this.read();
    const device = state.devices.find((candidate) =>
      safeTokenHashEquals(tokenHash, candidate.tokenHash),
    );
    if (device) {
      if (metadata.recordConnection) {
        await this.update((current) => ({
          ...current,
          devices: current.devices.map((candidate) =>
            candidate.id === device.id
              ? {
                  ...candidate,
                  lastConnectedAt: new Date().toISOString(),
                  ...(metadata.userAgent ? { lastUserAgent: metadata.userAgent } : {}),
                  ...(metadata.ip ? { lastIp: metadata.ip } : {}),
                }
              : candidate,
          ),
        }));
      }
      return {
        code: "OK",
        device: {
          id: device.id,
          name: device.name,
          createdAt: device.createdAt,
          ...(device.lastConnectedAt ? { lastConnectedAt: device.lastConnectedAt } : {}),
          ...(device.lastUserAgent ? { lastUserAgent: device.lastUserAgent } : {}),
          ...(device.lastIp ? { lastIp: device.lastIp } : {}),
        },
      };
    }
    const pending = state.pendingPairing;
    if (pending && safeTokenHashEquals(tokenHash, pending.tokenHash)) {
      if (!pending.request) {
        const request = { ...auditMetadata, requestedAt: new Date().toISOString() };
        await this.update((current) => ({
          ...current,
          ...(current.pendingPairing
            ? {
                pendingPairing: {
                  ...current.pendingPairing,
                  request,
                },
              }
            : {}),
        }));
        this.options.onConfirmationRequested?.(projectPending({ ...pending, request }));
      }
      return { code: "DEVICE_APPROVAL_REQUIRED", pairingId: pending.id };
    }
    return { code: "TOKEN_REQUIRED" };
  }

  async approvePairing(pairingId: string, ownerClientId: string): Promise<RemoteControlState> {
    const state = await this.read();
    const pending = state.pendingPairing;
    if (!pending || pending.id !== pairingId || pending.ownerClientId !== ownerClientId) {
      throw new Error("This pairing request is no longer available.");
    }
    if (!pending.request) throw new Error("No device access request is waiting for approval.");
    const now = new Date().toISOString();
    const device: RemoteControlDeviceRecord = {
      id: randomUUID(),
      tokenHash: pending.tokenHash,
      name: pending.name?.trim() || remoteControlDeviceLabel(pending.request.userAgent),
      ...(pending.name?.trim() ? { customName: true } : {}),
      createdAt: now,
      lastConnectedAt: now,
      ...(pending.request.userAgent ? { lastUserAgent: pending.request.userAgent } : {}),
      ...(pending.request.ip ? { lastIp: pending.request.ip } : {}),
    };
    return this.update((current) => ({
      ...current,
      hasCompletedPairing: true,
      devices: [...current.devices, device],
      pendingPairing: undefined,
    }));
  }

  async rejectPairing(
    pairingId: string,
    ownerClientId: string,
    output?: "svg" | "terminal",
  ): Promise<RemoteControlEnrollment> {
    const state = await this.read();
    const pending = state.pendingPairing;
    if (!pending || pending.id !== pairingId || pending.ownerClientId !== ownerClientId) {
      throw new Error("This pairing request is no longer available.");
    }
    await this.update((current) => ({ ...current, pendingPairing: undefined }));
    return this.pair({
      ownerClientId,
      origin: pending.origin,
      ...(pending.name ? { name: pending.name } : {}),
      ...(output ? { output } : {}),
    });
  }

  async cancelPairing(pairingId: string, ownerClientId: string): Promise<void> {
    await this.update((current) => ({
      ...current,
      ...(current.pendingPairing?.id === pairingId &&
      current.pendingPairing.ownerClientId === ownerClientId
        ? { pendingPairing: undefined }
        : {}),
    }));
  }

  async cancelOwnerPairing(ownerClientId: string): Promise<void> {
    await this.update((current) => ({
      ...current,
      ...(current.pendingPairing?.ownerClientId === ownerClientId
        ? { pendingPairing: undefined }
        : {}),
    }));
  }

  async renameDevice(deviceId: string, name: string): Promise<RemoteControlState> {
    if (!name.trim()) throw new Error("Device name is required.");
    return this.update((current) => ({
      ...current,
      devices: current.devices.map((device) =>
        device.id === deviceId ? { ...device, name: name.trim(), customName: true } : device,
      ),
    }));
  }

  async revokeDevice(deviceId: string): Promise<RemoteControlState> {
    closeRemoteControlConnections(deviceId);
    return this.update((current) => ({
      ...current,
      devices: current.devices.filter((device) => device.id !== deviceId),
    }));
  }

  async registerHost(pid: number, host: string, port: number): Promise<void> {
    const path = hostLeasePath(this.options.dataDir);
    await mkdirForLease(this.options.dataDir);
    await writeFile(path, JSON.stringify({ pid, host, port, startedAt: Date.now() }));
  }

  async unregisterHost(): Promise<void> {
    await rm(hostLeasePath(this.options.dataDir), { force: true });
  }

  private async hostAvailable(): Promise<boolean> {
    try {
      const lease = JSON.parse(await readFile(hostLeasePath(this.options.dataDir), "utf8")) as {
        pid: number;
        startedAt: number;
      };
      if (Date.now() - lease.startedAt > 30_000) return false;
      process.kill(lease.pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private async read(): Promise<RemoteControlConfig> {
    try {
      const raw = JSON.parse(await readFile(configPath(this.options.dataDir), "utf8")) as Record<
        string,
        unknown
      >;
      return normalizeRemoteControlConfig(raw["webHost"]);
    } catch {
      return normalizeRemoteControlConfig(undefined);
    }
  }

  private async update(
    mutate: (current: RemoteControlConfig) => RemoteControlConfig,
  ): Promise<RemoteControlState> {
    const next = await withSpiritConfigWriteLock(this.options.dataDir, async () => {
      const path = configPath(this.options.dataDir);
      const raw = await readRawConfig(path);
      const current = normalizeRemoteControlConfig(raw["webHost"]);
      const updated = mutate(current);
      raw["webHost"] = updated;
      const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`;
      try {
        await writeFile(tmpPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
        await rename(tmpPath, path);
      } catch (error) {
        await unlink(tmpPath).catch(() => {});
        throw error;
      }
      return updated;
    });
    const projected = projectState(next);
    this.options.onStateChanged?.(projected);
    return projected;
  }
}

function configPath(dataDir: string): string {
  return join(dataDir, "config.json");
}

function hostLeasePath(dataDir: string): string {
  return join(dataDir, "server", "remote-control-host.json");
}

async function mkdirForLease(dataDir: string): Promise<void> {
  await mkdir(join(dataDir, "server"), { recursive: true });
}

async function readRawConfig(path: string): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch {
    return { schemaVersion: 1, providers: [], activeModel: { providerId: "", name: "" } };
  }
}

function projectState(config: RemoteControlConfig): RemoteControlState {
  return {
    enabled: config.enabled,
    host: config.host,
    port: config.port,
    hasCompletedPairing: config.hasCompletedPairing,
    devices: config.devices.map((device) => ({
      id: device.id,
      name: device.name,
      ...(device.customName ? { customName: true } : {}),
      createdAt: device.createdAt,
      ...(device.lastConnectedAt ? { lastConnectedAt: device.lastConnectedAt } : {}),
      ...(device.lastUserAgent ? { lastUserAgent: device.lastUserAgent } : {}),
      ...(device.lastIp ? { lastIp: device.lastIp } : {}),
      status: isRemoteControlDeviceOnline(device.id) ? "online" : "offline",
    })),
    ...(config.pendingPairing ? { pendingPairing: projectPending(config.pendingPairing) } : {}),
  };
}

function projectPending(
  pending: NonNullable<RemoteControlConfig["pendingPairing"]>,
): RemoteControlState["pendingPairing"] {
  return {
    id: pending.id,
    origin: pending.origin,
    ownerClientId: pending.ownerClientId,
    createdAt: pending.createdAt,
    ...(pending.name ? { name: pending.name } : {}),
    ...(pending.request ? { request: pending.request } : {}),
  };
}

function safeTokenHashEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
