import { useTranslation } from "react-i18next";

import { lspDiagnosticsCounts } from "@/lib/file-tool-lsp-diagnostics-display";
import type { LspWriteDiagnosticsUi } from "@spiritagent/agent-core";

export function FileToolLspDiagnosticsBadge({
  diagnostics,
}: {
  diagnostics: LspWriteDiagnosticsUi;
}) {
  const { t } = useTranslation();
  const { errorCount, warningCount } = lspDiagnosticsCounts(diagnostics);
  const totalIssues = errorCount + warningCount;
  if (totalIssues === 0) {
    return null;
  }

  return (
    <span className="inline-flex shrink-0 text-xs leading-relaxed text-foreground-subtle">
      {t("tool.diagnosticsIssueCount", { count: totalIssues })}
    </span>
  );
}
