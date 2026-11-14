import { SKIP_SCROLL_INTO_VIEW_TAG, SKIP_SELECTION_FOCUS_TAG } from "lexical";

/** Host-driven syncs must not move focus or scroll any ancestor to reveal the caret. */
export const COMPOSER_HOST_SYNC_TAGS = [SKIP_SELECTION_FOCUS_TAG, SKIP_SCROLL_INTO_VIEW_TAG];
