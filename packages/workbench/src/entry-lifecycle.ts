import path from "node:path";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

import {
  loadConfig,
  resolveConfiguredSpiritDataDir,
  setSpiritDataDirOverride,
  spiritDataDir,
} from "@spiritagent/sessions/host/storage";
import type { DesktopHttpHost } from "@spiritagent/http/http-host";

export async function runWorkbench({
  allowDisabled = false,
}: { allowDisabled?: boolean } = {}): Promise<void> {
  setSpiritDataDirOverride(resolveConfiguredSpiritDataDir());

  const initialConfig = await loadConfig();
  if (!allowDisabled && !initialConfig.webHost.enabled) return;

  const [
    {
      invokeDesktopHostCommand,
      shutdownDesktopHostService,
      subscribeDesktopDreamUpdates,
      refreshDesktopRemoteControlConfig,
    },
    { setDesktopWebHostRuntimeStatus },
    { callDesktopRemoteControl, requestDesktopRemoteControlAccess, subscribeDesktopRemoteControl },
    { createDesktopHttpHost, resolveDesktopWebHostFromEnv },
  ] = await Promise.all([
    import("./host/service.js"),
    import("@spiritagent/sessions/host/web-host-state"),
    import("@spiritagent/sessions/host/remote-control-client"),
    import("@spiritagent/http/http-host"),
  ]);

  const instanceId = `workbench-${process.pid}-${randomUUID()}`;
  const initialEndpoint = resolveDesktopWebHostFromEnv();
  let webHost: DesktopHttpHost | undefined;
  let syncTail = Promise.resolve();
  let stopping = false;

  function webDistPath(): string {
    const require = createRequire(import.meta.url);
    return path.join(path.dirname(require.resolve("@spiritagent/web/package.json")), "dist");
  }

  async function start(host: string, port: number): Promise<void> {
    if (webHost?.isRunning()) {
      const current = webHost.getState();
      if (current.host === host && current.port === port) {
        await callDesktopRemoteControl(spiritDataDir(), "remote.registerHost", {
          instanceId,
          pid: process.pid,
          host,
          port,
        });
        return;
      }
      await stop();
    }

    setDesktopWebHostRuntimeStatus({ state: "starting", host, port });
    const next = createDesktopHttpHost({
      host,
      port,
      invokeHostCommand: invokeDesktopHostCommand,
      subscribeHostUpdates: subscribeDesktopDreamUpdates,
      auth: {
        requestAccess: (token, metadata) =>
          requestDesktopRemoteControlAccess(spiritDataDir(), token, metadata),
      },
      static: { root: webDistPath(), spaFallback: true },
    });
    const state = await next.start();
    webHost = next;
    setDesktopWebHostRuntimeStatus({
      state: "running",
      host,
      port,
      ...(state.url ? { url: state.url } : {}),
    });
    await callDesktopRemoteControl(spiritDataDir(), "remote.registerHost", {
      instanceId,
      pid: process.pid,
      host,
      port,
    });
  }

  async function stop(): Promise<void> {
    const current = webHost;
    webHost = undefined;
    await current?.stop();
    await callDesktopRemoteControl(spiritDataDir(), "remote.unregisterHost", { instanceId });
  }

  async function shutdown(): Promise<void> {
    if (stopping) return;
    stopping = true;
    await Promise.all([stop(), shutdownDesktopHostService()]);
  }

  await start(initialEndpoint.host, initialEndpoint.port);

  const leaseTimer = setInterval(() => {
    if (!webHost?.isRunning()) return;
    const current = webHost.getState();
    void callDesktopRemoteControl(spiritDataDir(), "remote.registerHost", {
      instanceId,
      pid: process.pid,
      host: current.host,
      port: current.port,
    }).catch(() => undefined);
  }, 10_000);
  leaseTimer.unref();

  await subscribeDesktopRemoteControl(spiritDataDir(), {
    onUpdated: () => {
      syncTail = syncTail.then(async () => {
        if (stopping) return;
        const config = await loadConfig();
        if (!config.webHost.enabled) {
          if (allowDisabled) {
            await stop();
          } else {
            await shutdown();
            process.exit(0);
          }
        } else {
          await start(config.webHost.host, config.webHost.port);
        }
        await refreshDesktopRemoteControlConfig();
      });
      syncTail = syncTail.catch((error) => {
        if (!stopping) console.warn("[workbench] failed to synchronize Remote Control", error);
      });
      return syncTail;
    },
    onConfirmationRequested: () => refreshDesktopRemoteControlConfig(),
  });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      clearInterval(leaseTimer);
      void shutdown().finally(() => process.exit(0));
    });
  }
}
