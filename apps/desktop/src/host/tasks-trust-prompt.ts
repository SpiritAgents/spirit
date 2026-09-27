import {
  canonicalizeWorkspaceRoot,
  type WorkspaceCapabilityTrustDecision,
  type WorkspaceCapabilityTrustRequest,
} from "@spiritagent/host-internal";

export type WorkspaceTasksTrustPayload = NonNullable<WorkspaceCapabilityTrustRequest["tasks"]>;

interface TasksTrustWaiter {
  workspaceRoot: string;
  contentHash: string;
  finish: () => void;
}

export interface WorkspaceTasksTrustPromptQueueOptions {
  getPending: () => WorkspaceCapabilityTrustRequest | undefined;
  setPending: (request: WorkspaceCapabilityTrustRequest | undefined) => void;
  /** The host's shared capability-trust tail (serialized with remote hooks prompts). */
  getTail: () => Promise<void>;
  setTail: (tail: Promise<void>) => void;
  emit: () => void;
  apply: (
    waiter: { workspaceRoot: string; contentHash: string },
    decision: WorkspaceCapabilityTrustDecision,
  ) => Promise<void>;
}

// Serializes tasks trust prompts onto the host's shared capability-trust tail and merges a
// tasks section into an already-open same-workspace prompt (typically a hooks prompt) so
// one reply answers both. A tasks prompt never replaces a pending tasks prompt for the
// same root with identical content, and never merges into a tasks-owned prompt (its
// waiter owns the open tail slot).
export class WorkspaceTasksTrustPromptQueue {
  private waiter: TasksTrustWaiter | undefined;

  constructor(private readonly options: WorkspaceTasksTrustPromptQueueOptions) {}

  request(payload: WorkspaceTasksTrustPayload, workspaceRoot: string): void {
    const canonical = canonicalizeWorkspaceRoot(workspaceRoot);
    const pending = this.options.getPending();
    if (pending !== undefined && pending.workspaceRoot === canonical) {
      // A same-root prompt is open right now: merge immediately (or dedupe).
      if (this.mergeIntoPending(pending, payload, canonical)) {
        return;
      }
    }
    this.options.setTail(
      this.options
        .getTail()
        .catch(() => undefined)
        .then(() => this.open(payload, canonical)),
    );
  }

  /** Applies the reply to the tasks waiter when the answered request carries its content. */
  async handleReply(decision: WorkspaceCapabilityTrustDecision): Promise<boolean> {
    const waiter = this.waiter;
    if (waiter === undefined) {
      return false;
    }
    this.waiter = undefined;
    const pending = this.options.getPending();
    const covered =
      pending !== undefined &&
      pending.workspaceRoot === waiter.workspaceRoot &&
      pending.tasks?.contentHash === waiter.contentHash;
    try {
      if (covered) {
        await this.options.apply(waiter, decision);
      }
    } finally {
      waiter.finish();
    }
    return covered;
  }

  private open(payload: WorkspaceTasksTrustPayload, canonical: string): Promise<void> | void {
    const pending = this.options.getPending();
    if (pending !== undefined && pending.workspaceRoot === canonical) {
      // A same-root prompt became pending while this request was queued (e.g. a hooks
      // prompt opened in between): merge instead of opening a second prompt.
      if (this.mergeIntoPending(pending, payload, canonical)) {
        return;
      }
      // The open prompt is tasks-owned (its waiter holds the tail slot): unreachable from
      // a serialized chain, but never overwrite it from here.
      return;
    }
    return new Promise<void>((finish) => {
      this.options.setPending({
        workspaceRoot: canonical,
        contentHash: payload.contentHash,
        hashChanged: payload.hashChanged,
        hooks: [],
        tasks: payload,
      });
      this.waiter = { workspaceRoot: canonical, contentHash: payload.contentHash, finish };
      this.options.emit();
    });
  }

  /** Returns true when the merge happened (or was a no-op dedupe). */
  private mergeIntoPending(
    pending: WorkspaceCapabilityTrustRequest,
    payload: WorkspaceTasksTrustPayload,
    canonical: string,
  ): boolean {
    if (pending.tasks?.contentHash === payload.contentHash) {
      return true;
    }
    if (this.waiter !== undefined && pending.tasks?.contentHash === this.waiter.contentHash) {
      return false;
    }
    this.options.setPending({ ...pending, tasks: payload });
    // The merged content is answered by the currently open prompt's reply; this waiter
    // owns no tail slot, so its finish is a no-op.
    this.waiter = { workspaceRoot: canonical, contentHash: payload.contentHash, finish: () => {} };
    this.options.emit();
    return true;
  }
}
