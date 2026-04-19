'use client';

import { useState } from 'react';
import type { GranularPosition, MatchupLineup, Player, BenchSlot } from '@/types';
import { FORMATION_SLOTS } from '@/types';
import pitchStyles from './pitch.module.css';
import PlayerDetailsModal from './players/PlayerDetailsModal';
import { formatPlayerName } from '@/lib/formatName';
import { getScoreIntensityColor } from '@/lib/utils/scoreColor';

// ─── Constants ────────────────────────────────────────────────────────────────

const POS_COLOR: Record<GranularPosition, string> = {
    GK: 'var(--color-pos-gk, #f59e0b)',
    CB: 'var(--color-pos-cb, #3b82f6)',
    LB: 'var(--color-pos-fb, #60a5fa)',
    RB: 'var(--color-pos-fb, #60a5fa)',
    DM: 'var(--color-pos-dm, #8b5cf6)',
    CM: 'var(--color-pos-cm, #a78bfa)',
    LM: 'var(--color-pos-wm, #86efac)',
    RM: 'var(--color-pos-wm, #86efac)',
    AM: 'var(--color-pos-am, #f0abfc)',
    LW: 'var(--color-pos-lw, #22c55e)',
    RW: 'var(--color-pos-rw, #16a34a)',
    ST: 'var(--color-pos-st, #ef4444)',
};

const ZONE_ORDER: Array<'ATT' | 'MID' | 'DEF' | 'GK'> = ['ATT', 'MID', 'DEF', 'GK'];
const BENCH_SLOT_NAMES: BenchSlot[] = ['DEF', 'MID', 'ATT', 'FLEX'];

const ZONE_CLASS_MAP = {
    GK: pitchStyles.zoneGK,
    DEF: pitchStyles.zoneDEF,
    MID: pitchStyles.zoneMID,
    ATT: pitchStyles.zoneATT,
} as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getZone(pos: GranularPosition): 'GK' | 'DEF' | 'MID' | 'ATT' {
    if (pos === 'GK') return 'GK';
    if (pos === 'CB' || pos === 'LB' || pos === 'RB') return 'DEF';
    if (pos === 'DM' || pos === 'CM' || pos === 'LM' || pos === 'RM' || pos === 'AM') return 'MID';
    return 'ATT';
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
    lineup: MatchupLineup;
    playerMap: Record<string, Partial<Player>>;
    detailMap?: Record<string, { points: number, stats?: any }>;
    teamName: string;
}

function formatStats(stats: any, pos?: GranularPosition) {
    if (!stats) return '';
    const parts = [];
    if (stats.goals) parts.push(`G: ${stats.goals}`);
    if (stats.assists) parts.push(`A: ${stats.assists}`);
    
    // Only show CS if NOT a wide/attacking player (LM, RM, AM, or ATT)
    const isAttacker = pos && (getZone(pos) === 'ATT' || pos === 'AM' || pos === 'LM' || pos === 'RM');
    if (stats.clean_sheet && !isAttacker) {
        parts.push(`CS: ${stats.clean_sheet ? 1 : 0}`);
    }
    
    if (stats.saves) parts.push(`Sv: ${stats.saves}`);
    if (stats.yellow_cards) parts.push(`YC: ${stats.yellow_cards}`);
    if (stats.red_cards) parts.push(`RC: ${stats.red_cards}`);
    return parts.join(' | ');
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ReadonlyPitch({ lineup, playerMap, detailMap, teamName }: Props) {
    const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);

    const { formation, starters, bench } = lineup;
    const slots = FORMATION_SLOTS[formation];

    // Map starters by slot name → player_id, handling duplicate slots (e.g., 2× CB)
    // by consuming them left-to-right in the order they appear in the lineup array.
    const slotQueues: Record<string, string[]> = {};
    for (const s of starters) {
        if (!slotQueues[s.slot]) slotQueues[s.slot] = [];
        slotQueues[s.slot].push(s.player_id);
    }
    // Build slotIndex → playerId by walking FORMATION_SLOTS in order
    const slotPointers: Record<string, number> = {};
    const assignments: Record<number, string> = {};
    slots.forEach((pos, i) => {
        const q = slotQueues[pos] ?? [];
        const ptr = slotPointers[pos] ?? 0;
        if (q[ptr]) {
            assignments[i] = q[ptr];
            slotPointers[pos] = ptr + 1;
        }
    });

    // Fallback: any starter whose slot name doesn't exist in this formation
    // (e.g. AM in a 4-3-3) gets placed into the first empty formation slot.
    const placedIds = new Set(Object.values(assignments));
    const unplaced = starters.filter(s => !placedIds.has(s.player_id));
    if (unplaced.length > 0) {
        let upIdx = 0;
        slots.forEach((_, i) => {
            if (!assignments[i] && upIdx < unplaced.length) {
                assignments[i] = unplaced[upIdx].player_id;
                upIdx++;
            }
        });
    }



    // Bench slot → playerId
    const benchMap: Record<BenchSlot, string | null> = { DEF: null, MID: null, ATT: null, FLEX: null };
    bench.forEach((b) => { benchMap[b.slot] = b.player_id; });

    // Group slots by zone (preserving left-to-right order within each zone)
    const zonedSlots: Record<'ATT' | 'MID' | 'DEF' | 'GK', { slotIndex: number; pos: GranularPosition }[]> = {
        ATT: [], MID: [], DEF: [], GK: [],
    };
    slots.forEach((pos, i) => {
        zonedSlots[getZone(pos)].push({ slotIndex: i, pos });
    });

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {/* Team header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--color-text-primary)' }}>
                    {teamName}
                </h3>
                <span style={{
                    padding: '0.2rem 0.6rem',
                    background: 'var(--color-bg-elevated)',
                    border: '1px solid var(--color-border)',
                    borderRadius: '0',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: 'var(--color-text-secondary)',
                }}>
                    {formation}
                </span>
            </div>

            {/* Pitch */}
            <div className={pitchStyles.pitchContainer}>
                <div className={pitchStyles.pitchCenterLine} />
                <div className={pitchStyles.pitchCenterCircle} />

                {ZONE_ORDER.map((zone) => {
                    const zoneSlots = zonedSlots[zone];
                    if (zoneSlots.length === 0) return null;

                    // Ghost nodes to match spacing for 3-man midfield (matches PitchUI logic)
                    const isCompactMid = zone === 'MID' && zoneSlots.length === 3;

                    return (
                        <div
                            key={zone}
                            className={`${pitchStyles.pitchZone} ${ZONE_CLASS_MAP[zone]}`}
                        >
                            <span className={pitchStyles.zoneLabel}>{zone}</span>
                            <div className={pitchStyles.pitchRow}>
                                {isCompactMid && <div style={{ width: '76px', visibility: 'hidden' }} />}

                                {zoneSlots.map(({ slotIndex, pos }) => {
                                    const playerId = assignments[slotIndex];
                                    const player = playerId ? playerMap[playerId] : null;

                                    // Vertical alignment — mirrors PitchUI node logic exactly
                                    const isHighWide = (pos === 'LM' || pos === 'RM') && formation === '4-2-3-1';
                                    const align = pos === 'DM'
                                        ? 'flex-end'
                                        : (pos === 'AM' || isHighWide)
                                            ? 'flex-start'
                                            : 'center';

                                    return (
                                        <div
                                            key={slotIndex}
                                            className={`${pitchStyles.pitchNode} ${player ? pitchStyles.clickable : ''}`}
                                            style={{ alignSelf: align, cursor: player ? 'pointer' : 'default' }}
                                            onClick={() => player && setSelectedPlayer(player as Player)}
                                        >
                                            <span
                                                className={pitchStyles.nodePosBadge}
                                                style={{ background: POS_COLOR[pos] }}
                                            >
                                                {pos}
                                            </span>
                                            {player ? (
                                                <>
                                                    <span className={pitchStyles.nodePlayerName}>
                                                        {formatPlayerName(player)}
                                                    </span>
                                                    {player.pl_team && (
                                                        <span className={pitchStyles.nodePlayerClub}>
                                                            {player.pl_team}
                                                        </span>
                                                    )}
                                                    {detailMap && playerId && detailMap[playerId] !== undefined && (
                                                        <>
                                                            {/* Score badge — absolute top-right corner (prototype 1 style) */}
                                                            <span style={{
                                                                position: 'absolute',
                                                                top: '4px',
                                                                right: '4px',
                                                                fontSize: '0.62rem',
                                                                fontWeight: 800,
                                                                lineHeight: 1.4,
                                                                color: getScoreIntensityColor(detailMap[playerId].points).text,
                                                                background: getScoreIntensityColor(detailMap[playerId].points).bg,
                                                                borderRadius: '0',
                                                                padding: '1px 4px',
                                                                zIndex: 1,
                                                            }}>
                                                                {detailMap[playerId].points.toFixed(1)}
                                                            </span>
                                    {detailMap[playerId].stats && formatStats(detailMap[playerId].stats, pos) && (
                                        <span style={{
                                            fontSize: '0.6rem',
                                            color: 'rgba(255,255,255,0.6)',
                                            marginTop: '1px',
                                            textAlign: 'center',
                                            lineHeight: 1.2,
                                        }}>
                                            {formatStats(detailMap[playerId].stats, pos)}
                                        </span>
                                    )}
                                                        </>
                                                    )}
                                                </>
                                            ) : (
                                                <span className={pitchStyles.nodeEmptyLabel}>—</span>
                                            )}
                                        </div>
                                    );
                                })}

                                {isCompactMid && <div style={{ width: '76px', visibility: 'hidden' }} />}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Bench */}
            <div className={pitchStyles.benchSection}>
                <div className={pitchStyles.benchLabel}>Bench Substitutes</div>
                <div className={pitchStyles.benchRow}>
                    {BENCH_SLOT_NAMES.map((slot) => {
                        const pid = benchMap[slot];
                        const player = pid ? playerMap[pid] : null;
                        return (
                            <div
                                key={slot}
                                className={`${pitchStyles.benchSlot} ${player ? pitchStyles.clickable : ''}`}
                                style={{ cursor: player ? 'pointer' : 'default' }}
                                onClick={() => player && setSelectedPlayer(player as Player)}
                            >
                                <span className={pitchStyles.benchSlotType}>{slot}</span>
                                {player ? (
                                    <>
                                        {player.primary_position && (
                                            <span
                                                className={pitchStyles.nodePosBadge}
                                                style={{ background: POS_COLOR[player.primary_position] }}
                                            >
                                                {player.primary_position}
                                            </span>
                                        )}
                                        <span className={pitchStyles.benchPlayerName}>
                                            {formatPlayerName(player)}
                                        </span>
                                        {player.pl_team && (
                                            <span className={pitchStyles.benchPlayerClub}>{player.pl_team}</span>
                                        )}
                                        {detailMap && pid && detailMap[pid] !== undefined && (
                                            <>
                                                <span style={{
                                                    fontSize: '0.68rem',
                                                    fontWeight: 700,
                                                    color: getScoreIntensityColor(detailMap[pid].points).text,
                                                    background: getScoreIntensityColor(detailMap[pid].points).bg,
                                                    borderRadius: '0',
                                                    padding: '1px 5px',
                                                    marginTop: '2px',
                                                }}>
                                                    {detailMap[pid].points.toFixed(1)}
                                                </span>
                                                {detailMap[pid].stats && formatStats(detailMap[pid].stats, player.primary_position) && (
                                                    <span style={{
                                                        fontSize: '0.58rem',
                                                        color: 'var(--color-text-muted)',
                                                        marginTop: '1px',
                                                    }}>
                                                        {formatStats(detailMap[pid].stats, player.primary_position)}
                                                    </span>
                                                )}
                                            </>
                                        )}
                                    </>
                                ) : (
                                    <span className={pitchStyles.nodeEmptyLabel}>—</span>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Player Details Modal */}
            {selectedPlayer && (
                <PlayerDetailsModal
                    player={selectedPlayer}
                    onClose={() => setSelectedPlayer(null)}
                />
            )}

            {/* GW Points Breakdown — bypasses zone matching, reads directly from lineup */}
            {detailMap && (
                <div style={{
                    background: 'var(--color-bg-card)',
                    border: '1px solid var(--color-border-subtle)',
                    borderRadius: '0',
                    padding: '0.75rem 1rem',
                }}>
                    <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem', fontFamily: 'var(--font-sans)' }}>
                        GW Points
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.25rem 1.5rem' }}>
                        {starters.map((s) => {
                            const p = playerMap[s.player_id];
                            const detail = detailMap ? detailMap[s.player_id] : null;
                            const pts = detail?.points;
                            return (
                                <div key={s.player_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', padding: '0.2rem 0' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 0 }}>
                                        <span style={{ fontSize: '0.6rem', fontWeight: 700, background: POS_COLOR[s.slot as GranularPosition] ?? 'var(--color-bg-elevated)', color: '#fff', borderRadius: '0', padding: '1px 4px', flexShrink: 0 }}>
                                            {s.slot}
                                        </span>
                                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                                            <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {formatPlayerName(p)}
                                            </span>
                                            {detail?.stats && formatStats(detail.stats, s.slot as GranularPosition) && (
                                                <span style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)', marginTop: '-2px' }}>
                                                    {formatStats(detail.stats, s.slot as GranularPosition)}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <span style={{
                                        fontSize: '0.78rem',
                                        fontWeight: 700,
                                        color: pts !== undefined ? getScoreIntensityColor(pts).bg : 'var(--color-text-muted)',
                                        flexShrink: 0,
                                    }}>
                                        {pts !== undefined ? pts.toFixed(1) : '—'}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                    {bench.filter(b => detailMap && detailMap[b.player_id] !== undefined).length > 0 && (
                        <div style={{ marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid var(--color-border-subtle)' }}>
                            <div style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)', marginBottom: '0.25rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Bench</div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.2rem 1.5rem' }}>
                                {bench.map((b) => {
                                    const p = playerMap[b.player_id];
                                    const detail = detailMap ? detailMap[b.player_id] : null;
                                    const pts = detail?.points;
                                    return (
                                        <div key={b.player_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', opacity: 0.75 }}>
                                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                <span style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                    {formatPlayerName(p)}
                                                </span>
                                            </div>
                                            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: pts !== undefined ? getScoreIntensityColor(pts).bg : 'var(--color-text-muted)', flexShrink: 0 }}>
                                                {pts !== undefined ? pts.toFixed(1) : '—'}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
