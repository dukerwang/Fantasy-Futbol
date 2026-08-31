import type { OutlookContextBag } from '../types/outlook';

const AVAILABILITY_LABEL: Record<OutlookContextBag['availability'], string> = {
  available: 'Available',
  injured: 'Injured',
  doubtful: 'Doubtful',
  suspended: 'Suspended',
  unavailable: 'Unavailable',
  unknown: 'Unknown',
};

/** Serialize locked facts for injection before synthesis. */
export function buildLockedFactsBlock(bag: OutlookContextBag): string {
  const lines = [
    '=== LOCKED FACTS (LAW — do not contradict) ===',
    `Player ID: ${bag.player_id}`,
    `Name: ${bag.name}`,
    `Display name: ${bag.display_name}`,
    `Age: ${bag.age ?? 'unknown'}`,
    `Nationality: ${bag.nationality ?? 'unknown'}`,
    `Club: ${bag.club}`,
    `Primary position: ${bag.primary_position}`,
    `Secondary positions: ${bag.secondary_positions.length ? bag.secondary_positions.join(', ') : 'none'}`,
    `Availability: ${AVAILABILITY_LABEL[bag.availability]}`,
    `Injury / availability news: ${bag.injury_news?.trim() || 'none reported'}`,
    `Market value (EUR m): ${bag.market_value_eur_m ?? 'unknown'}`,
    `New to Premier League this season: ${bag.is_new_to_prem ? 'yes' : 'no'}`,
    `PL tenure for evaluation: ${bag.pl_tenure === 'new_to_prem' ? 'recent arrival to the Premier League' : 'established Premier League player'}`,
    `Academy eligible (U21): ${bag.academy_eligible ? 'yes' : 'no'}`,
    `Simulation date: ${bag.simulation_date}`,
    `Current season: ${bag.current_season}`,
    `Dynasty league context: ${bag.is_dynasty_league ? 'yes — multi-year asset quality matters alongside short-run role' : 'no'}`,
    '',
    '=== PREMIER LEAGUE SCOPE (GAFFA) ===',
    'This outlook is for a Premier League-only dynasty game. Leaving the PL ends roster eligibility and materially reduces asset value.',
    'If verified reports suggest an exit from the Premier League (loan abroad, transfer out, release), say so plainly.',
    'If the player recently joined the PL, note acclimation and minute-path uncertainty.',
    '',
    '=== SCORING-DATA FIREWALL ===',
    'You do NOT receive fantasy points, match ratings, or league scoring totals for this player.',
    'Do NOT infer football quality from league scoring performance you were not given.',
    'Do NOT explain or invent scoring weights, sigmoid math, or positional rating components.',
  ];

  return lines.join('\n');
}

/** Outlook-mode system instruction — scoped subset of Futbolpedia scout voice. */
export function buildOutlookSystemInstruction(): string {
  return `⚽ FUTBOLPEDIA — OUTLOOK MODE (v0.1)

PRIME DIRECTIVE
You are Futbolpedia: an elite AI football scout writing short player outlooks for managers in a private dynasty league. Your job is opinionated football evaluation grounded in verified evidence — not market advice.

UNIVERSAL RESEARCH MANDATE
- Never answer from training memory alone. Use only locked facts plus the factual foundation supplied for this turn.
- If verified search data conflicts with memory, search data wins.
- Confirm the YEAR of every match, manager, club, and injury report against the simulation date.

HEAD COACH / MANAGER LAW
- Do NOT name a head coach unless current_head_coach is set in verified_extraction from the factual foundation.
- Training memory of managers is often stale (e.g. sacked coaches still named months later). When in doubt, omit the manager and describe role and usage without naming a coach.
- Never mix coaches from different eras in one outlook.

PREMIER LEAGUE MOBILITY
- Gaffa rosters Premier League players only. PL exit = asset becomes unusable; PL entry = new acquisition opportunity.
- When pl_mobility is linked_exit or confirmed_exit, address near-term availability risk and dynasty value impact without trade advice.
- When pl_mobility is recent_pl_arrival or linked_pl_move, note adaptation and minute-path uncertainty.

VOICE
- Sharp, professional, specific. Futbolpedia individuality — two outlooks must not read like the same template.

OPENING LAW (the previous run failed this)
- Across 75 outlooks, 63% said "fully fit", 49% opened with a fronted participial phrase, and 36% used "enters". Individually fine; read four in a row and they are one template.
- Do NOT open with fitness or availability. Health belongs later in the paragraph, where it does not dictate the shape.
- Do NOT open with a participial or prepositional phrase before the subject ("Operating as...", "Fresh off...", "Following his...", "Fully fit after...").
- Do NOT use "enters" as the main verb of the first sentence.
- Do NOT open with the club's name. The outlook is about the player; he is the subject of the first sentence, not his employer. "Arsenal's right wing runs through Saka" is the failure — "Saka isolates full-backs and cuts inside onto his left foot" is the fix.
- Open on the angle you are given below, with the player as the subject.
- Banned words: "Languid", "Biomechanically", "Mercurial".
- Banned phrases: "silenced skeptics", "defied skeptics", "silenced doubters".

COVERAGE BRIEF (invisible — satisfy in flowing prose, any order)
1. Status — health and availability in plain language
2. Role — squad usage, set pieces, competition for minutes, tactical position
3. Expectation — what managers can realistically expect week to week (floor, volatility, how value shows up)
4. Career point — age and phase (emerging, peak, plateau, decline risk)
5. Horizon — short-run and longer-run view in the same breath, without labeling them
6. Evaluation — your scout read on the asset: reliability, upside, volatility, dynasty durability

FORM VS CLASS
- Distinguish temporary form from underlying class. Do not treat a hot scoring run or cold spell as proof of a changed footballer.
- Injury affects availability narrative, not permanent talent judgment, unless evidence shows lasting decline.

HALLUCINATION & STAT RULES (Protocols E, L, M)
- Do not cite specific matches, opponents, scores, or quotes unless present in locked facts or verified_facts.
- Do not write stat-based superlatives ("prolific", "clinical", "world-class") without a verified number or event in the foundation.
- If data is thin, hedge honestly — omit the claim rather than inventing it.
- When data_gaps exist, confidence must not be "high".

HARD BANS IN USER-FACING OUTLOOK TEXT
- Buy / hold / sell / monitor / target / fade / strong buy / avoid
- "In Gaffa", "in Gaffa terms", "for fantasy managers", "from an FPL perspective"
- Stock openings: "Nailed starter who…", "From a dynasty perspective…"
- Using fantasy points or match ratings as evidence of football quality
- Explaining private league scoring mechanics

ALLOWED
- Scout judgments: steady starter, volatile weekly scorer, low-ceiling defensive floor, developmental asset, minutes risk, set-piece dependent
- Mentioning exact tactical positions when relevant to role (CB, DM, AM, etc.)

OUTPUT SHAPE
- One paragraph, roughly 70–110 words, prose only — no headings, no bullet lists in outlook text.`;
}

/** User prompt for synthesis stage — extraction + foundation inlined. */
export function buildOutlookSynthesisPrompt(params: {
  lockedFacts: string;
  computedFacts: string;
  factualFoundation: string;
  extractionJson: string;
  openingAngle: string;
}): string {
  return `${params.lockedFacts}

${params.computedFacts}

<factual_foundation>
${params.factualFoundation}
</factual_foundation>

<verified_extraction>
${params.extractionJson}
</verified_extraction>

Task: Write one Futbolpedia player outlook paragraph per the system instruction.

OPENING ANGLE FOR THIS PLAYER: ${params.openingAngle}
Begin the paragraph on that angle. Cover health somewhere later, not first.

Rules:
- Weave status, role, expectation, career point, short and long horizon, and your evaluation into flowing prose.
- Do NOT give buy/hold/sell advice.
- Only name the head coach if verified_extraction.current_head_coach is non-null; otherwise describe tactical role without naming a coach.
- If verified_extraction.pl_mobility indicates exit from the Premier League, address roster eligibility risk plainly.
- If extraction.data_gaps is non-empty, hedge or omit uncertain claims; set sidecar.confidence to "medium" or "low".
- sidecar.horizons_touched must include both "near" and "long" when you successfully cover both; otherwise list only what you covered.
- sidecar.evidence_gaps: copy unresolved data_gaps from extraction that affected the outlook.

SIDECAR JUDGMENTS — you decide each of these, they are not calculated for you:
- sidecar.quality: how good he is AT HIS POSITION. elite = among the best in the league in his role; high = clearly above average; solid = a competent starter; squad = depth. Judge a defender on defending and a goalkeeper on goalkeeping. A low expected-goal-involvement rank is normal for them and is NOT evidence of low quality.
- sidecar.minutes_role: how securely he holds a starting place when fit. Use the measured playing record, but override it when the evidence says his standing has changed — a new signing, a manager change, a return from injury into a settled side.
- sidecar.career_phase: emerging, peak, plateau or decline_risk. Positions age differently; centre-backs and goalkeepers mature late, wide attackers earlier.
- sidecar.dynasty_value: multi-year worth in a league you can never re-draft. cornerstone, long_term_hold, win_now, declining_asset.
- sidecar.pl_mobility: copy the verified extraction value unless the foundation contradicts it.
- sidecar.risk_flags: only what the evidence supports.
- sidecar.style: up to three archetypes from the supplied list, describing how he plays.`;
}

/** User prompt for query generation stage. */
export function buildOutlookQueryGenPrompt(bag: OutlookContextBag): string {
  return `Generate 2–3 targeted Google Search queries to research a current-season player outlook.

Player: ${bag.display_name}
Club: ${bag.club}
Position: ${bag.primary_position}${bag.secondary_positions.length ? ` (also ${bag.secondary_positions.join(', ')})` : ''}
Season: ${bag.current_season}
Simulation date: ${bag.simulation_date}
Availability: ${bag.availability}${bag.injury_news ? ` — ${bag.injury_news}` : ''}

Focus queries on:
- Current availability and fitness
- Squad role, minutes, set pieces, competition
- Recent tactical deployment and usage patterns
- Career phase context (age ${bag.age ?? 'unknown'})

Do NOT search for fantasy points, FPL ownership, or video-game ratings.
Return JSON: { "queries": string[] } with exactly 2 or 3 strings.`;
}

/** User prompt for extraction stage. */
export function buildOutlookExtractionPrompt(params: {
  lockedFacts: string;
  factualFoundation: string;
}): string {
  return `${params.lockedFacts}

<factual_foundation>
${params.factualFoundation}
</factual_foundation>

Task: Distill the foundation into structured facts for outlook synthesis.

Rules:
- verified_facts: bullet facts explicitly supported by the foundation (no training-memory additions)
- status_summary: plain-language availability/health
- role_summary: how he is used in the squad
- career_phase: emerging | peak | plateau | decline_risk | unknown
- current_head_coach: full name ONLY if the foundation confirms who manages the player's club as of the simulation date; otherwise null
- pl_mobility: stable | recent_pl_arrival | linked_exit | confirmed_exit | linked_pl_move | unknown
- mobility_summary: plain-language note on Premier League roster stability (staying, leaving, newly arrived, linked move)
- data_gaps: what you could not verify
- conflicting_reports: sources that disagree (empty array if none)

Manager rule: if sources disagree on the head coach or cite a sacked manager without confirming the current appointment, set current_head_coach to null and note the conflict.

Do NOT infer football quality from fantasy scoring — none was provided.`;
}
