import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  invokeDesktopHostCommand,
  shutdownDesktopHostService,
  subscribeDesktopDreamUpdates,
  refreshDesktopRemoteControlConfig,
} from "@spiritagent/workbench/host/service";
import {
  loadConfig,
  resolveConfiguredSpiritDataDir,
  setSpiritDataDirOverride,
} from "@spiritagent/sessions/host/storage";
import { setDesktopWebHostRuntimeStatus } from "@spiritagent/sessions/host/web-host-state";
import { requestDesktopRemoteControlAccess } from "@spiritagent/sessions/host/remote-control-client";
import { spiritDataDir } from "@spiritagent/sessions/host/storage";
import {
  callDesktopRemoteControl,
  subscribeDesktopRemoteControl,
} from "@spiritagent/sessions/host/remote-control-client";
import { createDesktopHttpHost, resolveDesktopWebHostFromEnv } from "@spiritagent/http/http-host";
import { resolveRendererDistPath } from "./renderer-dist.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

setSpiritDataDirOverride(resolveConfiguredSpiritDataDir());

const { host, port } = resolveDesktopWebHostFromEnv();
const webHost = createDesktopHttpHost({
  host,
  port,
  invokeHostCommand: invokeDesktopHostCommand,
  subscribeHostUpdates: subscribeDesktopDreamUpdates,
  auth: {
    requestAccess: (token, metadata) =>
      requestDesktopRemoteControlAccess(spiritDataDir(), token, metadata),
  },
  static: {
    root: resolveRendererDistPath(__dirname),
    spaFallback: true,
  },
});

const state = await webHost.start();
setDesktopWebHostRuntimeStatus({
  state: "running",
  host: state.host,
  port: state.port,
  ...(state.url ? { url: state.url } : {}),
});

await callDesktopRemoteControl(spiritDataDir(), "remote.registerHost", {
  pid: process.pid,
  host: state.host,
  port: state.port,
});
const leaseTimer = setInterval(() => {
  if (!webHost.isRunning()) return;
  const current = webHost.getState();
  void callDesktopRemoteControl(spiritDataDir(), "remote.registerHost", {
    pid: process.pid,
    host: current.host,
    port: current.port,
  });
}, 10_000);
leaseTimer.unref();

await subscribeDesktopRemoteControl(spiritDataDir(), {
  onUpdated: () => {
    void (async () => {
      const config = await loadConfig();
      if (config.webHost.enabled && !webHost.isRunning()) {
        await webHost.start();
        const current = webHost.getState();
        await callDesktopRemoteControl(spiritDataDir(), "remote.registerHost", {
          pid: process.pid,
          host: current.host,
          port: current.port,
        });
      } else if (!config.webHost.enabled && webHost.isRunning()) {
        await webHost.stop();
        await callDesktopRemoteControl(spiritDataDir(), "remote.unregisterHost");
      }
      await refreshDesktopRemoteControlConfig();
    })();
  },
  onConfirmationRequested: () => refreshDesktopRemoteControlConfig(),
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    clearInterval(leaseTimer);
    void Promise.all([webHost.stop(), shutdownDesktopHostService()]).finally(() => {
      void callDesktopRemoteControl(spiritDataDir(), "remote.unregisterHost");
      setDesktopWebHostRuntimeStatus({
        state: "stopped",
        host,
        port,
      });
      process.exit(0);
    });
  });
}
