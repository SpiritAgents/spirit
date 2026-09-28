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
  /** Merge-replace or open the pending request; display state is managed by the host. */
  setPending: (request: WorkspaceCapabilityTrustRequest) => void;
  /** True once the current pending prompt has had a chance to paint in the renderer. */
  isPromptShown: () => boolean;
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
// one reply answers both. Merging is only allowed while the pending prompt has not been
// displayed yet: once the user can see it, adding content under their click would
// authorize it unseen, so a standalone prompt is queued instead. A tasks prompt never
// replaces a pending tasks prompt for the same root with identical content, and never
// merges into a tasks-owned prompt (its waiter owns the open tail slot).
export class WorkspaceTasksTrustPromptQueue {
  private waiter: TasksTrustWaiter | undefined;

  constructor(private readonly options: WorkspaceTasksTrustPromptQueueOptions) {}

  request(payload: WorkspaceTasksTrustPayload, workspaceRoot: string): void {
    const canonical = canonicalizeWorkspaceRoot(workspaceRoot);
    const pending = this.options.getPending();
    if (
      pending !== undefined &&
      pending.workspaceRoot === canonical &&
      !this.options.isPromptShown()
    ) {
      // A same-root prompt is queued-but-not-displayed: merge immediately (or dedupe).
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

  /**
   * Applies the reply to the tasks waiter when the answered request carries its content.
   * The waiter is consumed synchronously; the answered request is passed in because the
   * host clears its pending state before awaiting (a second reply must find nothing).
   */
  async handleReply(
    decision: WorkspaceCapabilityTrustDecision,
    answered: WorkspaceCapabilityTrustRequest | undefined,
  ): Promise<boolean> {
    const waiter = this.waiter;
    if (waiter === undefined) {
      return false;
    }
    this.waiter = undefined;
    const covered =
      answered !== undefined &&
      answered.workspaceRoot === waiter.workspaceRoot &&
      answered.tasks?.contentHash === waiter.contentHash;
    try {
      if (covered) {
        await this.options.apply(waiter, decision);
      }
    } finally {
      waiter.finish();
    }
    return covered;
  }

  private open(payload: WorkspaceTasksTrustPayload, canonical: string): Promise<void> {
    return new Promise<void>((finish) => {
      this.options.setPending({
        workspaceRoot: canonical,
        // The top-level fields belong to the hooks domain; a tasks-only request keeps
        // them empty and carries its hash on the tasks section instead.
        contentHash: "",
        hashChanged: false,
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
