const activeConnections = new Map<string, Set<() => void>>();
const revokedDeviceIds = new Set<string>();

export function registerRemoteControlConnection(deviceId: string, close: () => void): () => void {
  if (revokedDeviceIds.has(deviceId)) {
    close();
    return () => {};
  }
  const connections = activeConnections.get(deviceId) ?? new Set<() => void>();
  connections.add(close);
  activeConnections.set(deviceId, connections);
  return () => {
    const current = activeConnections.get(deviceId);
    current?.delete(close);
    if (current?.size === 0) activeConnections.delete(deviceId);
  };
}

export function closeRemoteControlConnections(deviceId: string): void {
  revokedDeviceIds.add(deviceId);
  closeConnections(deviceId);
}

export function closeAllRemoteControlConnections(): void {
  for (const deviceId of activeConnections.keys()) closeConnections(deviceId);
}

function closeConnections(deviceId: string): void {
  const connections = activeConnections.get(deviceId);
  if (!connections) return;
  activeConnections.delete(deviceId);
  for (const close of connections) close();
}

export function isRemoteControlDeviceOnline(deviceId: string): boolean {
  return (activeConnections.get(deviceId)?.size ?? 0) > 0;
}
