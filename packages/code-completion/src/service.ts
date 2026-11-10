import type { CodeCompletionResult } from "./core/types.js";

import { CodeCompletionEditJournal } from "./edit-journal.js";
import type { LlmCodeCompletionDependencies } from "./llm-source.js";
import { LlmCodeCompletionSource } from "./llm-source.js";
import type {
  CodeCompletionJournalEntry,
  CodeCompletionRequestContext,
  CodeCompletionSource,
} from "./types.js";

// In the future, LSP textDocument/completion will plug in as another CompletionSource, merged and ranked with LLM results.
export interface LspCodeCompletionSource extends CodeCompletionSource {
  readonly kind: "lsp";
}

export class CodeCompletionService {
  private readonly journal: CodeCompletionEditJournal;
  private readonly sources: CodeCompletionSource[];

  constructor(options?: { journal?: CodeCompletionEditJournal; sources?: CodeCompletionSource[] }) {
    this.journal = options?.journal ?? new CodeCompletionEditJournal();
    this.sources = options?.sources ?? [];
  }

  get editJournal(): CodeCompletionEditJournal {
    return this.journal;
  }

  recordFileState(entry: CodeCompletionJournalEntry): void {
    this.journal.recordFileState(entry);
  }

  clearJournal(): void {
    this.journal.clear();
  }

  async request(
    context: CodeCompletionRequestContext,
    llmDependencies?: LlmCodeCompletionDependencies,
  ): Promise<CodeCompletionResult | null> {
    if (context.signal?.aborted) {
      return null;
    }

    const recentEdits = this.journal.formatRecentEdits();
    const sources =
      llmDependencies !== undefined
        ? [...this.sources, new LlmCodeCompletionSource(llmDependencies)]
        : this.sources;

    for (const source of sources) {
      if (context.signal?.aborted) {
        return null;
      }
      const result = await source.suggest(context, recentEdits);
      if (result && result.operations.length > 0) {
        return result;
      }
    }

    return { operations: [] };
  }
}
