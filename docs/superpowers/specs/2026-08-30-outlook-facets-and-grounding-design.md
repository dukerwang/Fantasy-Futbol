# Outlook facets and grounding — revision to the 2026-08-26 outlook spec

**Date:** 2026-08-30
**Status:** DRAFT — awaiting Duke's review
**Supersedes:** §2.2 (machine sidecar) and §5 (context bag) of
`2026-08-26-futbolpedia-outlook-design.md`. Everything else in that spec stands.
**Scope:** Engine and sync changes only. Still no UI — the stats page is a
separate spec that depends on this one landing.

---

## 1. Why this revision exists

The v1 pipeline shipped and generated 75 outlooks. Reading that output back
showed two problems that block any browse or filter surface built on top of it,
plus one architectural finding that shrinks the whole hallucination question.

**Decisions Duke made on 2026-08-30, which this spec records:**

- Fix the tag vocabulary and the prose voice in the engine before a full regen.
- Drop availability from the sidecar (§4.3).
- Include an explicit `dynasty_value` facet rather than deriving it (§4.2).

Everything else below is proposed, not ratified.

---

## 2. Evidence

Measured against the 75 rows in `player_outlooks` on 2026-08-30.

### 2.1 The tag vocabulary is unusable for filtering

| Measure | Value |
|---|---|
| Tag instances | 300 |
| Distinct tags | 158 |
| Tags appearing exactly once | 110 |

The cause is in the schema, not the model. `OUTLOOK_SYNTHESIS_SCHEMA` declares
`evaluation_tags` as a bare array of strings with no enum, and the synthesis
prompt asks for "2-5 short snake_case tags" with three examples. Those three
examples — `reliable_starter`, `minutes_risk`, `set_piece_routes` — are among
the most frequent tags in the data. The model anchors on them, then improvises.

The result is many spellings of one idea. Role security alone appears as
`reliable_starter`, `steady_starter`, `everyday_starter`, `undisputed_starter`,
`first_choice_starter`, `core_starter`, `secure_starter`, `durable_starter`,
`established_starter`, and `locked_starter`. Rotation appears as
`rotation_risk`, `rotational_role`, `rotational_depth`, `rotational_winger`,
`rotational_midfielder`, `rotational_creator`, `rotational_forward`,
`rotational_striker`, `rotational_minutes`, `minutes_competition`, and more.

At 432 players this becomes roughly 900 tags. Filter chips over that are noise.

### 2.2 Synthesis re-derives structure extraction already computed

`OUTLOOK_EXTRACTION_SCHEMA` returns three closed, gated fields:

```
career_phase        emerging | peak | plateau | decline_risk | unknown
pl_mobility         stable | recent_pl_arrival | linked_exit |
                    confirmed_exit | linked_pl_move | unknown
current_head_coach  verified against the factual foundation, nullable
```

None reach the sidecar. Synthesis then re-invents career phase as free text —
`prime_age`, `prime_asset`, `peak_asset`, `athletic_peak`, `peak_window`,
`peak_phase`, `emerging_prime`, `veteran_plateau`, `age_decline_risk` — nine
spellings of an enum that was clean one stage earlier.

`pl_mobility` is discarded entirely and resurfaces lossily as `transfer_risk`,
`pl_exit_risk`, `transfer_speculation`, and `transfer_uncertainty`. This is the
most Gaffa-relevant field in the pipeline, because a Premier League exit is a
roster eligibility event.

### 2.3 The voice is structurally formulaic

Across all 75 outlooks:

| Pattern | Share |
|---|---|
| Contains "fully fit" / "fully healthy" / "fully clear" | 63% |
| Opens with a fronted participial or prepositional phrase | 49% |
| Uses the verb "enters" | 36% |

The shared skeleton is *[Fronted status phrase], [Name] enters [career or
season frame] as [role]*. `BANNED_OUTLOOK_PATTERNS` cannot catch this — every
entry there is a lexical pattern, and this is syntax.

Word count is healthy: 85–104, mean 96, all inside the 70–110 target.

### 2.4 What is not wrong

- Zero head-coach drift across all 75, including the 65 older rows. The
  `managerMentions` gate works, and it is the model for the gates proposed below.
- `confidence` is a clean enum and calibrates plausibly: 64 medium, 11 high.
- `isOutlookFresh` already invalidates on context hash, pipeline version, and a
  30-day TTL. Refresh logic needs no change.

---

## 3. The grounding finding

Gaffa fetches FPL's `bootstrap-static` on every player sync and reads ten fields
off each element. The rest is discarded. Verified against the live payload on
2026-08-30 (626 elements):

```
penalties_order                        present — 20 players at order 1
direct_freekicks_order                 present
corners_and_indirect_freekicks_order   present
chance_of_playing_next_round           present — 183 players non-null
starts, minutes                        present
expected_goals / _assists / _involvements   present
selected_by_percent, form, points_per_game  present
```

FPL is free, unmetered, and authoritative for availability, minutes, and set
pieces. Gaffa also holds 1,232 `player_stats` rows for 2026-27 with per-gameweek
`minutes_played`.

**So most of the sidecar should be computed, not generated.** This is a larger
change in reliability than any prompt or gate: a computed facet cannot
hallucinate, and passing it in as a locked fact also stops the model spending
search calls rediscovering it.

The prose remains generated and still carries real risk. This finding narrows
the structured data, not the paragraph.

---

## 4. Design

### 4.1 Sidecar v2

Replace the flat `evaluation_tags` array with named facets. A closed but flat
enum would still mix "he starts every week" with "he takes corners" with "he is
33", which makes any filter UI incoherent regardless of list length.

```ts
export interface PlayerOutlookSidecar {
  // Promoted from extraction — already a closed enum, no new model surface
  pl_mobility: 'stable' | 'recent_pl_arrival' | 'linked_exit'
             | 'confirmed_exit' | 'linked_pl_move' | 'unknown';

  // Computed from Gaffa and FPL data — never generated
  career_phase: 'emerging' | 'peak' | 'plateau' | 'decline_risk' | 'unknown';
  minutes_role: 'nailed' | 'likely_starter' | 'rotation_risk' | 'fringe';
  output_profile: 'high_floor' | 'balanced' | 'boom_bust' | 'low_ceiling';
  set_pieces: ('penalties' | 'direct_free_kicks' | 'corners_wide'
             | 'aerial_target')[];
  dynasty_value: 'cornerstone' | 'long_term_hold' | 'win_now'
               | 'declining_asset';
  risk_flags: ('injury_prone' | 'contract_year' | 'minutes_competition')[];

  // Generated, bounded enum — display only, not a filter facet
  style: OutlookStyle[];

  // Unchanged
  confidence: 'high' | 'medium' | 'low';
  horizons_touched: ('near' | 'long')[];
  evidence_gaps: string[];
  generated_at: string;
  model_id: string;
  pipeline_version: string;
}
```

`career_phase` reuses extraction's enum values but is computed from
`date_of_birth` and minutes trend rather than taken from extraction output. Age
is a hard fact and phase is mostly a function of it, so there is no reason to
accept a model judgment here. Keep extraction's `career_phase` as a cross-check:
when the two disagree, log it and lower `confidence`.

`minutes_role` and `output_profile` earn their place on volume: they absorb
roughly 123 of the 300 observed tag instances into two four-value fields.

`style` stays a list because that is where the interesting content lives —
`ball_playing_cb`, `sweeper_keeper`, `inverted_fullback`, `deep_playmaker`,
`press_resistant`, `target_man`. Bound it to about 20 archetypes and render it
as chips. Keep it out of the filter row: faceting on 20 sparse values mostly
returns empty sets.

Coverage check: these facets account for roughly 284 of the 300 observed tag
instances. The remainder is noise worth losing.

### 4.2 Provenance — computed vs generated

| Facet | Source | Can it be wrong? |
|---|---|---|
| `set_pieces` | FPL `penalties_order`, `direct_freekicks_order`, `corners_and_indirect_freekicks_order` | No |
| `minutes_role` | per-gameweek `minutes_played` + FPL `starts` | No |
| `output_profile` | variance of per-gameweek points in `player_stats` | No |
| `career_phase` | `date_of_birth` + minutes trend | No |
| `dynasty_value` | age + `minutes_role` + `market_value` | No |
| `risk_flags: injury_prone` | history of `fpl_status` and minutes gaps | No |
| `risk_flags: contract_year` | search | Yes — gate it |
| `pl_mobility` | search | Yes — gate it |
| `style` | search | Yes — gate it |

Six of eight facets become deterministic. Search retains only what no free
structured source provides: tactical role, contract state, and transfer
movement.

Thresholds for the computed facets go in a single module with the numbers
documented inline, following the pattern `population.ts` already uses for the
regulars pool.

### 4.3 Availability leaves the sidecar

Nine current tags describe injury state (`injured_near_term`, `injury_doubt`,
`rehab_ramp`, `injury_recovery`, `injury_management`, and others). Availability
is already a locked fact from FPL, it changes daily, and an outlook lives 30
days. A stored availability tag is a guaranteed future contradiction.

Drop it. The page reads `fpl_status` and `chance_of_playing_next_round` live.
Keep only `injury_prone` as a durable pattern flag, computed from history.

### 4.4 Voice

The formula is syntactic, so the fix is a structural constraint rather than more
banned phrases:

1. **Forbid the dominant opening move.** Instruct synthesis not to open with a
   fitness or status clause, and not to use "enters" as the main verb of the
   first sentence. Status still gets covered — later in the paragraph, where it
   does not dictate the shape.
2. **Rotate the opening anchor.** Derive an opening angle from `player_id` —
   role, tactical function, career phase, or output pattern — so the entry point
   varies deterministically per player rather than defaulting to fitness.
3. **Add a structural gate.** Extend `bannedPhrases.ts` with a check on the
   first sentence: reject a fronted participial opener followed by name-plus-
   "enters". This is regex-checkable and gives the retry loop something concrete.
4. **Enable the jitter that already exists.** `resolveSynthesisTemperature`
   accepts `jitter` with a per-player seed, but `generateOutlook` passes
   `tempConfig?.jitter`, which is undefined by default. Turn it on. This is a
   secondary lever — temperature varies with evidence richness, not voice, so
   two well-evidenced players currently land at nearly the same temperature.

Measure the same three statistics from §2.3 after regen. Target: no single
opening pattern above roughly 20%.

### 4.5 Contradiction gate

After synthesis, check the prose against the locked numeric facts. Reject and
retry when they disagree — for example, prose calling a player a regular
starter when `starts` is 1.

This catches the failure mode that matters most once outlooks sit beside a stats
table. It also catches staleness in the *database*: one current outlook says
Curtis Jones moved to Inter Milan while `players.pl_team` still reads Liverpool.
Whichever side is stale, surfacing the disagreement is the useful behaviour, so
the gate should report both directions rather than assuming the model is wrong.

### 4.6 FPL field capture

`syncPlayers.ts` reads ten fields per element. Add the fields listed in §3.
Additive change to the sync and to the `players` table.

This is the only change outside `packages/` and `src/lib/outlook/`, and it
benefits Gaffa independently of outlooks — set-piece order and
`chance_of_playing_next_round` are useful on the player card regardless.

---

## 5. Shared-package consequence

The facet computation layer belongs in `packages/futbolpedia-engine/`, taking a
plain facts object rather than a Supabase row. Futbolpedia then inherits the
same locked-facts-first pattern, with FPL's bootstrap as its free ground truth
for Premier League players. That is a stronger case for the shared package than
the one in the original spec, which justified it only on prompt reuse.

---

## 6. Data impact

- All 75 stored outlooks are invalidated. 65 are already stale on
  `pipeline_version` (0.2.0 against a current 0.2.1), so this is not a new cost.
- Regulars pool is 432 players, of which 74 currently hold an outlook. A full
  seed is roughly 358 new generations plus 74 regenerations.
- The sidecar shape changes, so `player_outlooks.sidecar` rows written by any
  earlier version cannot be read by the new UI. Since no UI consumes them yet,
  no migration is needed — regen replaces them.
- Bump `PIPELINE_VERSION` to 0.3.0. Note `packages/futbolpedia-engine/package.json`
  reads 0.2.0 while `constants.ts` reads 0.2.1; align them.

---

## 7. Open questions

1. **`style` vocabulary.** Roughly 20 archetypes, drawn from the ~60 style tags
   already observed. Needs a pass to pick the list.
2. **`output_profile` thresholds.** Needs the variance distribution across the
   432-player pool before the cut points mean anything.
3. **Regen cost.** ~358 players times 3-4 Flash calls. Worth a token measurement
   on a 20-player sample before committing to the full batch.
4. **Does dropping searched facets reduce query count?** With set pieces and
   minutes passed in as locked facts, the 2-3 generated queries may narrow to 2.
   Cheaper, and it concentrates search on what only search can answer.

---

## 8. Success criteria

- Every facet is either a closed enum or a bounded list. No free-text tags.
- Six of eight facets are computed, with tests asserting they never come from
  model output.
- No single opening pattern exceeds roughly 20% of outlooks.
- No stored outlook contradicts the locked facts it was generated from.
- Regen of 432 players completes inside the Gemini budget, with tokens logged.
