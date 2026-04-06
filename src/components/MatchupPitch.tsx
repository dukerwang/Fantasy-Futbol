'use client';

import type { MatchupLineup, Player } from '@/types';
import { formatPlayerName } from '@/lib/formatName';
import { getScoreIntensityColor } from '@/lib/utils/scoreColor';
import styles from './MatchupPitch.module.css';

// ── Position colours ──────────────────────────────────────────────────────────
const POS_COLOR: Record<string, string> = {
    GK:  '#d97706',
    CB:  '#2563eb', LB: '#3b82f6', RB: '#3b82f6',
    DM:  '#7c3aed', CM: '#8b5cf6', LM: '#8b5cf6', RM: '#8b5cf6',
    AM:  '#a855f7',
    LW:  '#16a34a', RW: '#15803d',
    ST:  '#dc2626',
};

const BENCH_COLORS: Record<string, string> = {
    def: '#2563eb',
    mid: '#8b5cf6',
    atk: '#dc2626',
    flex: '#6b7280',
};

// ── Zone grouping ─────────────────────────────────────────────────────────────
const SLOT_TO_ZONE: Record<string, 'ATT' | 'MID' | 'DEF' | 'GK'> = {
    LW: 'ATT', ST: 'ATT', RW: 'ATT', AM: 'ATT',
    CM: 'MID', LM: 'MID', RM: 'MID',
    DM: 'DEF', CB: 'DEF', LB: 'DEF', RB: 'DEF',
    GK: 'GK',
};
const ZONE_ORDER = ['ATT', 'MID', 'DEF', 'GK'] as const;

type Zone = typeof ZONE_ORDER[number];

// ── Stats formatting (key stats per position) ─────────────────────────────────
function formatBreakdownStats(stats: Record<string, any>, slot: string): string {
    if (!stats || !Object.keys(stats).length) return '';
    const parts: string[] = [];
    const g = Number(stats.goals_scored ?? 0);
    const a = Number(stats.assists ?? 0);
    const sot = Number(stats.shots_on_target ?? 0);
    const cs = Number(stats.clean_sheets ?? 0);
    const saves = Number(stats.saves ?? 0);
    const tackles = Number(stats.tackles ?? 0);
    const kp = Number(stats.key_passes ?? 0);
    const dribbles = Number(stats.successful_dribbles ?? 0);
    const rating = stats.minutes_played ? Number(stats.rating ?? 0).toFixed(1) : null;

    const zone = SLOT_TO_ZONE[slot] ?? 'MID';

    if (zone === 'GK') {
        if (saves) parts.push(`${saves} Sv`);
        if (cs) parts.push('CS');
    } else if (zone === 'DEF') {
        if (cs) parts.push('CS');
        if (tackles) parts.push(`${tackles} Tk`);
    } else if (zone === 'MID') {
        if (g) parts.push(`${g}G`);
        if (a) parts.push(`${a}A`);
        if (kp) parts.push(`${kp} KP`);
    } else {
        if (g) parts.push(`${g}G`);
        if (a) parts.push(`${a}A`);
        if (sot) parts.push(`${sot} SOT`);
        if (!g && !a && dribbles) parts.push(`${dribbles} Dr`);
    }
    if (rating) parts.push(`${rating} rtg`);
    return parts.join(' · ');
}

// ── Sub-components ────────────────────────────────────────────────────────────
interface PlayerDetail { points: number; stats?: Record<string, any> }

function PlayerChip({ playerId, slot, player, detail }: {
    playerId: string; slot: string; player?: Partial<Player>; detail?: PlayerDetail;
}) {
    const bg = POS_COLOR[slot] ?? '#6b7280';
    const sc = detail ? getScoreIntensityColor(detail.points) : null;
    return (
        <div className={styles.chip}>
            <span className={styles.chipPos} style={{ background: bg }}>{slot}</span>
            <span className={styles.chipName}>{player ? formatPlayerName(player) : '—'}</span>
            {sc && detail && (
                <span className={styles.chipScore} style={{ background: sc.bg, color: sc.text }}>
                    {detail.points.toFixed(1)}
                </span>
            )}
        </div>
    );
}

function BenchChip({ slot, player, detail }: {
    slot: string; player?: Partial<Player>; detail?: PlayerDetail;
}) {
    // Derive a display position from the player's primary_position or bench slot
    const dispPos = player?.primary_position ?? slot.toUpperCase();
    const bg = POS_COLOR[dispPos] ?? BENCH_COLORS[slot] ?? '#6b7280';
    const sc = detail ? getScoreIntensityColor(detail.points) : null;
    return (
        <div className={styles.benchChip}>
            <span className={styles.chipPos} style={{ background: bg }}>{dispPos.slice(0, 2)}</span>
            <span className={styles.benchChipName}>{player ? formatPlayerName(player) : '—'}</span>
            {sc && detail && (
                <span className={styles.chipScore} style={{ background: sc.bg, color: sc.text }}>
                    {detail.points.toFixed(1)}
                </span>
            )}
        </div>
    );
}

// ── Main component ────────────────────────────────────────────────────────────
interface Props {
    lineupA:  MatchupLineup | null;
    lineupB:  MatchupLineup | null;
    playerMap: Record<string, Partial<Player>>;
    detailMap: Record<string, PlayerDetail>;
    teamAName: string;
    teamBName: string;
}

function groupByZone(starters: { player_id: string; slot: string }[]) {
    const zones: Record<Zone, typeof starters> = { ATT: [], MID: [], DEF: [], GK: [] };
    for (const s of starters) {
        const z = SLOT_TO_ZONE[s.slot] ?? 'MID';
        zones[z].push(s);
    }
    return zones;
}

export default function MatchupPitch({
    lineupA, lineupB, playerMap, detailMap, teamAName, teamBName,
}: Props) {
    const zonesA = lineupA ? groupByZone(lineupA.starters) : null;
    const zonesB = lineupB ? groupByZone(lineupB.starters) : null;

    // Starters totals for breakdown header
    const totalA = (lineupA?.starters ?? []).reduce(
        (s, x) => s + (detailMap[x.player_id]?.points ?? 0), 0,
    );
    const totalB = (lineupB?.starters ?? []).reduce(
        (s, x) => s + (detailMap[x.player_id]?.points ?? 0), 0,
    );

    return (
        <div className={styles.wrapper}>
            {/* ── Pitch ──────────────────────────────────────────────────── */}
            <div className={styles.pitchOuter}>
                <div className={styles.pitch}>

                    {/* Team name labels top-left / top-right */}
                    <div className={styles.pitchTeamLabels}>
                        <span className={styles.pitchTeamLabel}>{teamAName}</span>
                        <span className={`${styles.pitchTeamLabel} ${styles.right}`}>{teamBName}</span>
                    </div>

                    {/* Zone rows */}
                    <div className={styles.pitchZones}>
                        {ZONE_ORDER.map((zone) => (
                            <div key={zone} className={styles.pitchRow}>
                                {/* Team A half */}
                                <div className={styles.halfZone}>
                                    {zonesA ? (
                                        zonesA[zone].map((s) => (
                                            <PlayerChip
                                                key={s.player_id}
                                                playerId={s.player_id}
                                                slot={s.slot}
                                                player={playerMap[s.player_id]}
                                                detail={detailMap[s.player_id]}
                                            />
                                        ))
                                    ) : (
                                        zone === 'GK' && (
                                            <span className={styles.emptyHalf}>No lineup set</span>
                                        )
                                    )}
                                </div>

                                {/* Team B half */}
                                <div className={styles.halfZone}>
                                    {zonesB ? (
                                        zonesB[zone].map((s) => (
                                            <PlayerChip
                                                key={s.player_id}
                                                playerId={s.player_id}
                                                slot={s.slot}
                                                player={playerMap[s.player_id]}
                                                detail={detailMap[s.player_id]}
                                            />
                                        ))
                                    ) : (
                                        zone === 'GK' && (
                                            <span className={styles.emptyHalf}>No lineup set</span>
                                        )
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* ── Bench rows ─────────────────────────────────────────── */}
                <div className={styles.benchSection}>
                    {[
                        { lineup: lineupA, label: `${teamAName} — Bench` },
                        { lineup: lineupB, label: `${teamBName} — Bench` },
                    ].map(({ lineup, label }) => (
                        <div key={label} className={styles.benchRow}>
                            <span className={styles.benchLabel}>{label}</span>
                            <div className={styles.benchChips}>
                                {(lineup?.bench as any[] ?? []).map((b) => (
                                    <BenchChip
                                        key={b.player_id}
                                        slot={b.slot_type ?? b.slot ?? 'flex'}
                                        player={playerMap[b.player_id]}
                                        detail={detailMap[b.player_id]}
                                    />
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* ── Player Points Breakdown ─────────────────────────────────── */}
            <div className={styles.breakdown}>
                <h3 className={styles.breakdownTitle}>Player Points Breakdown</h3>
                <div className={styles.breakdownGrid}>
                    {[
                        { lineup: lineupA, name: teamAName, total: totalA },
                        { lineup: lineupB, name: teamBName, total: totalB },
                    ].map(({ lineup, name, total }) => (
                        <div key={name} className={styles.breakdownCol}>
                            <div className={styles.breakdownHeader}>
                                <span className={styles.breakdownTeamName}>{name}</span>
                                <span className={styles.breakdownTotal}>{total.toFixed(1)} Total</span>
                            </div>
                            {(lineup?.starters ?? []).map((s) => {
                                const p = playerMap[s.player_id];
                                const detail = detailMap[s.player_id];
                                const bg = POS_COLOR[s.slot] ?? '#6b7280';
                                return (
                                    <div key={s.player_id} className={styles.breakdownRow}>
                                        <span className={styles.breakdownPos} style={{ background: bg }}>
                                            {s.slot}
                                        </span>
                                        <div className={styles.breakdownInfo}>
                                            <span className={styles.breakdownName}>
                                                {p ? formatPlayerName(p) : '—'}
                                            </span>
                                            {detail?.stats && (
                                                <span className={styles.breakdownStats}>
                                                    {formatBreakdownStats(detail.stats, s.slot)}
                                                </span>
                                            )}
                                        </div>
                                        <span className={styles.breakdownPoints}>
                                            {detail ? detail.points.toFixed(1) : '—'}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
