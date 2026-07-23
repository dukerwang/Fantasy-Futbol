// Explicit named re-exports for design-sync — the app's components are all
// default exports, and the converter's synth-entry fallback uses `export *`,
// which never forwards default exports. This shim makes them real named
// exports so the esbuild bundle assigns them onto window.Gaffa correctly.
export { default as PlayerCard } from '../src/components/players/PlayerCard';
export { default as PositionBadge } from '../src/components/players/PositionBadge';
export { default as PremiumPlayerCard } from '../src/components/players/PremiumPlayerCard';
export { default as ThemeToggle } from '../src/components/layout/ThemeToggle';
// Re-exported from the SAME module graph as ThemeToggle's own import (not via
// cfg.extraEntries, which bundles as a separate pass and would instantiate a
// second, distinct ThemeContext — breaking the Provider/useContext identity
// match and making useTheme() throw "must be used within a ThemeProvider").
export { ThemeProvider } from '../src/context/ThemeContext';
