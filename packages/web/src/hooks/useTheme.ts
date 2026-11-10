import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  applyThemeToDocument,
  getStoredTheme,
  setStoredTheme,
  systemPrefersDark,
  type ThemePreference,
} from "@/lib/theme";

export type ThemeContextValue = {
  theme: ThemePreference;
  setTheme: (next: ThemePreference) => void;
  resolvedDark: boolean;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * setTheme lives in its own context: a constant reference, so components subscribing to it do not re-render on theme value changes.
 * The App top level only needs the setter; the theme value is subscribed by the small components that actually consume it,
 * avoiding a synchronous full re-render of the whole App tree (including the invisibly mounted app-body during OOBE) on theme switch.
 */
const ThemeSetterContext = createContext<((next: ThemePreference) => void) | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>(() => getStoredTheme());
  const [systemDark, setSystemDark] = useState(() => systemPrefersDark());

  const syncSystemDarkFromMain = useCallback((dark: boolean) => {
    setSystemDark(dark);
  }, []);

  const applySystemTheme = useCallback(() => {
    applyThemeToDocument("system", {
      onSystemDarkResolved: syncSystemDarkFromMain,
    });
  }, [syncSystemDarkFromMain]);

  const setTheme = useCallback(
    (next: ThemePreference) => {
      setStoredTheme(next);
      setThemeState(next);
      applyThemeToDocument(next, {
        onSystemDarkResolved: next === "system" ? syncSystemDarkFromMain : undefined,
      });
    },
    [syncSystemDarkFromMain],
  );

  useEffect(() => {
    if (theme !== "system") {
      return;
    }
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystemChange = () => {
      setSystemDark(mq.matches);
      applySystemTheme();
    };
    // The synchronous read may still lag behind the themeSource switch; the IPC resolve corrects resolvedDark via onSystemDarkResolved.
    setSystemDark(systemPrefersDark());
    applySystemTheme();
    mq.addEventListener("change", onSystemChange);
    return () => {
      mq.removeEventListener("change", onSystemChange);
    };
  }, [applySystemTheme, theme]);

  const resolvedDark = theme === "dark" ? true : theme === "light" ? false : systemDark;

  const value = useMemo(() => ({ theme, setTheme, resolvedDark }), [theme, setTheme, resolvedDark]);

  return createElement(
    ThemeSetterContext.Provider,
    { value: setTheme },
    createElement(ThemeContext.Provider, { value }, children),
  );
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return value;
}

/** Subscribe only to setTheme (constant reference); the component does not re-render on theme value changes. */
export function useThemeSetter(): (next: ThemePreference) => void {
  const setter = useContext(ThemeSetterContext);
  if (!setter) {
    throw new Error("useThemeSetter must be used within ThemeProvider");
  }
  return setter;
}
