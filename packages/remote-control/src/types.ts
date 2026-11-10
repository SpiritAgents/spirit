export interface RemoteControlDeviceRecord {
  id: string;
  tokenHash: string;
  name: string;
  customName?: boolean;
  createdAt: string;
  lastConnectedAt?: string;
  lastUserAgent?: string;
  lastIp?: string;
}

export interface RemoteControlDeviceSnapshot extends Omit<RemoteControlDeviceRecord, "tokenHash"> {
  status: "online" | "offline";
}

export interface RemoteControlRequestMetadata {
  userAgent?: string;
  ip?: string;
  requestedAt: string;
}

export interface RemoteControlPendingPairing {
  id: string;
  tokenHash: string;
  origin: string;
  ownerClientId: string;
  createdAt: string;
  name?: string;
  request?: RemoteControlRequestMetadata | undefined;
}

export interface RemoteControlConfig {
  enabled: boolean;
  host: string;
  port: number;
  hasCompletedPairing: boolean;
  devices: RemoteControlDeviceRecord[];
  pendingPairing?: RemoteControlPendingPairing | undefined;
}

export interface RemoteControlState extends Omit<
  RemoteControlConfig,
  "devices" | "pendingPairing"
> {
  hostAvailable: boolean;
  devices: RemoteControlDeviceSnapshot[];
  pendingPairing?: Omit<RemoteControlPendingPairing, "tokenHash"> | undefined;
}

export interface RemoteControlEnrollment {
  pairingId: string;
  token: string;
  url: string;
  qrCodeSvg?: string;
  qrCodeTerminal?: string;
}
