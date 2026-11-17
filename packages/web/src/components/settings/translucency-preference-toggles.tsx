import { useTranslation } from "react-i18next";

import { Toggle } from "@/components/ui/toggle";
import { RovingFocusGroup, RovingFocusItem } from "@/components/ui/roving-focus-group";
import { TRANSLUCENCY_PREFERENCES, type TranslucencyPreference } from "@/lib/translucency";

const TRANSLUCENCY_OPTION_LABEL_KEYS = {
  off: "settings.translucencyOff",
  sidebar: "settings.translucencySidebar",
  all: "settings.translucencyAll",
} as const satisfies Record<TranslucencyPreference, string>;

export function TranslucencyPreferenceToggles({
  value,
  onChange,
  ariaLabel,
}: {
  value: TranslucencyPreference;
  onChange: (next: TranslucencyPreference) => void;
  ariaLabel: string;
}) {
  const { t } = useTranslation();
  return (
    <RovingFocusGroup asChild orientation="horizontal" loop defaultCurrentTabStopId={value}>
      <div className="flex justify-end gap-1" role="radiogroup" aria-label={ariaLabel}>
        {TRANSLUCENCY_PREFERENCES.map((preference) => {
          const label = t(TRANSLUCENCY_OPTION_LABEL_KEYS[preference]);
          return (
            <RovingFocusItem
              asChild
              key={preference}
              tabStopId={preference}
              active={value === preference}
            >
              <Toggle
                variant="default"
                pressed={value === preference}
                onPressedChange={(pressed) => {
                  if (pressed) {
                    onChange(preference);
                  }
                }}
                role="radio"
                aria-checked={value === preference}
                aria-pressed={undefined}
                aria-label={label}
              >
                {label}
              </Toggle>
            </RovingFocusItem>
          );
        })}
      </div>
    </RovingFocusGroup>
  );
}
