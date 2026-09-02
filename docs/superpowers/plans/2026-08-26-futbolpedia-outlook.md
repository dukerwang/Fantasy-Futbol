# Futbolpedia Outlook — implementation plan

> **For agentic workers:** Implement task-by-task. Checkboxes track progress. Spec is the source of truth.

**Goal:** Ship a shared Futbolpedia outlook engine and populate Gaffa's `player_outlooks` cache for ~250–350 regular PL players. Text quality first — **no UI in v1**.

**Source of truth:** `docs/superpowers/specs/2026-08-26-futbolpedia-outlook-design.md`.

**Repos involved:**

| Repo | Path | Role |
|---|---|---|
| Futbolpedia | `/Users/dukewang/Futbolpedia` | Extract engine from `services/geminiService.ts` + `constants.ts` |
| Gaffa | `/Users/dukewang/Fantasy Futbol` | Context bag, cache, batch, admin regen |

**Tech stack:** TypeScript, `@google/genai`, Supabase (Gaffa project), vitest for engine tests.

## Global constraints

- `API_KEY` (Gemini) never exposed client-side — engine runs in Node only.
- Gaffa fantasy stats (`total_points`, `form`, `form_rating`, `ppg`) **must not** be synthesis evidence.
- No buy/hold/sell copy; no "in Gaffa" phrasing; no scoring-math explainers.
- Batch must respect monthly Gemini budget — `--limit`, TTL, trigger-based refresh only.
- Gaffa: `npm run build` must pass before declaring done (no CI).
- Migration applied via Supabase MCP against project **Gaffa**, not left as paste-only.

## File structure

### Shared engine (start in Futbolpedia, consumable from Gaffa)

| Path | Action |
|---|---|
| `packages/engine/package.json` | Create — `@futbolpedia/engine` |
| `packages/engine/src/types/outlook.ts` | Create — `OutlookContextBag`, `PlayerOutlook`, sidecar |
| `packages/engine/src/prompts/outlook.ts` | Create — system instruction, coverage brief, ban list |
| `packages/engine/src/pipeline/queryGen.ts` | Create — 2–3 search vectors |
| `packages/engine/src/pipeline/search.ts` | Create — parallel grounding (port from geminiService) |
| `packages/engine/src/pipeline/extract.ts` | Create — `OutlookExtraction` schema |
| `packages/engine/src/pipeline/synthesize.ts` | Create — outlook prose + sidecar; no thinkingConfig + schema |
| `packages/engine/src/pipeline/generateOutlook.ts` | Create — orchestrator |
| `packages/engine/src/gates/validateOutlook.ts` | Create — word count, banned phrases, confidence rules |
| `packages/engine/src/__tests__/golden/` | Create — 30 frozen context + extraction cases |
| `packages/engine/src/__tests__/validateOutlook.test.ts` | Create |
| `Futbolpedia/services/geminiService.ts` | Modify later — optional import from package (Phase 3) |

**Monorepo note:** If a workspace root is awkward, ship engine as a relative path import from Gaffa (`file:../Futbolpedia/packages/engine`) for v1. Refactor to proper workspace when stable.

### Gaffa integration

| Path | Action |
|---|---|
| `supabase/migrations/NNN_player_outlooks.sql` | Create — cache table |
| `src/lib/outlook/contextBag.ts` | Create — build locked facts from `Player` row |
| `src/lib/outlook/cache.ts` | Create — read/write `player_outlooks` |
| `src/lib/outlook/generate.ts` | Create — call engine + validate + store |
| `src/lib/outlook/population.ts` | Create — regulars SQL + refresh policy |
| `src/lib/outlook/__tests__/contextBag.test.ts` | Create |
| `scripts/generate-outlooks.mjs` | Create — CLI batch runner |
| `src/app/api/admin/outlooks/regenerate/route.ts` | Create — CRON_SECRET gated |

## Task 1: Engine types + prompts

- [x] Create `packages/engine` with TypeScript, `@google/genai`, vitest.
- [x] Define `OutlookContextBag`, `OutlookExtraction`, `PlayerOutlook`, `PlayerOutlookSidecar` per spec §5–6.
- [x] Write outlook system prompt: coverage brief, ban list, locked-facts law, scoring-data firewall.
- [x] Export `generateOutlook(bag, apiKey)` signature (or inject `GoogleGenAI` client).

## Task 2: Pipeline (query → search → extract → synthesize)

- [x] Port parallel search + 429 backoff from `Futbolpedia/services/geminiService.ts`.
- [x] Implement 2–3 query generation (deterministic vectors — no extra LLM call).
- [x] Implement extraction with `responseSchema` (Flash).
- [x] Implement synthesis with `responseSchema` — **omit `thinkingConfig`**.
- [x] One retry on schema failure; fail closed after that.
- [x] Log token usage per call (dev/batch observability).

## Task 3: Validation gates + golden eval

- [x] `validateOutlook(outlook, sidecar, bag, extraction)` — word count 50–130, banned phrases, high confidence + gaps rule.
- [x] Author **30 golden cases** per spec §9.3 (include Tarkowski-style scoring guard).
- [x] Unit tests for gates (deterministic).
- [x] Golden tests: mock extraction → synthesis, or record snapshots for CI.
- [x] CLI: `node packages/engine/scripts/try-outlook.mjs --name "James Tarkowski" --dry-run` for manual spot-check.
- [x] Run `npm test` in engine package — all green before batch.

## Task 4: Gaffa context bag

- [x] `contextBag.ts`: map `Player` → `OutlookContextBag` (availability from `fpl_status`, news from `fpl_news`, positions, age from `date_of_birth`, etc.).
- [x] Map `fpl_status` → availability enum per spec.
- [x] **Do not** include `total_points`, `form`, `form_rating`, `ppg` in bag v1.
- [x] Unit tests: each availability state, null DOB, secondary positions, new-to-Prem flag.

## Task 5: Database migration

- [x] Confirm head: `ls supabase/migrations | tail -3` → use next number.
- [x] Write migration for `player_outlooks` per spec §8.
- [x] Apply via Supabase MCP on Gaffa.

## Task 6: Cache + single-player generate

- [x] `cache.ts`: get/set by `player_id`, store `context_hash`, `pipeline_version`.
- [x] `generate.ts`: load player → bag → engine → validate → upsert; skip if hash unchanged + within TTL.
- [x] Wire `@futbolpedia/engine` from Gaffa (vendored `file:./packages/futbolpedia-engine`; sync via `npm run sync-futbolpedia-engine`).
- [x] Manual test: generate one known player, print outlook to stdout.

## Task 7: Population query + batch CLI

- [x] `population.ts`: SQL for regulars pool (~250–350) — tune `matches_played` / `market_value` thresholds after inspecting distribution.
- [x] Document chosen thresholds in file header comment.
- [x] `scripts/generate-outlooks.ts`: flags `--limit`, `--player-id`, `--dry-run`, `--force`.
- [x] Batch report: success / rejected / failed counts + player IDs.
- [x] Log cumulative token spend; stop if configurable cap hit.

## Task 8: Admin regen route

- [x] `POST /api/admin/outlooks/regenerate` — `x-cron-secret` gate.
- [x] Body: optional `{ playerIds: string[] }` or `{ regulars: true, limit: N }`.
- [x] Return batch report JSON.

## Task 9: Initial seed + manual QA

- [ ] Run batch on regulars with conservative `--limit` first (e.g. 20), review outlooks manually.
- [ ] Fix prompt/gates from failures; re-run.
- [ ] Full regulars seed when golden + spot-check pass.
- [ ] Duke review: 10 random outlooks for voice, facts, no banned phrasing.

**Blocked:** `API_KEY` not in Gaffa `.env.local`. Add it, then:
```bash
cd "/Users/dukewang/Fantasy Futbol"
npm run generate-outlooks -- --limit 20
npm run generate-outlooks -- --regulars
```

## Task 10: Verify

- [x] Gaffa: `npm run build`
- [x] Engine: all tests pass (41)
- [x] Gaffa: all tests pass (324)
- [x] Confirm no client bundle imports engine package (server lib + admin API only)
- [ ] Confirm `player_outlooks` row count ≈ regulars pool (0 rows — seed pending `API_KEY`)

## Out of scope (do not build)

- UI on player card, auction board, or stats table
- Full 25-attribute dossiers in Gaffa
- Buy/hold/sell or bid guidance
- Lite ratings derived from SoFIFA/Gaffa stats
- Futbolpedia chat app refactor (Phase 3 optional)
- Populating entire ~600+ player long tail in one batch

## Suggested execution order

1. Tasks 1–3 in Futbolpedia (engine + eval) — **prove text quality before Gaffa wiring**
2. Tasks 4–6 (context bag + cache + single generate)
3. Tasks 7–9 (batch + seed + QA)
4. Task 10 (verify)
