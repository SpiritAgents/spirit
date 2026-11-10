// TODO: allow the settings page / SPIRIT_LSP_* env vars to override the server launch command.

export interface LspTimingConfig {
  diagnosticsWaitMs: number;
  writeAppendDiagnosticsWaitMs: number;
  syncDebounceMs: number;
}

export const DEFAULT_LSP_TIMING: LspTimingConfig = {
  diagnosticsWaitMs: 4_000,
  // Appends after a write must wait for publishDiagnostics; 1.5s often returned no results in practice, so this is aligned to 4s with the agent-initiated get_diagnostics
  writeAppendDiagnosticsWaitMs: 4_000,
  syncDebounceMs: 300,
};
