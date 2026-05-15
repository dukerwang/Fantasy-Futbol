# Gaffa — Planning Context (Antigravity / Gemini)

Plans produced here are handed to **Claude Code or Cursor** for execution. Write plans with file paths, function names, tables, RPCs, and edge cases so an agent with no chat history can implement them.

**Default mode: planning only.** Do not create or edit code unless the user says implement / execute / go ahead. Questions about a plan → update the plan doc only.

Also read `CLAUDE.md` (execution, scoring runbook) and `CURSOR.md` (UI status, Stitch).

---

## What This App Is

**Vision:** A tactically deep dynasty soccer platform — not Sleeper-with-a-soccer-skin. Mechanics should feel like real football management: public transfer windows, position-accurate performance scoring, market values from real-world data, long-term roster consequences.

- Multi-tenant, invite leagues, **4–10** managers  
- **2025/26** season in active development — use current FPL fields (`defensive_contribution`, etc.)  
- Custom scoring, FAAB economy, and 12-position taxonomy are **non-negotiable** — generic fantasy patterns are often wrong here  

Every plan must ask: *does this respect the rules below?*

---

## 4-Phase Roadmap

1. ~~**Automation**~~ ✅ — GW resolution on FPL `finished` + daily cron safety nets (~1h worst case).  
2. ~~**Taxi squad**~~ ✅ — U21 academy slots, API + My Team UI shipped; polish in `CURSOR.md`.  
3. **Visual completion + Scoring V2 validation** — Cream Editorial rollout; V2 engine writing to shadow columns until `/admin/scoring-v2` sign-off and migration 040.  
4. **Loans & intra-league selling** — not started.

---

## Scoring Philosophy (V2)

### Goals

| Goal | Meaning for plans |
|---|---|
| FotMob-like display | ~6–6.5 average starter; ~7 good; ~8 exceptional; 9+ rare masterclass |
| Positional balance | Top DM/CB/LB can rank with top AM/ST/RW — `match_impact` (BPS) must work for all roles |
| Real-life accuracy | Elite real players trend elite in app; no player-specific tuning |
| Dynasty PPG signal | Meaningful season-long gaps between tiers (e.g. 3rd vs 8th winger) |
| Peaks matter | Explosive GWs can lift PPG; **do not** plan to eliminate convex points “inversions” unless product explicitly asks |

### Architecture (single source of truth)

- **Engine:** `src/lib/scoring/matchRating.ts`  
- **No** Edge Function duplicate (removed migration 037)  
- **V1 legacy:** `matchRatingV1Legacy.ts` — dual-write to primary columns only during shadow phase  
- **Shadow columns (039):** `match_rating_v2`, `fantasy_points_v2`, `score_*_v2`  
- **Promotion:** migration `040` — **blocked** until user sign-off; same PR removes dual-write and admin tools  

### Pipeline (for plan accuracy)

```
RawStats (FPL per fixture)
  → sigmoidNormalize per component (SIGMOID_K, DB reference stats)
  → position weights + flex → composite [0,1]
  → display: curveFinalRating = 3.0 + 7.0 × composite  (UI / stored as match_rating_v2)
  → points: calculateFantasyPoints(1.0 + 9.0 × composite)  (decoupled scale)
```

### Calibration constants (May 2026 — treat as locked)

| Parameter | Value | Planning note |
|---|---|---|
| `SIGMOID_K` | 1.0 | Do not plan K &gt; 1 without new validation — 1.3 inflated multi-component elites (AM/CM) |
| Display | `3.0 + 7.0 × c` | Shifts median to ~6.5 display |
| Points scale | 6.0 | Slightly wider PPG than old 5.0 |
| Points exponent | 1.5 | Convex; rejected 2.0 (variance artifact vs season avgs) |

### Data ingestion (plans touching sync/backfill)

- **`bps`:** must use `el.stats.bps * ratio` per fixture — FPL `explain` has no `bps`; zero BPS broke `match_impact` for defenders/mids  
- Reference stats: `rating_reference_stats` via `loadReferenceStats()`; recompute script when raw formulas change  
- IDs: `fpl_id` for live fetch; `id` for DB writes  

### Shadow validation workflow (include in scoring plans)

1. Code change + `npm run build` + push  
2. `node scripts/backfill-scoring-v2.mjs`  
3. User reviews `/admin/scoring-v2` (positional leaders, spot players, PPG vs rating)  
4. Only after approval: migration 040 + delete V1 + remove admin backfill  

### Sigmoid engine (conceptual)

- Normalize each raw metric vs **position-specific** 3-season baselines in DB  
- `z = SIGMOID_K × (value − median) / stddev` → `1 / (1 + exp(−z))`  
- Cross-position pools for goal involvement / finishing so a LWB fluke goal does not beat a ST brace  
- **Finishing** (goals vs xG) remains sensitive for attackers — small stddev on ST  
- A world-class DM should be able to outscore a mediocre ST over a season when performances warrant it  

---

## Granular Positioning

**12 slots:** GK, CB, LB, RB, LWB, RWB, DM, CM, AM, LW, RW, ST.

- Lineup slot = scoring profile for that matchup (role-aware resolution)  
- Players slot only in **primary or secondary** position  
- Do not plan features that collapse to “MID” or “FWD” for scoring  

### SoFIFA mapping (ingest only — not lineup slots)

Legacy LM/RM are not stored:

1. LM/RM + existing LB/RB on same side → LWB/RWB  
2. Any fullback tag → drop remaining LM/RM  
3. No fullback tags → LM→LW, RM→RW  

---

## Data Model (planning shorthand)

```
leagues → teams → roster_entries → players → player_stats
matchups, league_standings (view), player_rankings (view)
waiver_claims, transactions, trade_proposals
tournaments → rounds → tournament_matchups
rating_reference_stats
```

### IDs (always specify in plans)

| Field | Use |
|---|---|
| `players.id` | All internal FKs |
| `players.fpl_id` | FPL live/backfill only |
| `players.api_football_id` | Market value / API-Football |

---

## Transfer & Economy (mandatory for transfer plans)

- **Public FAAB** — highest bid visible; never blind bidding UI  
- Drop → **48h waiver** — competitive bids; winner pays; else free agent pool  
- Severance: **10%** of Transfermarkt value on drop  
- **Scout's Rebate:** 20% to nominator if another team wins  
- Min bid: **20%** of market value  
- PL player in: standard auction; PL player out: owner gets **80%** of market value as FAAB  

---

## League & Cups

- Dynasty, **38** GWs, **no playoffs** — champion = most `league_points`  
- H2H matchups: bragging + cups; draw if `|score_a − score_b| ≤ 10`  
- Three concurrent tournaments (League Cup, Champions, Consolation) — schedules in prior docs; matchweek scores count for league + active cup round  

---

## Design System (for UI plans)

- **CSS Modules** + variables in `globals.css` — no Tailwind, no inline styles  
- **Cream Editorial** default; dark toggle planned — no new hardcoded dark-theme hex  
- Stitch project `9034509438526576481` — **curl prototype HTML** before writing CSS (see `CURSOR.md`)  
- Player photos: `object-fit: cover; object-position: top center`; avoid `overflow: hidden` on photo cards  

---

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | Next.js App Router, TypeScript, CSS Modules |
| Backend | Supabase Postgres + RPCs |
| Host | Vercel — **deploy on `git push` only** |
| Data | FPL, Transfermarkt, API-Football, SoFIFA |

---

## Working Features (baseline)

Draft, trades, public FAAB/waivers, lineup validation, standings, matchups, fixtures, cups, stats, activity log, player sync, custom scoring (V2 in shadow), crons (auctions, bots, resolution).

---

## Planning Principles

### Thoroughness checklist

- [ ] Happy path  
- [ ] Edge cases (null stats, missing players, invalid bids, mid-GW moves)  
- [ ] Empty / error / loading UI  
- [ ] Mobile check  

Do not assume unbuilt features exist.

### Deployment

End every implementation plan with: `npm run build` → commit → push → verify `gaffa.live`.

### Vercel Hobby limits

- Cron: **max once per day per job** (use multiple jobs at different hours if needed)  
- Cron precision ±59 minutes  
- Function duration up to **300s** (fluid compute)  
- Do not plan sub-daily crons on Hobby  

### Fragile areas (flag in plans)

- `matchRating.ts` — requires backfill + admin review  
- No batch recalc without reason  
- RPCs for FAAB / points mutations  
- Never hardcode sigmoid medians — DB reference stats only  

### Intentional product decisions (do not replan away)

- Public bidding  
- No websockets (polling / revalidation)  
- Position-weighted scoring  
- No playoffs  
- Convex fantasy points rewarding big games (unless user requests change)  

---

## Scoring change plan template

When the user asks for scoring adjustments, plans should include:

1. **Which layer** — sigmoid (K / reference stats), weights, display scale, or points curve  
2. **Expected side effects** — positional groups, peak vs consistency, elite inflation  
3. **Validation** — backfill range, `/admin/scoring-v2` checks, 3–5 named spot players  
4. **Explicit non-goals** — e.g. “will not tune Bruno individually”  
5. **Rollback** — git revert + re-backfill  

Rejected experiments to cite when relevant: `SIGMOID_K=1.3`, points exponent `2.0`.
