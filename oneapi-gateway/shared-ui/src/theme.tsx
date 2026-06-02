import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Button } from "./components";

export type ThemeMode = "light" | "dark" | "system";
export type ThemeValue = "light" | "dark";

type ThemeContextValue = {
  theme: ThemeMode;
  resolvedTheme: ThemeValue;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
};

const STORAGE_KEY = "easyai-ui-theme";

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getSystemTheme(): ThemeValue {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getInitialTheme(defaultTheme: ThemeMode): ThemeMode {
  if (typeof window === "undefined") return defaultTheme;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }
  } catch {
    // Ignore storage errors.
  }
  return defaultTheme;
}

function applyTheme(theme: ThemeMode, resolvedTheme: ThemeValue) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = resolvedTheme;
  document.documentElement.style.colorScheme = resolvedTheme;
  document.documentElement.dataset.themeMode = theme;
}

export function ThemeProvider(props: {
  children: React.ReactNode;
  defaultTheme?: ThemeMode;
}) {
  const defaultTheme = props.defaultTheme ?? "system";
  const [theme, setThemeState] = useState<ThemeMode>(() => getInitialTheme(defaultTheme));
  const [systemTheme, setSystemTheme] = useState<ThemeValue>(() => getSystemTheme());

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemTheme(media.matches ? "dark" : "light");
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const resolvedTheme = theme === "system" ? systemTheme : theme;

  useEffect(() => {
    applyTheme(theme, resolvedTheme);
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Ignore storage errors.
    }
  }, [resolvedTheme, theme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      resolvedTheme,
      setTheme: (nextTheme) => setThemeState(nextTheme),
      toggleTheme: () => setThemeState((current) => (current === "dark" ? "light" : "dark")),
    }),
    [resolvedTheme, theme],
  );

  return <ThemeContext.Provider value={value}>{props.children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return value;
}

export function ThemeToggle(props: { className?: string; compact?: boolean }) {
  const { resolvedTheme, toggleTheme } = useTheme();
  return (
    <Button
      className={props.className}
      onClick={toggleTheme}
      variant="ghost"
      size={props.compact ? "sm" : "md"}
      title={resolvedTheme === "dark" ? "切换到亮色模式" : "切换到暗色模式"}
    >
      {resolvedTheme === "dark" ? "亮色模式" : "暗色模式"}
    </Button>
  );
}
