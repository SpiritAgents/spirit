import { useCallback, useMemo, useState } from "react";

import {
  buildLongConversationListDemoMessages,
  longConversationListDemoStats,
} from "@/lib/long-conversation-list-demo";
import type { ConversationMessageSnapshot } from "@/types";

export function useLongConversationListDemo() {
  const [active, setActive] = useState(false);
  const [messages, setMessages] = useState<ConversationMessageSnapshot[]>([]);

  const start = useCallback(() => {
    const nextMessages = buildLongConversationListDemoMessages();
    setMessages(nextMessages);
    setActive(true);
  }, []);

  const stop = useCallback(() => {
    setActive(false);
    setMessages([]);
  }, []);

  const stats = useMemo(
    () => (active ? longConversationListDemoStats(messages) : null),
    [active, messages],
  );

  return {
    active,
    messages,
    stats,
    start,
    stop,
  };
}
