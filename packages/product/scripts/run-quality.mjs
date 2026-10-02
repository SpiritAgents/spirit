import { spawn } from "node:child_process";
import { QualitySchema } from "../schema.ts";

const [requestedQuality, command, ...args] = process.argv.slice(2);
const quality = QualitySchema.parse(requestedQuality);
if (!command) throw new Error("Expected a command after the product quality");

const child = spawn(command, args, {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, SPIRIT_PRODUCT_QUALITY: quality },
});
child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
