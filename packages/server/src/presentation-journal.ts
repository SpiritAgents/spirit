import type {
  RuntimePresentationPayload,
  RuntimePresentationState,
} from "@spiritagent/host-internal";

const TRANSIENT_EVENTS = new Set([
  "background-task-changed",
  "background-task-output",
  "tool-execution-output-chunk",
  "streaming-tool-preview",
  "update-pending-assistant-thinking",
  "update-pending-assistant-compaction",
  "context-usage-updated",
]);

/** Desktop acknowledges a cursor only after projecting its matching timeline snapshot. */
export class PresentationJournal {
  private state: RuntimePresentationState;

  constructor(saved?: RuntimePresentationState) {
    this.state = structuredClone(saved ?? { sequence: 0, entries: [] });
  }

  append(payload: RuntimePresentationPayload): number {
    const sequence = ++this.state.sequence;
    if (payload.kind !== "runtime" || !TRANSIENT_EVENTS.has(payload.event.kind)) {
      this.state.entries.push({ ...structuredClone(payload), sequence });
    }
    return sequence;
  }

  snapshot(): RuntimePresentationState {
    return structuredClone(this.state);
  }

  acknowledge(sequence: number): void {
    if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence > this.state.sequence) {
      throw new Error("Invalid presentation sequence.");
    }
    this.state.entries = this.state.entries.filter((entry) => entry.sequence > sequence);
  }

  clear(): void {
    this.state.entries = [];
  }
}
