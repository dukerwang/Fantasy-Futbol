'use client';

/**
 * PitchUI — Visual football pitch lineup editor.
 *
 * Replaces the vertical list LineupEditor with an immersive pitch view.
 * Players are displayed in zone rows (GK / DEF / MID / ATT) ordered
 * left-to-right matching their lateral position.
 *
 * Interaction model (click-to-select):
 *  1. Click a pitch node or bench slot → selects it (blue outline)
 *  2. Click a pool player → selects it
 *  3. While a slot is selected, clicking a compatible pool player assigns them
 *  4. While a slot is selected, clicking another compatible slot swaps them
 */

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
    FORMATION_SLOTS,
    POSITION_FLEX_MAP,
    BENCH_FLEX_MAP,
    BENCH_SLOT_LABELS,
} from '@/types';
import type { Formation, GranularPosition, Player, BenchSlot, RosterEntry } from '@/types';
import styles from './pitch.module.css';

// ─── Constants ──────────────────────────────────────────────────────────────

const FORMATIONS: Formation[] = ['4-3-3', '4-4-2', '4-1-4-1', '4-2-3-1', '4-2-1-3', '3-4-3'];
const BENCH_SLOT_NAMES: BenchSlot[] = ['DEF', 'MID', 'ATT', 'FLEX'];

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getZone(pos: GranularPosition): 'GK' | 'DEF' | 'MID' | 'ATT' {
    if (pos === 'GK') return 'GK';
    if (pos === 'CB' || pos === 'LB' || pos === 'RB') return 'DEF';
    if (pos === 'DM' || pos === 'CM' || pos === 'LM' || pos === 'RM' || pos === 'AM') return 'MID';
    return 'ATT';
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
    return player.web_name ?? player.name;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
    teamId: string;
    allEntries: (RosterEntry & { player: Player })[];
    irEntries: (RosterEntry & { player: Player })[];
    initialFormation: Formation;
    initialAssignments: Record<number, string>;
    initialBench: Record<BenchSlot, string | null>;
    scoreMap?: Record<string, number>;
}

type Selection =
    | { type: 'starter'; slotIndex: number }
    | { type: 'bench-slot'; slot: BenchSlot }
    | { type: 'pool'; playerId: string }
    | null;

// ─── Pitch Zone Component ─────────────────────────────────────────────────────

interface PitchNodeProps {
    slotPos: GranularPosition;
    player: Player | undefined;
    formation: Formation;
    isSelected: boolean;
    isValidTarget: boolean;
    isEmpty: boolean;
    onClick: () => void;
    points?: number;
}

function PitchNode({ slotPos, player, formation, isSelected, isValidTarget, isEmpty, onClick, points }: PitchNodeProps) {
    const cls = [
        styles.pitchNode,
        isSelected ? styles.nodeSelected : '',
        isValidTarget ? styles.nodeValidTarget : '',
        isEmpty ? styles.nodeEmpty : '',
    ].filter(Boolean).join(' ');

    // Only elevate LM/RMs if they are acting as wingers in a 3-attacker formation (like 4-3-3 if it used LM/RMs, or 4-2-3-1 which acts like LAM/RAM)
    // The user specifically asked to ONLY elevate LM/RMs in formations with 3 attackers EXCEPT 3-4-3.
    // 4-2-3-1 is the only standard formation that uses LM/RM to support a lone ST alongside an AM (thus 3 attackers: LM, AM, RM behind the ST).
    const isHighWide = (slotPos === 'LM' || slotPos === 'RM') && (formation === '4-2-3-1');
    const align = slotPos === 'DM' ? 'flex-end' : (slotPos === 'AM' || isHighWide) ? 'flex-start' : 'center';

    return (
        <button
            type="button"
            className={cls}
            onClick={onClick}
            style={{ alignSelf: align }}
        >
            <span className={styles.nodePosBadge} style={{ background: POS_COLOR[slotPos] }}>
                {slotPos}
            </span>
            {player ? (
                <>
                    <span className={styles.nodePlayerName}>{displayName(player)}</span>
                    <span className={styles.nodePlayerClub}>{player.pl_team}</span>
                    {player.fpl_status && player.fpl_status !== 'a' && (
                        <span className={styles.nodeStatusDot} data-status={player.fpl_status} />
                    )}
                    {points !== undefined && (
                        <span style={{
                            fontSize: '0.68rem',
                            fontWeight: 700,
                            color: '#10b981',
                            background: 'rgba(16,185,129,0.12)',
                            border: '1px solid rgba(16,185,129,0.28)',
                            borderRadius: '4px',
                            padding: '1px 5px',
                            marginTop: '2px',
                        }}>
                            {points.toFixed(1)} pts
                        </span>
                    )}
                </>
            ) : (
                <span className={styles.nodeEmptyLabel}>Empty</span>
            )}
        </button>
    );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function PitchUI({
    teamId,
    allEntries,
    irEntries,
    initialFormation,
    initialAssignments,
    initialBench,
    scoreMap,
}: Props) {
    const router = useRouter();

    // ── State ──
    const [formation, setFormation] = useState<Formation>(initialFormation);
    const [assignments, setAssignments] = useState<Record<number, string | null>>(() => {
        const slots = FORMATION_SLOTS[initialFormation];
        const result: Record<number, string | null> = {};
        for (let i = 0; i < slots.length; i++) {
            result[i] = initialAssignments[i] ?? null;
        }
        return result;
    });
    const [benchAssignments, setBenchAssignments] = useState<Record<BenchSlot, string | null>>({
        DEF: initialBench.DEF ?? null,
        MID: initialBench.MID ?? null,
        ATT: initialBench.ATT ?? null,
        FLEX: initialBench.FLEX ?? null,
    });
    const [selection, setSelection] = useState<Selection>(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);

    const slots = FORMATION_SLOTS[formation];

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

    const poolEntries = useMemo(
        () => allEntries.filter((e) => !starterIds.has(e.player.id) && !benchIds.has(e.player.id)),
        [allEntries, starterIds, benchIds],
    );

    // ── Zone layout (grouped in FORMATION_SLOTS insertion order — no re-sorting) ──
    // FORMATION_SLOTS arrays are already ordered left-to-right within each zone.
    const zonedSlots = useMemo(() => {
        const list = slots.map((pos, i) => ({ slotIndex: i, pos, zone: getZone(pos) }));
        return {
            ATT: list.filter((s) => s.zone === 'ATT'),
            MID: list.filter((s) => s.zone === 'MID'),
            DEF: list.filter((s) => s.zone === 'DEF'),
            GK: list.filter((s) => s.zone === 'GK'),
        };
    }, [slots]);

    // ── Valid swap targets for highlighting ──
    const validSwapTargets = useMemo(() => {
        const targets = new Set<string>();
        if (!selection) return targets;

        if (selection.type === 'starter') {
            const currentPlayerId = assignments[selection.slotIndex];
            const currentEntry = currentPlayerId ? playerMap.get(currentPlayerId) : null;

            for (let i = 0; i < slots.length; i++) {
                if (i === selection.slotIndex) continue;
                const otherId = assignments[i];
                const otherEntry = otherId ? playerMap.get(otherId) : null;
                const curCanGoThere = !currentEntry || canPlaySlot(currentEntry.player, slots[i]);
                const otherCanComeHere = !otherEntry || canPlaySlot(otherEntry.player, slots[selection.slotIndex]);
                if (curCanGoThere && otherCanComeHere) targets.add(`starter-${i}`);
            }
            for (const e of poolEntries) {
                if (canPlaySlot(e.player, slots[selection.slotIndex])) targets.add(`pool-${e.player.id}`);
            }
            if (currentEntry) {
                for (const slot of BENCH_SLOT_NAMES) {
                    if (canPlayBenchSlot(currentEntry.player, slot)) targets.add(`bench-${slot}`);
                }
            }
        }

        if (selection.type === 'bench-slot') {
            const benchPlayerId = benchAssignments[selection.slot];
            const benchEntry = benchPlayerId ? playerMap.get(benchPlayerId) : null;
            if (benchEntry) {
                for (let i = 0; i < slots.length; i++) {
                    if (canPlaySlot(benchEntry.player, slots[i])) targets.add(`starter-${i}`);
                }
                for (const slot of BENCH_SLOT_NAMES) {
                    if (slot === selection.slot) continue;
                    if (canPlayBenchSlot(benchEntry.player, slot)) targets.add(`bench-${slot}`);
                }
            }
            for (const e of poolEntries) {
                if (canPlayBenchSlot(e.player, selection.slot)) targets.add(`pool-${e.player.id}`);
            }
        }

        if (selection.type === 'pool') {
            const entry = playerMap.get(selection.playerId);
            if (entry) {
                for (let i = 0; i < slots.length; i++) {
                    if (canPlaySlot(entry.player, slots[i])) targets.add(`starter-${i}`);
                }
                for (const slot of BENCH_SLOT_NAMES) {
                    if (canPlayBenchSlot(entry.player, slot)) targets.add(`bench-${slot}`);
                }
            }
        }

        return targets;
    }, [selection, assignments, benchAssignments, slots, playerMap, poolEntries]);

    // ── Formation change (smart — preserves valid assignments) ──
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
            if (available) {
                newAssignments[i] = available;
                usedPlayers.add(available);
            }
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
            if (cand) {
                newAssignments[i] = cand;
                usedPlayers.add(cand);
            }
        }

        setFormation(f);
        setAssignments(newAssignments);
        setSelection(null);
        setError(null);
        setSuccess(false);
    }

    // ── Starter node click ──
    const handleStarterClick = useCallback(
        (slotIndex: number) => {
            if (!selection) {
                setSelection({ type: 'starter', slotIndex });
                return;
            }

            if (selection.type === 'starter') {
                if (selection.slotIndex === slotIndex) { setSelection(null); return; }
                // Swap two starters
                const pidA = assignments[selection.slotIndex];
                const pidB = assignments[slotIndex];
                const eA = pidA ? playerMap.get(pidA) : null;
                const eB = pidB ? playerMap.get(pidB) : null;
                const aCanGo = !eA || canPlaySlot(eA.player, slots[slotIndex]);
                const bCanGo = !eB || canPlaySlot(eB.player, slots[selection.slotIndex]);
                if (aCanGo && bCanGo) {
                    setAssignments((prev) => ({ ...prev, [selection.slotIndex]: pidB ?? null, [slotIndex]: pidA ?? null }));
                    setError(null); setSuccess(false);
                } else {
                    setError('These players cannot swap — position mismatch.');
                }
                setSelection(null); return;
            }

            if (selection.type === 'pool') {
                const pid = selection.playerId;
                const slotPos = slots[slotIndex];
                const entry = playerMap.get(pid);
                if (!entry || !canPlaySlot(entry.player, slotPos)) {
                    setError(`${displayName(entry?.player ?? { name: 'Player', web_name: null } as Player)} cannot play ${slotPos}.`);
                    setSelection(null); return;
                }
                setAssignments((prev) => ({ ...prev, [slotIndex]: pid }));
                setError(null); setSuccess(false); setSelection(null); return;
            }

            if (selection.type === 'bench-slot') {
                const benchPid = benchAssignments[selection.slot];
                if (!benchPid) { setSelection({ type: 'starter', slotIndex }); return; }
                const eBench = playerMap.get(benchPid);
                const slotPos = slots[slotIndex];
                if (!eBench || !canPlaySlot(eBench.player, slotPos)) {
                    setError(`${displayName(eBench?.player ?? { name: 'Player', web_name: null } as Player)} cannot play ${slotPos}.`);
                    setSelection(null); return;
                }
                const curStarterId = assignments[slotIndex];
                const eStart = curStarterId ? playerMap.get(curStarterId) : null;
                if (eStart && canPlayBenchSlot(eStart.player, selection.slot)) {
                    setBenchAssignments((prev) => ({ ...prev, [selection.slot]: curStarterId }));
                } else {
                    setBenchAssignments((prev) => ({ ...prev, [selection.slot]: null }));
                }
                setAssignments((prev) => ({ ...prev, [slotIndex]: benchPid }));
                setError(null); setSuccess(false); setSelection(null); return;
            }
        },
        [selection, assignments, slots, playerMap, benchAssignments],
    );

    // ── Bench slot click ──
    const handleBenchSlotClick = useCallback(
        (slot: BenchSlot) => {
            if (!selection) { setSelection({ type: 'bench-slot', slot }); return; }

            if (selection.type === 'bench-slot') {
                if (selection.slot === slot) { setSelection(null); return; }
                const pidA = benchAssignments[selection.slot];
                const pidB = benchAssignments[slot];
                const eA = pidA ? playerMap.get(pidA) : null;
                const eB = pidB ? playerMap.get(pidB) : null;
                const aOk = !eA || canPlayBenchSlot(eA.player, slot);
                const bOk = !eB || canPlayBenchSlot(eB.player, selection.slot);
                if (aOk && bOk) {
                    setBenchAssignments((prev) => ({ ...prev, [selection.slot]: pidB ?? null, [slot]: pidA ?? null }));
                    setError(null); setSuccess(false);
                } else {
                    setError(`Position mismatch — cannot swap ${selection.slot} and ${slot} bench slots.`);
                }
                setSelection(null); return;
            }

            if (selection.type === 'pool') {
                const pid = selection.playerId;
                const entry = playerMap.get(pid);
                if (!entry || !canPlayBenchSlot(entry.player, slot)) {
                    setError(`${displayName(entry?.player ?? { name: 'Player', web_name: null } as Player)} cannot play the ${slot} bench slot.`);
                    setSelection(null); return;
                }
                setBenchAssignments((prev) => ({ ...prev, [slot]: pid }));
                setError(null); setSuccess(false); setSelection(null); return;
            }

            if (selection.type === 'starter') {
                const starterPid = assignments[selection.slotIndex];
                if (!starterPid) { setSelection({ type: 'bench-slot', slot }); return; }
                const eStart = playerMap.get(starterPid);
                if (!eStart || !canPlayBenchSlot(eStart.player, slot)) {
                    setError(`${displayName(eStart?.player ?? { name: 'Player', web_name: null } as Player)} cannot play the ${slot} bench slot.`);
                    setSelection(null); return;
                }
                const curBenchId = benchAssignments[slot];
                const eBench = curBenchId ? playerMap.get(curBenchId) : null;
                if (eBench && canPlaySlot(eBench.player, slots[selection.slotIndex])) {
                    setAssignments((prev) => ({ ...prev, [selection.slotIndex]: curBenchId }));
                } else {
                    setAssignments((prev) => ({ ...prev, [selection.slotIndex]: null }));
                }
                setBenchAssignments((prev) => ({ ...prev, [slot]: starterPid }));
                setError(null); setSuccess(false); setSelection(null); return;
            }
        },
        [selection, assignments, benchAssignments, slots, playerMap],
    );

    // ── Pool player click ──
    const handlePoolClick = useCallback(
        (playerId: string) => {
            if (!selection) { setSelection({ type: 'pool', playerId }); return; }

            if (selection.type === 'pool') {
                setSelection(selection.playerId === playerId ? null : { type: 'pool', playerId });
                return;
            }

            if (selection.type === 'starter') {
                const slotIndex = selection.slotIndex;
                const slotPos = slots[slotIndex];
                const entry = playerMap.get(playerId);
                if (!entry || !canPlaySlot(entry.player, slotPos)) {
                    setError(`${displayName(entry?.player ?? { name: 'Player', web_name: null } as Player)} cannot play ${slotPos}.`);
                    setSelection(null); return;
                }
                setAssignments((prev) => ({ ...prev, [slotIndex]: playerId }));
                setError(null); setSuccess(false); setSelection(null); return;
            }

            if (selection.type === 'bench-slot') {
                const slot = selection.slot;
                const entry = playerMap.get(playerId);
                if (!entry || !canPlayBenchSlot(entry.player, slot)) {
                    setError(`${displayName(entry?.player ?? { name: 'Player', web_name: null } as Player)} cannot play the ${slot} bench slot.`);
                    setSelection(null); return;
                }
                setBenchAssignments((prev) => ({ ...prev, [slot]: playerId }));
                setError(null); setSuccess(false); setSelection(null); return;
            }
        },
        [selection, slots, playerMap],
    );

    // ── Save ──
    async function handleSave() {
        const starterPayload = slots.map((slot, i) => ({ player_id: assignments[i] as string, slot }));
        if (starterPayload.some((s) => !s.player_id)) {
            setError('All 11 starting slots must be filled before saving.');
            return;
        }

        const benchPayload: { player_id: string; slot: BenchSlot }[] = [];
        for (const slot of BENCH_SLOT_NAMES) {
            const pid = benchAssignments[slot];
            if (pid) benchPayload.push({ player_id: pid, slot });
        }
        if (benchPayload.length !== 4) {
            setError(`Fill all 4 bench slots (DEF, MID, ATT, FLEX). Currently ${benchPayload.length}/4.`);
            return;
        }

        setSaving(true); setError(null); setSuccess(false);
        try {
            const res = await fetch(`/api/teams/${teamId}/lineup`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ formation, starters: starterPayload, bench: benchPayload }),
            });
            if (!res.ok) {
                const data = await res.json();
                setError(data.error ?? 'Failed to save lineup');
                return;
            }
            setSuccess(true);
            router.refresh();
        } catch {
            setError('Network error — please try again.');
        } finally {
            setSaving(false);
        }
    }

    const canSave = !saving && slots.every((_, i) => assignments[i] != null) && BENCH_SLOT_NAMES.every((s) => benchAssignments[s] != null);

    // ── Render ──
    const ZONE_ORDER: Array<'ATT' | 'MID' | 'DEF' | 'GK'> = ['ATT', 'MID', 'DEF', 'GK'];

    return (
        <div className={styles.pitchUI}>
            {/* Formation bar */}
            <div className={styles.formationBar}>
                <span className={styles.formationLabel}>Formation</span>
                <div className={styles.formationPills}>
                    {FORMATIONS.map((f) => (
                        <button
                            key={f}
                            type="button"
                            className={`${styles.formationPill} ${formation === f ? styles.formationPillActive : ''}`}
                            onClick={() => handleFormationChange(f)}
                        >
                            {f}
                        </button>
                    ))}
                </div>
            </div>

            {/* Selection hint */}
            {selection && (
                <div className={styles.selectionHint}>
                    <span>
                        {selection.type === 'starter' && 'Starter slot selected — click a player from the pool, another slot, or a bench slot to swap.'}
                        {selection.type === 'bench-slot' && `Bench slot ${selection.slot} selected — click a pool player to assign or another slot to swap.`}
                        {selection.type === 'pool' && 'Player selected — click a starter slot or bench slot to place them.'}
                    </span>
                    <button type="button" className={styles.cancelBtn} onClick={() => { setSelection(null); setError(null); }}>
                        Cancel
                    </button>
                </div>
            )}

            {/* ── Football Pitch ── */}
            <div className={styles.pitchContainer}>
                {/* Pitch markings */}
                <div className={styles.pitchCenterLine} />
                <div className={styles.pitchCenterCircle} />

                {/* Zone rows (ATT at top, GK at bottom) */}
                {ZONE_ORDER.map((zone) => {
                    const zoneSlots = zonedSlots[zone];
                    if (zoneSlots.length === 0) return null;
                    const isCompactMid = zone === 'MID' && zoneSlots.length === 3;
                    return (
                        <div key={zone} className={`${styles.pitchZone} ${styles[`zone${zone}`]}`}>
                            <span className={styles.zoneLabel}>{zone}</span>
                            <div
                                className={styles.pitchRow}
                            // Removed the padding hack. We now use ghost nodes to mathematically match the 5-man line.
                            >
                                {isCompactMid && <div style={{ width: '76px', visibility: 'hidden' }} />}
                                {zoneSlots.map(({ slotIndex, pos }) => {
                                    const playerId = assignments[slotIndex];
                                    const entry = playerId ? playerMap.get(playerId) : undefined;
                                    const isSelected = selection?.type === 'starter' && selection.slotIndex === slotIndex;
                                    const isValidTarget = validSwapTargets.has(`starter-${slotIndex}`);
                                    return (
                                        <PitchNode
                                            key={slotIndex}
                                            slotPos={pos}
                                            player={entry?.player}
                                            formation={formation}
                                            isSelected={isSelected}
                                            isValidTarget={isValidTarget}
                                            isEmpty={!playerId}
                                            onClick={() => handleStarterClick(slotIndex)}
                                            points={playerId && scoreMap ? scoreMap[playerId] : undefined}
                                        />
                                    );
                                })}
                                {isCompactMid && <div style={{ width: '76px', visibility: 'hidden' }} />}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* ── Bench Row ── */}
            <div className={styles.benchSection}>
                <div className={styles.benchLabel}>Bench Substitutes</div>
                <div className={styles.benchRow}>
                    {BENCH_SLOT_NAMES.map((slot) => {
                        const pid = benchAssignments[slot];
                        const entry = pid ? playerMap.get(pid) : undefined;
                        const isSelected = selection?.type === 'bench-slot' && selection.slot === slot;
                        const isValidTarget = validSwapTargets.has(`bench-${slot}`);
                        return (
                            <button
                                key={slot}
                                type="button"
                                className={`${styles.benchSlot} ${isSelected ? styles.nodeSelected : ''} ${isValidTarget ? styles.nodeValidTarget : ''} ${!pid ? styles.nodeEmpty : ''}`}
                                onClick={() => handleBenchSlotClick(slot)}
                            >
                                <span className={styles.benchSlotType}>{slot}</span>
                                <span className={styles.benchSlotDesc}>{BENCH_SLOT_LABELS[slot]}</span>
                                {entry ? (
                                    <>
                                        <span className={styles.nodePosBadge} style={{ background: POS_COLOR[entry.player.primary_position] }}>
                                            {entry.player.primary_position}
                                        </span>
                                        <span className={styles.benchPlayerName}>{displayName(entry.player)}</span>
                                        <span className={styles.benchPlayerClub}>{entry.player.pl_team}</span>
                                        {scoreMap && pid && scoreMap[pid] !== undefined && (
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
                                                {scoreMap[pid].toFixed(1)} pts
                                            </span>
                                        )}
                                    </>
                                ) : (
                                    <span className={styles.nodeEmptyLabel}>Empty</span>
                                )}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* ── Player Pool ── */}
            <div className={styles.poolSection}>
                <div className={styles.poolLabel}>
                    Available Players
                    <span className={styles.poolCount}>{poolEntries.length}</span>
                </div>
                {poolEntries.length === 0 ? (
                    <p className={styles.poolEmpty}>All players assigned to Starting XI or Bench.</p>
                ) : (
                    <div className={styles.poolGrid}>
                        {poolEntries.map((entry) => {
                            const isSelected = selection?.type === 'pool' && selection.playerId === entry.player.id;
                            const isValidTarget = validSwapTargets.has(`pool-${entry.player.id}`);
                            return (
                                <button
                                    key={entry.id}
                                    type="button"
                                    className={`${styles.poolPlayer} ${isSelected ? styles.nodeSelected : ''} ${isValidTarget ? styles.nodeValidTarget : ''}`}
                                    onClick={() => handlePoolClick(entry.player.id)}
                                >
                                    <span className={styles.nodePosBadge} style={{ background: POS_COLOR[entry.player.primary_position] }}>
                                        {entry.player.primary_position}
                                    </span>
                                    <span className={styles.poolPlayerName}>{displayName(entry.player)}</span>
                                    <span className={styles.poolPlayerClub}>{entry.player.pl_team}</span>
                                    {entry.player.secondary_positions && entry.player.secondary_positions.length > 0 && (
                                        <span className={styles.poolPlayerAlt}>
                                            +{entry.player.secondary_positions.join('/')}
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* ── IR (read-only) ── */}
            {irEntries.length > 0 && (
                <div className={styles.irSection}>
                    <div className={styles.irLabel}>
                        Injured Reserve
                        <span className={styles.poolCount}>{irEntries.length}</span>
                    </div>
                    <div className={styles.poolGrid}>
                        {irEntries.map((entry) => (
                            <div key={entry.id} className={styles.poolPlayer} style={{ opacity: 0.5, cursor: 'default' }}>
                                <span className={styles.nodePosBadge} style={{ background: POS_COLOR[entry.player.primary_position] }}>
                                    {entry.player.primary_position}
                                </span>
                                <span className={styles.poolPlayerName}>{displayName(entry.player)}</span>
                                <span className={styles.poolPlayerClub}>{entry.player.pl_team}</span>
                                <span className={styles.irBadge}>IR</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* ── Save Row ── */}
            <div className={styles.saveRow}>
                {error && <span className={styles.errorText}>{error}</span>}
                {success && !error && <span className={styles.successText}>Lineup saved!</span>}
                <button className={styles.saveBtn} onClick={handleSave} disabled={!canSave}>
                    {saving ? 'Saving\u2026' : 'Save Lineup'}
                </button>
            </div>
        </div>
    );
}
