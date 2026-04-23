import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * Supabase Edge Function — sync-ratings
 *
 * Fetches FPL live stats for a gameweek, calculates position-fair match
 * ratings for every player, and batch-upserts results into player_stats.
 *
 * Triggered via:
 *   - pg_cron + pg_net  (scheduled)
 *   - POST from the Next.js dashboard (manual trigger)
 *
 * Body: { "gameweek": number }   (0 = auto-detect current GW)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ════════════════════════════════════════════════════════════════════════════
// Types  (inlined — Edge Functions can't import from the Next.js src tree)
// ════════════════════════════════════════════════════════════════════════════

type GranularPosition =
    | "GK" | "CB" | "LB" | "RB"
    | "DM" | "CM" | "LM" | "RM" | "AM"
    | "LW" | "RW" | "ST";

type PositionGroup = "GK" | "DEF" | "MID" | "ATT";

type RatingComponent =
    | "match_impact" | "influence" | "creativity" | "threat"
    | "defensive" | "goal_involvement" | "finishing" | "save_score";

interface ComponentRefStats { median: number; stddev: number; }
type ReferenceStats = Record<RatingComponent, ComponentRefStats>;

interface RawStats {
    minutes_played: number;
    goals: number;
    assists: number;
    saves: number;
    goals_conceded: number;
    penalty_saves: number;
    yellow_cards: number;
    red_cards: number;
    own_goals: number;
    penalties_missed: number;
    clean_sheet: boolean;
    bps: number;
    influence: number;
    creativity: number;
    threat: number;
    ict_index: number;
    expected_goals: number;
    expected_assists: number;
    expected_goals_conceded: number;
    // Legacy fields (zeroed — not available from FPL live)
    shots_total: number;
    shots_on_target: number;
    passes_total: number;
    passes_accurate: number;
    pass_completion_pct: number;
    key_passes: number;
    big_chances_created: number;
    dribbles_attempted: number;
    dribbles_successful: number;
    tackles_total: number;
    tackles_won: number;
    interceptions: number;
    clearances: number;
    blocks: number;
    // FPL granular defensive stats (from live API)
    fpl_tackles: number;
    fpl_cbi: number;       // clearances_blocks_interceptions
    fpl_recoveries: number;
}

interface RatingBreakdownItem {
    component: string;
    key: RatingComponent;
    score: number;
    weight: number;
    weighted: number;
    detail: string;
}

interface MatchRating {
    rating: number;
    fantasyPoints: number;
    position: GranularPosition;
    breakdown: RatingBreakdownItem[];
}

// ════════════════════════════════════════════════════════════════════════════
// Position Weights  (must stay in sync with src/lib/scoring/matchRating.ts)
// ════════════════════════════════════════════════════════════════════════════

const FLEX_CONFIG: Record<string, { flex: number; components: RatingComponent[] }> = {
    GK: { flex: 0.20, components: ['save_score', 'defensive'] },
    CB: { flex: 0.25, components: ['defensive', 'match_impact', 'goal_involvement'] },
    LB: { flex: 0.25, components: ['creativity', 'match_impact', 'defensive'] },
    RB: { flex: 0.25, components: ['creativity', 'match_impact', 'defensive'] },
    DM: { flex: 0.25, components: ['match_impact', 'influence', 'goal_involvement'] },
    CM: { flex: 0.25, components: ['match_impact', 'creativity', 'influence'] },
    LM: { flex: 0.10, components: ['goal_involvement', 'creativity', 'influence'] },
    RM: { flex: 0.10, components: ['goal_involvement', 'creativity', 'influence'] },
    AM: { flex: 0.25, components: ['creativity', 'goal_involvement', 'finishing'] },
    LW: { flex: 0.15, components: ['goal_involvement', 'finishing', 'threat'] },
    RW: { flex: 0.15, components: ['goal_involvement', 'finishing', 'threat'] },
    ST: { flex: 0.25, components: ['threat', 'goal_involvement', 'finishing'] },
};

const POSITION_WEIGHTS: Record<string, Record<RatingComponent, number>> = {
    GK: { match_impact: 0.25, influence: 0.20, creativity: 0.05, threat: 0.00, defensive: 0.15, goal_involvement: 0.00, finishing: 0.00, save_score: 0.10 },
    CB: { match_impact: 0.30, influence: 0.05, creativity: 0.05, threat: 0.00, defensive: 0.10, goal_involvement: 0.20, finishing: 0.05, save_score: 0.00 },
    LB: { match_impact: 0.20, influence: 0.10, creativity: 0.15, threat: 0.05, defensive: 0.10, goal_involvement: 0.15, finishing: 0.00, save_score: 0.00 },
    RB: { match_impact: 0.20, influence: 0.10, creativity: 0.15, threat: 0.05, defensive: 0.10, goal_involvement: 0.15, finishing: 0.00, save_score: 0.00 },
    DM: { match_impact: 0.30, influence: 0.25, creativity: 0.05, threat: 0.00, defensive: 0.10, goal_involvement: 0.05, finishing: 0.00, save_score: 0.00 },
    CM: { match_impact: 0.20, influence: 0.15, creativity: 0.15, threat: 0.10, defensive: 0.05, goal_involvement: 0.10, finishing: 0.00, save_score: 0.00 },
    LM: { match_impact: 0.10, influence: 0.10, creativity: 0.10, threat: 0.10, defensive: 0.10, goal_involvement: 0.30, finishing: 0.10, save_score: 0.00 },
    RM: { match_impact: 0.10, influence: 0.10, creativity: 0.10, threat: 0.10, defensive: 0.10, goal_involvement: 0.30, finishing: 0.10, save_score: 0.00 },
    AM: { match_impact: 0.15, influence: 0.15, creativity: 0.25, threat: 0.15, defensive: 0.00, goal_involvement: 0.15, finishing: 0.00, save_score: 0.00 },
    LW: { match_impact: 0.10, influence: 0.10, creativity: 0.05, threat: 0.05, defensive: 0.10, goal_involvement: 0.25, finishing: 0.25, save_score: 0.00 },
    RW: { match_impact: 0.10, influence: 0.10, creativity: 0.05, threat: 0.05, defensive: 0.10, goal_involvement: 0.25, finishing: 0.25, save_score: 0.00 },
    ST: { match_impact: 0.10, influence: 0.10, creativity: 0.05, threat: 0.25, defensive: 0.00, goal_involvement: 0.15, finishing: 0.10, save_score: 0.00 },
};

// ════════════════════════════════════════════════════════════════════════════
// Rating Engine  (inlined from matchRating.ts)
// ════════════════════════════════════════════════════════════════════════════

const SIGMOID_K = 1.0;

function sigmoidNormalize(value: number, median: number, stddev: number): number {
    if (stddev <= 0) return 0.5;
    return 1 / (1 + Math.exp(-SIGMOID_K * (value - median) / stddev));
}

function getPositionGroup(pos: GranularPosition): PositionGroup {
    if (pos === "GK") return "GK";
    if (pos === "CB" || pos === "LB" || pos === "RB") return "DEF";
    if (pos === "DM" || pos === "CM" || pos === "LM" || pos === "RM" || pos === "AM") return "MID";
    return "ATT";
}

const COMPONENT_DISPLAY: Record<RatingComponent, string> = {
    match_impact: "Match Impact", influence: "Influence", creativity: "Creativity",
    threat: "Threat", defensive: "Defensive",
    goal_involvement: "Goal Involvement", finishing: "Finishing", save_score: "Save Score",
};

function calculateMatchRating(
    stats: RawStats,
    position: GranularPosition,
    refStats: Record<string, ReferenceStats>,
): MatchRating {
    if (stats.minutes_played === 0) {
        return { rating: 0, fantasyPoints: 0, position, breakdown: [] };
    }

    const posGroup = getPositionGroup(position);
    // Use granular position ref stats, fall back to position group
    const ref = refStats[position] ?? refStats[posGroup];

    // ── Step 1: Compute component scores (0-1) ────────────────────────────

    // 1. Match Impact (BPS adjusted to remove goal/assist contribution)
    const rawBps = stats.bps ?? 0;
    const adjustedBps = Math.max(0, rawBps - stats.goals * 12 - stats.assists * 9);
    const matchImpactScore = sigmoidNormalize(adjustedBps, ref.match_impact.median, ref.match_impact.stddev);

    // 2. Influence
    const inflScore = sigmoidNormalize(stats.influence ?? 0, ref.influence.median, ref.influence.stddev);

    // 3. Creativity
    const creaScore = sigmoidNormalize(stats.creativity ?? 0, ref.creativity.median, ref.creativity.stddev);

    // 4. Threat
    const thrScore = sigmoidNormalize(stats.threat ?? 0, ref.threat.median, ref.threat.stddev);

    // 5. Defensive (tackle curve + CB CBI nerf + recoveries)
    const gc = stats.goals_conceded;
    const xgc = stats.expected_goals_conceded ?? 0;
    const csBonus = (stats.clean_sheet && stats.minutes_played >= 60) ? 12 : 0;
    const xgcOutperf = Math.max(0, xgc - gc) * 5;
    const gcPenalty = Math.max(0, gc - xgc) * 5;
    const tackleCurve = Math.pow(Math.max(0, stats.fpl_tackles ?? 0), 0.85) * 1.8;
    const cbiMultiplier = position === "CB" ? 0.5 : 1.5;
    const defActionsRaw = tackleCurve + (stats.fpl_cbi ?? 0) * cbiMultiplier + (stats.fpl_recoveries ?? 0) * 0.5;
    const defScore = sigmoidNormalize(defActionsRaw + csBonus + xgcOutperf - gcPenalty, ref.defensive.median, ref.defensive.stddev);



    // 7. Goal Involvement
    const g = stats.goals;
    const a = stats.assists;
    const giScore = sigmoidNormalize(g * 6 + a * 4, ref.goal_involvement.median, ref.goal_involvement.stddev);

    // 7. Finishing (clamped linear — sparse data makes sigmoid unreliable)
    const xgOut = g - (stats.expected_goals ?? 0);
    const xaOut = a - (stats.expected_assists ?? 0);
    const finScore = Math.max(0, Math.min(1, 0.5 + xgOut * 0.3 + xaOut * 0.15));

    // 8. Save Score (GK only)
    let savScore = 0.5;
    if (posGroup === "GK") {
        const saveRaw = stats.saves * 2 + stats.penalty_saves * 5 - Math.max(0, gc - xgc) * 2;
        savScore = sigmoidNormalize(saveRaw, ref.save_score.median, ref.save_score.stddev);
    }

    const scores: Record<RatingComponent, { score: number; detail: string }> = {
        match_impact: { score: matchImpactScore, detail: `BPS: ${rawBps} (adj: ${adjustedBps})` },
        influence: { score: inflScore, detail: `${(stats.influence ?? 0).toFixed(1)}` },
        creativity: { score: creaScore, detail: `${(stats.creativity ?? 0).toFixed(1)}` },
        threat: { score: thrScore, detail: `${(stats.threat ?? 0).toFixed(1)}` },
        defensive: { score: defScore, detail: stats.clean_sheet ? `CS, ${gc} vs ${xgc.toFixed(1)} xGC` : `${gc} vs ${xgc.toFixed(1)} xGC` },

        goal_involvement: { score: giScore, detail: g > 0 || a > 0 ? `${g}G ${a}A` : "—" },
        finishing: { score: finScore, detail: `${xgOut >= 0 ? "+" : ""}${xgOut.toFixed(2)} xG` },
        save_score: { score: savScore, detail: posGroup === "GK" ? `${stats.saves} saves` : "—" },
    };

    // ── Step 2: Weighted composite ────────────────────────────────────────

    const weights = POSITION_WEIGHTS[position] || POSITION_WEIGHTS.CM;
    const flexConfig = FLEX_CONFIG[position] || FLEX_CONFIG.CM;
    let composite = 0;
    const breakdown: RatingBreakdownItem[] = [];

    let maxScore = -1;
    let maxComponent = '';
    for (const key of flexConfig.components) {
        if (scores[key as RatingComponent].score > maxScore) {
            maxScore = scores[key as RatingComponent].score;
            maxComponent = key;
        }
    }

    for (const key of Object.keys(weights) as RatingComponent[]) {
        let w = weights[key];
        if (key === maxComponent) w += flexConfig.flex;

        if (w === 0) continue;

        const { score, detail } = scores[key];
        const weighted = score * w;
        composite += weighted;
        breakdown.push({ component: COMPONENT_DISPLAY[key], key, score, weight: w, weighted, detail });
    }

    composite = Math.min(1.0, Math.max(0, composite));

    // ── Step 3: Linear map → 1.0-10.0 + soft minutes penalty ─────────────

    let rating = 1.0 + 9.0 * composite;
    if (stats.minutes_played < 60) {
        rating = Math.max(1.0, rating - (1 - stats.minutes_played / 60) * 1.5);
    }
    rating = Math.max(1.0, Math.min(10.0, rating));

    // ── Step 4: Curve → fantasy points ────────────────────────────────────

    const basePoints = 4.0;
    const scale = 5.0;
    const minutePenalty = stats.minutes_played < 60 ? 1.0 : 0;

    const curveRaw = Math.pow(Math.max(0, rating - 4.0) / 2.0, 1.5);
    let fp = basePoints + (scale * curveRaw) - minutePenalty;

    if (rating < 3.0) {
        fp -= 2.0;
    }
    fp = Math.max(0, fp);

    return {
        rating: Math.round(rating * 100) / 100,
        fantasyPoints: Math.round(fp * 100) / 100,
        position,
        breakdown,
    };
}

// ════════════════════════════════════════════════════════════════════════════
// FPL Live Data Fetcher
// ════════════════════════════════════════════════════════════════════════════

const FPL_BASE = "https://fantasy.premierleague.com/api";

interface FplLiveElement {
    id: number;
    stats: {
        minutes: number;
        goals_scored: number;
        assists: number;
        clean_sheets: number;
        goals_conceded: number;
        own_goals: number;
        penalties_saved: number;
        penalties_missed: number;
        yellow_cards: number;
        red_cards: number;
        saves: number;
        bonus: number;
        bps: number;
        influence: string;
        creativity: string;
        threat: string;
        ict_index: string;
        expected_goals: string;
        expected_assists: string;
        expected_goals_conceded: string;
        // Granular defensive stats
        tackles: number;
        clearances_blocks_interceptions: number;
        recoveries: number;
    };
}

function mapFplToRawStats(s: FplLiveElement["stats"]): RawStats {
    return {
        minutes_played: s.minutes,
        goals: s.goals_scored,
        assists: s.assists,
        saves: s.saves,
        goals_conceded: s.goals_conceded,
        penalty_saves: s.penalties_saved,
        yellow_cards: s.yellow_cards,
        red_cards: s.red_cards,
        own_goals: s.own_goals,
        penalties_missed: s.penalties_missed,
        clean_sheet: s.clean_sheets > 0,
        bps: s.bps,
        influence: parseFloat(s.influence) || 0,
        creativity: parseFloat(s.creativity) || 0,
        threat: parseFloat(s.threat) || 0,
        ict_index: parseFloat(s.ict_index) || 0,
        expected_goals: parseFloat(s.expected_goals) || 0,
        expected_assists: parseFloat(s.expected_assists) || 0,
        expected_goals_conceded: parseFloat(s.expected_goals_conceded) || 0,
        // Legacy fields (not available from FPL live)
        shots_total: 0, shots_on_target: 0,
        passes_total: 0, passes_accurate: 0, pass_completion_pct: 0,
        key_passes: 0, big_chances_created: 0,
        dribbles_attempted: 0, dribbles_successful: 0,
        tackles_total: 0, tackles_won: 0, interceptions: 0,
        clearances: 0, blocks: 0,
        // FPL granular defensive stats
        fpl_tackles: s.tackles ?? 0,
        fpl_cbi: s.clearances_blocks_interceptions ?? 0,
        fpl_recoveries: s.recoveries ?? 0,
    };
}

/** Auto-detect current gameweek from FPL bootstrap-static. */
async function detectCurrentGameweek(): Promise<number> {
    const res = await fetch(`${FPL_BASE}/bootstrap-static/`, {
        headers: { "User-Agent": "FantasyFutbol/1.0" },
    });
    if (!res.ok) throw new Error(`FPL bootstrap error: ${res.status}`);
    const data = await res.json();
    const current = (data.events as { id: number; is_current: boolean }[])
        .find((e) => e.is_current);
    if (!current) throw new Error("Could not detect current gameweek");
    return current.id;
}

// ════════════════════════════════════════════════════════════════════════════
// Reference Stats Loader
// ════════════════════════════════════════════════════════════════════════════

// Default reference stats per granular position (fallback if DB is empty)
const DEFAULT_REF: Record<string, ReferenceStats> = {
    GK: { match_impact: { median: 14, stddev: 9.3 }, influence: { median: 21.8, stddev: 14.28 }, creativity: { median: 0, stddev: 3.17 }, threat: { median: 0, stddev: 1.51 }, defensive: { median: 0.2, stddev: 2.8 }, goal_involvement: { median: 0, stddev: 0.48 }, finishing: { median: 0, stddev: 1 }, save_score: { median: 6, stddev: 4.03 } },
    CB: { match_impact: { median: 12, stddev: 8.72 }, influence: { median: 18.2, stddev: 11.82 }, creativity: { median: 1.8, stddev: 10.6 }, threat: { median: 2, stddev: 9.81 }, defensive: { median: 0.2, stddev: 2.8 }, goal_involvement: { median: 0, stddev: 1.59 }, finishing: { median: 0, stddev: 1 }, save_score: { median: 0, stddev: 0.92 } },
    LB: { match_impact: { median: 10, stddev: 9.12 }, influence: { median: 14.8, stddev: 11.2 }, creativity: { median: 10.3, stddev: 14.04 }, threat: { median: 4, stddev: 9.59 }, defensive: { median: 0.2, stddev: 2.8 }, goal_involvement: { median: 0, stddev: 1.7 }, finishing: { median: -0.01, stddev: 1 }, save_score: { median: 0, stddev: 1 } },
    RB: { match_impact: { median: 12, stddev: 9.3 }, influence: { median: 14.2, stddev: 11.53 }, creativity: { median: 9.5, stddev: 12.92 }, threat: { median: 2, stddev: 8.06 }, defensive: { median: 0.2, stddev: 2.8 }, goal_involvement: { median: 0, stddev: 1.82 }, finishing: { median: 0, stddev: 1 }, save_score: { median: 0, stddev: 1 } },
    DM: { match_impact: { median: 12, stddev: 6.54 }, influence: { median: 13, stddev: 12.62 }, creativity: { median: 10.1, stddev: 13.09 }, threat: { median: 2, stddev: 10.22 }, defensive: { median: 0.2, stddev: 2.8 }, goal_involvement: { median: 0, stddev: 1.95 }, finishing: { median: -0.01, stddev: 1 }, save_score: { median: 0, stddev: 1.36 } },
    CM: { match_impact: { median: 11, stddev: 6.69 }, influence: { median: 12.2, stddev: 15.78 }, creativity: { median: 14.2, stddev: 17.75 }, threat: { median: 8, stddev: 14.92 }, defensive: { median: 0.2, stddev: 2.8 }, goal_involvement: { median: 0, stddev: 2.76 }, finishing: { median: -0.01, stddev: 0.11 }, save_score: { median: 0, stddev: 1 } },
    LM: { match_impact: { median: 10, stddev: 7.07 }, influence: { median: 10.2, stddev: 17.61 }, creativity: { median: 16.3, stddev: 16.71 }, threat: { median: 15, stddev: 17.83 }, defensive: { median: 0.2, stddev: 2.8 }, goal_involvement: { median: 0, stddev: 3.17 }, finishing: { median: -0.02, stddev: 0.13 }, save_score: { median: 0, stddev: 1 } },
    RM: { match_impact: { median: 9, stddev: 7.01 }, influence: { median: 11, stddev: 19.08 }, creativity: { median: 15.1, stddev: 15.22 }, threat: { median: 16, stddev: 20.49 }, defensive: { median: 0.2, stddev: 2.8 }, goal_involvement: { median: 0, stddev: 3.47 }, finishing: { median: -0.01, stddev: 0.13 }, save_score: { median: 0, stddev: 1 } },
    AM: { match_impact: { median: 10, stddev: 7.47 }, influence: { median: 12, stddev: 19.4 }, creativity: { median: 15.9, stddev: 17.88 }, threat: { median: 10, stddev: 16.43 }, defensive: { median: 0.2, stddev: 2.8 }, goal_involvement: { median: 0, stddev: 3.46 }, finishing: { median: -0.01, stddev: 0.13 }, save_score: { median: 0, stddev: 1.04 } },
    LW: { match_impact: { median: 10, stddev: 7.46 }, influence: { median: 10.6, stddev: 19.21 }, creativity: { median: 15.95, stddev: 16.7 }, threat: { median: 19.5, stddev: 18.5 }, defensive: { median: 0.2, stddev: 2.8 }, goal_involvement: { median: 0, stddev: 3.69 }, finishing: { median: -0.02, stddev: 0.15 }, save_score: { median: 0, stddev: 1 } },
    RW: { match_impact: { median: 9, stddev: 7.45 }, influence: { median: 11.8, stddev: 19.08 }, creativity: { median: 16.3, stddev: 17.59 }, threat: { median: 19, stddev: 18.11 }, defensive: { median: 0.2, stddev: 2.8 }, goal_involvement: { median: 0, stddev: 3.48 }, finishing: { median: -0.01, stddev: 0.14 }, save_score: { median: 0, stddev: 1 } },
    ST: { match_impact: { median: 6, stddev: 9.22 }, influence: { median: 8.2, stddev: 21.49 }, creativity: { median: 10.8, stddev: 11.29 }, threat: { median: 21, stddev: 22.13 }, defensive: { median: 0.2, stddev: 2.8 }, goal_involvement: { median: 0, stddev: 3.92 }, finishing: { median: -0.02, stddev: 0.15 }, save_score: { median: 0, stddev: 1 } },
};

async function loadReferenceStats(
    // deno-lint-ignore no-explicit-any
    supabase: any,
    season: string,
): Promise<Record<string, ReferenceStats>> {
    const { data, error } = await supabase
        .from("rating_reference_stats")
        .select("position_group, component, median, stddev")
        .eq("season", season);

    if (error || !data || data.length === 0) {
        console.warn("No reference stats found in DB, using defaults");
        return DEFAULT_REF;
    }

    // Build from DB rows, falling back to defaults for missing entries
    const ref = structuredClone(DEFAULT_REF);
    for (const row of data as { position_group: string; component: string; median: number; stddev: number }[]) {
        const pos = row.position_group; // Now stores granular position (GK, CB, RB, etc.)
        const comp = row.component as RatingComponent;
        if (ref[pos] && ref[pos][comp]) {
            ref[pos][comp] = { median: Number(row.median), stddev: Number(row.stddev) };
        }
    }
    return ref;
}

// ════════════════════════════════════════════════════════════════════════════
// Rolling Reference Stats Update
// ════════════════════════════════════════════════════════════════════════════

// Rolling updates removed; using static reference stats from DB.

// ════════════════════════════════════════════════════════════════════════════
// Main Handler
// ════════════════════════════════════════════════════════════════════════════

Deno.serve(async (req: Request) => {
    try {
        // ── Parse request ───────────────────────────────────────────────────
        const { gameweek: gwInput } = await req.json().catch(() => ({ gameweek: 0 }));
        const gw: number = gwInput || await detectCurrentGameweek();

        console.log(`sync-ratings: processing GW ${gw}`);

        // ── Init Supabase client ────────────────────────────────────────────
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const supabase = createClient(supabaseUrl, serviceKey);

        const season = "2025-26";

        // ── Load reference stats ────────────────────────────────────────────
        const refStats = await loadReferenceStats(supabase, season);

        // ── Fetch FPL live data ─────────────────────────────────────────────
        const fplRes = await fetch(`${FPL_BASE}/event/${gw}/live/`, {
            headers: { "User-Agent": "FantasyFutbol/1.0" },
        });
        if (!fplRes.ok) {
            return new Response(JSON.stringify({ error: `FPL live error: ${fplRes.status}` }), {
                status: 502,
                headers: { "Content-Type": "application/json" },
            });
        }

        const fplData = await fplRes.json();
        const elements = (fplData.elements ?? []) as FplLiveElement[];
        console.log(`sync-ratings: ${elements.length} players from FPL`);

        // ── Fetch fixtures for DGW detection ───────────────────────────────
        const fixturesRes = await fetch(`${FPL_BASE}/fixtures/?event=${gw}`, {
            headers: { "User-Agent": "FantasyFutbol/1.0" },
        });
        const fixtures = await fixturesRes.json();
        const teamFixtures: Record<number, number[]> = {};
        fixtures.forEach((f: any) => {
            if (!teamFixtures[f.team_h]) teamFixtures[f.team_h] = [];
            if (!teamFixtures[f.team_a]) teamFixtures[f.team_a] = [];
            teamFixtures[f.team_h].push(f.id);
            teamFixtures[f.team_a].push(f.id);
        });

        // ── Build FPL ID → DB player lookup (single query) ──────────────────
        // Note: we fetch ALL players now to handle DGW/DNP rows
        const { data: dbPlayers, error: dbError } = await supabase
            .from("players")
            .select("id, fpl_id, pl_team_id, primary_position");

        if (dbError) {
            return new Response(JSON.stringify({ error: "DB player lookup failed", detail: dbError.message }), {
                status: 500,
                headers: { "Content-Type": "application/json" },
            });
        }

        const playerMap = new Map<number, { id: string; pl_team_id: number; primary_position: GranularPosition }>();
        for (const p of dbPlayers ?? []) {
            playerMap.set(p.fpl_id, { id: p.id, pl_team_id: p.pl_team_id, primary_position: p.primary_position as GranularPosition });
        }

        // ── Process all players ──────────────────────────────────────────────
        const upsertRows: Record<string, unknown>[] = [];

        for (const el of elements) {
            const dbPlayer = playerMap.get(el.id);
            if (!dbPlayer) continue;

            const playerFixIds = teamFixtures[dbPlayer.pl_team_id || 0] || [];

            if (el.explain && el.explain.length > 0) {
                for (const ex of el.explain) {
                    const fixtureId = ex.fixture;
                    const fixtureMinutes = ex.stats.find((s: any) => s.identifier === "minutes")?.value ?? 0;
                    const totalMinutes = el.stats.minutes || 1;
                    const ratio = fixtureMinutes / totalMinutes;

                    const fixtureFplStats = {
                        ...el.stats,
                        minutes: fixtureMinutes,
                        goals_scored: ex.stats.find((s: any) => s.identifier === "goals_scored")?.value ?? 0,
                        assists: ex.stats.find((s: any) => s.identifier === "assists")?.value ?? 0,
                        clean_sheets: ex.stats.find((s: any) => s.identifier === "clean_sheets")?.value ?? 0,
                        goals_conceded: ex.stats.find((s: any) => s.identifier === "goals_conceded")?.value ?? 0,
                        saves: ex.stats.find((s: any) => s.identifier === "saves")?.value ?? 0,
                        penalties_saved: ex.stats.find((s: any) => s.identifier === "penalties_saved")?.value ?? 0,
                        penalties_missed: ex.stats.find((s: any) => s.identifier === "penalties_missed")?.value ?? 0,
                        yellow_cards: ex.stats.find((s: any) => s.identifier === "yellow_cards")?.value ?? 0,
                        red_cards: ex.stats.find((s: any) => s.identifier === "red_cards")?.value ?? 0,
                        bonus: ex.stats.find((s: any) => s.identifier === "bonus")?.value ?? 0,
                        bps: ex.stats.find((s: any) => s.identifier === "bps")?.value ?? 0,
                        // Distribute non-point stats
                        influence: (parseFloat(el.stats.influence) * ratio).toFixed(1),
                        creativity: (parseFloat(el.stats.creativity) * ratio).toFixed(1),
                        threat: (parseFloat(el.stats.threat) * ratio).toFixed(1),
                        ict_index: (parseFloat(el.stats.ict_index) * ratio).toFixed(1),
                        expected_goals: (parseFloat(el.stats.expected_goals) * ratio).toFixed(2),
                        expected_assists: (parseFloat(el.stats.expected_assists) * ratio).toFixed(2),
                        expected_goals_conceded: (parseFloat(el.stats.expected_goals_conceded) * ratio).toFixed(2),
                        // Defensive granular
                        tackles: Math.round((el.stats.tackles ?? 0) * ratio),
                        clearances_blocks_interceptions: Math.round((el.stats.clearances_blocks_interceptions ?? 0) * ratio),
                        recoveries: Math.round((el.stats.recoveries ?? 0) * ratio),
                    };

                    const rawStats = mapFplToRawStats(fixtureFplStats as any);
                    const result = calculateMatchRating(rawStats, dbPlayer.primary_position, refStats);

                    upsertRows.push({
                        player_id: dbPlayer.id,
                        match_id: fixtureId,
                        gameweek: gw,
                        season,
                        stats: rawStats,
                        fantasy_points: result.fantasyPoints,
                        match_rating: result.rating,
                    });
                }
            } else {
                // Fallback for DNPs
                const fixtureId = playerFixIds[0] || (gw * 1000 + el.id);
                const rawStats = mapFplToRawStats(el.stats);
                const result = calculateMatchRating(rawStats, dbPlayer.primary_position, refStats);

                upsertRows.push({
                    player_id: dbPlayer.id,
                    match_id: fixtureId,
                    gameweek: gw,
                    season,
                    stats: rawStats,
                    fantasy_points: result.fantasyPoints,
                    match_rating: result.rating,
                });
            }
        }

        // ── Batch upsert in chunks of 100 ───────────────────────────────────
        let saved = 0;
        for (let i = 0; i < upsertRows.length; i += 100) {
            const chunk = upsertRows.slice(i, i + 100);
            const { error: upsertErr, count } = await supabase
                .from("player_stats")
                .upsert(chunk, { onConflict: "player_id,match_id", count: "exact" });

            if (upsertErr) {
                console.error(`Upsert error at chunk ${i}:`, upsertErr.message);
            } else {
                saved += count ?? chunk.length;
            }
        }

        console.log(`sync-ratings: upserted ${saved} player stats`);



        return new Response(
            JSON.stringify({ ok: true, gameweek: gw, processed: elements.length, saved }),
            { status: 200, headers: { "Content-Type": "application/json" } },
        );
    } catch (err) {
        console.error("sync-ratings error:", err);
        return new Response(
            JSON.stringify({ error: String(err) }),
            { status: 500, headers: { "Content-Type": "application/json" } },
        );
    }
});
