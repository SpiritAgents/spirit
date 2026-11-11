import { randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createConfigStore, type ConfigStore } from "@spiritagent/config";

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
  private readonly store: ConfigStore;

  constructor(private readonly options: RemoteControlManagerOptions) {
    this.store = createConfigStore({ dataDir: options.dataDir });
  }

  async initialize(): Promise<void> {
    const state = await this.read();
    if (state.pendingPairing) {
      await this.update((current) => ({ ...current, pendingPairing: undefined }));
    }
  }

  async getState(): Promise<RemoteControlState> {
    return this.projectWithHostAvailability(await this.read());
  }

  async enable(): Promise<RemoteControlState> {
    return this.update((current) => ({ ...current, enabled: true }));
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
      throw new Error("Remote Control requires a running Workbench Host.");
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

  async registerHost(instanceId: string, pid: number, host: string, port: number): Promise<void> {
    const path = hostLeasePath(this.options.dataDir);
    const existing = await readHostLease(path);
    if (
      existing?.instanceId === instanceId &&
      existing.pid === pid &&
      existing.host === host &&
      existing.port === port
    ) {
      // Heartbeats keep the lease fresh without producing a remote.updated feedback loop.
      await writeFile(
        path,
        JSON.stringify({
          ...existing,
          heartbeatAt: Date.now(),
        }),
      );
      return;
    }
    if (await this.hostAvailable()) {
      if (existing?.instanceId !== instanceId) {
        throw new Error("Remote Control Host is already running.");
      }
    }
    await mkdirForLease(this.options.dataDir);
    await writeFile(
      path,
      JSON.stringify({
        instanceId,
        pid,
        host,
        port,
        startedAt: Date.now(),
        heartbeatAt: Date.now(),
      }),
    );
    this.options.onStateChanged?.(await this.getState());
  }

  async unregisterHost(instanceId: string): Promise<void> {
    const current = await readHostLease(hostLeasePath(this.options.dataDir));
    if (current?.instanceId !== instanceId) return;
    await rm(hostLeasePath(this.options.dataDir), { force: true });
    this.options.onStateChanged?.(await this.getState());
  }

  private async hostAvailable(): Promise<boolean> {
    try {
      const lease = await readHostLease(hostLeasePath(this.options.dataDir));
      if (!lease) return false;
      if (Date.now() - lease.heartbeatAt > 30_000) return false;
      process.kill(lease.pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private async read(): Promise<RemoteControlConfig> {
    return this.store.readSection("webHost", normalizeRemoteControlConfig);
  }

  private async update(
    mutate: (current: RemoteControlConfig) => RemoteControlConfig,
  ): Promise<RemoteControlState> {
    const next = await this.store.updateSection("webHost", normalizeRemoteControlConfig, mutate);
    const state = await this.projectWithHostAvailability(next);
    this.options.onStateChanged?.(state);
    return state;
  }

  private async projectWithHostAvailability(
    config: RemoteControlConfig,
  ): Promise<RemoteControlState> {
    return { ...projectState(config), hostAvailable: await this.hostAvailable() };
  }
}

function hostLeasePath(dataDir: string): string {
  return join(dataDir, "server", "remote-control-host.json");
}

async function mkdirForLease(dataDir: string): Promise<void> {
  await mkdir(join(dataDir, "server"), { recursive: true });
}

async function readHostLease(path: string): Promise<
  | {
      instanceId: string;
      pid: number;
      host: string;
      port: number;
      startedAt: number;
      heartbeatAt: number;
    }
  | undefined
> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
}

function projectState(config: RemoteControlConfig): Omit<RemoteControlState, "hostAvailable"> {
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
