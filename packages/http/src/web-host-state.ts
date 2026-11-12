import type {
  DesktopWebHostPolicySnapshot,
  DesktopWebHostStatusSnapshot,
} from "@spiritagent/api/types";
import {
  DEFAULT_REMOTE_CONTROL_HOST,
  DEFAULT_REMOTE_CONTROL_PORT,
} from "@spiritagent/remote-control";
import {
  closeAllRemoteControlConnections,
  closeRemoteControlConnections,
  isRemoteControlDeviceOnline,
  registerRemoteControlConnection,
} from "@spiritagent/remote-control";

export const DESKTOP_WEB_HOST_POLICY: DesktopWebHostPolicySnapshot = {
  healthRequiresAuth: true,
  cors: "same-origin",
  allowHttpLan: true,
  allowRemoteControl: true,
};

let runtimeStatus: DesktopWebHostStatusSnapshot = {
  state: "stopped",
  host: DEFAULT_REMOTE_CONTROL_HOST,
  port: DEFAULT_REMOTE_CONTROL_PORT,
};

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
  return registerRemoteControlConnection(deviceId, close);
}

export function closeDesktopWebHostDeviceConnections(deviceId: string): void {
  closeRemoteControlConnections(deviceId);
}

export function closeAllDesktopWebHostDeviceConnections(): void {
  closeAllRemoteControlConnections();
}

export function isDesktopWebHostDeviceOnline(deviceId: string): boolean {
  return isRemoteControlDeviceOnline(deviceId);
}
