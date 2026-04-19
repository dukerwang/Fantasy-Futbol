'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
    FORMATION_SLOTS,
    POSITION_FLEX_MAP,
    BENCH_FLEX_MAP,
    BENCH_SLOT_LABELS,
} from '@/types';
import type { Formation, GranularPosition, Player, BenchSlot, RosterEntry } from '@/types';
import PlayerDetailsModal from '@/components/players/PlayerDetailsModal';
import { formatPlayerName } from '@/lib/formatName';
import { plTeamThreeLetter } from '@/lib/plTeamAbbrev';
import styles from './pitch.module.css';

// ─── Constants ──────────────────────────────────────────────────────────────

const FORMATIONS: Formation[] = ['4-3-3', '4-4-2', '4-1-4-1', '4-2-3-1', '4-2-1-3', '3-4-3'];

type PitchZone = 'ATT' | 'AMZ' | 'CMZ' | 'DMZ' | 'DEF' | 'GK';
// Zone order: attackers at top, GK at bottom (same vertical flow as MatchupPitch)
const ZONE_ORDER: PitchZone[] = ['ATT', 'AMZ', 'CMZ', 'DMZ', 'DEF', 'GK'];
const BENCH_SLOT_NAMES: BenchSlot[] = ['DEF', 'MID', 'ATT', 'FLEX'];

const DEFAULT_TAXI_AGE_LIMIT = 21;

const POS_COLOR: Record<GranularPosition, string> = {
    GK: 'var(--color-pos-gk)',
    CB: 'var(--color-pos-cb)',
    LB: 'var(--color-pos-fb)',
    RB: 'var(--color-pos-fb)',
    DM: 'var(--color-pos-dm)',
    CM: 'var(--color-pos-cm)',
    LM: 'var(--color-pos-wm)',
    RM: 'var(--color-pos-wm)',
    AM: 'var(--color-pos-am)',
    LW: 'var(--color-pos-lw)',
    RW: 'var(--color-pos-rw)',
    ST: 'var(--color-pos-st)',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Matches MatchupPitch's 6-zone approach so DM/CM/AM render as distinct rows
function getZone(pos: GranularPosition, formation: Formation): PitchZone {
    if (pos === 'GK') return 'GK';
    if (pos === 'CB' || pos === 'LB' || pos === 'RB') return 'DEF';
    if (pos === 'DM') return 'DMZ';
    // In a 4-2-3-1, the wide mids sit with the 10 in the attacking-mid band (matches MatchupPitch grouping)
    if (formation === '4-2-3-1' && (pos === 'LM' || pos === 'RM')) return 'AMZ';
    if (pos === 'CM' || pos === 'LM' || pos === 'RM') return 'CMZ';
    if (pos === 'AM') return 'AMZ';
    return 'ATT'; // LW, ST, RW
}

function getPlayerPositions(player: Player): GranularPosition[] {
    return [player.primary_position, ...(player.secondary_positions ?? [])];
}
function canPlaySlot(player: Player, slotPos: GranularPosition): boolean {
    return getPlayerPositions(player).some((p) => POSITION_FLEX_MAP[slotPos].includes(p));
}
function canPlayBenchSlot(player: Player, slot: BenchSlot): boolean {
    return getPlayerPositions(player).some((p) => BENCH_FLEX_MAP[slot].includes(p));
}

function displayName(player: Player): string {
    return formatPlayerName(player, 'initial_last');
}

function pitchFullName(player: Player): string {
    return formatPlayerName(player, 'full');
}

function isU21Eligible(player: Player, academyAgeLimit: number): boolean {
    if (!player.date_of_birth) return false;
    const dob = new Date(player.date_of_birth);
    const now = new Date();
    let age = now.getFullYear() - dob.getFullYear();
    const monthDiff = now.getMonth() - dob.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) age--;
    return age <= academyAgeLimit;
}

function isIrEligible(player: Player): boolean {
    return player.fpl_status === 'i' || player.fpl_status === 'u' || player.fpl_status === 'd';
}

/** PL fixture for this player's club has kicked off in the current GW — no XI/bench/reserve reshuffling. */
function isPlMatchLocked(player: Player | undefined, lockedTeamIds?: Set<number> | null): boolean {
    if (!player || player.pl_team_id == null) return false;
    return lockedTeamIds?.has(player.pl_team_id) ?? false;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
    teamId: string;
    /** Shown on the pitch header strip (MatchupPitch-style label) */
    teamName?: string;
    allEntries: (RosterEntry & { player: Player })[];   // active + bench status (excludes ir, taxi)
    irEntries: (RosterEntry & { player: Player })[];
    taxiEntries: (RosterEntry & { player: Player })[];
    faabBudget: number;
    taxiAgeLimit?: number;
    initialFormation: Formation;
    initialAssignments: Record<number, string>;
    initialBench: Record<BenchSlot, string | null>;
    scoreMap?: Record<string, number>;
    lockedTeamIds?: Set<number>;
}

type LineupSelection =
    | { type: 'starter'; slotIndex: number }
    | { type: 'bench-slot'; slot: BenchSlot }
    | { type: 'pool'; playerId: string }
    | null;

type SidebarSelection =
    | { type: 'taxi'; playerId: string }
    | { type: 'ir'; playerId: string }
    | null;

// ─── Pitch Node (player chip on the pitch) ───────────────────────────────────

interface PitchNodeProps {
    slotPos: GranularPosition;
    player: Player | undefined;
    isSelected: boolean;
    isValidTarget: boolean;
    isEmpty: boolean;
    isInvalid?: boolean;
    isLocked?: boolean;
    onClick: () => void;
    onViewDetails?: () => void;
    points?: number;
}

function PitchNode({ slotPos, player, isSelected, isValidTarget, isEmpty, isInvalid, isLocked, onClick, onViewDetails, points }: PitchNodeProps) {
    const frameColor = isInvalid ? '#ef4444' : POS_COLOR[slotPos];
    const wrapCls = [
        styles.pitchNodeWrap,
        isSelected ? styles.nodeWrapSelected : '',
        isValidTarget ? styles.nodeWrapValidTarget : '',
        isEmpty ? styles.nodeWrapEmpty : '',
        isInvalid ? styles.nodeWrapInvalid : '',
    ].filter(Boolean).join(' ');

    const chipCls = [
        styles.pitchNode,
        isEmpty ? styles.nodeChipEmpty : '',
    ].filter(Boolean).join(' ');

    return (
        <button
            type="button"
            className={wrapCls}
            onClick={isLocked ? (onViewDetails ?? undefined) : onClick}
            style={isLocked ? { opacity: 0.7, cursor: 'pointer' } : undefined}
            title={isLocked ? 'Match started (Locked) — click to view' : isInvalid ? 'Player is not eligible for this position' : undefined}
        >
            <div
                className={styles.nodePhotoMount}
                style={{ borderColor: isEmpty ? 'rgba(255,255,255,0.35)' : frameColor }}
            >
                {player?.photo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={player.photo_url} alt={pitchFullName(player)} className={styles.nodePhotoImg} />
                ) : (
                    <span className={styles.nodePhotoPlaceholder} aria-hidden>
                        {player ? displayName(player).charAt(0) : slotPos.charAt(0)}
                    </span>
                )}
            </div>

            <div className={chipCls}>
                {points !== undefined && (
                    <span className={styles.nodePtsBadge}>{points.toFixed(1)}</span>
                )}
                {isLocked && player && (
                    <span className={styles.nodeLockCorner} title="Locked">🔒</span>
                )}
                <div className={styles.nodeChipBody}>
                    {player ? (
                        <>
                            <span
                                className={styles.nodePlayerNameCenter}
                                onClick={(e) => { if (onViewDetails) { e.stopPropagation(); onViewDetails(); } }}
                                style={{ cursor: onViewDetails ? 'pointer' : 'default', ...(isInvalid ? { color: '#ef4444' } : {}) }}
                                title={onViewDetails ? 'View player details' : undefined}
                            >
                                {displayName(player)}
                            </span>
                            <div className={styles.nodeMetaChipRow}>
                                <span
                                    className={styles.nodePosBadge}
                                    style={{ background: isInvalid ? '#ef4444' : POS_COLOR[slotPos] }}
                                >
                                    {slotPos}
                                </span>
                                <span className={styles.nodeTeamChip}>
                                    {plTeamThreeLetter(player.pl_team_id, player.pl_team)}
                                </span>
                                {player.fpl_status && player.fpl_status !== 'a' && (
                                    <span className={styles.nodeStatusDot} data-status={player.fpl_status} />
                                )}
                            </div>
                        </>
                    ) : (
                        <>
                            <span className={styles.nodeEmptyLabel}>Empty</span>
                            <div className={styles.nodeMetaChipRow}>
                                <span
                                    className={styles.nodePosBadge}
                                    style={{ background: isInvalid ? '#ef4444' : POS_COLOR[slotPos] }}
                                >
                                    {slotPos}
                                </span>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </button>
    );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function PitchUI({
    teamId,
    teamName,
    allEntries,
    irEntries,
    taxiEntries,
    faabBudget,
    taxiAgeLimit = DEFAULT_TAXI_AGE_LIMIT,
    initialFormation,
    initialAssignments,
    initialBench,
    scoreMap,
    lockedTeamIds,
}: Props) {
    const router = useRouter();

    // ── Lineup state ──
    const [formation, setFormation] = useState<Formation>(initialFormation);
    const [assignments, setAssignments] = useState<Record<number, string | null>>(() => {
        const slots = FORMATION_SLOTS[initialFormation];
        const result: Record<number, string | null> = {};
        for (let i = 0; i < slots.length; i++) result[i] = initialAssignments[i] ?? null;
        return result;
    });
    const [benchAssignments, setBenchAssignments] = useState<Record<BenchSlot, string | null>>({
        DEF: initialBench.DEF ?? null,
        MID: initialBench.MID ?? null,
        ATT: initialBench.ATT ?? null,
        FLEX: initialBench.FLEX ?? null,
    });
    const [lineupSelection, setLineupSelection] = useState<LineupSelection>(null);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [saveSuccess, setSaveSuccess] = useState(false);

    // ── Sidebar (taxi/IR swap) state ──
    const [sidebarSelection, setSidebarSelection] = useState<SidebarSelection>(null);
    const [sidebarLoading, setSidebarLoading] = useState(false);
    const [sidebarError, setSidebarError] = useState<string | null>(null);

    // ── Modal ──
    const [viewingPlayer, setViewingPlayer] = useState<Player | null>(null);

    const slots = FORMATION_SLOTS[formation];
    const academyAgeLimit = taxiAgeLimit;

    // ── Derived state ──
    const starterIds = useMemo(
        () => new Set(Object.values(assignments).filter(Boolean) as string[]),
        [assignments],
    );
    const benchIds = useMemo(
        () => new Set(Object.values(benchAssignments).filter(Boolean) as string[]),
        [benchAssignments],
    );
    const playerMap = useMemo(() => {
        const map = new Map<string, RosterEntry & { player: Player }>();
        for (const e of allEntries) map.set(e.player.id, e);
        return map;
    }, [allEntries]);

    // Pool = unassigned players (the "Reserves" in the sidebar)
    const poolEntries = useMemo(
        () => allEntries.filter((e) => !starterIds.has(e.player.id) && !benchIds.has(e.player.id)),
        [allEntries, starterIds, benchIds],
    );

    // Zone layout for pitch rendering — 6 zones matching MatchupPitch structure
    const zonedSlots = useMemo(() => {
        const list = slots.map((pos, i) => ({ slotIndex: i, pos, zone: getZone(pos, formation) }));
        return {
            ATT: list.filter((s) => s.zone === 'ATT'),
            AMZ: list.filter((s) => s.zone === 'AMZ'),
            CMZ: list.filter((s) => s.zone === 'CMZ'),
            DMZ: list.filter((s) => s.zone === 'DMZ'),
            DEF: list.filter((s) => s.zone === 'DEF'),
            GK:  list.filter((s) => s.zone === 'GK'),
        };
    }, [slots]);

    // Valid swap/assign targets for lineup selection highlighting
    const validLineupTargets = useMemo(() => {
        const targets = new Set<string>();
        if (!lineupSelection) return targets;

        if (lineupSelection.type === 'starter') {
            const currentPlayerId = assignments[lineupSelection.slotIndex];
            const currentEntry = currentPlayerId ? playerMap.get(currentPlayerId) : null;
            for (let i = 0; i < slots.length; i++) {
                if (i === lineupSelection.slotIndex) continue;
                const otherId = assignments[i];
                const otherEntry = otherId ? playerMap.get(otherId) : null;
                const curCanGoThere = !currentEntry || canPlaySlot(currentEntry.player, slots[i]);
                const otherCanComeHere = !otherEntry || canPlaySlot(otherEntry.player, slots[lineupSelection.slotIndex]);
                if (curCanGoThere && otherCanComeHere) targets.add(`starter-${i}`);
            }
            for (const e of poolEntries) {
                if (isPlMatchLocked(e.player, lockedTeamIds)) continue;
                if (canPlaySlot(e.player, slots[lineupSelection.slotIndex])) targets.add(`pool-${e.player.id}`);
            }
            if (currentEntry) {
                for (const slot of BENCH_SLOT_NAMES) {
                    if (canPlayBenchSlot(currentEntry.player, slot)) targets.add(`bench-${slot}`);
                }
            }
        }

        if (lineupSelection.type === 'bench-slot') {
            const benchPlayerId = benchAssignments[lineupSelection.slot];
            const benchEntry = benchPlayerId ? playerMap.get(benchPlayerId) : null;
            if (benchEntry) {
                for (let i = 0; i < slots.length; i++) {
                    if (canPlaySlot(benchEntry.player, slots[i])) targets.add(`starter-${i}`);
                }
                for (const slot of BENCH_SLOT_NAMES) {
                    if (slot === lineupSelection.slot) continue;
                    if (canPlayBenchSlot(benchEntry.player, slot)) targets.add(`bench-${slot}`);
                }
            }
            for (const e of poolEntries) {
                if (isPlMatchLocked(e.player, lockedTeamIds)) continue;
                if (canPlayBenchSlot(e.player, lineupSelection.slot)) targets.add(`pool-${e.player.id}`);
            }
        }

        if (lineupSelection.type === 'pool') {
            const entry = playerMap.get(lineupSelection.playerId);
            if (entry && !isPlMatchLocked(entry.player, lockedTeamIds)) {
                for (let i = 0; i < slots.length; i++) {
                    if (canPlaySlot(entry.player, slots[i])) targets.add(`starter-${i}`);
                }
                for (const slot of BENCH_SLOT_NAMES) {
                    if (canPlayBenchSlot(entry.player, slot)) targets.add(`bench-${slot}`);
                }
            }
        }

        return targets;
    }, [lineupSelection, assignments, benchAssignments, slots, playerMap, poolEntries, lockedTeamIds]);

    // Valid targets for sidebar (taxi/IR) selection
    const validSidebarTargets = useMemo(() => {
        const targets = new Set<string>();
        if (!sidebarSelection) return targets;
        if (sidebarSelection.type === 'taxi') {
            for (const e of poolEntries) {
                if (isPlMatchLocked(e.player, lockedTeamIds)) continue;
                if (isU21Eligible(e.player, academyAgeLimit)) targets.add(`pool-${e.player.id}`);
            }
        }
        if (sidebarSelection.type === 'ir') {
            for (const e of poolEntries) {
                if (isPlMatchLocked(e.player, lockedTeamIds)) continue;
                if (isIrEligible(e.player)) targets.add(`pool-${e.player.id}`);
            }
        }
        return targets;
    }, [sidebarSelection, poolEntries, academyAgeLimit, lockedTeamIds]);

    // ── Selection helpers ──
    function clearAll() {
        setLineupSelection(null);
        setSidebarSelection(null);
        setSaveError(null);
    }

    function activateLineupSelection(sel: LineupSelection) {
        setSidebarSelection(null);
        setSidebarError(null);
        setLineupSelection(sel);
    }

    function activateSidebarSelection(sel: SidebarSelection) {
        setLineupSelection(null);
        setSaveError(null);
        setSidebarSelection(sel);
        setSidebarError(null);
    }

    // ── Drop to reserves (unassign from any slot) ──
    function dropToReserves() {
        if (!lineupSelection) return;
        if (lineupSelection.type === 'starter') {
            setAssignments((prev) => ({ ...prev, [lineupSelection.slotIndex]: null }));
        } else if (lineupSelection.type === 'bench-slot') {
            setBenchAssignments((prev) => ({ ...prev, [lineupSelection.slot]: null }));
        }
        setLineupSelection(null);
        setSaveError(null);
        setSaveSuccess(false);
    }

    // ── Formation change ──
    function handleFormationChange(f: Formation) {
        const newSlots = FORMATION_SLOTS[f];
        const newAssignments: Record<number, string | null> = {};
        for (let i = 0; i < newSlots.length; i++) newAssignments[i] = null;
        const usedPlayers = new Set<string>();
        const oldSlots = FORMATION_SLOTS[formation];
        const oldByPosition = new Map<GranularPosition, string[]>();
        for (let i = 0; i < oldSlots.length; i++) {
            const pid = assignments[i];
            if (!pid) continue;
            const pos = oldSlots[i];
            if (!oldByPosition.has(pos)) oldByPosition.set(pos, []);
            oldByPosition.get(pos)!.push(pid);
        }
        for (let i = 0; i < newSlots.length; i++) {
            const slotPos = newSlots[i];
            const candidates = oldByPosition.get(slotPos) ?? [];
            const available = candidates.find((id) => {
                if (usedPlayers.has(id)) return false;
                const entry = playerMap.get(id);
                return entry ? canPlaySlot(entry.player, slotPos) : false;
            });
            if (available) { newAssignments[i] = available; usedPlayers.add(available); }
        }
        const remaining = Object.values(assignments).filter((id): id is string => id != null && !usedPlayers.has(id));
        for (let i = 0; i < newSlots.length; i++) {
            if (newAssignments[i] != null) continue;
            const slotPos = newSlots[i];
            const cand = remaining.find((id) => {
                if (usedPlayers.has(id)) return false;
                const entry = playerMap.get(id);
                return entry ? canPlaySlot(entry.player, slotPos) : false;
            });
            if (cand) { newAssignments[i] = cand; usedPlayers.add(cand); }
        }
        setFormation(f);
        setAssignments(newAssignments);
        clearAll();
        setSaveSuccess(false);
    }

    // ── Starter node click ──
    const handleStarterClick = useCallback(
        (slotIndex: number) => {
            setSidebarSelection(null);
            setSidebarError(null);
            if (!lineupSelection) {
                activateLineupSelection({ type: 'starter', slotIndex });
                return;
            }
            if (lineupSelection.type === 'starter') {
                if (lineupSelection.slotIndex === slotIndex) { setLineupSelection(null); return; }
                const pidA = assignments[lineupSelection.slotIndex];
                const pidB = assignments[slotIndex];
                const eA = pidA ? playerMap.get(pidA) : null;
                const eB = pidB ? playerMap.get(pidB) : null;
                const aCanGo = !eA || canPlaySlot(eA.player, slots[slotIndex]);
                const bCanGo = !eB || canPlaySlot(eB.player, slots[lineupSelection.slotIndex]);
                if (aCanGo && bCanGo) {
                    setAssignments((prev) => ({ ...prev, [lineupSelection.slotIndex]: pidB ?? null, [slotIndex]: pidA ?? null }));
                    setSaveError(null); setSaveSuccess(false);
                } else {
                    setSaveError('Position mismatch — these players cannot swap.');
                }
                setLineupSelection(null); return;
            }
            if (lineupSelection.type === 'pool') {
                const pid = lineupSelection.playerId;
                const slotPos = slots[slotIndex];
                const entry = playerMap.get(pid);
                if (!entry || !canPlaySlot(entry.player, slotPos)) {
                    setSaveError(`${displayName(entry?.player ?? { name: 'Player', web_name: null } as Player)} cannot play ${slotPos}.`);
                    setLineupSelection(null); return;
                }
                if (isPlMatchLocked(entry.player, lockedTeamIds)) {
                    setSaveError('Match started — this player is locked.');
                    setLineupSelection(null); return;
                }
                setAssignments((prev) => ({ ...prev, [slotIndex]: pid }));
                setSaveError(null); setSaveSuccess(false); setLineupSelection(null); return;
            }
            if (lineupSelection.type === 'bench-slot') {
                const benchPid = benchAssignments[lineupSelection.slot];
                if (!benchPid) { activateLineupSelection({ type: 'starter', slotIndex }); return; }
                const eBench = playerMap.get(benchPid);
                const slotPos = slots[slotIndex];
                if (!eBench || !canPlaySlot(eBench.player, slotPos)) {
                    setSaveError(`${displayName(eBench?.player ?? { name: 'Player', web_name: null } as Player)} cannot play ${slotPos}.`);
                    setLineupSelection(null); return;
                }
                const curStarterId = assignments[slotIndex];
                const eStart = curStarterId ? playerMap.get(curStarterId) : null;
                if (eStart && canPlayBenchSlot(eStart.player, lineupSelection.slot)) {
                    setBenchAssignments((prev) => ({ ...prev, [lineupSelection.slot]: curStarterId }));
                } else {
                    setBenchAssignments((prev) => ({ ...prev, [lineupSelection.slot]: null }));
                }
                setAssignments((prev) => ({ ...prev, [slotIndex]: benchPid }));
                setSaveError(null); setSaveSuccess(false); setLineupSelection(null); return;
            }
        },
        [lineupSelection, assignments, slots, playerMap, benchAssignments, lockedTeamIds],
    );

    // ── Bench slot click ──
    const handleBenchSlotClick = useCallback(
        (slot: BenchSlot) => {
            setSidebarSelection(null);
            setSidebarError(null);
            if (!lineupSelection) { activateLineupSelection({ type: 'bench-slot', slot }); return; }
            if (lineupSelection.type === 'bench-slot') {
                if (lineupSelection.slot === slot) { setLineupSelection(null); return; }
                const pidA = benchAssignments[lineupSelection.slot];
                const pidB = benchAssignments[slot];
                const eA = pidA ? playerMap.get(pidA) : null;
                const eB = pidB ? playerMap.get(pidB) : null;
                const aOk = !eA || canPlayBenchSlot(eA.player, slot);
                const bOk = !eB || canPlayBenchSlot(eB.player, lineupSelection.slot);
                if (aOk && bOk) {
                    setBenchAssignments((prev) => ({ ...prev, [lineupSelection.slot]: pidB ?? null, [slot]: pidA ?? null }));
                    setSaveError(null); setSaveSuccess(false);
                } else {
                    setSaveError(`Position mismatch — cannot swap ${lineupSelection.slot} and ${slot} bench slots.`);
                }
                setLineupSelection(null); return;
            }
            if (lineupSelection.type === 'pool') {
                const pid = lineupSelection.playerId;
                const entry = playerMap.get(pid);
                if (!entry || !canPlayBenchSlot(entry.player, slot)) {
                    setSaveError(`${displayName(entry?.player ?? { name: 'Player', web_name: null } as Player)} cannot play the ${slot} bench slot.`);
                    setLineupSelection(null); return;
                }
                if (isPlMatchLocked(entry.player, lockedTeamIds)) {
                    setSaveError('Match started — this player is locked.');
                    setLineupSelection(null); return;
                }
                setBenchAssignments((prev) => ({ ...prev, [slot]: pid }));
                setSaveError(null); setSaveSuccess(false); setLineupSelection(null); return;
            }
            if (lineupSelection.type === 'starter') {
                const starterPid = assignments[lineupSelection.slotIndex];
                if (!starterPid) { activateLineupSelection({ type: 'bench-slot', slot }); return; }
                const eStart = playerMap.get(starterPid);
                if (!eStart || !canPlayBenchSlot(eStart.player, slot)) {
                    setSaveError(`${displayName(eStart?.player ?? { name: 'Player', web_name: null } as Player)} cannot play the ${slot} bench slot.`);
                    setLineupSelection(null); return;
                }
                const curBenchId = benchAssignments[slot];
                const eBench = curBenchId ? playerMap.get(curBenchId) : null;
                if (eBench && canPlaySlot(eBench.player, slots[lineupSelection.slotIndex])) {
                    setAssignments((prev) => ({ ...prev, [lineupSelection.slotIndex]: curBenchId }));
                } else {
                    setAssignments((prev) => ({ ...prev, [lineupSelection.slotIndex]: null }));
                }
                setBenchAssignments((prev) => ({ ...prev, [slot]: starterPid }));
                setSaveError(null); setSaveSuccess(false); setLineupSelection(null); return;
            }
        },
        [lineupSelection, assignments, benchAssignments, slots, playerMap, lockedTeamIds],
    );

    // ── Pool (Reserve) player click ──
    const handlePoolClick = useCallback(
        (playerId: string) => {
            // If a sidebar (taxi/ir) selection is active, handle it
            if (sidebarSelection) {
                const targetEntry = poolEntries.find((e) => e.player.id === playerId);
                if (!targetEntry) return;

                if (isPlMatchLocked(targetEntry.player, lockedTeamIds)) {
                    setSidebarError('Match started — this player is locked.');
                    setSidebarSelection(null);
                    return;
                }

                if (sidebarSelection.type === 'taxi') {
                    if (!isU21Eligible(targetEntry.player, academyAgeLimit)) {
                        setSidebarError('This player is not U21 eligible for the academy.');
                        setSidebarSelection(null); return;
                    }
                    handleTaxiSwap(sidebarSelection.playerId, playerId);
                    return;
                }

                if (sidebarSelection.type === 'ir') {
                    if (!isIrEligible(targetEntry.player)) {
                        setSidebarError('This player must be injured or unavailable to be moved to IR.');
                        setSidebarSelection(null); return;
                    }
                    handleIrSwap(sidebarSelection.playerId, playerId);
                    return;
                }
                return;
            }

            // Otherwise handle as lineup pool selection
            if (!lineupSelection) {
                const entry = playerMap.get(playerId);
                if (isPlMatchLocked(entry?.player, lockedTeamIds)) {
                    if (entry) setViewingPlayer(entry.player);
                    return;
                }
                activateLineupSelection({ type: 'pool', playerId });
                return;
            }

            if (lineupSelection.type === 'pool') {
                setLineupSelection(lineupSelection.playerId === playerId ? null : { type: 'pool', playerId });
                return;
            }
            if (lineupSelection.type === 'starter') {
                const slotIndex = lineupSelection.slotIndex;
                const slotPos = slots[slotIndex];
                const entry = playerMap.get(playerId);
                if (!entry || !canPlaySlot(entry.player, slotPos)) {
                    setSaveError(`${displayName(entry?.player ?? { name: 'Player', web_name: null } as Player)} cannot play ${slotPos}.`);
                    setLineupSelection(null); return;
                }
                if (isPlMatchLocked(entry.player, lockedTeamIds)) {
                    setSaveError('Match started — this player is locked.');
                    setLineupSelection(null); return;
                }
                setAssignments((prev) => ({ ...prev, [slotIndex]: playerId }));
                setSaveError(null); setSaveSuccess(false); setLineupSelection(null); return;
            }
            if (lineupSelection.type === 'bench-slot') {
                const slot = lineupSelection.slot;
                const entry = playerMap.get(playerId);
                if (!entry || !canPlayBenchSlot(entry.player, slot)) {
                    setSaveError(`${displayName(entry?.player ?? { name: 'Player', web_name: null } as Player)} cannot play the ${slot} bench slot.`);
                    setLineupSelection(null); return;
                }
                if (isPlMatchLocked(entry.player, lockedTeamIds)) {
                    setSaveError('Match started — this player is locked.');
                    setLineupSelection(null); return;
                }
                setBenchAssignments((prev) => ({ ...prev, [slot]: playerId }));
                setSaveError(null); setSaveSuccess(false); setLineupSelection(null); return;
            }
        },
        [lineupSelection, sidebarSelection, slots, playerMap, poolEntries, academyAgeLimit, lockedTeamIds],
    );

    // ── Taxi swap — sequential: move reserve to taxi first (frees roster slot), then activate taxi player ──
    async function handleTaxiSwap(outgoingTaxiId: string, incomingReserveId: string) {
        setSidebarLoading(true);
        setSidebarError(null);
        setSidebarSelection(null);
        try {
            // Step 1: move the reserve to taxi (removes them from active roster count)
            const r1 = await fetch(`/api/teams/${teamId}/taxi`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ playerId: incomingReserveId, action: 'move_to_taxi' }),
            });
            if (!r1.ok) { const d = await r1.json(); setSidebarError(d.error ?? 'Move to academy failed'); return; }

            // Step 2: activate the taxi player (now there is roster space)
            const r2 = await fetch(`/api/teams/${teamId}/taxi`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ playerId: outgoingTaxiId, action: 'activate' }),
            });
            if (!r2.ok) { const d = await r2.json(); setSidebarError(d.error ?? 'Activate failed'); return; }

            router.refresh();
        } catch {
            setSidebarError('Network error — please try again.');
        } finally {
            setSidebarLoading(false);
        }
    }

    // ── Taxi standalone activate ──
    async function handleTaxiActivate(playerId: string) {
        setSidebarLoading(true);
        setSidebarError(null);
        setSidebarSelection(null);
        try {
            const res = await fetch(`/api/teams/${teamId}/taxi`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ playerId, action: 'activate' }),
            });
            if (!res.ok) { const d = await res.json(); setSidebarError(d.error ?? 'Failed to activate'); }
            else { router.refresh(); }
        } catch {
            setSidebarError('Network error — please try again.');
        } finally {
            setSidebarLoading(false);
        }
    }

    // ── IR swap — sequential: move reserve to IR first (frees roster slot), then activate IR player ──
    async function handleIrSwap(outgoingIrId: string, incomingReserveId: string) {
        setSidebarLoading(true);
        setSidebarError(null);
        setSidebarSelection(null);
        try {
            // Step 1: move the reserve to IR (removes them from active roster count)
            const r1 = await fetch(`/api/teams/${teamId}/ir`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ playerId: incomingReserveId, action: 'move_to_ir' }),
            });
            if (!r1.ok) { const d = await r1.json(); setSidebarError(d.error ?? 'Move to IR failed'); return; }

            // Step 2: activate the IR player (now there is roster space)
            const r2 = await fetch(`/api/teams/${teamId}/ir`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ playerId: outgoingIrId, action: 'activate' }),
            });
            if (!r2.ok) { const d = await r2.json(); setSidebarError(d.error ?? 'Activate failed'); return; }

            router.refresh();
        } catch {
            setSidebarError('Network error — please try again.');
        } finally {
            setSidebarLoading(false);
        }
    }

    // ── IR standalone activate ──
    async function handleIrActivate(playerId: string) {
        setSidebarLoading(true);
        setSidebarError(null);
        setSidebarSelection(null);
        try {
            const res = await fetch(`/api/teams/${teamId}/ir`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ playerId, action: 'activate' }),
            });
            if (!res.ok) { const d = await res.json(); setSidebarError(d.error ?? 'Failed to activate from IR'); }
            else { router.refresh(); }
        } catch {
            setSidebarError('Network error — please try again.');
        } finally {
            setSidebarLoading(false);
        }
    }

    // ── Save lineup ──
    async function handleSave() {
        const starterPayload = slots.map((slot, i) => ({ player_id: assignments[i] as string, slot }));
        if (starterPayload.some((s) => !s.player_id)) {
            setSaveError('All 11 starting slots must be filled before saving.');
            return;
        }
        const benchPayload: { player_id: string; slot: BenchSlot }[] = [];
        for (const slot of BENCH_SLOT_NAMES) {
            const pid = benchAssignments[slot];
            if (pid) benchPayload.push({ player_id: pid, slot });
        }
        if (benchPayload.length !== 4) {
            setSaveError(`Fill all 4 bench slots. Currently ${benchPayload.length}/4.`);
            return;
        }
        setSaving(true); setSaveError(null); setSaveSuccess(false);
        try {
            const res = await fetch(`/api/teams/${teamId}/lineup`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ formation, starters: starterPayload, bench: benchPayload }),
            });
            if (!res.ok) { const data = await res.json(); setSaveError(data.error ?? 'Failed to save lineup'); return; }
            setSaveSuccess(true);
            router.refresh();
        } catch {
            setSaveError('Network error — please try again.');
        } finally {
            setSaving(false);
        }
    }

    const canSave = !saving && slots.every((_, i) => assignments[i] != null) && BENCH_SLOT_NAMES.every((s) => benchAssignments[s] != null);
    // Formation changes are locked once any match in the gameweek has kicked off
    const isMatchweekLocked = (lockedTeamIds?.size ?? 0) > 0;

    // Hint text for current selection state
    const selectionHint = lineupSelection
        ? lineupSelection.type === 'starter'
            ? 'Starter selected — click a reserve, another slot, or a bench slot to swap. Click the Reserves header to drop to reserves.'
            : lineupSelection.type === 'bench-slot'
            ? `Bench slot ${lineupSelection.slot} selected — click a reserve to assign, another bench slot to swap, or the Reserves header to clear.`
            : 'Reserve selected — click a starter slot or bench slot to place.'
        : sidebarSelection
        ? sidebarSelection.type === 'taxi'
            ? 'Academy player selected - click an eligible U21 reserve to swap in.'
            : 'IR player selected — click an injured/unavailable reserve to swap in.'
        : null;

    // ─── Render ───────────────────────────────────────────────────────────────

    return (
        <div className={styles.pitchUI}>
            {/* ── Formation bar ── */}
            <div className={styles.formationBar}>
                <span className={styles.formationLabel}>Formation</span>
                <div className={styles.formationPills}>
                    {FORMATIONS.map((f) => (
                        <button
                            key={f}
                            type="button"
                            className={[
                                styles.formationPill,
                                formation === f ? styles.formationPillActive : '',
                                isMatchweekLocked ? styles.formationPillDisabled : '',
                            ].filter(Boolean).join(' ')}
                            onClick={() => handleFormationChange(f)}
                            disabled={isMatchweekLocked}
                            title={isMatchweekLocked ? 'Formation locked — matches in progress' : undefined}
                        >
                            {f}
                        </button>
                    ))}
                </div>
                {isMatchweekLocked && (
                    <span className={styles.formationLockedNote}>🔒 Locked during matchweek</span>
                )}
            </div>

            {/* ── Selection hint banner ── */}
            {selectionHint && (
                <div className={styles.selectionHint}>
                    <span>{selectionHint}</span>
                    <button type="button" className={styles.cancelBtn} onClick={clearAll}>Cancel</button>
                </div>
            )}

            {/* ── 2-column layout: Pitch (left) + Sidebar (right) ── */}
            <div className={styles.pitchLayout}>

                {/* ── LEFT: Full pitch — horizontal halfway line + center circle match
                    vertical lineup (attack top, GK bottom); not the matchup L/R halves. ── */}
                <div className={styles.pitchCol}>
                    <div className={styles.pitchContainer}>
                        {/* Outer green padding; inner pitchField = white touchlines inside the grass */}
                        <div className={styles.pitchField}>
                        {/* Attacking end (top) */}
                        <div className={styles.pitchTopPenaltyBox} />
                        <div className={styles.pitchTopSixBox} />
                        <div className={styles.pitchTopPenaltyArc} />
                        <div className={styles.pitchHalftimeLine} />
                        <div className={styles.centerCircle} />
                        {/* Defending end (bottom) — same geometry as MatchupPitch half-field */}
                        <div className={styles.pitchBottomPenaltyBox} />
                        <div className={styles.pitchBottomSixBox} />
                        <div className={styles.pitchBottomPenaltyArc} />
                        {teamName && (
                            <div className={styles.pitchLabels}>
                                <span className={styles.pitchLabelLeft}>{teamName}</span>
                            </div>
                        )}

                        <div className={styles.pitchZones}>
                            {ZONE_ORDER.map((zone) => {
                                const zoneSlots = zonedSlots[zone];
                                if (zoneSlots.length === 0) return null;
                                return (
                                    <div key={zone} className={`${styles.pitchZone} ${styles[`zone${zone}`]}`}>
                                        <div className={styles.pitchRow}>
                                            {zoneSlots.map(({ slotIndex, pos }) => {
                                                const playerId = assignments[slotIndex];
                                                const entry = playerId ? playerMap.get(playerId) : undefined;
                                                const isSelected = lineupSelection?.type === 'starter' && lineupSelection.slotIndex === slotIndex;
                                                const isValidTarget = validLineupTargets.has(`starter-${slotIndex}`);
                                                const isInvalid = !!playerId && !!entry && !canPlaySlot(entry.player, pos);
                                                const isLocked = !!playerId && !!entry && entry.player.pl_team_id !== null && lockedTeamIds?.has(entry.player.pl_team_id);
                                                return (
                                                    <PitchNode
                                                        key={slotIndex}
                                                        slotPos={pos}
                                                        player={entry?.player}
                                                        isSelected={isSelected}
                                                        isValidTarget={isValidTarget}
                                                        isEmpty={!playerId}
                                                        isInvalid={isInvalid}
                                                        isLocked={isLocked}
                                                        onClick={() => handleStarterClick(slotIndex)}
                                                        onViewDetails={entry ? () => setViewingPlayer(entry.player) : undefined}
                                                        points={playerId && scoreMap ? scoreMap[playerId] : undefined}
                                                    />
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        </div>{/* end pitchField */}
                    </div>

                    {/* Save row below pitch */}
                    <div className={styles.saveRow}>
                        {saveError && <span className={styles.errorText}>{saveError}</span>}
                        {saveSuccess && !saveError && <span className={styles.successText}>Lineup saved!</span>}
                        <button className={styles.saveBtn} onClick={handleSave} disabled={!canSave}>
                            {saving ? 'Saving…' : 'Save Lineup'}
                        </button>
                    </div>
                </div>

                {/* ── RIGHT: Sidebar ── */}
                <div className={styles.sidebarCol}>

                    {/* Sidebar error/loading */}
                    {sidebarError && (
                        <div className={styles.sidebarError}>
                            {sidebarError}
                            <button type="button" onClick={() => setSidebarError(null)} className={styles.sidebarErrorDismiss}>✕</button>
                        </div>
                    )}

                    {/* ── BENCH CARD ── */}
                    <div className={styles.sidebarCard}>
                        <div className={styles.sidebarCardHeader}>
                            <h3 className={styles.sidebarCardTitle}>Bench</h3>
                            <span className={styles.sidebarCardMeta}>Substitutes</span>
                        </div>
                        <div className={styles.benchList}>
                            {BENCH_SLOT_NAMES.map((slot) => {
                                const pid = benchAssignments[slot];
                                const entry = pid ? playerMap.get(pid) : undefined;
                                const isSelected = lineupSelection?.type === 'bench-slot' && lineupSelection.slot === slot;
                                const isValidTarget = validLineupTargets.has(`bench-${slot}`);
                                const isLocked = !!pid && !!entry && entry.player.pl_team_id !== null && lockedTeamIds?.has(entry.player.pl_team_id);
                                return (
                                    <button
                                        key={slot}
                                        type="button"
                                        className={`${styles.benchRow} ${isSelected ? styles.benchRowSelected : ''} ${isValidTarget ? styles.benchRowTarget : ''} ${!pid ? styles.benchRowEmpty : ''}`}
                                        onClick={isLocked && entry ? () => setViewingPlayer(entry.player) : () => handleBenchSlotClick(slot)}
                                        title={isLocked ? 'Match started (Locked)' : undefined}
                                    >
                                        <span className={styles.benchSlotBadge}>{slot}</span>
                                        <span className={styles.benchSlotDesc}>{BENCH_SLOT_LABELS[slot]}</span>
                                        {entry ? (
                                            <>
                                                <span
                                                    className={styles.benchPlayerName}
                                                    onClick={(e) => { e.stopPropagation(); setViewingPlayer(entry.player); }}
                                                >
                                                    {displayName(entry.player)}
                                                </span>
                                                {scoreMap && pid && scoreMap[pid] !== undefined && (
                                                    <span className={styles.benchPts}>{scoreMap[pid].toFixed(1)}</span>
                                                )}
                                                {isLocked && <span className={styles.lockIcon}>🔒</span>}
                                            </>
                                        ) : (
                                            <span className={styles.benchEmpty}>—</span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* ── RESERVES CARD ── */}
                    <div
                        className={`${styles.sidebarCard} ${lineupSelection && lineupSelection.type !== 'pool' ? styles.sidebarCardDropTarget : ''}`}
                        onClick={(e) => {
                            // Only drop-to-reserves when clicking the card background (not a player row)
                            if (e.target === e.currentTarget && (lineupSelection?.type === 'starter' || lineupSelection?.type === 'bench-slot')) {
                                dropToReserves();
                            }
                        }}
                    >
                        <div
                            className={styles.sidebarCardHeader}
                            style={{ cursor: (lineupSelection?.type === 'starter' || lineupSelection?.type === 'bench-slot') ? 'pointer' : 'default' }}
                            onClick={() => {
                                if (lineupSelection?.type === 'starter' || lineupSelection?.type === 'bench-slot') dropToReserves();
                            }}
                            title={(lineupSelection?.type === 'starter' || lineupSelection?.type === 'bench-slot') ? 'Click to drop selected player to reserves' : undefined}
                        >
                            <h3 className={styles.sidebarCardTitle}>Reserves</h3>
                            <span className={styles.sidebarCardMeta}>{poolEntries.length} available</span>
                        </div>

                        {poolEntries.length === 0 ? (
                            <p className={styles.reservesEmpty}>All players assigned to XI or bench.</p>
                        ) : (
                            <div className={styles.reservesList}>
                                {poolEntries.map((entry) => {
                                    const isLocked = isPlMatchLocked(entry.player, lockedTeamIds);
                                    const isLineupTarget = validLineupTargets.has(`pool-${entry.player.id}`);
                                    const isSidebarTarget = validSidebarTargets.has(`pool-${entry.player.id}`);
                                    const isHighlighted = isLineupTarget || isSidebarTarget;
                                    const isU21 = isU21Eligible(entry.player, academyAgeLimit);
                                    const isInjured = isIrEligible(entry.player);
                                    // Grey out non-eligible players when sidebar selection is active
                                    const isDimmed = sidebarSelection
                                        ? (sidebarSelection.type === 'taxi' ? !isU21 : !isInjured)
                                        : false;
                                    return (
                                        <button
                                            key={entry.id}
                                            type="button"
                                            className={`${styles.reserveRow} ${isLocked ? styles.reserveRowLocked : ''} ${isHighlighted ? styles.reserveRowTarget : ''} ${isDimmed ? styles.reserveRowDimmed : ''}`}
                                            onClick={isLocked ? () => setViewingPlayer(entry.player) : () => handlePoolClick(entry.player.id)}
                                            title={isLocked ? 'Match started (Locked)' : undefined}
                                        >
                                            <span
                                                className={styles.reservePosBadge}
                                                style={{ background: POS_COLOR[entry.player.primary_position] }}
                                            >
                                                {entry.player.primary_position}
                                            </span>
                                            <span
                                                className={styles.reserveName}
                                                onClick={(e) => { e.stopPropagation(); setViewingPlayer(entry.player); }}
                                            >
                                                {displayName(entry.player)}
                                            </span>
                                            <span className={styles.reserveClub}>{entry.player.pl_team}</span>
                                            {isU21 && sidebarSelection?.type === 'taxi' && (
                                                <span className={styles.u21Badge}>U21</span>
                                            )}
                                            {isInjured && sidebarSelection?.type === 'ir' && (
                                                <span className={styles.injuryBadge}>
                                                    {entry.player.fpl_status?.toUpperCase()}
                                                </span>
                                            )}
                                            {entry.player.fpl_status && entry.player.fpl_status !== 'a' && !sidebarSelection && (
                                                <span className={styles.statusDot} data-status={entry.player.fpl_status} />
                                            )}
                                            {isLocked && <span className={styles.lockIcon}>🔒</span>}
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* ── TAXI SQUAD CARD ── */}
                    {(taxiEntries.length > 0 || true) && (
                        <div className={styles.sidebarCard}>
                            <div className={styles.sidebarCardHeader}>
                                <h3 className={styles.sidebarCardTitle}>Academy</h3>
                                <span className={styles.sidebarCardMeta}>{taxiEntries.length} / 3 slots</span>
                            </div>
                            {taxiEntries.length === 0 ? (
                                <p className={styles.reservesEmpty}>No players in academy.</p>
                            ) : (
                                <div className={styles.taxiList}>
                                    {taxiEntries.map((entry) => {
                                        const isSelected = sidebarSelection?.type === 'taxi' && sidebarSelection.playerId === entry.player.id;
                                        const isU21 = isU21Eligible(entry.player, academyAgeLimit);
                                        return (
                                            <div key={entry.id} className={`${styles.taxiRow} ${isSelected ? styles.taxiRowSelected : ''}`}>
                                                <span className={isU21 ? styles.u21Badge : styles.agedOutBadge}>
                                                    {isU21 ? 'U21' : 'AGED OUT'}
                                                </span>
                                                <span
                                                    className={styles.taxiName}
                                                    onClick={() => setViewingPlayer(entry.player)}
                                                >
                                                    {displayName(entry.player)}
                                                </span>
                                                <span className={styles.taxiClub}>{entry.player.pl_team}</span>
                                                <div className={styles.taxiActions}>
                                                    <button
                                                        type="button"
                                                        className={`${styles.taxiSwapBtn} ${isSelected ? styles.taxiSwapBtnActive : ''}`}
                                                        onClick={() => {
                                                            if (isSelected) { setSidebarSelection(null); return; }
                                                            activateSidebarSelection({ type: 'taxi', playerId: entry.player.id });
                                                        }}
                                                        disabled={sidebarLoading}
                                                        title="Select to swap with a U21 reserve"
                                                    >
                                                        {isSelected ? 'Cancel' : 'Swap'}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className={styles.taxiActivateBtn}
                                                        onClick={() => handleTaxiActivate(entry.player.id)}
                                                        disabled={sidebarLoading}
                                                        title="Promote to active roster"
                                                    >
                                                        {sidebarLoading ? '…' : 'Activate'}
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}

                    {/* ── IR CARD ── */}
                    {irEntries.length > 0 && (
                        <div className={styles.sidebarCard}>
                            <div className={styles.sidebarCardHeader}>
                                <h3 className={`${styles.sidebarCardTitle} ${styles.irTitle}`}>Injured Reserve</h3>
                                <span className={styles.sidebarCardMeta}>{irEntries.length} players</span>
                            </div>
                            <div className={styles.irList}>
                                {irEntries.map((entry) => {
                                    const isSelected = sidebarSelection?.type === 'ir' && sidebarSelection.playerId === entry.player.id;
                                    return (
                                        <div key={entry.id} className={`${styles.irRow} ${isSelected ? styles.irRowSelected : ''}`}>
                                            <span className={styles.irBadge}>IR</span>
                                            <span
                                                className={styles.irName}
                                                onClick={() => setViewingPlayer(entry.player)}
                                            >
                                                {displayName(entry.player)}
                                            </span>
                                            <span className={styles.irClub}>{entry.player.pl_team}</span>
                                            <div className={styles.irActions}>
                                                <button
                                                    type="button"
                                                    className={`${styles.irSwapBtn} ${isSelected ? styles.irSwapBtnActive : ''}`}
                                                    onClick={() => {
                                                        if (isSelected) { setSidebarSelection(null); return; }
                                                        activateSidebarSelection({ type: 'ir', playerId: entry.player.id });
                                                    }}
                                                    disabled={sidebarLoading}
                                                    title="Select to swap with an injured reserve"
                                                >
                                                    {isSelected ? 'Cancel' : 'Swap'}
                                                </button>
                                                <button
                                                    type="button"
                                                    className={styles.irActivateBtn}
                                                    onClick={() => handleIrActivate(entry.player.id)}
                                                    disabled={sidebarLoading}
                                                    title="Activate from IR"
                                                >
                                                    {sidebarLoading ? '…' : 'Activate'}
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* ── BUDGET CARD ── */}
                    <div className={styles.budgetCard}>
                        <span className={styles.budgetLabel}>FAAB Budget</span>
                        <span className={styles.budgetValue}>£{faabBudget}m</span>
                        <span className={styles.budgetSub}>remaining</span>
                    </div>

                </div>
            </div>

            <PlayerDetailsModal
                player={viewingPlayer}
                onClose={() => setViewingPlayer(null)}
            />
        </div>
    );
}
