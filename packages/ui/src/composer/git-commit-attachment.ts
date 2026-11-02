export interface GitCommitAttachment {
  id: string;
  oid: string;
  subject: string;
  author: string;
  authoredAt: string;
  /** Raw commit message from git `%B` (subject line + optional body). */
  fullMessage: string;
  /** Host-only: workspace tool tab that produced this chip. Never sent to the agent. */
  sourceTabId?: string;
}
