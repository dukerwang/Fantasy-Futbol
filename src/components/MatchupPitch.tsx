'use client';

import { useCallback, useState } from 'react';
import type { MatchupLineup, Player, GranularPosition } from '@/types';
import { POSITION_FLEX_MAP, BENCH_DEPTH_BONUS, BENCH_DEPTH_BONUS_LABEL } from '@/types';
import { getPlayerDisplayName } from '@/lib/players/displayName';
import { getScoreIntensityColor } from '@/lib/utils/scoreColor';
import { usePlayerCard } from './players/PlayerCardProvider';
import CrestBadge from './crest/CrestBadge';
import type { CrestConfig } from './crest/types';
import { Icon } from './ui/Icon';
import styles from './MatchupPitch.module.css';

/* ── Zone / colour config (from prototype tailwind theme) ─────────── */
type Zone = 'ATT' | 'AMZ' | 'CMZ' | 'DMZ' | 'WBZ' | 'DEF' | 'GK';

const ZONE_ORDER: Zone[] = ['ATT', 'AMZ', 'CMZ', 'DMZ', 'WBZ', 'DEF', 'GK'];

const SLOT_COLOR: Record<string, string> = {
    GK: 'var(--color-pos-gk)',
    LB: 'var(--color-pos-fb)',
    CB: 'var(--color-pos-cb)',
    RB: 'var(--color-pos-fb)',
    LWB: 'var(--color-pos-wb)',
    RWB: 'var(--color-pos-wb)',
    DM: 'var(--color-pos-dm)',
    CM: 'var(--color-pos-cm)',
    AM: 'var(--color-pos-am)',
    LW: 'var(--color-pos-lw)',
    ST: 'var(--color-pos-st)',
    RW: 'var(--color-pos-rw)',
};

const BENCH_COLOR: Record<string, string> = {
    def: 'var(--color-pos-fb)', mid: 'var(--color-pos-cm)', atk: 'var(--color-pos-st)', flex: 'var(--color-text-muted)',
};

const SLOT_TO_ZONE: Record<string, Zone> = {
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

function PlayerChip({ slot, player, detail, isSubIn, onClick }: {
    slot: string;
    player?: Partial<Player>;
    detail?: Detail;
    isSubIn?: boolean;
    onClick?: () => void;
}) {
    const bg = SLOT_COLOR[slot] ?? '#6b7280';
    const sc = detail ? getScoreIntensityColor(detail.points) : null;
    return (
        <div className={styles.chip} onClick={onClick} style={{ cursor: onClick ? 'pointer' : undefined }}>
            {isSubIn && <span className={styles.subIconPitch} title="Auto-subbed in"><Icon name="arrow-up" size={14} strokeWidth={2} /></span>}
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
                {player ? getPlayerDisplayName(player) : '—'}
            </p>
            {detail?.stats && (
                <p className={styles.chipSub}>{fmtStats(detail.stats, slot)}</p>
            )}
        </div>
    );
}

function BenchChip({ slotType, player, detail, isSubOut, onClick }: {
    slotType: string;
    player?: Partial<Player>;
    detail?: Detail;
    isSubOut?: boolean;
    onClick?: () => void;
}) {
    const pos = player?.primary_position ?? slotType.toUpperCase().slice(0, 3);
    const bg = SLOT_COLOR[player?.primary_position ?? ''] ?? BENCH_COLOR[slotType] ?? '#6b7280';
    const sc = detail ? getScoreIntensityColor(detail.points) : null;
    return (
        <div className={styles.benchChip} onClick={onClick} style={{ cursor: onClick ? 'pointer' : undefined }}>
            {isSubOut && <span className={styles.subIconBench} title="Auto-subbed out"><Icon name="arrow-down" size={14} strokeWidth={2} /></span>}
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
                {player ? getPlayerDisplayName(player) : '—'}
            </p>
        </div>
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
    for (const s of starters) z[SLOT_TO_ZONE[s.slot] ?? 'CMZ'].push(s);
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
}

export default function MatchupPitch({
    lineupA, lineupB, playerMap, detailMap, teamAName, teamBName, teamAId, teamBId, crestA, crestB, matchupStatus = 'live',
}: Props) {
    // Pitch tiles hold only a partial player, so the card resolves by id off
    // the shared cache rather than painting a half-filled front.
    const { openPlayerById, prefetchPlayer } = usePlayerCard();
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

    // Always render all 6 zone rows — empty rows act as spacers so
    // CMZ stays at position 3/6 even when AMZ has no players.
    const visibleZones = ZONE_ORDER;

    function renderHalfPitch(
        zones: ReturnType<typeof groupByZone> | null,
        teamName: string,
        teamId?: string,
        crestConfig?: CrestConfig | null,
        sideKey: string = 'a',
    ) {
        return (
            <div className={styles.halfOuter}>
                <div className={styles.halfField}>
                    <div className={styles.halfTopLine} />
                    <div className={styles.halfTopCircle} />
                    <div className={styles.halfPenaltyBox} />
                    <div className={styles.halfPenaltyArc} />
                    <div className={styles.halfGoalBox} />
                    <div className={styles.halfTeamLabel} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                        {teamId && (
                            <CrestBadge config={crestConfig} size={22} teamName={teamName} teamId={teamId} />
                        )}
                        <span>{teamName}</span>
                    </div>
                    <div className={styles.pitchHalfZones}>
                        {visibleZones.map((zone) => (
                            <div key={`${sideKey}-${zone}`} className={styles.pitchHalfZoneRow}>
                                <div className={`${styles.halfZone} ${zone === 'WBZ' ? styles.halfZoneWBZ : ''}`}>
                                    {(zones?.[zone] ?? []).map((s) => {
                                        const dy = slotOffset(s.slot);
                                        return (
                                            <div key={s.player_id} style={dy ? { transform: `translateY(${dy}px)` } : undefined}>
                                                <PlayerChip
                                                    slot={s.slot}
                                                    player={playerMap[s.player_id]}
                                                    detail={detailMap[s.player_id]}
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

    return (
        <div className={styles.wrapper}>
            {/* Two vertically oriented half-pitches (attack top / GK bottom), side by side */}
            <div className={styles.pitchSurface}>
                <div className={styles.pitchHalvesGrid}>
                    {renderHalfPitch(zonesA, teamAName, teamAId, crestA, 'a')}
                    {renderHalfPitch(zonesB, teamBName, teamBId, crestB, 'b')}
                </div>
            </div>

            {/* ── Bench ─────────────────────────────────────────────── */}
            {[
                { bench: resolvedA.bench, name: teamAName, bonus: benchBonusA },
                { bench: resolvedB.bench, name: teamBName, bonus: benchBonusB },
            ].map(({ bench, name, bonus }) => {
                return (
                <div key={name} className={styles.benchSection}>
                    <div className={styles.benchHeaderRow}>
                        <p className={styles.benchSectionLabel}>{name} — Bench</p>
                        {bonus > 0 && <span className={styles.benchTotalLabel}>+{bonus.toFixed(1)} bench pts</span>}
                    </div>
                    <div className={styles.benchChipsRow}>
                        {bench.map((b) => (
                            <BenchChip
                                key={b.player_id}
                                slotType={b.slot_type ?? b.slot ?? 'flex'}
                                player={playerMap[b.player_id]}
                                detail={detailMap[b.player_id]}
                                isSubOut={b.isSubOut}
                                onClick={() => setViewingPlayer(playerMap[b.player_id] ?? null)}
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
                        { starters: resolvedA.starters, name: teamAName, total: totalA, bonus: benchBonusA },
                        { starters: resolvedB.starters, name: teamBName, total: totalB, bonus: benchBonusB },
                    ].map(({ starters, name, total, bonus }) => (
                        <div key={name} className={styles.breakdownCol}>
                            <div className={styles.breakdownColHeader}>
                                <span className={styles.breakdownColName}>{name}</span>
                                <span className={styles.breakdownColTotal}>{total.toFixed(1)} Total</span>
                            </div>
                            {starters.map((s, i) => {
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
                                                    {p ? getPlayerDisplayName(p) : '—'}
                                                    {s.isSubIn && <span title="Auto-subbed in" className={styles.breakdownSubIcon}><Icon name="arrow-up" size={14} strokeWidth={2} /></span>}
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
                            {bonus > 0 && (
                                <div className={`${styles.breakdownRow} ${starters.length % 2 !== 0 ? styles.breakdownRowAlt : ''}`}>
                                    <div className={styles.breakdownLeft}>
                                        <span className={styles.breakdownBar} style={{ background: '#d1d5db' }} />
                                        <div>
                                            <p className={styles.breakdownName}>Bench Contribution ({BENCH_DEPTH_BONUS_LABEL})</p>
                                        </div>
                                    </div>
                                    <span className={styles.breakdownPts}>
                                        {bonus.toFixed(1)}
                                    </span>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>
            
            {/* The player card modal is owned by PlayerCardProvider in the dashboard layout. */}
        </div>
    );
}
