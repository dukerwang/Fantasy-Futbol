'use client';

import type { MatchupLineup, Player } from '@/types';
import { formatPlayerName } from '@/lib/formatName';
import { getScoreIntensityColor } from '@/lib/utils/scoreColor';
import styles from './MatchupPitch.module.css';

/* ── Zone / colour config (from prototype tailwind theme) ─────────── */
type Zone = 'ATT' | 'AMZ' | 'CMZ' | 'DMZ' | 'DEF' | 'GK';

const ZONE_ORDER: Zone[] = ['ATT', 'AMZ', 'CMZ', 'DMZ', 'DEF', 'GK'];

// Exact hex values from prototype tailwind config
const SLOT_COLOR: Record<string, string> = {
    GK: '#f59e0b',
    LB: '#3b82f6', CB: '#3b82f6', RB: '#3b82f6', DM: '#3b82f6',
    CM: '#8b5cf6', LM: '#8b5cf6', RM: '#8b5cf6', AM: '#8b5cf6',
    LW: '#ef4444', ST: '#ef4444', RW: '#ef4444',
};

const BENCH_COLOR: Record<string, string> = {
    def: '#3b82f6', mid: '#8b5cf6', atk: '#ef4444', flex: '#6b7280',
};

const SLOT_TO_ZONE: Record<string, Zone> = {
    // ATT row: pure attackers (LW, ST, RW)
    LW: 'ATT', ST: 'ATT', RW: 'ATT',
    // AMZ row: AM + LM/RM (wide attacking mids line up with AM)
    AM: 'AMZ', LM: 'AMZ', RM: 'AMZ',
    // CM row close to DM (lower than AM)
    CM: 'CMZ',
    // DM row
    DM: 'DMZ',
    // Defenders
    CB: 'DEF', LB: 'DEF', RB: 'DEF',
    GK: 'GK',
};

/* ── Stats formatter — matches prototype "2G · 4SOT · 8.9 rating" ── */
function fmtStats(stats: Record<string, any> | undefined, slot: string): string {
    if (!stats) return '';
    const zone = SLOT_TO_ZONE[slot] ?? 'CMZ';
    const parts: string[] = [];
    const g = Number(stats.goals_scored ?? 0);
    const a = Number(stats.assists ?? 0);
    const cs = Number(stats.clean_sheets ?? 0);
    const rtg = stats.minutes_played ? Number(stats.rating ?? 0).toFixed(1) : null;

    if (zone === 'GK') {
        const sv = Number(stats.saves ?? 0);
        if (sv) parts.push(`${sv} Sv`);
        if (cs) parts.push('CS');
    } else if (zone === 'DEF' || zone === 'DMZ') {
        if (cs) parts.push('CS');
        const tk = Number(stats.tackles ?? 0);
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
type Detail = { points: number; stats?: Record<string, any> };

function PlayerChip({ slot, player, detail }: {
    slot: string;
    player?: Partial<Player>;
    detail?: Detail;
}) {
    const bg = SLOT_COLOR[slot] ?? '#6b7280';
    const sc = detail ? getScoreIntensityColor(detail.points) : null;
    return (
        <div className={styles.chip}>
            {sc && detail && (
                <span className={styles.chipScore} style={{ background: sc.bg, color: sc.text }}>
                    {detail.points.toFixed(1)}
                </span>
            )}
            {/* Line 1: position badge */}
            <div className={styles.chipPosRow}>
                <span className={styles.chipPosLabel} style={{ background: bg }}>{slot}</span>
            </div>
            {/* Line 2: name */}
            <p className={styles.chipName}>
                {player ? formatPlayerName(player) : '—'}
            </p>
        </div>
    );
}

function BenchChip({ slotType, player, detail }: {
    slotType: string;
    player?: Partial<Player>;
    detail?: Detail;
}) {
    const pos = player?.primary_position ?? slotType.toUpperCase().slice(0, 3);
    const bg = SLOT_COLOR[player?.primary_position ?? ''] ?? BENCH_COLOR[slotType] ?? '#6b7280';
    const sc = detail ? getScoreIntensityColor(detail.points) : null;
    return (
        <div className={styles.benchChip}>
            {sc && detail && (
                <span className={styles.benchScore} style={{ background: sc.bg, color: sc.text }}>
                    {detail.points.toFixed(1)}
                </span>
            )}
            <div className={styles.chipPosRow}>
                <span className={styles.chipPosLabel} style={{ background: bg, fontSize: '0.4rem', padding: '1px 4px' }}>
                    {pos}
                </span>
            </div>
            <p className={styles.benchChipName}>
                {player ? formatPlayerName(player) : '—'}
            </p>
        </div>
    );
}

function slotOffset(slot: string): number {
    if (['LW', 'RW', 'LM', 'RM'].includes(slot)) return 10;  // wingers drop down
    if (slot === 'CM') return -25;                             // CM rises toward attackers
    if (slot === 'DM') return -35;                             // DM rises toward CM
    return 0;
}

/* ── Group starters into zones ────────────────────────────────────── */
function groupByZone(starters: { player_id: string; slot: string }[]) {
    const z: Record<Zone, { player_id: string; slot: string }[]> = {
        ATT: [], AMZ: [], CMZ: [], DMZ: [], DEF: [], GK: [],
    };
    for (const s of starters) z[SLOT_TO_ZONE[s.slot] ?? 'CMZ'].push(s);
    return z;
}

/* ── Main component ───────────────────────────────────────────────── */
interface Props {
    lineupA: MatchupLineup | null;
    lineupB: MatchupLineup | null;
    playerMap: Record<string, Partial<Player>>;
    detailMap: Record<string, Detail>;
    teamAName: string;
    teamBName: string;
}

export default function MatchupPitch({
    lineupA, lineupB, playerMap, detailMap, teamAName, teamBName,
}: Props) {
    const zonesA = lineupA ? groupByZone(lineupA.starters) : null;
    const zonesB = lineupB ? groupByZone(lineupB.starters) : null;

    const totalA = (lineupA?.starters ?? []).reduce((s, x) => s + (detailMap[x.player_id]?.points ?? 0), 0);
    const totalB = (lineupB?.starters ?? []).reduce((s, x) => s + (detailMap[x.player_id]?.points ?? 0), 0);

    // Always render all 6 zone rows — empty rows act as spacers so
    // CMZ stays at position 3/6 even when AMZ has no players.
    const visibleZones = ZONE_ORDER;

    function renderHalfPitch(
        zones: ReturnType<typeof groupByZone> | null,
        teamName: string,
        sideKey: string,
    ) {
        return (
            <div className={styles.halfOuter}>
                <div className={styles.halfField}>
                    <div className={styles.halfTopLine} />
                    <div className={styles.halfTopCircle} />
                    <div className={styles.halfPenaltyBox} />
                    <div className={styles.halfPenaltyArc} />
                    <div className={styles.halfGoalBox} />
                    <div className={styles.halfTeamLabel}>
                        <span>{teamName}</span>
                    </div>
                    <div className={styles.pitchHalfZones}>
                        {visibleZones.map((zone) => (
                            <div key={`${sideKey}-${zone}`} className={styles.pitchHalfZoneRow}>
                                <div className={styles.halfZone}>
                                    {(zones?.[zone] ?? []).map((s) => {
                                        const dy = slotOffset(s.slot);
                                        return (
                                            <div key={s.player_id} style={dy ? { transform: `translateY(${dy}px)` } : undefined}>
                                                <PlayerChip
                                                    slot={s.slot}
                                                    player={playerMap[s.player_id]}
                                                    detail={detailMap[s.player_id]}
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

    return (
        <div className={styles.wrapper}>
            {/* Two vertically oriented half-pitches (attack top / GK bottom), side by side */}
            <div className={styles.pitchSurface}>
                <div className={styles.pitchHalvesGrid}>
                    {renderHalfPitch(zonesA, teamAName, 'a')}
                    {renderHalfPitch(zonesB, teamBName, 'b')}
                </div>
            </div>

            {/* ── Bench ─────────────────────────────────────────────── */}
            {[
                { lineup: lineupA, name: teamAName },
                { lineup: lineupB, name: teamBName },
            ].map(({ lineup, name }) => {
                const benchRawTotal = (lineup?.bench as any[] ?? []).reduce((s, b) => s + (detailMap[b.player_id]?.points ?? 0), 0);
                const benchContributed = benchRawTotal * 0.2;
                return (
                <div key={name} className={styles.benchSection}>
                    <div className={styles.benchHeaderRow}>
                        <p className={styles.benchSectionLabel}>{name} — Bench</p>
                        {benchContributed > 0 && <span className={styles.benchTotalLabel}>+{benchContributed.toFixed(1)} pts</span>}
                    </div>
                    <div className={styles.benchChipsRow}>
                        {(lineup?.bench as any[] ?? []).map((b) => (
                            <BenchChip
                                key={b.player_id}
                                slotType={b.slot_type ?? b.slot ?? 'flex'}
                                player={playerMap[b.player_id]}
                                detail={detailMap[b.player_id]}
                            />
                        ))}
                    </div>
                </div>
                );
            })}

            {/* ── Player Points Breakdown ────────────────────────────── */}
            <div className={styles.breakdown}>
                <div className={styles.breakdownHeaderRow}>
                    <h3 className={styles.breakdownTitle}>Player Points Breakdown</h3>
                </div>
                <div className={styles.breakdownGrid}>
                    {[
                        { lineup: lineupA, name: teamAName, total: totalA },
                        { lineup: lineupB, name: teamBName, total: totalB },
                    ].map(({ lineup, name, total }) => (
                        <div key={name} className={styles.breakdownCol}>
                            <div className={styles.breakdownColHeader}>
                                <span className={styles.breakdownColName}>{name}</span>
                                <span className={styles.breakdownColTotal}>{total.toFixed(1)} Total</span>
                            </div>
                            {(lineup?.starters ?? []).map((s, i) => {
                                const p = playerMap[s.player_id];
                                const detail = detailMap[s.player_id];
                                const bar = SLOT_COLOR[s.slot] ?? '#6b7280';
                                return (
                                    <div
                                        key={s.player_id}
                                        className={`${styles.breakdownRow} ${i % 2 !== 0 ? styles.breakdownRowAlt : ''}`}
                                    >
                                        <div className={styles.breakdownLeft}>
                                            <span className={styles.breakdownBar} style={{ background: bar }} />
                                            <div>
                                                <p className={styles.breakdownName}>
                                                    {p ? formatPlayerName(p) : '—'}
                                                </p>
                                                {detail?.stats && (
                                                    <p className={styles.breakdownStats}>
                                                        {fmtStats(detail.stats, s.slot)}
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
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
