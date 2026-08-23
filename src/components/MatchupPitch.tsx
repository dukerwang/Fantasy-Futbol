'use client';

import { useCallback } from 'react';
import type { MatchupLineup, Player, GranularPosition } from '@/types';
import { POSITION_FLEX_MAP, BENCH_DEPTH_BONUS, BENCH_DEPTH_BONUS_LABEL } from '@/types';
import { getPlayerDisplayName } from '@/lib/players/displayName';
import { SPINE, POS_COLOR } from '@/lib/positions/spine';
import { usePlayerCard } from './players/PlayerCardProvider';
import PositionBadge from './players/PositionBadge';
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
        ? Number(detail.rating).toFixed(1)
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
type Detail = { points: number; rating?: number | null; stats?: MatchStatsSnapshot };

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
 */
function ptsBand(points: number): string {
    if (points >= 18) return styles.ptsElite;
    if (points >= 12) return styles.ptsGood;
    if (points >= 7) return styles.ptsFair;
    if (points >= 3) return styles.ptsPoor;
    return styles.ptsBlank;
}

function PointsBadge({ detail, status }: { detail?: Detail; status: PlayStatus }) {
    if (status === 'pending') {
        return <span className={`${styles.chipPts} ${styles.ptsPending}`} title="Yet to play">–</span>;
    }
    if (status === 'dnp') {
        return <span className={`${styles.chipPts} ${styles.ptsDnp}`} title="Did not play">DNP</span>;
    }
    const pts = detail?.points ?? 0;
    return <span className={`${styles.chipPts} ${ptsBand(pts)}`}>{pts.toFixed(1)}</span>;
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
    const stateCls = status === 'pending' ? styles.chipPending
        : status === 'dnp' ? styles.chipDnp : '';
    return (
        <button
            type="button"
            className={`${styles.chip} ${stateCls}`}
            onClick={onClick}
            aria-label={`${name}, ${slot}, ${
                status === 'pending' ? 'yet to play'
                    : status === 'dnp' ? 'did not play'
                    : `${(detail?.points ?? 0).toFixed(1)} points`
            }`}
        >
            {isSubIn && <SubMark dir="in" />}
            {player && <PointsBadge detail={detail} status={status} />}
            {isGranular(slot) && (
                <span className={styles.chipBadgeRow}>
                    <PositionBadge position={slot} size="sm" />
                </span>
            )}
            <p className={styles.chipName}>{name}</p>
            {detail?.stats && (
                <p className={styles.chipStats}>{fmtStats(detail, slot)}</p>
            )}
        </button>
    );
}

/**
 * A bench chip takes the player's OWN position, because he is not filling a
 * slot. Where there is no player there is no badge — 1.0 painted the bench
 * CATEGORY (def / mid / atk / flex) in position hues, which is the hub port's
 * "the hue already means centre-back everywhere else" defect: a bench category
 * is not a position, and flex had no hue at all so it borrowed text-muted.
 */
function BenchChip({ player, detail, status, isSubOut, onClick }: {
    player?: Partial<Player>;
    detail?: Detail;
    status: PlayStatus;
    isSubOut?: boolean;
    onClick?: () => void;
}) {
    const pos = player?.primary_position;
    const name = player ? getPlayerDisplayName(player) : '—';
    const stateCls = status === 'pending' ? styles.chipPending
        : status === 'dnp' ? styles.chipDnp : '';
    return (
        <button type="button" className={`${styles.benchChip} ${stateCls}`} onClick={onClick} aria-label={name}>
            {isSubOut && <SubMark dir="out" />}
            {player && <PointsBadge detail={detail} status={status} />}
            {isGranular(pos) && (
                <span className={styles.chipBadgeRow}>
                    <PositionBadge position={pos} size="sm" />
                </span>
            )}
            <p className={styles.chipName}>{name}</p>
        </button>
    );
}

function slotOffset(slot: string): number {
    if (['LW', 'RW'].includes(slot)) return 10;  // wingers drop down
    if (slot === 'CM') return -25;                             // CM rises toward attackers
    if (['DM', 'LWB', 'RWB'].includes(slot)) return -35;       // DM and WBs rise toward CM
    return 0;
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
function resolveSubs(
    lineup: MatchupLineup | null,
    detailMap: Record<string, Detail>,
    playerMap: Record<string, Partial<Player>>,
    matchupStatus: string
) {
    if (!lineup) return { starters: [], bench: [] };

    const starters = [...(lineup.starters || [])].map(s => ({ ...s, isSubIn: false }));
    const bench = [...(lineup.bench as any[] || [])].map(b => ({ ...b, isSubOut: false }));

    // Only resolve autosubs for completed gameweeks to avoid premature subs
    if (matchupStatus === 'completed') {
        const usedBenchIds = new Set<string>();

        for (let i = 0; i < starters.length; i++) {
            const starterId = starters[i].player_id;
            const starterMins = detailMap[starterId]?.stats?.minutes_played ?? 0;

            if (starterMins === 0) {
                const slotAllowedPos = POSITION_FLEX_MAP[starters[i].slot as GranularPosition] ?? [];

                for (let j = 0; j < bench.length; j++) {
                    const benchId = bench[j].player_id;
                    if (usedBenchIds.has(benchId)) continue;

                    const benchMins = detailMap[benchId]?.stats?.minutes_played ?? 0;
                    if (benchMins === 0) continue;

                    const player = playerMap[benchId];
                    const subPositions = [player?.primary_position, ...(player?.secondary_positions ?? [])];
                    const canPlaySlot = subPositions.some(pos => slotAllowedPos.includes(pos as GranularPosition));

                    if (canPlaySlot) {
                        usedBenchIds.add(benchId);

                        // Swap them!
                        const tempSlot = starters[i].slot;
                        starters[i] = { player_id: benchId, slot: tempSlot, isSubIn: true };
                        bench[j] = { ...bench[j], player_id: starterId, isSubOut: true };
                        break;
                    }
                }
            }
        }
    }

    return { starters, bench };
}

/* ── Main component ───────────────────────────────────────────────── */
interface Props {
    lineupA: MatchupLineup | null;
    lineupB: MatchupLineup | null;
    playerMap: Record<string, Partial<Player>>;
    detailMap: Record<string, Detail>;
    teamAName: string;
    teamBName: string;
    teamAId?: string;
    teamBId?: string;
    crestA?: CrestConfig | null;
    crestB?: CrestConfig | null;
    matchupStatus?: string;
    /**
     * Players whose own club has kicked off. Anything not in here is still to
     * come, so its 0.0 means "not yet", not "did nothing" — see PlayStatus.
     * An array rather than a Set because this crosses the server/client
     * boundary as an RSC prop.
     */
    startedPlayerIds?: string[];
}

export default function MatchupPitch({
    lineupA, lineupB, playerMap, detailMap, teamAName, teamBName, teamAId, teamBId, crestA, crestB, matchupStatus = 'live',
    startedPlayerIds,
}: Props) {
    // Undefined means the page could not resolve kickoffs (FPL unreachable).
    // Treat every player as started in that case: showing a real 0.0 to someone
    // who has played is a smaller error than labelling a finished match "yet to
    // play".
    const started = startedPlayerIds ? new Set(startedPlayerIds) : null;
    const statusOf = (playerId: string): PlayStatus =>
        playStatus(detailMap[playerId], started ? started.has(playerId) : true);
    // Pitch tiles hold only a partial player, so the card resolves by id off
    // the shared cache rather than painting a half-filled front.
    const { openPlayerById } = usePlayerCard();
    const setViewingPlayer = useCallback(
        (p: Partial<Player> | null) => { if (p?.id) openPlayerById(p.id); },
        [openPlayerById],
    );

    const resolvedA = resolveSubs(lineupA, detailMap, playerMap, matchupStatus);
    const resolvedB = resolveSubs(lineupB, detailMap, playerMap, matchupStatus);

    const zonesA = groupByZone(resolvedA.starters);
    const zonesB = groupByZone(resolvedB.starters);

    function calcBenchBonus(bench: any[]) {
        const rawBenchPts = bench.reduce((sum, b) => {
            if (b.isSubOut) return sum; // this was a starter subbed out
            return sum + (detailMap[b.player_id]?.points ?? 0);
        }, 0);
        return rawBenchPts * BENCH_DEPTH_BONUS;
    }

    const benchBonusA = calcBenchBonus(resolvedA.bench);
    const benchBonusB = calcBenchBonus(resolvedB.bench);

    const totalA = resolvedA.starters.reduce((s, x) => s + (detailMap[x.player_id]?.points ?? 0), 0) + benchBonusA;
    const totalB = resolvedB.starters.reduce((s, x) => s + (detailMap[x.player_id]?.points ?? 0), 0) + benchBonusB;

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
                            <div key={`${sideKey}-${zone}`} className={styles.zoneRow}>
                                <div className={`${styles.zone} ${zone === 'WBZ' ? styles.zoneWBZ : ''}`}>
                                    {(zones?.[zone] ?? []).map((s) => {
                                        const dy = slotOffset(s.slot);
                                        return (
                                            <div key={s.player_id} style={dy ? { transform: `translateY(${dy}px)` } : undefined}>
                                                <PlayerChip
                                                    slot={s.slot}
                                                    player={playerMap[s.player_id]}
                                                    detail={detailMap[s.player_id]}
                                                    status={statusOf(s.player_id)}
                                                    isSubIn={s.isSubIn}
                                                    onClick={() => setViewingPlayer(playerMap[s.player_id] ?? null)}
                                                />
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    const sides = [
        { key: 'a', name: teamAName, bench: resolvedA.bench, starters: resolvedA.starters, bonus: benchBonusA, total: totalA },
        { key: 'b', name: teamBName, bench: resolvedB.bench, starters: resolvedB.starters, bonus: benchBonusB, total: totalB },
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
                                <span className={styles.benchBonus}>+{bonus.toFixed(1)}</span>
                            )}
                        </div>
                        <div className={styles.benchChips}>
                            {bench.map((b: any) => (
                                <BenchChip
                                    key={b.player_id}
                                    player={playerMap[b.player_id]}
                                    detail={detailMap[b.player_id]}
                                    status={statusOf(b.player_id)}
                                    isSubOut={b.isSubOut}
                                    onClick={() => setViewingPlayer(playerMap[b.player_id] ?? null)}
                                />
                            ))}
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
                                <span className={styles.breakdownColTotal}>{total.toFixed(1)}</span>
                            </div>
                            {starters.map((s, i) => {
                                const p = playerMap[s.player_id];
                                const detail = detailMap[s.player_id];
                                return (
                                    <div
                                        key={s.player_id}
                                        className={`${styles.breakdownRow} ${i % 2 !== 0 ? styles.breakdownRowAlt : ''}`}
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
                                            {detail?.points.toFixed(1) ?? '—'}
                                        </span>
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
                                    <span className={styles.breakdownPts}>{bonus.toFixed(1)}</span>
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
