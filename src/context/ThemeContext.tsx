'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'light' | 'dark';
export type Palette = 'lock' | 'shipped';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
  palette: Palette;
  setPalette: (palette: Palette) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const THEME_COLOR: Record<Palette, Record<Theme, string>> = {
  lock:    { light: '#F8F4EC', dark: '#1B1F29' },
  shipped: { light: '#F7F3ED', dark: '#1A1F2E' },
};

const PALETTE_KEY = 'gaffa-palette';

// The in-app toggle is manual (data-theme), not prefers-color-scheme, so the
// static <meta name="theme-color"> from the viewport export only covers the
// OS default. Push the toggled color into every theme-color tag (both the
// light- and dark-media variants) so the browser/PWA chrome — status bar,
// address bar — always matches what's actually on screen, not the OS guess.
function syncThemeColorMeta(theme: Theme, palette: Palette) {
  const color = THEME_COLOR[palette][theme];
  document.querySelectorAll('meta[name="theme-color"]').forEach((tag) => {
    tag.setAttribute('content', color);
  });
}

function readPalette(): Palette {
  const saved = localStorage.getItem(PALETTE_KEY);
  return saved === 'shipped' ? 'shipped' : 'lock';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('light');
  const [palette, setPaletteState] = useState<Palette>('lock');

  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') as Theme | null;
    const resolvedTheme = savedTheme ?? 'light';
    const resolvedPalette = readPalette();
    setThemeState(resolvedTheme);
    setPaletteState(resolvedPalette);
    document.documentElement.setAttribute('data-theme', resolvedTheme);
    document.documentElement.setAttribute('data-palette', resolvedPalette);
    syncThemeColorMeta(resolvedTheme, resolvedPalette);
  }, []);

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
    localStorage.setItem('theme', newTheme);
    document.documentElement.setAttribute('data-theme', newTheme);
    syncThemeColorMeta(newTheme, palette);
  };

  const setPalette = (newPalette: Palette) => {
    setPaletteState(newPalette);
    localStorage.setItem(PALETTE_KEY, newPalette);
    document.documentElement.setAttribute('data-palette', newPalette);
    syncThemeColorMeta(theme, newPalette);
  };

  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme, palette, setPalette }}>
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

export function usePalette() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('usePalette must be used within a ThemeProvider');
  }
  return { palette: context.palette, setPalette: context.setPalette };
}
