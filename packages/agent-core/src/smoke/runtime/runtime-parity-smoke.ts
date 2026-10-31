import { runRuntimeParitySmoke } from "../cases/runtime/runtime-parity-case.js";

runRuntimeParitySmoke().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`runtime parity smoke failed: ${message}`);
  if (error instanceof Error) {
    console.error(error.stack);
  }
  process.exitCode = 1;
});
