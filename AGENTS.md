# AGENTS.md

Operating contract for every coding agent in this repo: OpenAI Codex, Antigravity
(Gemini), Cursor, and Claude Code. Claude Code additionally auto-loads
`CLAUDE.md`, which carries the architecture detail this file does not repeat.

Gaffa is a dynasty fantasy football platform for the Premier League, live at
[gaffa.live](https://gaffa.live).

## Read on demand, not up front

Do not read the whole repo before you start. Work out what the task needs and
read that. These are the files worth knowing exist:

| When you are about to | Read first |
|---|---|
| Touch UI, CSS, layout, or typography | `docs/UI_RULES.md`, then `DESIGN.md` |
| Write or rename anything a manager reads | `docs/UI_RULES.md` rules 1–4 |
| Make a design argument or assert a policy | `docs/DECISIONS.md` |
| Change a league mechanic or scoring rule | `docs/USER_GUIDE.md` |
| Work on scoring, auctions, or the data pipeline | `CLAUDE.md`, `README.md` |
| Futbolpedia club-context read API | `src/app/api/integrations/futbolpedia/context/route.ts`, `FUTBOLPEDIA_READ_SECRET` |

`docs/UI_RULES.md` is the single source of truth for UI rules. If a rule needs to
change, change it there first. Everything else points at it.

`docs/DECISIONS.md` is the only record of what Duke actually decided. Prose
elsewhere in the repo is frequently agent-written and was never ratified. Do not
coin a named rule, and do not cite one back to Duke as his.

## Definition of done

Work is done when `npm run build` passes. Run it before saying a task is
complete and before pushing.

`npm test` (vitest, 749 tests, ~4s) uses disposable fixtures and has no
production access. Run it, fix failures, and rerun without asking.
`npm run check:ui` is likewise free to run at will.

Do not claim a feature is live on Vercel until the build passes.

## Ask before you act

These have consequences that a rerun cannot undo. Get a yes first:

- Destructive migrations (`DROP`, `TRUNCATE`, irreversible data rewrites).
  Routine additive migrations do not need to wait.
- Anything that rewrites a published score, result, or standing. Alpha leagues
  have real managers in them; history does not get retroactively edited.
- Pushing, deploying, or opening a PR.
- Batch jobs that spend real money (Gemini grounded search, API-Football quota).

## Writing style

Follow the Google Developer Documentation Style Guide
(`developers.google.com/style`) in UI copy, error messages, docs, commit
messages, and your own replies. The `google-dev-style` skill has the full
detail; load it for substantial writing.

Active voice, second person, standard contractions. No throat-clearing openers,
no "please" on routine instructions, no "just" / "simply" / "obviously", no
hedge-stacking, no em dashes used as a sentence-joining crutch. Prose by
default; lists only for real sequences. Oxford comma.

**Case is not a style preference here, it is a decision:** headings and section
titles are **title case** ("Record Book", "Title-Winning XI"). Buttons are
sentence case ("Submit proposal"), never uppercase. This changed sitewide in
`f2552ff2` and was reaffirmed 2026-09-04 — see `docs/DECISIONS.md`.
`scripts/check-ui-rules.mjs` rejects the alternative on write.

A heading names the thing beneath it; it does not caption it. "Title-Winning
XI", not "The XI That Won It". "League & Cups", not "How It Splits".

Say **Club Balance**, never "FAAB", in anything a user reads. Leagues cycle
indefinitely; they never "complete".

## Skills

Use when they fit the task: `emil-design-eng` (interaction physics, §4.A of
`DESIGN.md`), `apple-design` (mobile ergonomics, §4.B), `google-dev-style`
(copy and docs), `impeccable` in Operate mode (dense dashboards and tables),
`animate` (motion on Gaffa's tokens), `full-output-enforcement` (no truncated
code).

Do not use these — each one fights Gaffa's design system rather than working
inside it: `industrial-brutalist-ui` (military/CRT aesthetic, all-caps
headings), `high-end-visual-design` (mandates eyebrows, bans sticky topbars),
`design-taste-frontend` / `gpt-taste` (marketing landing pages, pulls in
Tailwind and GSAP), `minimalist-ui` (bans coloured headers, breaks the green
topbar), `stitch-design-taste` (regenerates `DESIGN.md` from scratch),
`image-to-code` (scaffolds disposable pages outside the design system).

## Cost and resource limits

Gaffa runs on free tiers. Before any operational task, ask how to get the
outcome with the fewest remote invocations and the least spend.

**Vercel (Hobby)** — 1M function invocations per rolling 30 days, 4 fluid active
CPU hours per month. Run backfills, outlook generation, and multi-minute syncs
as local scripts (`scripts/...`, `tsx ...`) straight against Postgres, not
through serverless functions. Never loop over remote API routes when a direct
query does the same job. Never `setInterval`-poll an API route from a client
component; use Supabase Realtime.

**Supabase** — 500 MB database, 200 concurrent Realtime connections. PostgREST
truncates at 1,000 rows, so paginate with `.range()` on `player_stats` and
`sofifa_position_reference`. Batch instead of N+1. Use Postgres RPCs for
multi-step transactions (bids, trades, payouts). Remove Realtime channels on
unmount.

**Google AI Studio** — respect the monthly spend cap and
`OUTLOOK_MONTHLY_GROUNDED_CAP`. Share head-coach and club queries across
players. Do not regenerate outlooks already matching `PIPELINE_VERSION`.

**External sources** — API-Football allows 100 requests/day. SoFIFA and
Transfermarkt block cloud and CI IPs; scrape only from a local machine using the
tools that already exist (`playwright-sofifa.js`,
`scripts/sync_transfermarkt_gaps.ts`). Check for an existing script before
writing a new one.

