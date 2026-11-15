export type DesktopNotificationKind =
  | "task-complete"
  | "approval"
  | "ask-questions"
  | "generic"
  | "automation";

export type DesktopNotificationAction =
  | {
      type: "button";
      text: string;
      action?: "allow" | "deny" | "focus";
    }
  | {
      type: "text";
      text: string;
      placeholder?: string;
      action: "reply";
    };

export type DesktopNotificationContext = {
  requestId?: string;
  approvalId?: string;
  questionToolCallId?: string;
  questionId?: string;
  automationId?: string;
  runId?: string;
  sessionPath?: string;
};

export type DesktopShowNotificationRequest = {
  title: string;
  body?: string;
  tag?: string;
  silent?: boolean;
  actions?: DesktopNotificationAction[];
  kind?: DesktopNotificationKind;
  context?: DesktopNotificationContext;
};
