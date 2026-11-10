export type DesktopAutomationWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type DesktopAutomationSchedule =
  | { kind: "hourly" }
  | { kind: "daily"; hour: number; minute: number }
  | { kind: "weekly"; weekday: DesktopAutomationWeekday; hour: number; minute: number };

export interface DesktopAutomationScheduleFormatLabels {
  hourly: string;
  dailyPrefix: string;
  weeklyPrefix: string;
  weekdays: readonly string[];
  formatWeekly?(weekday: string, time: string): string;
}
