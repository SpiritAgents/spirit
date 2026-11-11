export interface ServerNotification {
  method: string;
  params?: unknown;
}

export type ServerNotificationListener = (notification: ServerNotification) => void;
export type ServerDisconnectListener = (error: Error) => void;

export interface ServerRpcClient {
  call<Result = unknown>(method: string, params?: unknown): Promise<Result>;
  onNotification(listener: ServerNotificationListener): () => void;
  onDisconnect(listener: ServerDisconnectListener): () => void;
  close(): void;
}

export interface ServerConnectorOptions {
  dataDir: string;
  forwardStderr: boolean;
}

export type ServerConnector = (
  options: ServerConnectorOptions,
) => Promise<{ client: ServerRpcClient }>;

let connector: ServerConnector | undefined;

export function configureServerConnector(next: ServerConnector): void {
  connector = next;
}

export function requireServerConnector(): ServerConnector {
  if (!connector) {
    throw new Error("The Workbench server connector has not been configured.");
  }
  return connector;
}
