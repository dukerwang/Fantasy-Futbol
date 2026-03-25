'use client';

import { useState } from 'react';
import type { GranularPosition, MatchupLineup, Player, BenchSlot } from '@/types';
import { FORMATION_SLOTS } from '@/types';
import pitchStyles from './pitch.module.css';
import PlayerDetailsModal from './players/PlayerDetailsModal';

// ─── Constants ────────────────────────────────────────────────────────────────

const POS_COLOR: Record<GranularPosition, string> = {
    GK: 'var(--color-pos-gk, #f59e0b)',
    CB: 'var(--color-pos-cb, #3b82f6)',
    LB: 'var(--color-pos-fb, #6366f1)',
    RB: 'var(--color-pos-fb, #6366f1)',
    DM: 'var(--color-pos-dm, #8b5cf6)',
    CM: 'var(--color-pos-cm, #06b6d4)',
    LM: 'var(--color-pos-cm, #06b6d4)',
    RM: 'var(--color-pos-cm, #06b6d4)',
    AM: 'var(--color-pos-am, #10b981)',
    LW: 'var(--color-pos-lw, #f97316)',
    RW: 'var(--color-pos-rw, #ef4444)',
    ST: 'var(--color-pos-st, #ec4899)',
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

function formatStats(stats?: any) {
    if (!stats) return '';
    const parts = [];
    if (stats.goals) parts.push(`G: ${stats.goals}`);
    if (stats.assists) parts.push(`A: ${stats.assists}`);
    if (stats.clean_sheet) parts.push(`CS: ${stats.clean_sheet ? 1 : 0}`);
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
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary, #f3f4f6)' }}>
                    {teamName}
                </h3>
                <span style={{
                    padding: '0.2rem 0.6rem',
                    background: 'var(--bg-surface-light, #252d3a)',
                    border: '1px solid var(--border-color, #374151)',
                    borderRadius: '6px',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: 'var(--text-secondary, #9ca3af)',
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
                                                        {player.web_name ?? player.name ?? '—'}
                                                    </span>
                                                    {player.pl_team && (
                                                        <span className={pitchStyles.nodePlayerClub}>
                                                            {player.pl_team}
                                                        </span>
                                                    )}
                                                    {detailMap && playerId && detailMap[playerId] !== undefined && (
                                                        <>
                                                            <span style={{
                                                                fontSize: '0.7rem',
                                                                fontWeight: 700,
                                                                color: '#10b981',
                                                                background: 'rgba(16,185,129,0.12)',
                                                                border: '1px solid rgba(16,185,129,0.3)',
                                                                borderRadius: '4px',
                                                                padding: '1px 5px',
                                                                marginTop: '2px',
                                                                letterSpacing: '0.02em',
                                                            }}>
                                                                {detailMap[playerId].points.toFixed(1)} pts
                                                            </span>
                                                            {detailMap[playerId].stats && formatStats(detailMap[playerId].stats) && (
                                                                <span style={{
                                                                    fontSize: '0.6rem',
                                                                    color: '#9ca3af',
                                                                    marginTop: '1px',
                                                                    textAlign: 'center',
                                                                    lineHeight: 1.2,
                                                                }}>
                                                                    {formatStats(detailMap[playerId].stats)}
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
                                            {player.web_name ?? player.name ?? '—'}
                                        </span>
                                        {player.pl_team && (
                                            <span className={pitchStyles.benchPlayerClub}>{player.pl_team}</span>
                                        )}
                                        {detailMap && pid && detailMap[pid] !== undefined && (
                                            <>
                                                <span style={{
                                                    fontSize: '0.68rem',
                                                    fontWeight: 700,
                                                    color: '#6366f1',
                                                    background: 'rgba(99,102,241,0.1)',
                                                    border: '1px solid rgba(99,102,241,0.25)',
                                                    borderRadius: '4px',
                                                    padding: '1px 5px',
                                                    marginTop: '2px',
                                                }}>
                                                    {detailMap[pid].points.toFixed(1)} pts
                                                </span>
                                                {detailMap[pid].stats && formatStats(detailMap[pid].stats) && (
                                                    <span style={{
                                                        fontSize: '0.58rem',
                                                        color: '#9ca3af',
                                                        marginTop: '1px',
                                                    }}>
                                                        {formatStats(detailMap[pid].stats)}
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
                    background: 'var(--bg-surface, #1a2235)',
                    border: '1px solid var(--border-color, #374151)',
                    borderRadius: '10px',
                    padding: '0.75rem 1rem',
                }}>
                    <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary, #9ca3af)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>
                        GW{''} Points
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.25rem 1.5rem' }}>
                        {starters.map((s) => {
                            const p = playerMap[s.player_id];
                            const detail = detailMap ? detailMap[s.player_id] : null;
                            const pts = detail?.points;
                            return (
                                <div key={s.player_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', padding: '0.2rem 0' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 0 }}>
                                        <span style={{ fontSize: '0.6rem', fontWeight: 700, background: POS_COLOR[s.slot as GranularPosition] ?? '#374151', color: '#fff', borderRadius: '3px', padding: '1px 4px', flexShrink: 0 }}>
                                            {s.slot}
                                        </span>
                                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                                            <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-primary, #f3f4f6)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {p?.web_name ?? p?.name ?? '—'}
                                            </span>
                                            {detail?.stats && formatStats(detail.stats) && (
                                                <span style={{ fontSize: '0.65rem', color: '#9ca3af', marginTop: '-2px' }}>
                                                    {formatStats(detail.stats)}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <span style={{
                                        fontSize: '0.78rem',
                                        fontWeight: 700,
                                        color: pts !== undefined ? '#10b981' : 'var(--text-muted, #6b7280)',
                                        flexShrink: 0,
                                    }}>
                                        {pts !== undefined ? pts.toFixed(1) : '—'}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                    {bench.filter(b => detailMap && detailMap[b.player_id] !== undefined).length > 0 && (
                        <div style={{ marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid var(--border-color, #374151)' }}>
                            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted, #6b7280)', marginBottom: '0.25rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Bench</div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.2rem 1.5rem' }}>
                                {bench.map((b) => {
                                    const p = playerMap[b.player_id];
                                    const detail = detailMap ? detailMap[b.player_id] : null;
                                    const pts = detail?.points;
                                    return (
                                        <div key={b.player_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', opacity: 0.7 }}>
                                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                <span style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-secondary, #9ca3af)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                    {p?.web_name ?? p?.name ?? '—'}
                                                </span>
                                            </div>
                                            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: pts !== undefined ? '#6366f1' : 'var(--text-muted, #6b7280)', flexShrink: 0 }}>
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
