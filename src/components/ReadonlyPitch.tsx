'use client';

import { useState } from 'react';
import type { GranularPosition, MatchupLineup, Player, BenchSlot } from '@/types';
import { FORMATION_SLOTS } from '@/types';
import pitchStyles from '@/app/(dashboard)/league/[leagueId]/team/pitch.module.css';
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
    teamName: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ReadonlyPitch({ lineup, playerMap, teamName }: Props) {
    const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);

    const { formation, starters, bench } = lineup;
    const slots = FORMATION_SLOTS[formation];

    // Starters are stored in FORMATION_SLOTS index order — reconstruct the index→playerId map.
    const assignments: Record<number, string> = {};
    starters.forEach((s, i) => { assignments[i] = s.player_id; });

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
        </div>
    );
}
