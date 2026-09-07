<!--
  HOW TO READ THIS FILE — read this before treating anything below as binding.

  This file RECORDS what the code currently does and sets the design contract.

  Every claim is tagged:
    [code]     verifiable in the repo right now; the file is cited. Trust it,
               but re-check the citation before relying on it — code moves.
    [decided]  Duke said it, in his own words. See docs/DECISIONS.md for the
               quote and the date. This is the only category that is binding.
    [inferred] an agent's reading. NOT policy. Contradict it freely if the work
               is better for it, and say so rather than working around it.

  WHY THE TAGS EXIST. An earlier version of this file promoted several
  agent-authored observations into named "laws" and cited them back to Duke.
  If you are an agent reading this: do not invent named rules. Do not restate
  an inference as doctrine. If you cannot cite a file or a quote, tag it
  [inferred] and let the reader decide.
-->

# Design: Gaffa

## 1. Atmosphere & Design Philosophy

Gaffa is an editorial, high-density fantasy football platform for the Premier League. The atmosphere is **calm, tactile, and data-dense** — like a modern, beautifully typeset European broadsheet sports journal crossed with a high-performance trading platform. [inferred]

* **Ground & Tone**: Warm, bright cream field (`#F8F4EC`) on desktop/mobile paired with deep forest green chrome (`#185B37`). Not vintage/yellow beige, but fresh, readable, and sharp. [code] [decided]
* **Sports Data Craft**: Visual weight is carried by typography (Newsreader serif display, Archivo Narrow condensed data labels, and Hanken Grotesk body) rather than decorative graphics or generic cards. [code]
* **Product, Not Costume**: Gaffa is sophisticated product UI for real football managers, not a themed novelty game. [decided]

---

## 2. Tokens as Shipped

All declared in `src/app/globals.css`. Light values under `:root, .g-theme-light`; dark under `[data-theme="dark"]`. Machine-verified at 172/172 pairs passing WCAG AA via `node design-2.0/verify-palette.mjs`. [code]

* **Surfaces (Light)**: `--color-bg-primary` #F8F4EC (page ground) · `--color-bg-secondary` #EBE8DE · `--color-bg-card` #FCFAF7 (near-white card) · `--color-bg-card-alt` #F9F6F1 · `--color-bg-elevated` #EBE8DE [code]
* **Surfaces (Dark)**: `--color-bg-primary` #1B1F29 (charcoal navy) · `--color-bg-secondary` #242934 · `--color-bg-card` #272D39 · `--color-bg-card-alt` #202530 · `--color-bg-elevated` #313743 [code]
* **Ink (Light)**: `--color-text-primary` #1B1915 · `--color-text-secondary` #49443B · `--color-text-muted` #635D51 [code]
* **Ink (Dark)**: `--color-text-primary` #EDEAE2 · `--color-text-secondary` #B7B2A8 · `--color-text-muted` #949BAB [code]
* **The Green Ramp (Hue 155)**:
  - `--color-green-50` #EAF5ED (row tint "yours")
  - `--color-green-100` #D6EBDC (chip/hover)
  - `--color-green-200` #ADD6BA (keyline on tint)
  - `--color-green-300` #3B8D5D (meter fill)
  - `--color-green-600` #1E7C4A (accent text dark)
  - `--color-green-700` #0C6D3E (== `--color-accent`)
  - `--color-green-800` #185B37 (== `--color-topbar`)
  - `--color-green-900` #16452A (deep chrome) [code]
* **Tactical Position Spine (12 positions)**: Locked L54/C0.118, hue rotated by pitch zone:
  - `GK` #926500 · `CB` #0076B2 · `LB`/`RB` #5667B9 · `LWB`/`RWB` #008295 · `DM` #7B56B9 · `CM` #915397 · `AM` #A34E71 · `LW`/`RW` #00866F · `CF` #C0392B [code]
* **Typography**:
  - Display / Names / Scores: `Newsreader` (`--font-serif`)
  - Body & General UI: `Hanken Grotesk` (`--font-sans`)
  - Column Heads / Badges / Buttons: `Archivo Narrow` (`--font-condensed`)
  - Numeric Tickers / Stopwatches: `JetBrains Mono` (`--font-mono`) [code]
* **Motion & Physics**:
  - `--dur-instant: 90ms` · `--dur-fast: 140ms` · `--dur-base: 220ms` · `--dur-slow: 420ms`
  - Standard curve: `--ease-standard: cubic-bezier(.22, 1, .36, 1)` [code]

---

## 3. What Duke Has Actually Decided

Full quotes and dates in **`docs/DECISIONS.md`**. Summary: [decided]

* **Cream ground stays; brighter and less yellow is the direction.** Beige is out. [decided]
* **The green topbar stays.** [decided]
* **Wingers stay green.** [decided]
* **No coloured accent bars on container edges.** No left-edge accent stripes, no colored top rules, no gradient strips on cards. [decided]
* **No eyebrow labels above page titles.** Do not place uppercase kickers/eyebrows above page or section headers. [decided]
* **Gaffa is not a themed costume.** Sophisticated, accessible product UI for real football fans. [decided]
* **"One job per colour" is not binding.** Green carries topbar chrome, primary buttons, and positive status safely via the green ramp. [decided]
* **Mobile is a first-class target, not a reflow.** Must look and feel native, tactile, and ergonomic. [decided]
* **No white panels floating on the cream ground.** A section is a serif title over a 2px ink rule with flat content beneath it; only a genuinely bounded object (hero, board, table) gets a 1px border box — border, not shadow. `.g-panel` is not the default for a new page. See `_home/home.module.css`. [decided]
* **Headings and section titles are title case**; buttons stay sentence case. [decided]
* **A heading names the thing beneath it**, it does not caption it. "Title-Winning XI", not "The XI That Won It". [decided]

---

## 4. Component Micro-Rules & Mobile-First Standards

These engineering rules govern interactive feel across all components: [code] [inferred]

### A. Micro-Interactions & Tactile Feedback (Emil Kowalski Craft)
* **Button Press Feedback**: Every `button` gets `transform: scale(var(--press-scale, 0.97))` on `:active:not(:disabled)`, over `140ms var(--ease-standard)`. [code]
  * The rule lives in `@layer gaffa-base` in `globals.css`. Unlayered rules beat layered ones whatever their specificity, so any CSS Module can override it without a specificity fight — `button:active:not(:disabled)` is (0,2,1) and would otherwise silently outrank a plain `.foo:active`. [code]
  * To change the press for one component, set `--press-scale` on it rather than redeclaring `transform`; redeclaring escapes the `prefers-reduced-motion` guard that sits beside the base rule. [code]
* **Never Animate From `scale(0)`**: Entrance transitions start from `scale(0.95)` with `opacity: 0`. [inferred]
* **Origin-Aware Popovers**: Dropdowns and popovers must scale in from their trigger anchor point (`transform-origin: var(--transform-origin)`), not the screen center. Modals stay centered. [inferred]
* **Snappy UI Threshold**: In-app UI transitions must stay under `250ms`. Never use `ease-in` for interactive UI. [inferred]
* **Universal Keyboard Focus**: All interactive elements must show high-contrast `:focus-visible` rings (`outline: 2px solid var(--color-accent); outline-offset: 2px;`). [code]

### B. Apple-Grade Mobile Standards
* **Dynamic Viewport (`dvh`)**: Full-height views and overlays use a `vh` declaration followed by a `dvh` one, so the fallback survives and modern browsers track the real visible viewport as Safari's chrome retracts. Covered: `body`, the draft room, chat, the chat widget, the transfer modal, SquadPeek, the departure modal and the trades modal. Not yet converted: the marketing/auth shells, the dashboard shell, pre-draft lobby, team setup, tournaments, activity and crest. [code]
* **Safe Area Inset Awareness**: `body` carries left/right/bottom insets and `--nav-height` folds in `safe-area-inset-top`; TopBar, chat, the chat widget, the transfer modal and SquadPeek handle their own. Any new fixed or bottom-anchored element must do the same. [code]
* **Touch Target Ergonomics**: 44px is the target, but it is applied per component (chat, players index, TopBar, MatchupPitch at 48px) rather than enforced globally. Treat it as a rule to apply when building, not a guarantee the app already meets. [inferred]
* **Touch Delay & Flash Elimination**: Set `touch-action: manipulation` and `-webkit-tap-highlight-color: transparent` globally. [code]
* **Bottom Sheets on Mobile**: On viewports `<640px`, floating dialogs/modals align to the bottom (`align-items: flex-end`) with top rounded corners and safe area padding. [code]
* **Zero Horizontal Page Overflow**: Multi-column tables must use horizontal swipe snap or pinned columns rather than expanding page width. [inferred]

---

## 5. Explicit Anti-Patterns & Banned AI Tells

These patterns are strictly forbidden across Gaffa: [decided] [inferred]

| Anti-Pattern | Why It Is Banned | Correct Gaffa Pattern |
|---|---|---|
| **Title Eyebrows / Kickers** | AI-slop rhythm tell (`EYEBROW` → `Title` → `Card`). Duke specifically banned this. | Let the editorial `<h1>` or `<h2>` heading stand on its own, title case. |
| **Colored Left Container Stripes** | Generic AI dashboard cliché (`border-left: 3px solid green`). Banned by Duke. | Express status via badge chips or a background tint (`--color-accent-dim`). A tint that carries state must also beat `:hover` — a bare `.rowUnread` loses to `.row:hover` and the state vanishes on hover — and must be paired with a non-color cue such as a bolder title. |
| **Uncalibrated AI Neon Glows** | Oversaturated drop shadows (`box-shadow: 0 0 20px rgba(...)`). | Calibrated ambient resting shadows (`--shadow-card`) tinted to the background hue. |
| **Heavy 1px Wireframe Borders** | Makes data tables feel caged in and cluttered. | `--color-border-subtle` at 1px plus explicit card fills (`--color-bg-card`). A subpixel `0.5px` hairline token was added and removed unused — treat it as a proposal, not a shipped rule. [inferred] |
| **Screaming Uppercase Action Buttons** | Monotonous shouting labels (`SUBMIT PROPOSAL`). | Clean sentence case (`Submit proposal`, `Join league`) in condensed or sans typography. |
| **Generic 3-Card Bento Formulas** | AI layout default that ignores real domain content. | Asymmetric editorial grids, dense data rows, and tactical pitch layouts. |
| **Blank Loading Pop-Ins** | Abrupt content flashing on route navigation. | Contextual skeleton shimmer blocks matching layout shape. `.g-skeleton` exists in `globals.css` but no surface uses it yet. [inferred] |

---

## 6. Known Problems & Proposals

Measured opportunities in the current codebase: [inferred]

* **Four surfaces where three would do**: `--color-bg-card` #FCFAF7 sits close to page ground #F8F4EC. Reconciling card surfaces with subtle resting depth helps distinguish layers. [inferred]
* **Legacy CSS variables**: Older components still contain leftover inline style patterns or legacy classes; continue migrating them to the unified token system. [code]
* **Concurrent Session Care**: Always check `git status` and file mtimes before editing shared files like `globals.css`. [inferred]
