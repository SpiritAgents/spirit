import type { ThinkingSwitchDeclaration, ThinkingSwitchWirePatch } from "./llm-provider-shared.js";

/** User thinking-switch state carried on a transport config: `vendorExtendedThinking === false` is off. */
export type ThinkingSwitchState = "on" | "off";

export function resolveThinkingSwitchState(config: {
  vendorExtendedThinking?: boolean;
  thinkingSwitch?: Pick<ThinkingSwitchDeclaration, "defaultState" | "offBlockedEfforts">;
  effort?: string;
}): ThinkingSwitchState {
  if (
    config.effort !== undefined &&
    config.thinkingSwitch?.offBlockedEfforts?.includes(config.effort)
  ) {
    return "on";
  }
  if (config.vendorExtendedThinking !== undefined) {
    return config.vendorExtendedThinking ? "on" : "off";
  }
  return config.thinkingSwitch?.defaultState ?? "on";
}

/**
 * The declared wire patch selected by the current thinking state, if any. An absent
 * `thinkingSwitch` block (or an absent patch for the current state) returns `undefined`, leaving
 * the transport's default thinking encoding in charge (e.g. the Anthropic transport sends
 * `{thinking: {type: "disabled"}}` for the off state).
 */
export function resolveThinkingSwitchWirePatch(config: {
  thinkingSwitch?: ThinkingSwitchDeclaration;
  vendorExtendedThinking?: boolean;
  effort?: string;
}): ThinkingSwitchWirePatch | "omit" | undefined {
  const declaration = config.thinkingSwitch;
  if (declaration === undefined) {
    return undefined;
  }
  return declaration[resolveThinkingSwitchState(config)];
}
