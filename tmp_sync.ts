import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

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

const POSITION_WEIGHTS: Record<GranularPosition, Record<RatingComponent, number>> = {
    GK: { match_impact: 0.25, influence: 0.20, creativity: 0.05, threat: 0.00, defensive: 0.25, goal_involvement: 0.05, finishing: 0.00, save_score: 0.20 },
    CB: { match_impact: 0.30, influence: 0.25, creativity: 0.05, threat: 0.05, defensive: 0.25, goal_involvement: 0.05, finishing: 0.05, save_score: 0.00 },
    LB: { match_impact: 0.25, influence: 0.20, creativity: 0.10, threat: 0.10, defensive: 0.20, goal_involvement: 0.10, finishing: 0.05, save_score: 0.00 },
    RB: { match_impact: 0.25, influence: 0.20, creativity: 0.10, threat: 0.10, defensive: 0.20, goal_involvement: 0.10, finishing: 0.05, save_score: 0.00 },
    DM: { match_impact: 0.30, influence: 0.25, creativity: 0.10, threat: 0.00, defensive: 0.20, goal_involvement: 0.10, finishing: 0.05, save_score: 0.00 },
    CM: { match_impact: 0.20, influence: 0.20, creativity: 0.15, threat: 0.10, defensive: 0.10, goal_involvement: 0.15, finishing: 0.10, save_score: 0.00 },
    LM: { match_impact: 0.20, influence: 0.15, creativity: 0.20, threat: 0.10, defensive: 0.10, goal_involvement: 0.15, finishing: 0.10, save_score: 0.00 },
    RM: { match_impact: 0.20, influence: 0.15, creativity: 0.20, threat: 0.10, defensive: 0.10, goal_involvement: 0.15, finishing: 0.10, save_score: 0.00 },
    AM: { match_impact: 0.10, influence: 0.15, creativity: 0.20, threat: 0.15, defensive: 0.00, goal_involvement: 0.25, finishing: 0.15, save_score: 0.00 },
    LW: { match_impact: 0.15, influence: 0.15, creativity: 0.05, threat: 0.25, defensive: 0.00, goal_involvement: 0.25, finishing: 0.15, save_score: 0.00 },
    RW: { match_impact: 0.15, influence: 0.15, creativity: 0.05, threat: 0.25, defensive: 0.00, goal_involvement: 0.25, finishing: 0.15, save_score: 0.00 },
    ST: { match_impact: 0.10, influence: 0.15, creativity: 0.05, threat: 0.25, defensive: 0.00, goal_involvement: 0.25, finishing: 0.20, save_score: 0.00 },
};

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
    threat: "Threat", defensive: "Defensive", goal_involvement: "Goal Involvement",
    finishing: "Finishing", save_score: "Save Score",
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

    // 5. Defensive (actual defensive actions + clean sheet + xGC)
    const gc = stats.goals_conceded;
    const xgc = stats.expected_goals_conceded ?? 0;
    const csBonus = (stats.clean_sheet && stats.minutes_played >= 60) ? 4 : 0;
    const xgcOutperf = Math.max(0, xgc - gc) * 2;
    const gcPenalty = Math.max(0, gc - xgc);
    const defActionsRaw = (stats.fpl_tackles ?? 0) * 1.5 + (stats.fpl_cbi ?? 0) * 1.5 + (stats.fpl_recoveries ?? 0) * 0.5;
    const defScore = sigmoidNormalize(defActionsRaw + csBonus + xgcOutperf - gcPenalty, ref.defensive.median, ref.defensive.stddev);

    // 6. Goal Involvement
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

    const weights = POSITION_WEIGHTS[position];
    let composite = 0;
    const breakdown: RatingBreakdownItem[] = [];

    for (const key of Object.keys(weights) as RatingComponent[]) {
        const w = weights[key];
        if (w === 0) continue;
        const { score, detail } = scores[key];
        const weighted = score * w;
        composite += weighted;
        breakdown.push({ component: COMPONENT_DISPLAY[key], key, score, weight: w, weighted, detail });
    }

    // Peak component blend: 50% weighted + 50% peak component score
    const maxScore = Math.max(...breakdown.map(b => b.score));
    composite = 0.50 * composite + 0.50 * maxScore;

    // ── Step 3: Linear map → 1.0-10.0 + soft minutes penalty ─────────────

    let rating = 1.0 + 9.0 * composite;
    if (stats.minutes_played < 60) {
        rating = Math.max(1.0, rating - (1 - stats.minutes_played / 60) * 1.5);
    }
    rating = Math.max(1.0, Math.min(10.0, rating));

    // ── Step 4: Curve → fantasy points ────────────────────────────────────

    const base = 2.0, scale = 3.0, penalty = 1.5, exponent = 2.1;
    const fp = rating >= 6.0
        ? base + scale * Math.pow(rating - 6.0, exponent)
        : Math.max(0, base - penalty * Math.pow(6.0 - rating, exponent));

    return {
        rating: Math.round(rating * 100) / 100,
        fantasyPoints: Math.round(fp * 100) / 100,
        position,
        breakdown,
    };
}

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
        shots_total: 0, shots_on_target: 0,
        passes_total: 0, passes_accurate: 0, pass_completion_pct: 0,
        key_passes: 0, big_chances_created: 0,
        dribbles_attempted: 0, dribbles_successful: 0,
        tackles_total: 0, tackles_won: 0, interceptions: 0,
        clearances: 0, blocks: 0,
        fpl_tackles: s.tackles ?? 0,
        fpl_cbi: s.clearances_blocks_interceptions ?? 0,
        fpl_recoveries: s.recoveries ?? 0,
    };
}

const DEFAULT_REF: Record<string, ReferenceStats> = {
    GK: { match_impact: { median: 10, stddev: 10 }, influence: { median: 22, stddev: 14 }, creativity: { median: 0, stddev: 2 }, threat: { median: 0, stddev: 1 }, defensive: { median: 0.1, stddev: 2.7 }, goal_involvement: { median: 0, stddev: 0.5 }, finishing: { median: 0, stddev: 0.1 }, save_score: { median: 4, stddev: 4.5 } },
    CB: { match_impact: { median: 7, stddev: 9 }, influence: { median: 16, stddev: 12 }, creativity: { median: 1.4, stddev: 10 }, threat: { median: 2, stddev: 10 }, defensive: { median: 0.1, stddev: 2.5 }, goal_involvement: { median: 0, stddev: 1.4 }, finishing: { median: 0, stddev: 0.2 }, save_score: { median: 0, stddev: 1 } },
    LB: { match_impact: { median: 7, stddev: 9 }, influence: { median: 13, stddev: 12 }, creativity: { median: 9, stddev: 13 }, threat: { median: 2.5, stddev: 9 }, defensive: { median: 0.1, stddev: 2.5 }, goal_involvement: { median: 0, stddev: 1.8 }, finishing: { median: 0, stddev: 0.2 }, save_score: { median: 0, stddev: 1 } },
    RB: { match_impact: { median: 7, stddev: 9 }, influence: { median: 12, stddev: 11 }, creativity: { median: 5, stddev: 11 }, threat: { median: 2, stddev: 7 }, defensive: { median: 0.2, stddev: 2.4 }, goal_involvement: { median: 0, stddev: 1.4 }, finishing: { median: 0, stddev: 0.2 }, save_score: { median: 0, stddev: 1 } },
    DM: { match_impact: { median: 10, stddev: 7 }, influence: { median: 10, stddev: 12 }, creativity: { median: 6, stddev: 13 }, threat: { median: 2, stddev: 10 }, defensive: { median: 0.1, stddev: 2.5 }, goal_involvement: { median: 0, stddev: 1.8 }, finishing: { median: 0, stddev: 0.2 }, save_score: { median: 0, stddev: 1 } },
    CM: { match_impact: { median: 10, stddev: 7 }, influence: { median: 10, stddev: 14 }, creativity: { median: 10, stddev: 14 }, threat: { median: 4, stddev: 12 }, defensive: { median: 0.1, stddev: 2.4 }, goal_involvement: { median: 0, stddev: 2.4 }, finishing: { median: 0, stddev: 0.3 }, save_score: { median: 0, stddev: 1 } },
    LM: { match_impact: { median: 8, stddev: 7 }, influence: { median: 6, stddev: 12 }, creativity: { median: 8, stddev: 12 }, threat: { median: 4, stddev: 10 }, defensive: { median: 0.1, stddev: 2.4 }, goal_involvement: { median: 0, stddev: 2 }, finishing: { median: 0, stddev: 0.3 }, save_score: { median: 0, stddev: 1 } },
    RM: { match_impact: { median: 8, stddev: 7 }, influence: { median: 6, stddev: 12 }, creativity: { median: 8, stddev: 12 }, threat: { median: 4, stddev: 10 }, defensive: { median: 0.1, stddev: 2.4 }, goal_involvement: { median: 0, stddev: 2 }, finishing: { median: 0, stddev: 0.4 }, save_score: { median: 0, stddev: 1 } },
    AM: { match_impact: { median: 9, stddev: 8 }, influence: { median: 10, stddev: 19 }, creativity: { median: 14, stddev: 18 }, threat: { median: 10, stddev: 16 }, defensive: { median: 0.2, stddev: 2.5 }, goal_involvement: { median: 0, stddev: 3.5 }, finishing: { median: 0, stddev: 0.4 }, save_score: { median: 0, stddev: 1 } },
    LW: { match_impact: { median: 9, stddev: 7 }, influence: { median: 8, stddev: 17 }, creativity: { median: 14, stddev: 15 }, threat: { median: 12, stddev: 17 }, defensive: { median: 0.2, stddev: 2.5 }, goal_involvement: { median: 0, stddev: 3.1 }, finishing: { median: 0, stddev: 0.4 }, save_score: { median: 0, stddev: 1 } },
    RW: { match_impact: { median: 9, stddev: 8 }, influence: { median: 11, stddev: 21 }, creativity: { median: 15, stddev: 17 }, threat: { median: 19, stddev: 21 }, defensive: { median: 0.1, stddev: 2.6 }, goal_involvement: { median: 0, stddev: 3.8 }, finishing: { median: 0, stddev: 0.4 }, save_score: { median: 0, stddev: 1 } },
    ST: { match_impact: { median: 4, stddev: 9 }, influence: { median: 4, stddev: 18 }, creativity: { median: 2.5, stddev: 10 }, threat: { median: 11, stddev: 20 }, defensive: { median: 0.1, stddev: 2.3 }, goal_involvement: { median: 0, stddev: 3.3 }, finishing: { median: 0, stddev: 0.4 }, save_score: { median: 0, stddev: 1 } },
};

async function loadReferenceStats(
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

    const ref = structuredClone(DEFAULT_REF);
    for (const row of data) {
        const pos = row.position_group;
        const comp = row.component as RatingComponent;
        if (ref[pos] && ref[pos][comp]) {
            ref[pos][comp] = { median: Number(row.median), stddev: Number(row.stddev) };
        }
    }
    return ref;
}

const ALPHA = 0.15;

async function updateReferenceStats(
    supabase: any,
    season: string,
    gameweekStats: Map<string, Map<RatingComponent, number[]>>,
): Promise<void> {
    for (const [pos, compMap] of gameweekStats) {
        for (const [comp, values] of compMap) {
            if (values.length === 0) continue;

            const gwMedian = values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
            const mean = values.reduce((s, v) => s + v, 0) / values.length;
            const gwStddev = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length) || 1;

            const { data: existing } = await supabase
                .from("rating_reference_stats")
                .select("median, stddev, sample_size")
                .eq("position_group", pos)
                .eq("component", comp)
                .eq("season", season)
                .single();

            if (existing) {
                const newMedian = (1 - ALPHA) * Number(existing.median) + ALPHA * gwMedian;
                const newStddev = (1 - ALPHA) * Number(existing.stddev) + ALPHA * gwStddev;
                await supabase
                    .from("rating_reference_stats")
                    .update({
                        median: newMedian,
                        stddev: Math.max(0.1, newStddev),
                        sample_size: (existing.sample_size || 0) + values.length,
                        updated_at: new Date().toISOString(),
                    })
                    .eq("position_group", pos)
                    .eq("component", comp)
                    .eq("season", season);
            }
        }
    }
}

async function run() {
    try {
        const gw = 25;
        console.log(`sync-ratings: processing GW ${gw}`);

        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
        const supabase = createClient(supabaseUrl, serviceKey);

        const season = "2025-26";

        const refStats = await loadReferenceStats(supabase, season);

        const fplRes = await fetch(`${FPL_BASE}/event/${gw}/live/`, {
            headers: { "User-Agent": "FantasyFutbol/1.0" },
        });
        if (!fplRes.ok) {
            console.error(`FPL live error: ${fplRes.status}`);
            return;
        }

        const fplData = await fplRes.json();
        const elements = (fplData.elements ?? []) as FplLiveElement[];
        console.log(`sync-ratings: ${elements.length} players from FPL`);

        const fplIds = elements.filter((e) => e.stats.minutes > 0).map((e) => e.id);
        const { data: dbPlayers, error: dbError } = await supabase
            .from("players")
            .select("id, fpl_id, primary_position")
            .in("fpl_id", fplIds);

        if (dbError) {
            console.error("DB player lookup failed", dbError);
            return;
        }

        const playerMap = new Map<number, { id: string; primary_position: GranularPosition }>();
        for (const p of dbPlayers ?? []) {
            playerMap.set(p.fpl_id, { id: p.id, primary_position: p.primary_position as GranularPosition });
        }

        const gwRawValues = new Map<string, Map<RatingComponent, number[]>>();
        const upsertRows: any[] = [];

        for (const el of elements) {
            if (el.stats.minutes === 0) continue;

            const dbPlayer = playerMap.get(el.id);
            if (!dbPlayer) continue;

            const rawStats = mapFplToRawStats(el.stats);
            const pos = dbPlayer.primary_position;
            const result = calculateMatchRating(rawStats, pos, refStats);

            upsertRows.push({
                player_id: dbPlayer.id,
                match_id: gw * 1000 + el.id,
                gameweek: gw,
                season,
                stats: rawStats,
                fantasy_points: result.fantasyPoints,
                match_rating: result.rating,
            });

            if (!gwRawValues.has(pos)) gwRawValues.set(pos, new Map());
            const posMap = gwRawValues.get(pos)!;

            const rawComponentValues: [RatingComponent, number][] = [
                ["match_impact", Math.max(0, (rawStats.bps ?? 0) - rawStats.goals * 12 - rawStats.assists * 9)],
                ["influence", rawStats.influence ?? 0],
                ["creativity", rawStats.creativity ?? 0],
                ["threat", rawStats.threat ?? 0],
                ["defensive", ((rawStats.clean_sheet && rawStats.minutes_played >= 60) ? 4 : 0) + (rawStats.fpl_tackles ?? 0) * 1.5 + (rawStats.fpl_cbi ?? 0) * 1.5 + (rawStats.fpl_recoveries ?? 0) * 0.5 + Math.max(0, (rawStats.expected_goals_conceded ?? 0) - rawStats.goals_conceded) * 2 - Math.max(0, rawStats.goals_conceded - (rawStats.expected_goals_conceded ?? 0))],
                ["goal_involvement", rawStats.goals * 6 + rawStats.assists * 4],
            ];

            if (pos === "GK") {
                rawComponentValues.push(["save_score", rawStats.saves * 2 + rawStats.penalty_saves * 5 - Math.max(0, rawStats.goals_conceded - (rawStats.expected_goals_conceded ?? 0)) * 2]);
            }

            for (const [comp, val] of rawComponentValues) {
                if (!posMap.has(comp)) posMap.set(comp, []);
                posMap.get(comp)!.push(val);
            }
        }

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

        await updateReferenceStats(supabase, season, gwRawValues);
        console.log("sync-ratings: reference stats updated");

    } catch (err) {
        console.error("sync-ratings error:", err);
    }
}

run();
