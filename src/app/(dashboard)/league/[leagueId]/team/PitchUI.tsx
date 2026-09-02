'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
    FORMATION_SLOTS,
    POSITION_FLEX_MAP,
    BENCH_FLEX_MAP,
} from '@/types';
import type { Formation, GranularPosition, Player, BenchSlot, RosterEntry } from '@/types';
import { playerHoverProps, usePlayerCard } from '@/components/players/PlayerCardProvider';
import { getPlayerDisplayName } from '@/lib/players/displayName';
import Portrait from '@/components/players/Portrait';
import PositionBadge from '@/components/players/PositionBadge';
import { SPINE, POS_COLOR } from '@/lib/positions/spine';
import { getFormationLockStatus, assignStartersForFormation } from '@/lib/lineups/smartLock';
import { scoreAppearanceAtSlot, type RefStatsMap } from '@/lib/scoring/matchups';
import type { RawStats } from '@/types';
import styles from './pitch.module.css';
import { Icon } from '@/components/ui/Icon';


// ─── Constants ──────────────────────────────────────────────────────────────

const FORMATIONS: Formation[] = ['4-3-3', '4-2-1-3', '4-2-2-2', '3-4-3', '3-4-1-2', '3-5-2', '5-3-2', '3-4-2-1', '4-3-1-2', '4-3-2-1', '4-2-4', '5-2-3'];

type PitchZone = 'ATT' | 'AMZ' | 'CMZ' | 'DMZ' | 'WBZ' | 'DEF' | 'GK';
// Zone order: attackers at top, GK at bottom (same vertical flow as MatchupPitch)
const ZONE_ORDER: PitchZone[] = ['ATT', 'AMZ', 'CMZ', 'DMZ', 'WBZ', 'DEF', 'GK'];
const BENCH_SLOT_NAMES: BenchSlot[] = ['DEF', 'MID', 'ATT', 'FLEX'];
const BENCH_SLOT_TITLE: Record<BenchSlot, string> = {
    DEF: 'Defender',
    MID: 'Midfielder',
    ATT: 'Attacker',
    FLEX: 'Flex',
};

const DEFAULT_TAXI_AGE_LIMIT = 21;

/**
 * Pending (club hasn't kicked off yet) vs. DNP (kicked off, 0 minutes) vs.
 * played — mirrors MatchupPitch's playStatus so the same player reads the
 * same way on the lineup pitch as on the matchup detail pitch.
 */
type PlayStatus = 'pending' | 'played' | 'dnp';

function playStatus(minutes: number | undefined, hasStarted: boolean): PlayStatus {
    if (!hasStarted) return 'pending';
    return Number(minutes ?? 0) > 0 ? 'played' : 'dnp';
}

/**
 * Points band for the pitch badge fill — same thresholds and colours as
 * MatchupPitch's ptsBand (matchRating.ts has the exact table); see
 * pitch.module.css's .nodePtsBadge comment for why this exists twice.
 */
function ptsBand(points: number): string {
    if (points >= 29) return styles.nodePtsElite;
    if (points >= 15.8) return styles.nodePtsGood;
    if (points >= 5.6) return styles.nodePtsFair;
    if (points >= 2.0) return styles.nodePtsBelowAvg;
    if (points > 0) return styles.nodePtsWeak;
    return styles.nodePtsBad;
}

/* SPINE (phase-of-play order) and POS_COLOR now live in
   src/lib/positions/spine.ts — the stats pool is the second panel to qualify
   for the spectrum, and two copies of the twelve hues is how the device stops
   meaning the same thing on both. */

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Matches MatchupPitch's 6-zone approach so DM/CM/AM/WB render as distinct rows
function getZone(pos: GranularPosition): PitchZone {
    if (pos === 'GK') return 'GK';
    if (pos === 'LWB' || pos === 'RWB') return 'WBZ';
    if (pos === 'CB' || pos === 'LB' || pos === 'RB') return 'DEF';
    if (pos === 'DM') return 'DMZ';
    if (pos === 'CM') return 'CMZ';
    if (pos === 'AM') return 'AMZ';
    return 'ATT'; // LW, ST, RW
}

function getPlayerPositions(player: Player): GranularPosition[] {
    return (player.primary_position ? [player.primary_position] : []).concat(player.secondary_positions ?? []);
}
function canPlaySlot(player: Player, slotPos: GranularPosition): boolean {
    return getPlayerPositions(player).some((p) => POSITION_FLEX_MAP[slotPos].includes(p));
}
function canPlayBenchSlot(player: Player, slot: BenchSlot): boolean {
    return getPlayerPositions(player).some((p) => BENCH_FLEX_MAP[slot].includes(p));
}

function displayName(player: Player): string {
    return getPlayerDisplayName(player, 'initial_last');
}

function pitchFullName(player: Player): string {
    return getPlayerDisplayName(player, 'full');
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
    taxiAgeLimit?: number;
    initialFormation: Formation;
    initialAssignments: Record<number, string>;
    initialBench: Record<BenchSlot, string | null>;
    scoreMap?: Record<string, number>;
    /** Minutes played this GW. Undefined = no scoring context yet (offseason/no GW); present = drives pending/DNP badges. */
    minutesMap?: Record<string, number>;
    rawStatsMap?: Record<string, RawStats>;
    refStats?: RefStatsMap;
    gameweek?: number;
    lockedTeamIds?: Set<number>;
    /** Scoring-week locks (this GW until it completes). IR uses this; lineup/academy use lockedTeamIds. */
    scoringLockedTeamIds?: Set<number>;
    /** When the pitch is next week while this week is still live. */
    lineupWeekLabel?: string;
    /** Active roster count / cap, shown on the pitch header strip */
    activeRosterCount?: number;
    maxRosterSize?: number;
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
    isLoan?: boolean;
    onClick: () => void;
    onViewDetails?: () => void;
    points?: number;
    status?: PlayStatus;
}

function PitchNode({ slotPos, player, isSelected, isValidTarget, isEmpty, isInvalid, isLocked, onClick, onViewDetails, points, status }: PitchNodeProps) {
    const { prefetchPlayer } = usePlayerCard();
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
            {...(player ? playerHoverProps(prefetchPlayer, player) : {})}
            onClick={() => {
                if (player && onViewDetails) {
                    onViewDetails();
                } else if (!isLocked) {
                    onClick();
                }
            }}
            style={isLocked ? { opacity: 0.7 } : undefined}
            title={isLocked ? 'Match started (Locked) — click to view' : isInvalid ? 'Player is not eligible for this position' : undefined}
        >
            {/* The lot-size portrait, with the club on its crest chip. The node
                used to carry a three-letter club abbreviation as a line of text
                beside the badge — the exact line the crest replaced everywhere
                else, and the reason the chip needed two rows of type. */}
            <span
                className={styles.nodePortrait}
                onClick={(e) => {
                    if (player && !isLocked) {
                        e.stopPropagation();
                        onClick();
                    }
                }}
            >
                <Portrait
                    photoUrl={player?.photo_url}
                    name={player ? pitchFullName(player) : slotPos}
                    club={player?.pl_team}
                    size="md"
                    headTopPct={player?.portrait_head_top_pct}
                    headWidthPct={player?.portrait_head_width_pct}
                    photoVersion={player?.photo_version}
                />
                {isLocked && player && (
                    <span className={styles.nodeLockBadge} title="Locked">
                        <Icon name="lock" size={11} strokeWidth={2.2} />
                    </span>
                )}
                {status === 'pending' && (
                    <span className={`${styles.nodePtsBadge} ${styles.nodePtsPending}`} title="Yet to play">–</span>
                )}
                {status === 'dnp' && (
                    <span className={`${styles.nodePtsBadge} ${styles.nodePtsDnp}`} title="Did not play">DNP</span>
                )}
                {(status === 'played' || (status === undefined && points !== undefined)) && (
                    <span className={`${styles.nodePtsBadge} ${ptsBand(points ?? 0)}`}>{(points ?? 0).toFixed(2)}</span>
                )}
            </span>

            <div className={chipCls}>
                <div className={styles.nodeChipBody}>
                    {player ? (
                        <>
                            <span className={`${styles.nodePlayerNameCenter} ${isInvalid ? styles.nodeNameInvalid : ''}`}>
                                {displayName(player)}
                            </span>
                            <div className={styles.nodeMetaChipRow}>
                                <PositionBadge position={slotPos} size="sm" />
                                {player.fpl_status && player.fpl_status !== 'a' && (
                                    <span className={styles.nodeStatusDot} data-status={player.fpl_status} />
                                )}
                            </div>
                        </>
                    ) : (
                        <>
                            <span className={styles.nodeEmptyLabel}>Empty</span>
                            <div className={styles.nodeMetaChipRow}>
                                <PositionBadge position={slotPos} size="sm" />
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
    taxiAgeLimit = DEFAULT_TAXI_AGE_LIMIT,
    initialFormation,
    initialAssignments,
    initialBench,
    scoreMap,
    minutesMap,
    rawStatsMap,
    refStats,
    gameweek,
    lockedTeamIds,
    scoringLockedTeamIds,
    lineupWeekLabel,
    activeRosterCount,
    maxRosterSize,
}: Props) {
    const router = useRouter();
    const irLockedTeamIds = scoringLockedTeamIds ?? lockedTeamIds;

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
    const { openPlayer, prefetchPlayer, primePlayers } = usePlayerCard();
    const setViewingPlayer = useCallback(
        (p: Player, slot?: string) => {
            openPlayer(p, {
                gameweek: gameweek ?? null,
                position: slot ?? p.primary_position ?? null,
            });
        },
        [openPlayer, gameweek],
    );

    useEffect(() => {
        primePlayers([
            ...allEntries.map((e) => e.player),
            ...taxiEntries.map((e) => e.player),
            ...irEntries.map((e) => e.player),
        ]);
    }, [allEntries, taxiEntries, irEntries, primePlayers]);

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
        const list = slots.map((pos, i) => ({ slotIndex: i, pos, zone: getZone(pos) }));
        return {
            ATT: list.filter((s) => s.zone === 'ATT'),
            AMZ: list.filter((s) => s.zone === 'AMZ'),
            CMZ: list.filter((s) => s.zone === 'CMZ'),
            DMZ: list.filter((s) => s.zone === 'DMZ'),
            WBZ: list.filter((s) => s.zone === 'WBZ'),
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
                if (otherEntry && isPlMatchLocked(otherEntry.player, lockedTeamIds)) continue;
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
                    const benchPid = benchAssignments[slot];
                    const benchEntry = benchPid ? playerMap.get(benchPid) : null;
                    if (benchEntry && isPlMatchLocked(benchEntry.player, lockedTeamIds)) continue;
                    if (canPlayBenchSlot(currentEntry.player, slot)) targets.add(`bench-${slot}`);
                }
            }
        }

        if (lineupSelection.type === 'bench-slot') {
            const benchPlayerId = benchAssignments[lineupSelection.slot];
            const benchEntry = benchPlayerId ? playerMap.get(benchPlayerId) : null;
            if (benchEntry) {
                for (let i = 0; i < slots.length; i++) {
                    const starterPid = assignments[i];
                    const starterEntry = starterPid ? playerMap.get(starterPid) : null;
                    if (starterEntry && isPlMatchLocked(starterEntry.player, lockedTeamIds)) continue;
                    if (canPlaySlot(benchEntry.player, slots[i])) targets.add(`starter-${i}`);
                }
                for (const slot of BENCH_SLOT_NAMES) {
                    if (slot === lineupSelection.slot) continue;
                    const otherBenchPid = benchAssignments[slot];
                    const otherBenchEntry = otherBenchPid ? playerMap.get(otherBenchPid) : null;
                    if (otherBenchEntry && isPlMatchLocked(otherBenchEntry.player, lockedTeamIds)) continue;
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
                    const starterPid = assignments[i];
                    const starterEntry = starterPid ? playerMap.get(starterPid) : null;
                    if (starterEntry && isPlMatchLocked(starterEntry.player, lockedTeamIds)) continue;
                    if (canPlaySlot(entry.player, slots[i])) targets.add(`starter-${i}`);
                }
                for (const slot of BENCH_SLOT_NAMES) {
                    const benchPid = benchAssignments[slot];
                    const benchEntry = benchPid ? playerMap.get(benchPid) : null;
                    if (benchEntry && isPlMatchLocked(benchEntry.player, lockedTeamIds)) continue;
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
                if (isPlMatchLocked(e.player, irLockedTeamIds)) continue;
                if (isIrEligible(e.player)) targets.add(`pool-${e.player.id}`);
            }
        }
        return targets;
    }, [sidebarSelection, poolEntries, academyAgeLimit, lockedTeamIds, irLockedTeamIds]);

    // ── Selection helpers ──
    function clearAll() {
        setLineupSelection(null);
        setSidebarSelection(null);
        setSaveError(null);
    }

    function activateLineupSelection(sel: LineupSelection | null) {
        if (!sel) {
            setLineupSelection(null);
            return;
        }
        if (sel.type === 'starter') {
            const pid = assignments[sel.slotIndex];
            const entry = pid ? playerMap.get(pid) : null;
            if (entry && isPlMatchLocked(entry.player, lockedTeamIds)) {
                setSaveError(`${displayName(entry.player)} is locked — match started.`);
                return;
            }
        } else if (sel.type === 'bench-slot') {
            const pid = benchAssignments[sel.slot];
            const entry = pid ? playerMap.get(pid) : null;
            if (entry && isPlMatchLocked(entry.player, lockedTeamIds)) {
                setSaveError(`${displayName(entry.player)} is locked — match started.`);
                return;
            }
        }
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
        const status = formationLockStatus[f];
        if (status?.disabled) {
            setSaveError(status.reason ?? `Cannot switch to ${f}`);
            return;
        }
        const newAssignments = assignStartersForFormation(
            assignments,
            slots,
            f,
            lockedPlayerIds,
            playerMap,
        );
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
                
                if ((eA && isPlMatchLocked(eA.player, lockedTeamIds)) || (eB && isPlMatchLocked(eB.player, lockedTeamIds))) {
                    setSaveError('Match started — one of these players is locked.');
                    setLineupSelection(null); return;
                }

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
                
                const existingId = assignments[slotIndex];
                const existingEntry = existingId ? playerMap.get(existingId) : null;

                if (isPlMatchLocked(entry.player, lockedTeamIds) || (existingEntry && isPlMatchLocked(existingEntry.player, lockedTeamIds))) {
                    setSaveError('Match started — involved player is locked.');
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

                if ((eBench && isPlMatchLocked(eBench.player, lockedTeamIds)) || (eStart && isPlMatchLocked(eStart.player, lockedTeamIds))) {
                    setSaveError('Match started — involved player is locked.');
                    setLineupSelection(null); return;
                }

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

                if ((eA && isPlMatchLocked(eA.player, lockedTeamIds)) || (eB && isPlMatchLocked(eB.player, lockedTeamIds))) {
                    setSaveError('Match started — involved player is locked.');
                    setLineupSelection(null); return;
                }

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
                
                const existingId = benchAssignments[slot];
                const existingEntry = existingId ? playerMap.get(existingId) : null;

                if (isPlMatchLocked(entry.player, lockedTeamIds) || (existingEntry && isPlMatchLocked(existingEntry.player, lockedTeamIds))) {
                    setSaveError('Match started — involved player is locked.');
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

                if ((eStart && isPlMatchLocked(eStart.player, lockedTeamIds)) || (eBench && isPlMatchLocked(eBench.player, lockedTeamIds))) {
                    setSaveError('Match started — involved player is locked.');
                    setLineupSelection(null); return;
                }

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
                    if (isPlMatchLocked(targetEntry.player, irLockedTeamIds)) {
                        setSidebarError('Match started — this player is locked.');
                        setSidebarSelection(null);
                        return;
                    }
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
        [lineupSelection, sidebarSelection, slots, playerMap, poolEntries, academyAgeLimit, lockedTeamIds, irLockedTeamIds],
    );

    // ── Taxi swap: swap an active U21 reserve with an academy player ──
    async function handleTaxiSwap(outgoingTaxiId: string, incomingReserveId: string) {
        setSidebarLoading(true);
        setSidebarError(null);
        setSidebarSelection(null);
        try {
            const res = await fetch(`/api/teams/${teamId}/taxi`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'swap',
                    playerId: incomingReserveId,
                    swapWithPlayerId: outgoingTaxiId,
                }),
            });
            if (!res.ok) {
                const d = await res.json();
                setSidebarError(d.error ?? 'Academy swap failed');
                return;
            }

            router.refresh();
        } catch {
            setSidebarError('Could not reach the server. Try again.');
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
            setSidebarError('Could not reach the server. Try again.');
        } finally {
            setSidebarLoading(false);
        }
    }

    // ── IR swap: swap an active injured reserve with an IR player ──
    async function handleIrSwap(outgoingIrId: string, incomingReserveId: string) {
        setSidebarLoading(true);
        setSidebarError(null);
        setSidebarSelection(null);
        try {
            const res = await fetch(`/api/teams/${teamId}/ir`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'swap',
                    playerId: incomingReserveId,
                    swapWithPlayerId: outgoingIrId,
                }),
            });
            if (!res.ok) {
                const d = await res.json();
                setSidebarError(d.error ?? 'IR swap failed');
                return;
            }

            router.refresh();
        } catch {
            setSidebarError('Could not reach the server. Try again.');
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
            setSidebarError('Could not reach the server. Try again.');
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
            setSaveError('Could not reach the server. Try again.');
        } finally {
            setSaving(false);
        }
    }

    const canSave = !saving && slots.every((_, i) => assignments[i] != null) && BENCH_SLOT_NAMES.every((s) => benchAssignments[s] != null);

    const lockedPlayerIds = useMemo(() => {
        const set = new Set<string>();
        if (!lockedTeamIds || lockedTeamIds.size === 0) return set;
        for (const e of allEntries) {
            if (isPlMatchLocked(e.player, lockedTeamIds)) {
                set.add(e.player.id);
            }
        }
        return set;
    }, [allEntries, lockedTeamIds]);

    const lockedStarters = useMemo(() => {
        const list: Array<{ playerId: string; slot: GranularPosition }> = [];
        const initialSlots = FORMATION_SLOTS[initialFormation];
        for (let i = 0; i < initialSlots.length; i++) {
            const pid = initialAssignments[i];
            if (pid && lockedPlayerIds.has(pid)) {
                list.push({ playerId: pid, slot: initialSlots[i] });
            }
        }
        return list;
    }, [initialAssignments, initialFormation, lockedPlayerIds]);

    const formationLockStatus = useMemo(() => {
        const names = new Map<string, string>();
        for (const [id, e] of playerMap.entries()) {
            names.set(id, displayName(e.player));
        }
        return getFormationLockStatus(lockedStarters, names);
    }, [lockedStarters, playerMap]);

    // Hint text for current selection state (shown as a tooltip on the compact indicator)
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

    // Short label for the compact indicator itself
    const selectionLabel = lineupSelection
        ? lineupSelection.type === 'starter'
            ? 'Starter selected'
            : lineupSelection.type === 'bench-slot'
            ? `Bench (${lineupSelection.slot}) selected`
            : 'Reserve selected'
        : sidebarSelection
        ? sidebarSelection.type === 'taxi'
            ? 'Academy player selected'
            : 'IR player selected'
        : null;

    // ─── Render ───────────────────────────────────────────────────────────────

    return (
        <div className={styles.pitchUI}>
            {/* ── Formation bar ── */}
            <div className={styles.formationBar}>
                <span className="g-label">{lineupWeekLabel ?? 'Formation'}</span>
                <div className={styles.formationPills}>
                    {FORMATIONS.map((f) => {
                        const status = formationLockStatus[f];
                        const isDisabled = status?.disabled ?? false;
                        return (
                            <button
                                key={f}
                                type="button"
                                className={[
                                    styles.formationPill,
                                    formation === f ? styles.formationPillActive : '',
                                    isDisabled ? styles.formationPillDisabled : '',
                                ].filter(Boolean).join(' ')}
                                onClick={() => handleFormationChange(f)}
                                disabled={isDisabled}
                                title={isDisabled ? status?.reason : undefined}
                            >
                                {f}
                            </button>
                        );
                    })}
                </div>
                <div className={styles.formationBarTrailer}>
                    {lockedPlayerIds.size > 0 && (
                        <span className={styles.formationLockedNote} title="Players whose match has kicked off are locked to their slots">
                            <Icon name="lock" size={14} style={{ marginRight: '4px' }} /> Smart-Lock active
                        </span>
                    )}
                    {selectionLabel && (
                        <span className={styles.selectionIndicator}>
                            <span className={styles.selectionDot} aria-hidden />
                            <span className={styles.selectionLabel} title={selectionHint ?? undefined}>
                                {selectionLabel}
                            </span>
                            <button
                                type="button"
                                className={styles.selectionCancelBtn}
                                onClick={clearAll}
                                aria-label="Cancel selection"
                                title="Cancel"
                            >
                                ×
                            </button>
                        </span>
                    )}
                    {saveError && <span className={styles.errorText}>{saveError}</span>}
                    {saveSuccess && !saveError && <span className={styles.successText}>Lineup saved.</span>}
                    <button className={styles.saveBtn} onClick={handleSave} disabled={!canSave}>
                        {saving ? 'Saving…' : 'Save Lineup'}
                    </button>
                </div>
            </div>

            {/* ── The board ──
                One panel: the grass and the squad rail are two columns of one
                field, divided by a hairline, not two things that float. You
                move players between them and the rail's counts are arithmetic
                on what is on the grass. See design-2.0/README.md § "A board is
                one panel". */}
            <div className="g-panel">
                {/* The spectrum's first use in the app. It is rationed to a panel
                    representing a whole squad or the whole pool — every earlier
                    port correctly left it off, and a board carrying the eleven on
                    the field plus every reserve is what it was reserved for. */}
                <div className={`g-spectrum ${styles.spectrum}`} aria-hidden>
                    {SPINE.map((p) => <i key={p} style={{ background: POS_COLOR[p] }} />)}
                </div>

                <div className={styles.board}>

                {/* ── LEFT: Full pitch — horizontal halfway line + center circle match
                    vertical lineup (attack top, GK bottom); not the matchup L/R halves. ── */}
                <div className={styles.pitchCol}>
                    <div className={styles.pitchContainer}>
                        {/* Outer green run-off; inner pitchField = touchlines inside the grass */}
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
                        {(teamName || activeRosterCount !== undefined) && (
                            <div className={styles.pitchLabels}>
                                {teamName && <span className={`g-label ${styles.pitchLabelLeft}`}>{teamName}</span>}
                                {activeRosterCount !== undefined && (
                                    <span className={`g-label ${styles.pitchLabelRight}`}>
                                        {activeRosterCount}/{maxRosterSize} Active Roster
                                    </span>
                                )}
                            </div>
                        )}

                        <div className={styles.pitchZones}>
                            {ZONE_ORDER.filter((zone) => zonedSlots[zone].length > 0).map((zone) => {
                                const zoneSlots = zonedSlots[zone];
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
                                                const hasStarted = !!entry && isPlMatchLocked(entry.player, irLockedTeamIds);
                                                const status = playerId && minutesMap ? playStatus(minutesMap[playerId], hasStarted) : undefined;
                                                const starterPoints = (() => {
                                                    if (!playerId) return undefined;
                                                    const basePts = scoreMap?.[playerId];
                                                    if (basePts === undefined) return undefined;
                                                    const stats = rawStatsMap?.[playerId];
                                                    if (stats && refStats && entry) {
                                                        return scoreAppearanceAtSlot(stats, pos, entry.player.primary_position ?? undefined, refStats, { points: basePts, rating: null }).points;
                                                    }
                                                    return basePts;
                                                })();
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
                                                        isLoan={entry?.status === 'loan_in'}
                                                        onClick={() => handleStarterClick(slotIndex)}
                                                        onViewDetails={entry ? () => setViewingPlayer(entry.player, pos) : undefined}
                                                        points={starterPoints}
                                                        status={status}
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
                </div>


                {/* ── RIGHT: the squad rail ──
                    Four tiers as sections of one column, divided by hairlines.
                    They were four independent cards floating beside a bare
                    pitch — five elevation declarations for one composition —
                    and, being separate rulesets, their padding, hover and
                    selected states had already drifted apart. One row class
                    serves all four now. */}
                <div className={styles.sidebarCol}>

                    {sidebarError && (
                        <div className={styles.sidebarError}>
                            {sidebarError}
                            <button type="button" onClick={() => setSidebarError(null)} className={styles.sidebarErrorDismiss} aria-label="Dismiss">✕</button>
                        </div>
                    )}

                    {/* ── BENCH ── */}
                    <section className={styles.tier}>
                        <div className={styles.tierHead}>
                            <h3 className={styles.tierTitle}>Bench</h3>
                            <span className="g-label">Substitutes</span>
                        </div>
                        {BENCH_SLOT_NAMES.map((slot) => {
                            const pid = benchAssignments[slot];
                            const entry = pid ? playerMap.get(pid) : undefined;
                            const isSelected = lineupSelection?.type === 'bench-slot' && lineupSelection.slot === slot;
                            const isValidTarget = validLineupTargets.has(`bench-${slot}`);
                            const isLocked = !!pid && !!entry && entry.player.pl_team_id !== null && lockedTeamIds?.has(entry.player.pl_team_id);
                            const pts = scoreMap && pid ? scoreMap[pid] : undefined;
                            const benchHasStarted = !!entry && isPlMatchLocked(entry.player, irLockedTeamIds);
                            const benchStatus = pid && minutesMap ? playStatus(minutesMap[pid], benchHasStarted) : undefined;
                            return (
                                <button
                                    key={slot}
                                    type="button"
                                    className={[
                                        'g-row', 'g-namerow', styles.row, styles.rowBtn,
                                        isSelected ? styles.rowSelected : '',
                                        isValidTarget ? styles.rowTarget : '',
                                        !pid ? styles.rowEmpty : '',
                                    ].filter(Boolean).join(' ')}
                                    style={entry ? { ['--pf' as string]: entry.player.primary_position ? POS_COLOR[entry.player.primary_position] : 'var(--color-border-subtle)' } : undefined}
                                    onClick={isLocked && entry ? () => setViewingPlayer(entry.player) : () => handleBenchSlotClick(slot)}
                                    title={isLocked ? 'Match started (Locked)' : undefined}
                                >
                                    <span className={styles.slotBadge} title={BENCH_SLOT_TITLE[slot]}>{slot}</span>

                                    {entry ? (
                                        <>
                                            <PositionBadge position={entry.player.primary_position} size="sm" />
                                            <span
                                                className={styles.rowName}
                                                onClick={(e) => { e.stopPropagation(); setViewingPlayer(entry.player); }}
                                                {...playerHoverProps(prefetchPlayer, entry.player)}
                                            >
                                                {displayName(entry.player)}
                                            </span>
                                            <span className={styles.rowSpacer} />
                                            {entry.status === 'loan_in' && <span className={styles.loanTag}>Loan</span>}
                                            <span className={styles.rowClub}>{entry.player.pl_team}</span>
                                            {benchStatus === 'pending' && (
                                                <span className={`${styles.rowPts} ${styles.rowPtsPending}`} title="Yet to play">–</span>
                                            )}
                                            {benchStatus === 'dnp' && (
                                                <span className={`${styles.rowPts} ${styles.rowPtsDnp}`} title="Did not play">DNP</span>
                                            )}
                                            {(benchStatus === 'played' || (benchStatus === undefined && pts !== undefined)) && (
                                                <span className={styles.rowPts}>{(pts ?? 0).toFixed(2)}</span>
                                            )}
                                            {isLocked && <span className={styles.lockIcon}><Icon name="lock" size={14} /></span>}
                                        </>
                                    ) : (
                                        <span className={styles.rowEmptyMark}>—</span>
                                    )}
                                </button>
                            );
                        })}
                    </section>

                    {/* ── RESERVES ── */}
                    <section
                        className={`${styles.tier} ${lineupSelection && lineupSelection.type !== 'pool' ? styles.tierDropTarget : ''}`}
                        onClick={(e) => {
                            // Drop-to-reserves only when the click lands on the section
                            // itself, never on a player row.
                            if (e.target === e.currentTarget && (lineupSelection?.type === 'starter' || lineupSelection?.type === 'bench-slot')) {
                                dropToReserves();
                            }
                        }}
                    >
                        <div
                            className={styles.tierHead}
                            style={{ cursor: (lineupSelection?.type === 'starter' || lineupSelection?.type === 'bench-slot') ? 'pointer' : undefined }}
                            onClick={() => {
                                if (lineupSelection?.type === 'starter' || lineupSelection?.type === 'bench-slot') dropToReserves();
                            }}
                            title={(lineupSelection?.type === 'starter' || lineupSelection?.type === 'bench-slot') ? 'Click to drop selected player to reserves' : undefined}
                        >
                            <h3 className={styles.tierTitle}>Reserves</h3>
                            <span className="g-label">{poolEntries.length} available</span>
                        </div>

                        {poolEntries.length === 0 ? (
                            <p className={styles.tierEmpty}>All players assigned to XI or bench.</p>
                        ) : (
                            poolEntries.map((entry) => {
                                const isLocked = isPlMatchLocked(entry.player, lockedTeamIds);
                                const isLineupTarget = validLineupTargets.has(`pool-${entry.player.id}`);
                                const isSidebarTarget = validSidebarTargets.has(`pool-${entry.player.id}`);
                                const isHighlighted = isLineupTarget || isSidebarTarget;
                                const isSelected = lineupSelection?.type === 'pool' && lineupSelection.playerId === entry.player.id;
                                const isU21 = isU21Eligible(entry.player, academyAgeLimit);
                                const isInjured = isIrEligible(entry.player);
                                // Grey out non-eligible players while an academy/IR swap is armed.
                                const isDimmed = sidebarSelection
                                    ? (sidebarSelection.type === 'taxi' ? !isU21 : !isInjured)
                                    : false;
                                return (
                                    <button
                                        key={entry.id}
                                        type="button"
                                        className={[
                                            'g-row', 'g-namerow', styles.row, styles.rowBtn,
                                            isLocked ? styles.rowLocked : '',
                                            isHighlighted ? styles.rowTarget : '',
                                            isSelected ? styles.rowSelected : '',
                                            isDimmed ? styles.rowDimmed : '',
                                        ].filter(Boolean).join(' ')}
                                        style={{ ['--pf' as string]: entry.player.primary_position ? POS_COLOR[entry.player.primary_position] : 'var(--color-border-subtle)' }}
                                        onClick={isLocked ? () => setViewingPlayer(entry.player) : () => handlePoolClick(entry.player.id)}
                                        title={isLocked ? 'Match started (Locked)' : undefined}
                                    >
                                        <PositionBadge position={entry.player.primary_position} size="sm" />
                                        <span
                                            className={styles.rowName}
                                            onClick={(e) => { e.stopPropagation(); setViewingPlayer(entry.player); }}
                                            {...playerHoverProps(prefetchPlayer, entry.player)}
                                        >
                                            {displayName(entry.player)}
                                        </span>
                                        <span className={styles.rowSpacer} />
                                        {entry.status === 'loan_in' && <span className={styles.loanTag}>Loan</span>}
                                        <span className={styles.rowClub}>{entry.player.pl_team}</span>
                                        {isU21 && sidebarSelection?.type === 'taxi' && (
                                            <span className={styles.eligibleTag}>U21</span>
                                        )}
                                        {isInjured && sidebarSelection?.type === 'ir' && (
                                            <span className={styles.eligibleTag}>{entry.player.fpl_status?.toUpperCase()}</span>
                                        )}
                                        {entry.player.fpl_status && entry.player.fpl_status !== 'a' && !sidebarSelection && (
                                            <span className={styles.statusDot} data-status={entry.player.fpl_status} />
                                        )}
                                        {isLocked && <span className={styles.lockIcon}><Icon name="lock" size={14} /></span>}
                                    </button>
                                );
                            })
                        )}
                    </section>

                    {/* ── ACADEMY ── */}
                    <section className={styles.tier}>
                        <div className={styles.tierHead}>
                            <h3 className={styles.tierTitle}>Academy</h3>
                            <span className="g-label">{taxiEntries.length} / 3 slots</span>
                        </div>
                        {taxiEntries.length === 0 ? (
                            <p className={styles.tierEmpty}>No players in academy.</p>
                        ) : (
                            taxiEntries.map((entry) => {
                                const isSelected = sidebarSelection?.type === 'taxi' && sidebarSelection.playerId === entry.player.id;
                                return (
                                    <div
                                        key={entry.id}
                                        className={`g-row g-namerow ${styles.row} ${isSelected ? styles.rowSelected : ''}`}
                                        style={{ ['--pf' as string]: entry.player.primary_position ? POS_COLOR[entry.player.primary_position] : 'var(--color-border-subtle)' }}
                                    >
                                        <PositionBadge position={entry.player.primary_position} size="sm" />
                                        <span
                                            className={styles.rowName}
                                            onClick={() => setViewingPlayer(entry.player)}
                                            {...playerHoverProps(prefetchPlayer, entry.player)}
                                        >
                                            {displayName(entry.player)}
                                        </span>
                                        <span className={styles.rowSpacer} />
                                        <span className={styles.rowClub}>{entry.player.pl_team}</span>
                                        <div className={styles.rowActions}>
                                            <button
                                                type="button"
                                                className={`${styles.rowBtnGhost} ${isSelected ? styles.rowBtnGhostOn : ''}`}
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
                                                className={styles.rowBtnPrimary}
                                                onClick={() => handleTaxiActivate(entry.player.id)}
                                                disabled={sidebarLoading}
                                                title="Promote to active roster"
                                            >
                                                {sidebarLoading ? '…' : 'Activate'}
                                            </button>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </section>

                    {/* ── INJURED RESERVE ── */}
                    {irEntries.length > 0 && (
                        <section className={styles.tier}>
                            <div className={styles.tierHead}>
                                <h3 className={styles.tierTitle}>Injured Reserve</h3>
                                <span className="g-label">{irEntries.length} players</span>
                            </div>
                            {irEntries.map((entry) => {
                                const isSelected = sidebarSelection?.type === 'ir' && sidebarSelection.playerId === entry.player.id;
                                const irLocked = isPlMatchLocked(entry.player, irLockedTeamIds);
                                return (
                                    <div
                                        key={entry.id}
                                        className={`g-row g-namerow ${styles.row} ${isSelected ? styles.rowSelected : ''}`}
                                        style={{ ['--pf' as string]: entry.player.primary_position ? POS_COLOR[entry.player.primary_position] : 'var(--color-border-subtle)' }}
                                    >
                                        <PositionBadge position={entry.player.primary_position} size="sm" />
                                        <span
                                            className={styles.rowName}
                                            onClick={() => setViewingPlayer(entry.player)}
                                            {...playerHoverProps(prefetchPlayer, entry.player)}
                                        >
                                            {displayName(entry.player)}
                                        </span>
                                        <span className={styles.rowSpacer} />
                                        <span className={styles.rowClub}>{entry.player.pl_team}</span>
                                        <div className={styles.rowActions}>
                                            <button
                                                type="button"
                                                className={`${styles.rowBtnGhost} ${isSelected ? styles.rowBtnGhostOn : ''}`}
                                                onClick={() => {
                                                    if (isSelected) { setSidebarSelection(null); return; }
                                                    activateSidebarSelection({ type: 'ir', playerId: entry.player.id });
                                                }}
                                                disabled={sidebarLoading || irLocked}
                                                title={irLocked ? 'Match started — IR is locked until this week is settled' : 'Select to swap with an injured reserve'}
                                            >
                                                {isSelected ? 'Cancel' : 'Swap'}
                                            </button>
                                            <button
                                                type="button"
                                                className={styles.rowBtnPrimary}
                                                onClick={() => handleIrActivate(entry.player.id)}
                                                disabled={sidebarLoading || irLocked}
                                                title={irLocked ? 'Match started — IR is locked until this week is settled' : 'Activate from IR'}
                                            >
                                                {sidebarLoading ? '…' : 'Activate'}
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </section>
                    )}

                </div>
                </div>{/* end board */}
            </div>{/* end panel */}

            {/* The player card modal is owned by PlayerCardProvider in the dashboard layout. */}
        </div>
    );
}
