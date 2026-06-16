/**
 * Admin — Scoring Engine V2 Shadow Comparison
 *
 * Compares the FROZEN v1 engine (legacy, pre-rebalance) against the new v2
 * engine for the same player-fixtures. Used to validate the Phase 1+2
 * rebalance before promoting v2 to primary (Phase 3D).
 *
 * Access: any user who commissioners at least one league (we don't have a
 * global admin flag; the league commissioner is the natural admin).
 *
 * Empty-state behavior: meaningful after v2 columns are populated (dual-write
 * sync or `scripts/backfill-scoring-v2.mjs`). Until then, match_rating_v2 is NULL.
 */

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getCurrentFplSeason, getLatestReferenceStatsSeason } from '@/lib/season/currentSeason';
import { redirect } from 'next/navigation';
import styles from './scoring-v2.module.css';
import { FULL_PLAYER_SELECT } from '@/lib/constants/queries';
import { calculateMatchRating } from '@/lib/scoring/matchRating';
import type { GranularPosition } from '@/types';
import { loadReferenceStats, calculateTeamScore } from '@/lib/scoring/matchups';
import { normalizeMatchupLineup } from '@/lib/lineups/normalizeMatchupLineup';
import ShadowStatsTable, {
  type ShadowStatsPayload,
  type ShadowStatsPlayer,
} from './ShadowStatsTable';

export const dynamic = 'force-dynamic';

const GRANULAR_POSITIONS = [
  'GK', 'CB', 'LB', 'RB', 'LWB', 'RWB',
  'DM', 'CM', 'AM', 'LW', 'RW', 'ST',
] as const;

// Named-player anchors the user flagged as miscalibrated under v1. Substring
// matched against `web_name` and `full_name` (we don't store first/last
// separately). The comparison shows per-GW v1/v2 plus full-season totals.
const NAMED_ANCHORS = [
  { needle: 'reece james', label: 'Reece James' },
  { needle: 'saliba', label: 'William Saliba' },
  { needle: 'caicedo', label: 'Moisés Caicedo' },
  { needle: 'raya', label: 'David Raya' },
  { needle: 'bruno fernandes', label: 'Bruno Fernandes' },
] as const;

interface PlayerStatsRow {
  id?: string;
  player_id: string;
  match_id?: number;
  gameweek: number;
  match_rating: number | null;
  match_rating_v2: number | null;
  fantasy_points: number | null;
  fantasy_points_v2: number | null;
  stats: { minutes_played?: number } | null;
}

function fixtureMinutes(row: PlayerStatsRow): number {
  return Number(row.stats?.minutes_played ?? 0);
}

/** True when the player actually played (excludes DNP rows with 0 minutes). */
function isPlayedFixture(row: PlayerStatsRow): boolean {
  return fixtureMinutes(row) > 0;
}

interface MatchupRow {
  id: string;
  gameweek: number;
  score_a: number | null;
  score_b: number | null;
  team_a_id: string;
  team_b_id: string;
  lineup_a: any;
  lineup_b: any;
}

function fmt(n: number | null | undefined, digits = 2): string {
  if (n == null || Number.isNaN(n)) return '—';
  return n.toFixed(digits);
}

function safeDelta(v2: number | null, v1: number | null): number | null {
  if (v2 == null || v1 == null) return null;
  return v2 - v1;
}

const PLAYER_CHUNK = 120;

async function fetchPlayersByIds(
  admin: SupabaseClient,
  ids: string[],
): Promise<Map<string, { id: string; primary_position: string; secondary_positions: string[] | null; web_name: string | null; name: string | null; full_name: string | null }>> {
  const map = new Map<string, { id: string; primary_position: string; secondary_positions: string[] | null; web_name: string | null; name: string | null; full_name: string | null }>();
  const unique = Array.from(new Set(ids));
  for (let i = 0; i < unique.length; i += PLAYER_CHUNK) {
    const slice = unique.slice(i, i + PLAYER_CHUNK);
    const { data, error } = await admin
      .from('players')
      .select('id, primary_position, secondary_positions, name, full_name, web_name')
      .in('id', slice);
    if (error) throw new Error(`players chunk ${i}: ${error.message}`);
    for (const p of data ?? []) {
      map.set(p.id, p as { id: string; primary_position: string; secondary_positions: string[] | null; web_name: string | null; name: string | null; full_name: string | null });
    }
  }
  return map;
}

/**
 * Render a horizontal CSS bar showing a delta value relative to its scale.
 * Positive deltas extend right (green), negative left (red).
 */
function DeltaBar({ value, max }: { value: number; max: number }) {
  const pct = Math.min(100, Math.abs(value) / max * 100);
  const isNeg = value < 0;
  return (
    <div className={styles.deltaBarRow}>
      <div className={styles.deltaBarTrack}>
        <div
          className={isNeg ? styles.deltaBarNeg : styles.deltaBarPos}
          style={{
            width: `${pct}%`,
            [isNeg ? 'right' : 'left']: '50%',
          } as React.CSSProperties}
        />
        <div className={styles.deltaBarMid} />
      </div>
      <span className={styles.deltaBarValue}>{value >= 0 ? '+' : ''}{fmt(value, 2)}</span>
    </div>
  );
}

export default async function ScoringV2Page() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const admin = createAdminClient();

  // Gate: must commissioner at least one league.
  const { data: comLeagues } = await admin
    .from('leagues')
    .select('id')
    .eq('commissioner_id', user.id)
    .limit(1);
  if (!comLeagues || comLeagues.length === 0) {
    redirect('/dashboard');
  }

  const refStatsSeason = await getLatestReferenceStatsSeason(admin);
  const refStats = await loadReferenceStats(admin, refStatsSeason);
  // Must match sync + backfill (`getCurrentFplSeason`). Using `rating_reference_stats`
  // season alone can mismatch (e.g. empty table fallback vs DB convention) and yield
  // zero rows here while v2 rows exist.
  const statsSeason = await getCurrentFplSeason();

  // 1. Fetch ALL active players first so we have position mapping for the dynamic V1 calculations
  const { data: allActiveForShadow } = await admin
    .from('players')
    .select(FULL_PLAYER_SELECT)
    .eq('is_active', true);

  const playerById = new Map<string, { id: string; primary_position: string; secondary_positions: string[] | null; web_name: string | null; name: string | null; full_name: string | null }>();
  for (const p of (allActiveForShadow as any) ?? []) {
    playerById.set(p.id, p as any);
  }

  // 2. Fetch ALL player_stats rows. PostgREST returns max
  //    1000 rows per request — paginate with `.range()`. Order by `id` only so
  //    pages are stable (multi-column `.order()` is easy to get wrong).
  const STATS_PAGE = 1000;
  const rows: PlayerStatsRow[] = [];
  let statsOffset = 0;
  for (;;) {
    const { data: chunk, error: statsErr } = await admin
      .from('player_stats')
      .select('id, player_id, match_id, gameweek, match_rating, fantasy_points, stats')
      .eq('season', statsSeason)
      .not('stats', 'is', null)
      .order('id', { ascending: true })
      .range(statsOffset, statsOffset + STATS_PAGE - 1);
    if (statsErr) throw new Error(`player_stats scoring-v2: ${statsErr.message}`);
    if (!chunk?.length) break;

    for (const r of chunk) {
      const p = playerById.get(r.player_id);
      if (!p) continue;

      // V1 is retired after Migration 040. Use V2 values as the baseline.
      const v1Result = {
        rating: r.match_rating !== null && r.match_rating !== undefined ? Number(r.match_rating) : 0,
        fantasyPoints: r.fantasy_points !== null && r.fantasy_points !== undefined ? Number(r.fantasy_points) : 0,
      };
      rows.push({
        id: r.id,
        player_id: r.player_id,
        match_id: r.match_id,
        gameweek: r.gameweek,
        match_rating: v1Result.rating, // V1 (legacy)
        match_rating_v2: r.match_rating !== null && r.match_rating !== undefined ? Number(r.match_rating) : null, // V2 (promoted live)
        fantasy_points: v1Result.fantasyPoints, // V1 (legacy)
        fantasy_points_v2: r.fantasy_points !== null && r.fantasy_points !== undefined ? Number(r.fantasy_points) : null, // V2 (promoted live)
        stats: r.stats
      });
    }

    if (chunk.length < STATS_PAGE) break;
    statsOffset += STATS_PAGE;
  }

  const displayName = (p: { web_name: string | null; full_name: string | null; name: string | null } | undefined): string => {
    return p?.web_name || p?.full_name || p?.name || '—';
  };

  // 3. Per-position summary: avg rating delta and avg fantasy_points delta.
  type PosAgg = { n: number; sumRatingDelta: number; sumPointsDelta: number };
  const posAgg: Record<string, PosAgg> = Object.fromEntries(
    GRANULAR_POSITIONS.map((p) => [p, { n: 0, sumRatingDelta: 0, sumPointsDelta: 0 }])
  );

  const posKeys = new Set<string>(GRANULAR_POSITIONS as unknown as string[]);

  for (const r of rows) {
    const p = playerById.get(r.player_id);
    const pos = p?.primary_position ? String(p.primary_position).toUpperCase() : '';
    if (!pos || !posKeys.has(pos)) continue;
    const dR = safeDelta(r.match_rating_v2, r.match_rating);
    const dP = safeDelta(r.fantasy_points_v2, r.fantasy_points);
    if (dR == null || dP == null) continue;
    posAgg[pos].n++;
    posAgg[pos].sumRatingDelta += dR;
    posAgg[pos].sumPointsDelta += dP;
  }

  const posSummary = GRANULAR_POSITIONS.map((pos) => {
    const a = posAgg[pos];
    return {
      pos,
      n: a.n,
      avgRatingDelta: a.n > 0 ? a.sumRatingDelta / a.n : 0,
      avgPointsDelta: a.n > 0 ? a.sumPointsDelta / a.n : 0,
    };
  });

  // 4. Top movers (by per-player average fantasy-point delta across fixtures
  //    with both v1 and v2 points). Min 2 fixtures.
  type PlayerAgg = { n: number; sumDelta: number; pos: string; name: string };
  const playerAgg = new Map<string, PlayerAgg>();
  for (const r of rows) {
    const p = playerById.get(r.player_id);
    if (!p) continue;
    const dP = safeDelta(r.fantasy_points_v2, r.fantasy_points);
    if (dP == null) continue;
    const ex = playerAgg.get(r.player_id);
    const name = displayName(p);
    if (!ex) playerAgg.set(r.player_id, { n: 1, sumDelta: dP, pos: String(p.primary_position).toUpperCase(), name });
    else { ex.n++; ex.sumDelta += dP; }
  }
  const moverRows = Array.from(playerAgg.entries())
    .filter(([, v]) => v.n >= 2)
    .map(([id, v]) => ({ id, ...v, avgDelta: v.sumDelta / v.n }));
  const topUp = [...moverRows].sort((a, b) => b.avgDelta - a.avgDelta).slice(0, 12);
  const topDown = [...moverRows].sort((a, b) => a.avgDelta - b.avgDelta).slice(0, 12);

  // Full-season shadow leaderboard: all active players + per-player aggregates from `rows`.

  type ShadowAcc = {
    gp: number;
    ptsV1: number;
    ptsV2: number;
    sumR1: number;
    sumR2: number;
    /** Rows where legacy `match_rating` was actually stored (often sparse vs points). */
    nR1: number;
    totalMinutes: number;
  };

  function buildShadowAgg(minMins: number) {
    // shadowAgg maps: playerId -> Map of position -> ShadowAcc
    const shadowAgg = new Map<string, Map<string, ShadowAcc>>();
    for (const r of rows) {
      if (r.fantasy_points_v2 == null || r.match_rating_v2 == null) continue;
      if (!isPlayedFixture(r)) continue;
      const mins = Number(r.stats?.minutes_played ?? 0);
      if (mins < minMins) continue;

      const p = playerById.get(r.player_id);
      if (!p) continue;

      let playerMap = shadowAgg.get(r.player_id);
      if (!playerMap) {
        playerMap = new Map<string, ShadowAcc>();
        shadowAgg.set(r.player_id, playerMap);
      }

      // 1. Primary Position
      const primPos = p.primary_position ? String(p.primary_position).toUpperCase() : '';
      if (primPos) {
        let primAcc = playerMap.get(primPos);
        if (!primAcc) {
          primAcc = { gp: 0, ptsV1: 0, ptsV2: 0, sumR1: 0, sumR2: 0, nR1: 0, totalMinutes: 0 };
          playerMap.set(primPos, primAcc);
        }
        primAcc.gp += 1;
        primAcc.ptsV1 += Number(r.fantasy_points ?? 0);
        primAcc.ptsV2 += Number(r.fantasy_points_v2);
        primAcc.sumR2 += Number(r.match_rating_v2);
        primAcc.totalMinutes += mins;
        if (r.match_rating != null && !Number.isNaN(Number(r.match_rating))) {
          primAcc.sumR1 += Number(r.match_rating);
          primAcc.nR1 += 1;
        }
      }

      // 2. Secondary Positions (dynamically calculated)
      const secPositions = (p.secondary_positions ?? []) as string[];
      for (const secPos of secPositions) {
        const posKey = String(secPos).toUpperCase();
        if (!posKey || posKey === primPos) continue;

        let secAcc = playerMap.get(posKey);
        if (!secAcc) {
          secAcc = { gp: 0, ptsV1: 0, ptsV2: 0, sumR1: 0, sumR2: 0, nR1: 0, totalMinutes: 0 };
          playerMap.set(posKey, secAcc);
        }

        // Dynamically calculate rating and points under this secondary position weights
        const dynamicRating = calculateMatchRating(r.stats as any, posKey as any, refStats as any, primPos as any);

        secAcc.gp += 1;
        secAcc.ptsV1 += Number(r.fantasy_points ?? 0);
        secAcc.ptsV2 += dynamicRating.fantasyPoints;
        secAcc.sumR2 += dynamicRating.rating;
        secAcc.totalMinutes += mins;
        if (r.match_rating != null && !Number.isNaN(Number(r.match_rating))) {
          secAcc.sumR1 += Number(r.match_rating);
          secAcc.nR1 += 1;
        }
      }
    }

    const result: Record<string, Record<string, ShadowStatsPayload>> = {};
    for (const [pid, playerMap] of shadowAgg) {
      result[pid] = {};
      for (const [pos, ex] of playerMap) {
        const gp = ex.gp;
        const totalMinutes = ex.totalMinutes;
        result[pid][pos] = {
          gp,
          ptsV1: ex.ptsV1,
          ptsV2: ex.ptsV2,
          ppgV1: gp > 0 ? ex.ptsV1 / gp : 0,
          ppgV2: gp > 0 ? ex.ptsV2 / gp : 0,
          p90V1: totalMinutes > 0 ? (ex.ptsV1 / totalMinutes) * 90 : 0,
          p90V2: totalMinutes > 0 ? (ex.ptsV2 / totalMinutes) * 90 : 0,
          avgRV1: ex.nR1 > 0 ? ex.sumR1 / ex.nR1 : null,
          avgRV2: gp > 0 ? ex.sumR2 / gp : 0,
          totalMinutes,
        };
      }
    }
    return result;
  }

  const shadowByPlayerAll = buildShadowAgg(15);
  const shadowByPlayer45 = buildShadowAgg(45);

  const shadowTablePlayers = (allActiveForShadow ?? []) as unknown as ShadowStatsPlayer[];

  // 5. Named-anchor breakdowns (one row per GW per player). Anchor lookup is
  //    a separate query so we still show anchors even if they have NO v2 data
  //    yet (helps validate the page renders correctly on day 1).
  const anchorPlayers: { id: string; name: string; pos: string; rows: PlayerStatsRow[] }[] = [];
  for (const a of NAMED_ANCHORS) {
    const { data: anchorMatches } = await admin
      .from('players')
      .select('id, primary_position, name, full_name, web_name')
      .or(`full_name.ilike.%${a.needle}%,web_name.ilike.%${a.needle}%`)
      .limit(5);
    if (!anchorMatches || anchorMatches.length === 0) continue;

    // Rank by # of v2-populated rows for this player (handles name collisions).
    const ranked = anchorMatches
      .map((c) => ({ c, n: rows.filter((r) => r.player_id === c.id).length }))
      .sort((x, y) => y.n - x.n);
    const chosen = ranked[0]?.c as {
      id: string;
      primary_position: string;
      name: string | null;
      full_name: string | null;
      web_name: string | null;
    } | undefined;
    if (!chosen) continue;

    const playerRows = rows
      .filter((r) => r.player_id === chosen.id)
      .sort((x, y) => x.gameweek - y.gameweek);
    anchorPlayers.push({
      id: chosen.id,
      name: displayName(chosen) || a.label,
      pos: chosen.primary_position,
      rows: playerRows,
    });
  }

  // 6. Matchup score deltas > 5 with the team names.
  const { data: matchupsRaw } = await admin
    .from('matchups')
    .select('id, gameweek, score_a, score_b, lineup_a, lineup_b, team_a_id, team_b_id, team_a:teams!matchups_team_a_id_fkey(team_name), team_b:teams!matchups_team_b_id_fkey(team_name)');

  const playerPositions = new Map<string, string[]>();
  const playerPlTeamId = new Map<string, number>();
  for (const [pid, p] of playerById.entries()) {
    playerPositions.set(pid, [p.primary_position, ...((p.secondary_positions as string[]) ?? [])]);
    if ((p as any).pl_team_id) {
      playerPlTeamId.set(pid, (p as any).pl_team_id);
    }
  }

  const gwPlayerRecordV1 = new Map<number, Map<string, { fixtures: { minutes: number; fantasyPoints: number; stats: any }[] }>>();
  const gwPlayerRecordV2 = new Map<number, Map<string, { fixtures: { minutes: number; fantasyPoints: number; stats: any }[] }>>();
  for (const r of rows) {
    const gw = r.gameweek;
    
    // V1 Map
    let gwMap1 = gwPlayerRecordV1.get(gw);
    if (!gwMap1) {
      gwMap1 = new Map();
      gwPlayerRecordV1.set(gw, gwMap1);
    }
    const fix1 = { minutes: fixtureMinutes(r), fantasyPoints: r.fantasy_points ?? 0, stats: r.stats };
    let rec1 = gwMap1.get(r.player_id);
    if (!rec1) {
      rec1 = { fixtures: [fix1] };
      gwMap1.set(r.player_id, rec1);
    } else {
      rec1.fixtures.push(fix1);
    }

    // V2 Map
    let gwMap2 = gwPlayerRecordV2.get(gw);
    if (!gwMap2) {
      gwMap2 = new Map();
      gwPlayerRecordV2.set(gw, gwMap2);
    }
    const fix2 = { minutes: fixtureMinutes(r), fantasyPoints: r.fantasy_points_v2 ?? 0, stats: r.stats };
    let rec2 = gwMap2.get(r.player_id);
    if (!rec2) {
      rec2 = { fixtures: [fix2] };
      gwMap2.set(r.player_id, rec2);
    } else {
      rec2.fixtures.push(fix2);
    }
  }

  const matchupDeltas = (matchupsRaw ?? [])
    .map((m: any) => {
      const gw = m.gameweek;
      const recordV1 = gwPlayerRecordV1.get(gw) ?? new Map();
      const recordV2 = gwPlayerRecordV2.get(gw) ?? new Map();

      const lineupA = normalizeMatchupLineup(m.lineup_a);
      const lineupB = normalizeMatchupLineup(m.lineup_b);

      const scoreAv1 = calculateTeamScore(lineupA, recordV1, playerPositions, playerPlTeamId, {} as any, false, new Set());
      const scoreBv1 = calculateTeamScore(lineupB, recordV1, playerPositions, playerPlTeamId, {} as any, false, new Set());

      const scoreAv2 = calculateTeamScore(lineupA, recordV2, playerPositions, playerPlTeamId, refStats as any, true, new Set());
      const scoreBv2 = calculateTeamScore(lineupB, recordV2, playerPositions, playerPlTeamId, refStats as any, true, new Set());

      const dA = safeDelta(scoreAv2, scoreAv1);
      const dB = safeDelta(scoreBv2, scoreBv1);
      const maxAbs = Math.max(Math.abs(dA ?? 0), Math.abs(dB ?? 0));
      
      return {
        id: m.id as string,
        gameweek: gw as number,
        teamA: m.team_a?.team_name ?? '—',
        teamB: m.team_b?.team_name ?? '—',
        scoreA: scoreAv1,
        scoreAv2: scoreAv2,
        scoreB: scoreBv1,
        scoreBv2: scoreBv2,
        dA,
        dB,
        maxAbs,
      };
    })
    .filter((m) => m.maxAbs > 5)
    .sort((a, b) => b.maxAbs - a.maxAbs)
    .slice(0, 25);

  const maxAbsAvgPoint = Math.max(
    1,
    ...posSummary.map((p) => Math.abs(p.avgPointsDelta)),
  );
  const maxAbsAvgRating = Math.max(
    0.1,
    ...posSummary.map((p) => Math.abs(p.avgRatingDelta)),
  );

  const dataEmpty = rows.length === 0;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Scoring Engine V2 — Shadow Comparison</h1>
          <p className={styles.subtitle}>
            Side-by-side: FROZEN v1 (legacy) vs v2 (Phase 1+2 rebalance). Player-stats season{' '}
            <strong>{statsSeason}</strong>
            {refStatsSeason !== statsSeason && (
              <> · Reference baselines loaded for <strong>{refStatsSeason}</strong></>
            )}
            . Past GWs: run <code>scripts/backfill-scoring-v2.mjs</code> once, then refresh.
          </p>
        </div>
        <div className={styles.meta}>
          <div><span className={styles.metaLabel}>player-fixtures with v2:</span> {rows.length}</div>
          <div><span className={styles.metaLabel}>matchups with v2:</span> {(matchupsRaw ?? []).length}</div>
          <div><span className={styles.metaLabel}>unique players:</span> {playerById.size}</div>
        </div>
      </header>

      {dataEmpty && (
        <section className={styles.emptyBanner}>
          <strong>No v2 data yet.</strong> Dual-write activates the next time <code>/api/sync/stats?mode=fpl_live</code> runs.
          Run <code>scripts/backfill-scoring-v2.mjs</code> in the offseason to populate past GWs.
        </section>
      )}

      {/* Per-position summary */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Per-position averages</h2>
        <p className={styles.sectionHint}>Avg v2−v1 rating and fantasy-point delta across all player-fixtures, bucketed by primary position.</p>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Pos</th>
              <th>N</th>
              <th>Avg Δ rating</th>
              <th>rating delta</th>
              <th>Avg Δ pts</th>
              <th>pts delta</th>
            </tr>
          </thead>
          <tbody>
            {posSummary.map((p) => (
              <tr key={p.pos}>
                <td className={styles.cellPos}>{p.pos}</td>
                <td className={styles.cellNum}>{p.n}</td>
                <td className={styles.cellNum}>{p.n > 0 ? (p.avgRatingDelta >= 0 ? '+' : '') + fmt(p.avgRatingDelta, 3) : '—'}</td>
                <td className={styles.cellBar}>
                  {p.n > 0 ? <DeltaBar value={p.avgRatingDelta} max={maxAbsAvgRating} /> : <span className={styles.muted}>—</span>}
                </td>
                <td className={styles.cellNum}>{p.n > 0 ? (p.avgPointsDelta >= 0 ? '+' : '') + fmt(p.avgPointsDelta, 2) : '—'}</td>
                <td className={styles.cellBar}>
                  {p.n > 0 ? <DeltaBar value={p.avgPointsDelta} max={maxAbsAvgPoint} /> : <span className={styles.muted}>—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Top movers */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Top movers</h2>
        <p className={styles.sectionHint}>Players with the largest avg fantasy-point delta per game (min 2 fixtures with both v1 and v2 points).</p>
        <div className={styles.moverGrid}>
          <div>
            <h3 className={styles.moverTitle}>Up</h3>
            <table className={styles.table}>
              <thead><tr><th>Player</th><th>Pos</th><th>N</th><th>Avg Δ pts</th></tr></thead>
              <tbody>
                {topUp.length === 0 && (
                  <tr><td colSpan={4} className={styles.muted}>No movers yet</td></tr>
                )}
                {topUp.map((m) => (
                  <tr key={m.id}>
                    <td>{m.name}</td>
                    <td className={styles.cellPos}>{m.pos}</td>
                    <td className={styles.cellNum}>{m.n}</td>
                    <td className={styles.cellNumPos}>{m.avgDelta >= 0 ? '+' : ''}{fmt(m.avgDelta, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <h3 className={styles.moverTitle}>Down</h3>
            <table className={styles.table}>
              <thead><tr><th>Player</th><th>Pos</th><th>N</th><th>Avg Δ pts</th></tr></thead>
              <tbody>
                {topDown.length === 0 && (
                  <tr><td colSpan={4} className={styles.muted}>No movers yet</td></tr>
                )}
                {topDown.map((m) => (
                  <tr key={m.id}>
                    <td>{m.name}</td>
                    <td className={styles.cellPos}>{m.pos}</td>
                    <td className={styles.cellNum}>{m.n}</td>
                    <td className={styles.cellNumNeg}>{m.avgDelta >= 0 ? '+' : ''}{fmt(m.avgDelta, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <ShadowStatsTable
        statsSeason={statsSeason}
        players={shadowTablePlayers}
        shadowMaps={{
          all: shadowByPlayerAll,
          gt45: shadowByPlayer45,
        }}
      />

      {/* Named anchors */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Named anchors</h2>
        <p className={styles.sectionHint}>
          Players you flagged as miscalibrated under v1. Each row is one gameweek (one row per fixture if DGW). Read across: v1 vs v2 <strong>rating</strong> (1–10 match quality) and <strong>pts</strong> (fantasy points that week).
        </p>
        {anchorPlayers.length === 0 && (
          <p className={styles.muted}>No anchor players found in the players table.</p>
        )}
        {anchorPlayers.map((a) => {
          const hasRows = a.rows.length > 0;
          const sumV1 = a.rows.reduce((s, r) => s + (r.fantasy_points ?? 0), 0);
          const sumV2 = a.rows.reduce((s, r) => s + (r.fantasy_points_v2 ?? 0), 0);
          const avgRatingV1 = hasRows ? a.rows.reduce((s, r) => s + (r.match_rating ?? 0), 0) / a.rows.length : 0;
          const avgRatingV2 = hasRows ? a.rows.reduce((s, r) => s + (r.match_rating_v2 ?? 0), 0) / a.rows.length : 0;
          return (
            <div key={a.id} className={styles.anchorBlock}>
              <div className={styles.anchorHeader}>
                <h3>{a.name} <span className={styles.cellPos}>{a.pos}</span></h3>
                <div className={styles.anchorTotals}>
                  <div><span className={styles.metaLabel}>avg rating v1→v2:</span> {hasRows ? `${fmt(avgRatingV1)} → ${fmt(avgRatingV2)} (${avgRatingV2 - avgRatingV1 >= 0 ? '+' : ''}${fmt(avgRatingV2 - avgRatingV1, 2)})` : '—'}</div>
                  <div><span className={styles.metaLabel}>total pts v1→v2:</span> {hasRows ? `${fmt(sumV1, 2)} → ${fmt(sumV2, 2)} (${sumV2 - sumV1 >= 0 ? '+' : ''}${fmt(sumV2 - sumV1, 2)})` : '—'}</div>
                </div>
              </div>
              {!hasRows && <p className={styles.muted}>No v2-populated fixtures yet.</p>}
              {hasRows && (
                <table className={styles.tableCompact}>
                  <thead>
                    <tr><th>GW</th><th>Rating v1</th><th>Rating v2</th><th>Δ rating</th><th>Pts v1</th><th>Pts v2</th><th>Δ pts</th></tr>
                  </thead>
                  <tbody>
                    {a.rows.map((r) => {
                      const dR = safeDelta(r.match_rating_v2, r.match_rating) ?? 0;
                      const dP = safeDelta(r.fantasy_points_v2, r.fantasy_points) ?? 0;
                      return (
                        <tr key={`${r.player_id}-${r.gameweek}`}>
                          <td>{r.gameweek}</td>
                          <td className={styles.cellNum}>{fmt(r.match_rating, 2)}</td>
                          <td className={styles.cellNum}>{fmt(r.match_rating_v2, 2)}</td>
                          <td className={dR >= 0 ? styles.cellNumPos : styles.cellNumNeg}>{dR >= 0 ? '+' : ''}{fmt(dR, 2)}</td>
                          <td className={styles.cellNum}>{fmt(r.fantasy_points, 2)}</td>
                          <td className={styles.cellNum}>{fmt(r.fantasy_points_v2, 2)}</td>
                          <td className={dP >= 0 ? styles.cellNumPos : styles.cellNumNeg}>{dP >= 0 ? '+' : ''}{fmt(dP, 2)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
      </section>

      {/* Matchup deltas */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Matchup score deltas (|Δ| &gt; 5)</h2>
        <p className={styles.sectionHint}>Matchups where role-aware v2 scoring meaningfully changed the team score.</p>
        <table className={styles.table}>
          <thead>
            <tr><th>GW</th><th>Team A</th><th>v1 → v2</th><th>Team B</th><th>v1 → v2</th></tr>
          </thead>
          <tbody>
            {matchupDeltas.length === 0 && (
              <tr><td colSpan={5} className={styles.muted}>No big swings yet</td></tr>
            )}
            {matchupDeltas.map((m) => (
              <tr key={m.id}>
                <td>{m.gameweek}</td>
                <td>{m.teamA}</td>
                <td className={styles.cellNum}>
                  {fmt(m.scoreA, 2)} → {fmt(m.scoreAv2, 2)}{' '}
                  <span className={(m.dA ?? 0) >= 0 ? styles.cellNumPos : styles.cellNumNeg}>
                    ({(m.dA ?? 0) >= 0 ? '+' : ''}{fmt(m.dA ?? 0, 2)})
                  </span>
                </td>
                <td>{m.teamB}</td>
                <td className={styles.cellNum}>
                  {fmt(m.scoreB, 2)} → {fmt(m.scoreBv2, 2)}{' '}
                  <span className={(m.dB ?? 0) >= 0 ? styles.cellNumPos : styles.cellNumNeg}>
                    ({(m.dB ?? 0) >= 0 ? '+' : ''}{fmt(m.dB ?? 0, 2)})
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
