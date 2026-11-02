export interface FileSnippetAttachment {
  id: string;
  /** Workspace-relative or absolute file path frozen at insert time. */
  filePath: string;
  /** 1-based line numbers from Monaco selection; 0 when unknown (e.g. Markdown preview). */
  lineStart: number;
  lineEnd: number;
  /** Raw selected file text for the agent. */
  selectedText: string;
  /** Host-only: workspace tool tab that produced this chip. Never sent to the agent. */
  sourceTabId?: string;
}
