/** Max width of the main conversation column (centered); the empty-conversation composer reuses it */
export const CONVERSATION_MAX_W = "max-w-[min(86vw,44rem)]";
/** Message list of a non-empty conversation (about one spacing block wider than {@link CONVERSATION_MAX_W}) */
export const CONVERSATION_MESSAGE_LIST_MAX_W = "max-w-[min(90vw,48rem)]";
/** Horizontal padding shared by the message list, composer, top-bar banner, and the full-page content columns (settings, automations, marketplace) so their content edges align with the conversation column (avoids touching the window edge when the widened sidebar narrows the column) */
export const CONVERSATION_GUTTER_X = "px-4 sm:px-5";
export const CONVERSATION_GUTTER_NEG_X = "-mx-4 sm:-mx-5";
/** Scroll-bed fallback before composer-dock has been measured (previously 12rem) */
export const CONVERSATION_COMPOSER_SCROLL_BED_FALLBACK_PX = 192;
/** Extra whitespace between the last message and the composer overlay that can still be scrolled down into */
export const CONVERSATION_SCROLL_BED_EXTRA_PX = 48;
