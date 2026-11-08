import type { DesktopWebHostPolicySnapshot, DesktopWebHostStatusSnapshot } from "../types.js";
import { DEFAULT_DESKTOP_WEB_HOST, DEFAULT_DESKTOP_WEB_PORT } from "./storage.js";

export const DESKTOP_WEB_HOST_POLICY: DesktopWebHostPolicySnapshot = {
  healthRequiresAuth: true,
  cors: "same-origin",
  allowHttpLan: true,
  allowRemoteControl: true,
};

let runtimeStatus: DesktopWebHostStatusSnapshot = {
  state: "stopped",
  host: DEFAULT_DESKTOP_WEB_HOST,
  port: DEFAULT_DESKTOP_WEB_PORT,
};

const activeDeviceConnections = new Map<string, Set<() => void>>();

export function setDesktopWebHostRuntimeStatus(status: DesktopWebHostStatusSnapshot): void {
  runtimeStatus = { ...status };
}

export function getDesktopWebHostRuntimeStatus(): DesktopWebHostStatusSnapshot {
  return { ...runtimeStatus };
}

export function registerDesktopWebHostDeviceConnection(
  deviceId: string,
  close: () => void,
): () => void {
  const connections = activeDeviceConnections.get(deviceId) ?? new Set<() => void>();
  connections.add(close);
  activeDeviceConnections.set(deviceId, connections);
  return () => {
    const current = activeDeviceConnections.get(deviceId);
    if (!current) {
      return;
    }
    current.delete(close);
    if (current.size === 0) {
      activeDeviceConnections.delete(deviceId);
    }
  };
}

export function closeDesktopWebHostDeviceConnections(deviceId: string): void {
  const connections = activeDeviceConnections.get(deviceId);
  if (!connections) {
    return;
  }
  activeDeviceConnections.delete(deviceId);
  for (const close of connections) {
    close();
  }
}

export function closeAllDesktopWebHostDeviceConnections(): void {
  for (const deviceId of activeDeviceConnections.keys()) {
    closeDesktopWebHostDeviceConnections(deviceId);
  }
}

export function isDesktopWebHostDeviceOnline(deviceId: string): boolean {
  return (activeDeviceConnections.get(deviceId)?.size ?? 0) > 0;
}
