'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const THEME_COLOR: Record<Theme, string> = {
  light: '#F8F4EC',
  dark: '#1B1F29',
};

// The in-app toggle is manual (data-theme), not prefers-color-scheme, so the
// static <meta name="theme-color"> from the viewport export only covers the
// OS default. Push the toggled color into every theme-color tag (both the
// light- and dark-media variants) so the browser/PWA chrome — status bar,
// address bar — always matches what's actually on screen, not the OS guess.
function syncThemeColorMeta(theme: Theme) {
  const color = THEME_COLOR[theme];
  document.querySelectorAll('meta[name="theme-color"]').forEach((tag) => {
    tag.setAttribute('content', color);
  });
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('light');

  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') as Theme | null;
    const resolvedTheme = savedTheme ?? 'light';
    setThemeState(resolvedTheme);
    document.documentElement.setAttribute('data-theme', resolvedTheme);
    syncThemeColorMeta(resolvedTheme);
  }, []);

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
    localStorage.setItem('theme', newTheme);
    document.documentElement.setAttribute('data-theme', newTheme);
    syncThemeColorMeta(newTheme);
  };

  const toggleTheme = () => {
    setTheme(theme === 'light' ? 'dark' : 'light');
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
