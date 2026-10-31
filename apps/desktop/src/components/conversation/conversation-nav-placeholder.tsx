import { Spinner } from "@spiritagent/ui/spinner";

/** Transitional placeholder shown while the target session's data is still loading. */
export function ConversationNavPlaceholder() {
  return (
    <div
      className="flex min-h-full w-full items-center justify-center"
      data-spirit-surface="conversation-nav-placeholder"
    >
      <Spinner className="spirit-nav-placeholder-fade size-5 text-muted-foreground" />
    </div>
  );
}
