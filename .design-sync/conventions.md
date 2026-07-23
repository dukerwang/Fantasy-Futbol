## Gaffa design conventions

Gaffa is a dynasty fantasy-football app. Two themes exist — Cream Editorial (light) and Premium Dark — switched via `data-theme="light"|"dark"` on the root element. Build every screen so it works in both; never hardcode a hex color.

### Styling idiom: CSS custom properties, no utility classes

There is no Tailwind/utility layer. Style with `var(--token-name)` inside plain CSS (or inline `style` for one-offs), reading real values from `styles.css`. Key families:

- **Surfaces**: `--color-bg-primary`, `--color-bg-secondary`, `--color-bg-card`, `--color-bg-card-alt`, `--color-bg-card-hover`, `--color-bg-elevated`, `--color-bg-overlay`
- **Text**: `--color-text-primary`, `--color-text-secondary`, `--color-text-muted`, `--color-text-inverse`
- **Borders**: `--color-border`, `--color-border-subtle`, `--color-border-accent`
- **Accent** (the app's single green accent, not a rainbow palette): `--color-accent`, `--color-accent-hover`, `--color-accent-dim`, plus `--color-accent-green`, `--color-accent-blue`, `--color-accent-purple`, `--color-accent-red`, `--color-accent-yellow` (each with a `-dim`/`-hover` variant) for status/semantic use only
- **Semantic status**: `--color-success`, `--color-warning`, `--color-danger` (+ `-dim`/`-dark` variants), `--color-defeat`
- **Rank/prize**: `--color-gold`, `--color-silver`, `--color-bronze`
- **Position colors** (one per tactical position group — always use these for position badges/spines, never invent new ones): `--color-pos-gk`, `--color-pos-cb`, `--color-pos-fb` (LB/RB), `--color-pos-wb` (LWB/RWB), `--color-pos-dm`, `--color-pos-cm`, `--color-pos-am`, `--color-pos-lw`, `--color-pos-rw`, `--color-pos-st`
- **Spacing**: `--space-1` … `--space-20` (4px scale)
- **Radii**: `--radius-sm`, `--radius-md`, `--radius-lg`, `--radius-xl`, `--radius-2xl`, `--radius-full`
- **Shadows**: `--shadow-sm/md/lg/xl`, `--shadow-card`, `--shadow-card-lift`, `--shadow-glow` (+ `-blue`/`-green` variants), `--shadow-trading-card`
- **Type scale**: `--text-xs` … `--text-5xl`, weights `--font-normal/medium/semibold/bold`, line-heights `--leading-tight/snug/base`
- **Transitions**: `--transition-fast/base/slow`, `--ease-out-expo`

### Typography — three families, deliberately mixed

- `--font-serif` (Newsreader) — display/editorial: player names, big stat numbers, headings. Gives cards an "editorial trading card" feel.
- `--font-sans` (Hanken Grotesk) — body copy, labels, nav, buttons.
- `--font-mono` (JetBrains Mono) — numeric/data readouts where tabular alignment matters (stat tables, IDs).

All three load via a Google Fonts `@import` at the top of `styles.css` — already wired, no extra setup needed.

### Position taxonomy

12 tactical positions only — GK, CB, LB, RB, LWB, RWB, DM, CM, AM, LW, RW, ST. No generic DEF/MID/FWD groupings, no LM/RM. `PositionBadge` is the canonical way to render one (`position`, `size: 'sm'|'md'`) — reuse it instead of hand-rolling position chips.

### Where the truth lives

Read `styles.css` (the tokens + font imports) and `_ds_bundle.css` (compiled component styles) before styling anything new — both are in this bundle. Per-component usage is in each `<Name>.prompt.md`.

### Example: a small stat row built from tokens + PlayerCard

```jsx
import { PlayerCard, PositionBadge } from 'gaffa';

function RosterRow({ player }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <span style={{ font: 'var(--font-semibold) var(--text-sm)/var(--leading-snug) var(--font-sans)', color: 'var(--color-text-muted)' }}>
        Starting XI
      </span>
      <PlayerCard player={player} action={{ type: 'bid' }} />
    </div>
  );
}
```

`PlayerCard` and `PremiumPlayerCard` render best at ~600px+ width (they crop below ~500px) — give them a full-width column, not a narrow sidebar slot.
