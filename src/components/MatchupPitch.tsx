'use client';

import { useCallback, useEffect, useState } from 'react';
import type { BenchSlot, MatchupLineup, Player, GranularPosition } from '@/types';
import { BENCH_DEPTH_BONUS_LABEL, getExpectedBenchSlots } from '@/types';
import type { TeamScoreDetail } from '@/lib/scoring/matchups';
import type { PerfGroup } from '@/lib/scoring/perfBand';
import PerformanceBlock from './players/PerformanceBlock';
import { roleArticle } from '@/lib/scoring/perfBand';
import { getPlayerDisplayName } from '@/lib/players/displayName';
import { SPINE, POS_COLOR } from '@/lib/positions/spine';
import { playerHoverProps, usePlayerCard } from './players/PlayerCardProvider';
import PositionBadge from './players/PositionBadge';
import Portrait from './players/Portrait';
import CrestBadge from './crest/CrestBadge';
import type { CrestConfig } from './crest/types';
import { Icon } from './ui/Icon';
import styles from './MatchupPitch.module.css';

/* ── Zone config ──────────────────────────────────────────────────── */
type Zone = 'ATT' | 'AMZ' | 'CMZ' | 'DMZ' | 'WBZ' | 'DEF' | 'GK';

const ZONE_ORDER: Zone[] = ['ATT', 'AMZ', 'CMZ', 'DMZ', 'WBZ', 'DEF', 'GK'];

const SLOT_TO_ZONE = {
    // ATT row: pure attackers (LW, ST, RW)
    LW: 'ATT', ST: 'ATT', RW: 'ATT',
    // AMZ row: AM
    AM: 'AMZ',
    // DM row
    DM: 'DMZ',
    // Midfield row
    CM: 'CMZ',
    // Wingbacks row
    LWB: 'WBZ', RWB: 'WBZ',
    // Defenders
    CB: 'DEF', LB: 'DEF', RB: 'DEF',
    GK: 'GK',
} satisfies Record<string, Zone>;

/** The twelve are only ever a taxonomy here — never a fill. */
const isGranular = (p: unknown): p is GranularPosition =>
    typeof p === 'string' && (SPINE as string[]).includes(p);

/* ── Stats formatter — "2G · 4 SOT · 8.9 rating" ─────────────────── */
/**
 * Keys here must match what /api/sync/stats actually writes into
 * player_stats.stats — see mapFplLiveToRawStats. Four of them didn't: this read
 * `goals_scored`, `clean_sheets`, `tackles` and `rating`, none of which exist,
 * so every chip silently rendered "0.0 rating" and nothing else. The rating in
 * particular has never lived in the stats JSON at all; it is its own column, so
 * it arrives on Detail rather than here.
 *
 * `key_passes` and `shots_on_target` are real keys but FPL's live feed leaves
 * them at 0, so they simply never render.
 */
interface MatchStatsSnapshot {
    goals?: number;
    assists?: number;
    clean_sheet?: boolean;
    minutes_played?: number;
    saves?: number;
    fpl_tackles?: number;
    key_passes?: number;
    shots_on_target?: number;
}

function fmtStats(detail: Detail | undefined, slot: string): string {
    const stats = detail?.stats;
    if (!stats) return '';
    // SAFETY: lineup slots are always one of the 12 GranularPosition values, never an arbitrary string.
    const zone = SLOT_TO_ZONE[slot as GranularPosition] ?? 'CMZ';
    const parts: string[] = [];
    const g = Number(stats.goals ?? 0);
    const a = Number(stats.assists ?? 0);
    const cs = stats.clean_sheet ? 1 : 0;
    const rtg = stats.minutes_played && detail?.rating != null
        ? Number(detail.rating).toFixed(2)
        : null;

    if (zone === 'GK') {
        const sv = Number(stats.saves ?? 0);
        if (sv) parts.push(`${sv} Sv`);
        if (cs) parts.push('CS');
    } else if (zone === 'DEF' || zone === 'DMZ') {
        if (cs) parts.push('CS');
        const tk = Number(stats.fpl_tackles ?? 0);
        if (tk) parts.push(`${tk} Tk`);
    } else if (zone === 'CMZ' || zone === 'AMZ') {
        if (g) parts.push(`${g}G`);
        if (a) parts.push(`${a}A`);
        const kp = Number(stats.key_passes ?? 0);
        if (kp) parts.push(`${kp} KP`);
    } else {
        if (g) parts.push(`${g}G`);
        if (a) parts.push(`${a}A`);
        const sot = Number(stats.shots_on_target ?? 0);
        if (sot) parts.push(`${sot} SOT`);
    }
    if (rtg) parts.push(`${rtg} rating`);
    return parts.join(' · ');
}

/* ── Sub-components ───────────────────────────────────────────────── */
type Detail = {
    points: number;
    rating?: number | null;
    stats?: MatchStatsSnapshot;
    bySlot?: Record<string, { points: number; rating: number | null }>;
};

/**
 * The number the chip should show for this slot, not the player's stored
 * primary-position score. Bench bonus still reads `detail.points` (no slot).
 */
function detailAtSlot(detail: Detail | undefined, slot: string): Detail | undefined {
    if (!detail) return undefined;
    const slotted = detail.bySlot?.[slot];
    if (!slotted) return detail;
    return { ...detail, points: slotted.points, rating: slotted.rating };
}

/**
 * Why a 0.0 is ambiguous without this.
 *
 * A chip reading 0.0 could mean the player turned out and did nothing, or that
 * his club has not kicked off yet. Those are opposite pieces of news to someone
 * checking a live matchup, and the pitch rendered them identically.
 *
 * `startedPlayerIds` carries the players whose own club is under way, derived
 * from getLockedPlTeamIds — the same fixture-kickoff signal the lineup lockout
 * uses, rather than a second one invented here.
 */
type PlayStatus = 'pending' | 'played' | 'dnp';

function playStatus(detail: Detail | undefined, hasStarted: boolean): PlayStatus {
    if (!hasStarted) return 'pending';
    return Number(detail?.stats?.minutes_played ?? 0) > 0 ? 'played' : 'dnp';
}

/**
 * Points band for the badge fill. Restores the ramp that the 2.0 pitch port
 * dropped when it replaced .chipScore with a single flat colour — scanning a
 * pitch for who actually returned is the whole job of that number.
 *
 * Thresholds are calculateFantasyPoints() evaluated at the rating ramp's own
 * cutoffs (PremiumPlayerCard.module.css: 8.5/7.5/6.5/6.0/5.5 display), so a
 * given performance colours the same on the pitch badge as it does on the
 * player card. calculateFantasyPoints() is pivot=4.0/scale=8.6/exp=1.5 — if
 * that curve is retuned, regenerate these too or the two ramps drift apart
 * again (matchRating.ts has the exact table).
 */
function ptsBand(points: number): string {
    if (points >= 29) return styles.ptsElite;
    if (points >= 15.8) return styles.ptsGood;
    if (points >= 5.6) return styles.ptsFair;
    if (points >= 2.0) return styles.ptsBelowAvg;
    if (points > 0) return styles.ptsWeak;
    return styles.ptsBad;
}

function PointsBadge({ detail, status }: { detail?: Detail; status: PlayStatus }) {
    if (status === 'pending') {
        return <span className={`${styles.chipPts} ${styles.ptsPending}`} title="Yet to play">–</span>;
    }
    if (status === 'dnp') {
        return <span className={`${styles.chipPts} ${styles.ptsDnp}`} title="Did not play">DNP</span>;
    }
    const pts = detail?.points ?? 0;
    return <span className={`${styles.chipPts} ${ptsBand(pts)}`}>{pts.toFixed(2)}</span>;
}

/**
 * A sub marker. One shape, two tokens: the arrow says the direction and the
 * colour only reinforces it, which is the hub port's "add a form axis rather
 * than a hue" applied to a mark that already had one.
 */
function SubMark({ dir }: { dir: 'in' | 'out' }) {
    const isIn = dir === 'in';
    return (
        <span
            className={`${styles.subMark} ${isIn ? styles.subIn : styles.subOut}`}
            title={isIn ? 'Auto-subbed in' : 'Auto-subbed out'}
        >
            <Icon name={isIn ? 'arrow-up' : 'arrow-down'} size={13} strokeWidth={2} />
        </span>
    );
}

function PlayerChip({ slot, player, detail, status, isSubIn, onClick }: {
    slot: string;
    player?: Partial<Player>;
    detail?: Detail;
    status: PlayStatus;
    isSubIn?: boolean;
    onClick?: () => void;
}) {
    const name = player ? getPlayerDisplayName(player) : '—';
    const { prefetchPlayer } = usePlayerCard();
    const stateCls = status === 'pending' ? styles.chipPending
        : status === 'dnp' ? styles.chipDnp : '';
    return (
        <button
            type="button"
            className={`${styles.chipWrap} ${stateCls}`}
            {...(player?.id ? playerHoverProps(prefetchPlayer, { id: player.id, photo_url: player.photo_url }) : {})}
            onClick={onClick}
            aria-label={`${name}, ${slot}, ${
                status === 'pending' ? 'yet to play'
                    : status === 'dnp' ? 'did not play'
                    : `${(detail?.points ?? 0).toFixed(2)} points`
            }`}
        >
            <span className={styles.chipPortrait}>
                {isSubIn && <SubMark dir="in" />}
                <Portrait
                    photoUrl={player?.photo_url}
                    name={name}
                    club={player?.pl_team}
                    size="md"
                    headTopPct={player?.portrait_head_top_pct}
                    headWidthPct={player?.portrait_head_width_pct}
                    photoVersion={player?.photo_version}
                />
                {player && <PointsBadge detail={detail} status={status} />}
            </span>
            <div className={styles.chipBox}>
                <div className={styles.chipBody}>
                    {isGranular(slot) && (
                        <span className={styles.chipBadgeRow}>
                            <PositionBadge position={slot} size="sm" />
                        </span>
                    )}
                    <p className={styles.chipName}>{name}</p>
                    {/* Always occupy the stats line so a blank chip is the same
                        height as a scored one — `align-items: center` on the
                        zone used to float the shorter card up into the row
                        above. */}
                    <p className={styles.chipStats}>{fmtStats(detail, slot) || '\u00a0'}</p>
                </div>
            </div>
        </button>
    );
}

const BENCH_SLOT_TITLE: Record<BenchSlot, string> = {
    DEF: 'Defender',
    MID: 'Midfielder',
    ATT: 'Attacker',
    FLEX: 'Flex',
};

/**
 * A bench chip takes the player's OWN position, because he is not filling a
 * starter slot. The DEF/MID/ATT/FLEX caption under the chip is the bench
 * *category* — where he sits, not what he covers. 1.0 painted that category
 * in position hues, which is the hub port's "the hue already means centre-back
 * everywhere else" defect: a bench category is not a position, and flex had no
 * hue at all so it borrowed text-muted.
 */
function BenchChip({ slot, player, detail, status, isSubOut, onClick }: {
    slot: BenchSlot;
    player?: Partial<Player>;
    detail?: Detail;
    status: PlayStatus;
    isSubOut?: boolean;
    onClick?: () => void;
}) {
    const pos = player?.primary_position;
    const name = player ? getPlayerDisplayName(player) : '—';
    const { prefetchPlayer } = usePlayerCard();
    const stateCls = !player ? ''
        : status === 'pending' ? styles.chipPending
        : status === 'dnp' ? styles.chipDnp : '';
    return (
        <button
            type="button"
            className={`${styles.chipWrap} ${styles.benchChipWrap} ${stateCls}`}
            {...(player?.id ? playerHoverProps(prefetchPlayer, { id: player.id, photo_url: player.photo_url }) : {})}
            onClick={onClick}
            disabled={!player}
            aria-label={`${BENCH_SLOT_TITLE[slot]} bench, ${name}`}
        >
            <span className={styles.chipPortrait}>
                {isSubOut && <SubMark dir="out" />}
                <Portrait
                    photoUrl={player?.photo_url}
                    name={name}
                    club={player?.pl_team}
                    size="sm"
                    headTopPct={player?.portrait_head_top_pct}
                    headWidthPct={player?.portrait_head_width_pct}
                    photoVersion={player?.photo_version}
                />
                {player && <PointsBadge detail={detail} status={status} />}
            </span>
            <div className={`${styles.chipBox} ${styles.benchChipBox}`}>
                <div className={styles.chipBody}>
                    {isGranular(pos) && (
                        <span className={styles.chipBadgeRow}>
                            <PositionBadge position={pos} size="sm" />
                        </span>
                    )}
                    <p className={styles.chipName}>{name}</p>
                </div>
            </div>
        </button>
    );
}

/* ── Group starters into zones ────────────────────────────────────── */
function groupByZone(starters: { player_id: string; slot: string; isSubIn?: boolean }[]) {
    const z: Record<Zone, { player_id: string; slot: string; isSubIn?: boolean }[]> = {
        ATT: [], AMZ: [], CMZ: [], DMZ: [], WBZ: [], DEF: [], GK: [],
    };
    // SAFETY: lineup slots are always one of the 12 GranularPosition values, never an arbitrary string.
    for (const s of starters) z[SLOT_TO_ZONE[s.slot as GranularPosition] ?? 'CMZ'].push(s);
    return z;
}

/* ── Resolve Autosubs ─────────────────────────────────────────────── */
/**
 * Which starter slots got covered by a bench player, and which bench slots
 * show the player they covered for — driven entirely by `calculateTeamScore`'s
 * own `detail.subs`, the same list that produced the score being displayed.
 *
 * This used to re-walk the lineup and re-derive eligibility itself, gated on
 * `matchupStatus === 'completed'` — which meant no sub ever showed while a
 * matchup was live, and a second implementation of the same eligibility rule
 * that could (and did) disagree with the one that actually computed the score.
 */
function resolveSubs(
    lineup: MatchupLineup | null,
    detail: TeamScoreDetail | undefined,
) {
    if (!lineup) return { starters: [], bench: [] };

    const subsByOutId = new Map((detail?.subs ?? []).map((s) => [s.outId, s]));
    const subsByInId = new Map((detail?.subs ?? []).map((s) => [s.inId, s]));

    const starters = (lineup.starters || []).map((s) => {
        const sub = subsByOutId.get(s.player_id);
        if (sub) return { player_id: sub.inId, slot: s.slot, isSubIn: true };
        return { ...s, isSubIn: false };
    });

    const bench = (lineup.bench ?? []).map((b) => {
        const sub = subsByInId.get(b.player_id);
        if (sub) return { ...b, player_id: sub.outId, isSubOut: true };
        return { ...b, isSubOut: false };
    });

    return { starters, bench };
}

const isBenchSlot = (s: unknown): s is BenchSlot =>
    s === 'DEF' || s === 'MID' || s === 'ATT' || s === 'FLEX';

/** DEF → MID → ATT → FLEX, which is both the saved order and auto-sub search. */
function orderedBench<T extends { slot?: string }>(bench: T[]): { slot: BenchSlot; row: T | null }[] {
    const used = new Set<string>();
    const rows = getExpectedBenchSlots().map((slot) => {
        const row = bench.find((b) => b.slot === slot) ?? null;
        if (row) used.add(slot);
        return { slot, row };
    });
    for (const b of bench) {
        if (!b.slot || used.has(b.slot)) continue;
        rows.push({ slot: isBenchSlot(b.slot) ? b.slot : 'FLEX', row: b });
    }
    return rows;
}

/* ── Main component ───────────────────────────────────────────────── */
interface Props {
    lineupA: MatchupLineup | null;
    lineupB: MatchupLineup | null;
    playerMap: Record<string, Partial<Player>>;
    detailMap: Record<string, Detail>;
    /**
     * Banded performance groups per starter, keyed by player id, already
     * scored at the slot he was fielded in. Server-built — see
     * buildLineupPerformance. Absent for a player who did not appear.
     */
    perfMap?: Record<string, PerfGroup[]>;
    /** The gameweek this board is showing. Carried into the player card so a
     *  chip opens on the match you clicked, not on the card front. */
    gameweek?: number | null;
    teamAName: string;
    teamBName: string;
    teamAId?: string;
    teamBId?: string;
    crestA?: CrestConfig | null;
    crestB?: CrestConfig | null;
    /**
     * Players whose own club has kicked off. Anything not in here is still to
     * come, so its 0.0 means "not yet", not "did nothing" — see PlayStatus.
     * An array rather than a Set because this crosses the server/client
     * boundary as an RSC prop.
     */
    startedPlayerIds?: string[];
    /**
     * The scores actually shown in the header — `calculateTeamScore`'s output
     * (or the persisted `matchup.score_a/b` once completed). The breakdown
     * total below reads these directly rather than re-summing the lineup
     * itself, so the two numbers on the page can't disagree.
     */
    scoreA?: number;
    scoreB?: number;
    /** What `calculateTeamScore` actually did — subs, blanked starters, bench bonus. */
    detailA?: TeamScoreDetail;
    detailB?: TeamScoreDetail;
}

export default function MatchupPitch({
    lineupA, lineupB, playerMap, detailMap, perfMap, gameweek, teamAName, teamBName, teamAId, teamBId, crestA, crestB,
    startedPlayerIds, scoreA = 0, scoreB = 0, detailA, detailB,
}: Props) {
    // One breakdown row open at a time. The two columns share this, so opening
    // a player on one side closes the other — the block is tall enough that two
    // open at once pushes the second team's rows off a phone screen.
    const [openPerfId, setOpenPerfId] = useState<string | null>(null);
    // Undefined means the page could not resolve kickoffs (FPL unreachable).
    // Treat every player as started in that case: showing a real 0.0 to someone
    // who has played is a smaller error than labelling a finished match "yet to
    // play".
    const started = startedPlayerIds ? new Set(startedPlayerIds) : null;
    const statusOf = (playerId: string): PlayStatus =>
        playStatus(detailMap[playerId], started ? started.has(playerId) : true);
    // The page already loaded FULL_PLAYER_SELECT + ranks for every player on
    // the pitch. Opening by id would wait on `/api/players/:id/card` anyway —
    // that's why this surface felt slower than lineup/club, which hand the
    // card a player they already hold. Prime the cache on mount so a click
    // from the match report (still id-only) is instant too.
    const { openPlayer, primePlayers } = usePlayerCard();
    useEffect(() => {
        const rows = Object.values(playerMap).filter((p): p is Partial<Player> & { id: string } => Boolean(p.id));
        if (rows.length) primePlayers(rows as Player[]);
    }, [playerMap, primePlayers]);
    // Carries the gameweek, so the card lands on THIS match's game-log row
    // rather than the front with no match context at all.
    const setViewingPlayer = useCallback(
        (p: Partial<Player> | null) => {
            if (p?.id) openPlayer(p as Player, { gameweek: gameweek ?? null });
        },
        [openPlayer, gameweek],
    );

    const resolvedA = resolveSubs(lineupA, detailA);
    const resolvedB = resolveSubs(lineupB, detailB);

    const zonesA = groupByZone(resolvedA.starters);
    const zonesB = groupByZone(resolvedB.starters);

    // Bench bonus total and the breakdown total both come straight from
    // `calculateTeamScore`'s own output (via props) rather than being
    // re-derived here — see the Props doc comment for why.
    const benchBonusA = detailA?.benchBonusTotal ?? 0;
    const benchBonusB = detailB?.benchBonusTotal ?? 0;

    function renderHalf(
        zones: ReturnType<typeof groupByZone> | null,
        hasLineup: boolean,
        teamName: string,
        teamId?: string,
        crestConfig?: CrestConfig | null,
        sideKey: string = 'a',
    ) {
        return (
            <div className={styles.half}>
                <div className={styles.halfField}>
                    <div className={styles.halfTopLine} />
                    <div className={styles.halfTopCircle} />
                    <div className={styles.halfPenaltyBox} />
                    <div className={styles.halfPenaltyArc} />
                    <div className={styles.halfGoalBox} />

                    <div className={styles.halfTeamLabel}>
                        {teamId && (
                            <CrestBadge config={crestConfig} size={24} teamName={teamName} teamId={teamId} />
                        )}
                        <span className={`g-label ${styles.halfTeamName}`}>{teamName}</span>
                    </div>

                    {!hasLineup && (
                        <p className={styles.emptyLineup}>No lineup was set for this gameweek.</p>
                    )}

                    <div className={styles.zones}>
                        {ZONE_ORDER.filter((zone) => (zones?.[zone] ?? []).length > 0).map((zone) => (
                            <div
                                key={`${sideKey}-${zone}`}
                                className={`${styles.zoneRow} ${styles[`zone${zone}`] ?? ''}`}
                            >
                                <div className={styles.zone}>
                                    {(zones?.[zone] ?? []).map((s) => (
                                        <PlayerChip
                                            key={s.player_id}
                                            slot={s.slot}
                                            player={playerMap[s.player_id]}
                                            detail={detailAtSlot(detailMap[s.player_id], s.slot)}
                                            status={statusOf(s.player_id)}
                                            isSubIn={s.isSubIn}
                                            onClick={() => setViewingPlayer(playerMap[s.player_id] ?? null)}
                                        />
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    const sides = [
        { key: 'a', name: teamAName, bench: resolvedA.bench, starters: resolvedA.starters, bonus: benchBonusA, total: scoreA },
        { key: 'b', name: teamBName, bench: resolvedB.bench, starters: resolvedB.starters, bonus: benchBonusB, total: scoreB },
    ];

    return (
        <section className={`${styles.board} g-panel`}>
            {/* Rationed to a panel representing a whole squad or the whole pool.
                This one carries two complete XIs plus both benches. */}
            <div className={`g-spectrum ${styles.spectrum}`} aria-hidden="true">
                {SPINE.map((p) => <i key={p} style={{ background: POS_COLOR[p] }} />)}
            </div>

            <div className={styles.pitchGrid}>
                {renderHalf(zonesA, resolvedA.starters.length > 0, teamAName, teamAId, crestA, 'a')}
                {renderHalf(zonesB, resolvedB.starters.length > 0, teamBName, teamBId, crestB, 'b')}
            </div>

            {/* ── Benches ───────────────────────────────────────────── */}
            <div className={styles.benches}>
                {sides.map(({ key, name, bench, bonus }) => (
                    <div key={key} className={styles.bench}>
                        <div className={styles.benchHead}>
                            <h3 className={styles.benchName}>{name} — Bench</h3>
                            {bonus > 0 && (
                                <span className={styles.benchBonus}>+{bonus.toFixed(2)}</span>
                            )}
                        </div>
                        <div className={styles.benchChips}>
                            {orderedBench(bench).map(({ slot, row }) => {
                                const pid = row?.player_id;
                                const player = pid ? playerMap[pid] : undefined;
                                return (
                                    <div key={`${slot}-${pid ?? 'empty'}`} className={styles.benchSlot}>
                                        <BenchChip
                                            slot={slot}
                                            player={player}
                                            detail={pid ? detailMap[pid] : undefined}
                                            status={pid ? statusOf(pid) : 'pending'}
                                            isSubOut={row?.isSubOut}
                                            onClick={player ? () => setViewingPlayer(player) : undefined}
                                        />
                                        <span className={styles.benchSlotLabel} title={BENCH_SLOT_TITLE[slot]}>{slot}</span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>

            {/* ── The breakdown ─────────────────────────────────────── */}
            <div className={styles.breakdown}>
                <span className={`g-label ${styles.breakdownHead}`}>Points breakdown</span>
                <div className={styles.breakdownGrid}>
                    {sides.map(({ key, name, starters, total, bonus }) => (
                        <div key={key} className={styles.breakdownCol}>
                            <div className={styles.breakdownColHead}>
                                <span className={styles.breakdownColName}>{name}</span>
                                <span className={styles.breakdownColTotal}>{total.toFixed(2)}</span>
                            </div>
                            {starters.map((s, i) => {
                                const p = playerMap[s.player_id];
                                const detail = detailAtSlot(detailMap[s.player_id], s.slot);
                                const perf = perfMap?.[s.player_id];
                                const isOpen = openPerfId === s.player_id;
                                return (
                                    <div key={s.player_id} className={styles.breakdownEntry}>
                                    <div
                                        className={`${styles.breakdownRow} ${i % 2 !== 0 ? styles.breakdownRowAlt : ''} ${perf ? styles.breakdownRowOpenable : ''} ${isOpen ? styles.breakdownRowOpen : ''}`}
                                        role={perf ? 'button' : undefined}
                                        tabIndex={perf ? 0 : undefined}
                                        aria-expanded={perf ? isOpen : undefined}
                                        aria-label={perf ? `${p ? getPlayerDisplayName(p) : 'Player'} — how this score was earned` : undefined}
                                        onClick={perf ? () => setOpenPerfId(isOpen ? null : s.player_id) : undefined}
                                        onKeyDown={perf ? (e) => {
                                            if (e.key === 'Enter' || e.key === ' ') {
                                                e.preventDefault();
                                                setOpenPerfId(isOpen ? null : s.player_id);
                                            }
                                        } : undefined}
                                    >
                                        <div className={styles.breakdownLeft}>
                                            {isGranular(s.slot) && <PositionBadge position={s.slot} size="sm" />}
                                            <div className={styles.breakdownIdentity}>
                                                <p className={styles.breakdownName}>
                                                    <span className={styles.breakdownNameText}>
                                                        {p ? getPlayerDisplayName(p) : '—'}
                                                    </span>
                                                    {s.isSubIn && (
                                                        <span title="Auto-subbed in" className={styles.breakdownSubIcon}>
                                                            <Icon name="arrow-up" size={13} strokeWidth={2} />
                                                        </span>
                                                    )}
                                                </p>
                                                {detail?.stats && (
                                                    <p className={styles.breakdownStats}>
                                                        {fmtStats(detail, s.slot)}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                        <span className={styles.breakdownPts}>
                                            {detail?.points.toFixed(2) ?? '—'}
                                        </span>
                                    </div>
                                    {isOpen && perf && (
                                        <div className={styles.breakdownPerf}>
                                            <PerformanceBlock
                                                groups={perf}
                                                note={`Centre line is the median for ${roleArticle(s.slot)}`}
                                            />
                                        </div>
                                    )}
                                    </div>
                                );
                            })}
                            {bonus > 0 && (
                                <div className={`${styles.breakdownRow} ${styles.breakdownBonusRow} ${starters.length % 2 !== 0 ? styles.breakdownRowAlt : ''}`}>
                                    <div className={styles.breakdownLeft}>
                                        <p className={styles.breakdownName}>
                                            <span className={styles.breakdownNameText}>
                                                Bench contribution ({BENCH_DEPTH_BONUS_LABEL})
                                            </span>
                                        </p>
                                    </div>
                                    <span className={styles.breakdownPts}>{bonus.toFixed(2)}</span>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            {/* The player card modal is owned by PlayerCardProvider in the dashboard layout. */}
        </section>
    );
}
