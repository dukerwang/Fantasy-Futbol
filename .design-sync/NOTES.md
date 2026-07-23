# design-sync notes for Gaffa

## Repo shape

Gaffa is a private Next.js app (`"private": true`, `next build`), not a publishable
component library — there's no `dist/` build or `.d.ts` export tree. This repo
uses the **package** shape in synth-entry mode.

## Scope (deliberately narrow)

Only 4 components are synced, pinned via `componentSrcMap`:
`PlayerCard`, `PositionBadge`, `PremiumPlayerCard` (all in `src/components/players/`),
and `ThemeToggle` (`src/components/layout/`).

**Deliberately excluded** (nulled in `componentSrcMap`): `TopBar`, `NotificationBell` —
both depend on `next/navigation` (`usePathname`/`useRouter`) and live Supabase session
data. That coupling can't be faked with `cfg.provider` (it's not a plain React context),
so they'd either hard-crash outside the Next.js runtime or need a much heavier shim.
Also excluded: `AuthShowcase`, `FormattedText`, `Icon`, `LoginForm`, `MatchupPitch`,
`NavigationLink`, `PageSkeleton`, `PlayerDetailsModal`, `SignupForm` — out of scope for
this pass, not because they're broken. `MatchupPitch` in particular may be worth adding
in a future sync (a lineup pitch visualization — likely a good DS candidate).

## The synth-entry default-export gap

`source-kit.mjs`'s synth-entry fallback writes `.pkg-entry.mjs` as
`export * from "<path>"` for every scanned src file. **`export *` never forwards
default exports** — and every component in this repo is `export default function X()`.
That silently produced a bundle where none of the components were actually on
`window.Gaffa` (`[BUNDLE_EXPORT]` failure), even though component *discovery* (which
scans source via ts-morph and does recover default-export names) found them fine.

**Fix**: `.design-sync/entry.mjs` is a hand-written entry file with explicit named
re-exports (`export { default as X } from '...'`), and `cfg.entry` points at it. This
makes `resolveDistEntry` treat it as a real dist entry (skips synth mode entirely,
since the file exists), so esbuild produces correct named exports on `window.Gaffa`.
**If a 5th component is added, add its re-export line to `entry.mjs` too** — don't
rely on synth-entry alone for this repo.

## Provider context identity — always import via `'gaffa'` in previews

`ThemeToggle` needs `ThemeProvider` (`src/context/ThemeContext.tsx`) via `cfg.provider`.
Two traps here that both manifested as `useTheme must be used within a ThemeProvider`
even though the wrap looked correct in the emitted HTML:

1. Don't use `cfg.extraEntries` to add `ThemeContext.tsx` — extraEntries bundle as a
   **separate esbuild pass**, instantiating a second, distinct `ThemeContext` (second
   `createContext()` call) that doesn't match the one `ThemeToggle` reads from. Instead,
   re-export `ThemeProvider` directly from `entry.mjs` (same module graph as
   `ThemeToggle`'s own import of it) — see the file for the comment.
2. **Authored preview files must import components from the package name (`'gaffa'`),
   never via a relative path into `src/`.** A relative import (e.g.
   `from '../../src/components/layout/ThemeToggle'`) can end up compiling the
   component's source fresh into the preview's own bundle instead of being redirected
   to `window.Gaffa.X` — which again duplicates any context the component reads from,
   breaking Provider/consumer identity. This is also just the documented convention
   (previews are supposed to import from `'<pkg>'`) — follow it for every component,
   not only ones with providers, since the failure mode is silent for context-free
   components and loud (crash) for ones that aren't.

## Known render warns (triaged, expected)

- `[FONT_REMOTE]` — Newsreader/Hanken Grotesk/JetBrains Mono/Fira Code load via a
  Google Fonts `@import` in `globals.css`. Not shipped as static font files; assumed
  to load at runtime same as the real app. No action.
- `PremiumPlayerCard`'s hero image and team crest reference `/team-logos/<id>.png`
  (a Next.js `public/` asset) — this won't resolve inside the standalone bundle/preview
  sandbox. Preview data uses `photo_url: null` and a team not in scope for the crest
  image to keep the card fully self-contained (falls back to letter-avatar / colored
  initial). If a future preview wants the real crest, the target project already has
  `assets/team-logos/*.png` uploaded from a prior (non-design-sync) import — could be
  wired via `cfg.extraFonts`-style asset copying, but that's out of scope here.
- `PlayerCard` and `PremiumPlayerCard` both needed `cfg.overrides.<Name>.cardMode:
  "column"` — both cards are wider than a multi-column grid cell (`[GRID_OVERFLOW]`).

## The existing project content (not touched by this sync)

The "Gaffa Design System" claude.ai/design project was **not created by this skill**
before this run — it already had hand-authored content: `ui_kits/app/*` (interactive
recreation of login/dashboard/league/market screens as static JSX+Babel), `preview/*.html`
(token/component preview cards: colors, type, badges, buttons, player cards, etc.,
styled via their own `colors_and_type.css` + `card.css`, NOT this bundle's `styles.css`),
and `assets/team-logos/*.png`. None of that was in this run's `writes`/`deletes` globs,
so it's untouched. The only overlap was root `_ds_bundle.js`, `styles.css`, `README.md` —
overwritten with this sync's generated versions (confirmed safe: the hand-authored
`preview/*.html` and `ui_kits/app/index.html` link their own CSS files, not the root
`styles.css`).

## Re-sync risks

- If `TopBar`/`NotificationBell` (or any future component) need real inclusion, the
  Next.js router coupling will need actual solving (e.g. a fake `next/navigation`
  shim via `cfg.provider`/an override) — don't just add them to `componentSrcMap` and
  expect it to work.
- The `PremiumPlayerCard` preview's `fetch('/api/players/${id}')` call fails silently
  in the sandbox (caught) — gamelog/history render as empty states ("No data yet").
  That's expected and matches production behavior when the API 404s; not a bug to fix.
- `entry.mjs` is hand-maintained, not auto-derived — a component rename/move under
  `src/components/` needs its `componentSrcMap` path AND its `entry.mjs` re-export
  updated together, or the build will silently drop it from the bundle exports again.
- This repo's `package.json` is `"private": true` with no `version` — `VERSION` in the
  generated README is `0.0.0`. Harmless, but don't expect real semver tracking here.
