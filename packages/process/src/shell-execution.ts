import { spawn } from "node:child_process";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { buildAgentShellEnvironment } from "./bundled-ripgrep-env.js";
import {
  defaultShellForPty,
  prepareShellForHostExecution,
  shellRunCommandArgs,
} from "./default-terminal-shell.js";
import { POSIX_SHELL_SUPERVISOR, WINDOWS_SHELL_SUPERVISOR } from "./shell-supervisor.js";

const DEFAULT_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

export interface RunShellOptions {
  workspaceRoot: string;
  command: string;
  onOutputChunk?: (chunk: string) => void | Promise<void>;
  maxOutputBytes?: number;
  signal?: AbortSignal;
}

export interface RunShellResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  truncated: boolean;
}

export interface RunShellHandle {
  result: Promise<RunShellResult>;
  kill(): void;
}

export function runShell(options: RunShellOptions): RunShellHandle {
  options.signal?.throwIfAborted();
  const limit = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  if (!Number.isSafeInteger(limit) || limit < 0) {
    throw new Error("Shell output size must be a non-negative integer.");
  }
  const { file } = defaultShellForPty();
  const args = [...shellRunCommandArgs(file), prepareShellForHostExecution(file, options.command)];
  const env = buildAgentShellEnvironment(process.env);
  const windows = process.platform === "win32";
  const supervisor = spawn(
    windows
      ? path.join(
          process.env.SystemRoot || "C:\\Windows",
          "System32",
          "WindowsPowerShell",
          "v1.0",
          "powershell.exe",
        )
      : process.execPath,
    windows
      ? ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", WINDOWS_SHELL_SUPERVISOR]
      : ["--input-type=module", "--eval", POSIX_SHELL_SUPERVISOR],
    {
      cwd: options.workspaceRoot,
      windowsHide: true,
      env: { ...env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: windows ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe", "ipc"],
    },
  );
  let stopped = false;
  let terminalReceived = false;
  let exitCode: number | null = null;
  let failure: Error | undefined;
  const kill = (): void => {
    if (stopped || terminalReceived) return;
    stopped = true;
    if (windows) supervisor.stdin?.end("stop\n");
    else if (supervisor.connected) {
      supervisor.send({ kind: "stop" }, (error) => {
        if (error && !terminalReceived) {
          failure = error;
          supervisor.kill();
        }
      });
    }
  };
  const abort = (): void => kill();
  options.signal?.addEventListener("abort", abort, { once: true });
  let stdout = "";
  let stderr = "";
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let truncated = false;
  const decoders = { stdout: new StringDecoder("utf8"), stderr: new StringDecoder("utf8") };
  let outputQueue = Promise.resolve();
  let pendingWrites = 0;
  const append = (stream: "stdout" | "stderr", text: string): void => {
    if (!text) return;
    const bytes = Buffer.from(text, "utf8");
    const remaining = Math.max(0, limit - (stream === "stdout" ? stdoutBytes : stderrBytes));
    const kept = new StringDecoder("utf8").write(bytes.subarray(0, remaining));
    if (bytes.length > remaining) truncated = true;
    if (stream === "stdout") {
      stdout += kept;
      stdoutBytes += Buffer.byteLength(kept);
    } else {
      stderr += kept;
      stderrBytes += Buffer.byteLength(kept);
    }
    if (!options.onOutputChunk || failure) return;
    supervisor.stdout?.pause();
    supervisor.stderr?.pause();
    pendingWrites += 1;
    outputQueue = outputQueue
      .then(async () => {
        if (!failure) await options.onOutputChunk!(text);
      })
      .catch((error: unknown) => {
        failure = error instanceof Error ? error : new Error(String(error));
        kill();
      })
      .finally(() => {
        pendingWrites -= 1;
        if (pendingWrites === 0) {
          supervisor.stdout?.resume();
          supervisor.stderr?.resume();
        }
      });
  };
  supervisor.stdout?.on("data", (chunk: Buffer) => append("stdout", decoders.stdout.write(chunk)));
  supervisor.stderr?.on("data", (chunk: Buffer) => append("stderr", decoders.stderr.write(chunk)));
  supervisor.stdout?.on("end", () => append("stdout", decoders.stdout.end()));
  supervisor.stderr?.on("end", () => append("stderr", decoders.stderr.end()));
  supervisor.stdin?.on("error", (error) => {
    if (!terminalReceived && supervisor.exitCode === null) {
      failure = error;
      supervisor.kill();
    }
  });
  const spec = { kind: "start", file, args, cwd: options.workspaceRoot, env };
  if (windows) supervisor.stdin?.write(`${JSON.stringify(spec)}\n`);
  else
    supervisor.on("message", (message: unknown) => {
      if (typeof message !== "object" || message === null || !("kind" in message)) return;
      if (message.kind === "ready") {
        supervisor.send(spec, (error) => {
          if (error) {
            failure = error;
            kill();
          }
        });
        if (stopped)
          supervisor.send({ kind: "stop" }, (error) => {
            if (error && !terminalReceived) failure = error;
          });
      } else if (message.kind === "error" && "error" in message) {
        failure = new Error(String(message.error));
        kill();
      } else if (message.kind === "result" && "exitCode" in message) {
        if (
          message.exitCode !== null &&
          (typeof message.exitCode !== "number" || !Number.isInteger(message.exitCode))
        ) {
          failure = new Error("Invalid shell supervisor result.");
          kill();
        } else {
          exitCode = message.exitCode;
          terminalReceived = true;
        }
      }
    });
  const result = new Promise<RunShellResult>((resolve, reject) => {
    supervisor.once("error", (error) => {
      failure = error;
    });
    supervisor.once("close", (code) => {
      options.signal?.removeEventListener("abort", abort);
      void outputQueue.then(() => {
        if (failure) {
          reject(failure);
          return;
        }
        if (!windows && !terminalReceived) {
          reject(new Error("The shell supervisor exited without an execution result."));
          return;
        }
        resolve({ stdout, stderr, exitCode: windows ? code : exitCode, truncated });
      }, reject);
    });
  });
  if (options.signal?.aborted) kill();
  return { result, kill };
}
