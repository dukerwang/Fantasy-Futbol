'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  FORMATION_SLOTS,
  POSITION_FLEX_MAP,
  BENCH_FLEX_MAP,
  BENCH_SLOT_LABELS,
} from '@/types';
import type { Formation, GranularPosition, RosterEntry, Player, BenchSlot } from '@/types';
import styles from './my-team.module.css';

const FORMATIONS: Formation[] = ['4-3-3', '4-4-2', '4-1-4-1', '4-2-3-1', '3-4-3', '4-2-1-3'];
const BENCH_SLOT_NAMES: BenchSlot[] = ['DEF', 'MID', 'ATT', 'FLEX'];

const POS_COLOR: Record<GranularPosition, string> = {
  GK: 'var(--color-pos-gk)',
  CB: 'var(--color-pos-cb)',
  LB: 'var(--color-pos-fb)',
  RB: 'var(--color-pos-fb)',
  DM: 'var(--color-pos-dm)',
  CM: 'var(--color-pos-cm)',
  LM: 'var(--color-pos-cm)',
  RM: 'var(--color-pos-cm)',
  AM: 'var(--color-pos-am)',
  LW: 'var(--color-pos-lw)',
  RW: 'var(--color-pos-rw)',
  ST: 'var(--color-pos-st)',
};

interface Props {
  teamId: string;
  allEntries: (RosterEntry & { player: Player })[];
  irEntries: (RosterEntry & { player: Player })[];
  initialFormation: Formation;
  initialAssignments: Record<number, string>;
  benchSize: number;
}

type Selection =
  | { type: 'starter'; slotIndex: number }
  | { type: 'bench-slot'; slot: BenchSlot }
  | { type: 'reserve'; playerId: string }
  | null;

function getPlayerPositions(player: Player): GranularPosition[] {
  return [player.primary_position, ...(player.secondary_positions ?? [])];
}

function canPlaySlot(player: Player, slotPos: GranularPosition): boolean {
  return getPlayerPositions(player).some((p) => POSITION_FLEX_MAP[slotPos].includes(p));
}

function canPlayBenchSlot(player: Player, slot: BenchSlot): boolean {
  return getPlayerPositions(player).some((p) => BENCH_FLEX_MAP[slot].includes(p));
}

export default function LineupEditor({
  teamId,
  allEntries,
  irEntries,
  initialFormation,
  initialAssignments,
}: Props) {
  const router = useRouter();

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
    DEF: null, MID: null, ATT: null, FLEX: null,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [selection, setSelection] = useState<Selection>(null);

  const slots = FORMATION_SLOTS[formation];

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

  // Reserves: non-IR players not in starting XI or bench
  const reserveEntries = useMemo(
    () => allEntries.filter((e) => !starterIds.has(e.player.id) && !benchIds.has(e.player.id)),
    [allEntries, starterIds, benchIds],
  );

  // Smart formation change: try to keep valid starter assignments
  function handleFormationChange(f: Formation) {
    const newSlots = FORMATION_SLOTS[f];
    const newAssignments: Record<number, string | null> = {};
    const usedPlayers = new Set<string>();

    for (let i = 0; i < newSlots.length; i++) {
      newAssignments[i] = null;
    }

    const oldSlots = FORMATION_SLOTS[formation];
    const oldByPosition = new Map<GranularPosition, string[]>();
    for (let i = 0; i < oldSlots.length; i++) {
      const playerId = assignments[i];
      if (!playerId) continue;
      const pos = oldSlots[i];
      if (!oldByPosition.has(pos)) oldByPosition.set(pos, []);
      oldByPosition.get(pos)!.push(playerId);
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

    const remainingOldPlayers = Object.values(assignments)
      .filter((id): id is string => id != null && !usedPlayers.has(id));

    for (let i = 0; i < newSlots.length; i++) {
      if (newAssignments[i] != null) continue;
      const slotPos = newSlots[i];
      const candidate = remainingOldPlayers.find((id) => {
        if (usedPlayers.has(id)) return false;
        const entry = playerMap.get(id);
        return entry ? canPlaySlot(entry.player, slotPos) : false;
      });
      if (candidate) {
        newAssignments[i] = candidate;
        usedPlayers.add(candidate);
      }
    }

    setFormation(f);
    setAssignments(newAssignments);
    setSelection(null);
    setError(null);
    setSuccess(false);
  }

  // ── Starter slot click ─────────────────────────────────────────────────

  const handleStarterClick = useCallback(
    (slotIndex: number) => {
      if (!selection) {
        setSelection({ type: 'starter', slotIndex });
        return;
      }

      if (selection.type === 'starter') {
        if (selection.slotIndex === slotIndex) {
          setSelection(null);
          return;
        }
        // Swap two starters
        const playerA = assignments[selection.slotIndex];
        const playerB = assignments[slotIndex];
        const slotPosA = slots[selection.slotIndex];
        const slotPosB = slots[slotIndex];
        const entryA = playerA ? playerMap.get(playerA) : null;
        const entryB = playerB ? playerMap.get(playerB) : null;
        const aCanPlayB = !entryA || canPlaySlot(entryA.player, slotPosB);
        const bCanPlayA = !entryB || canPlaySlot(entryB.player, slotPosA);

        if (aCanPlayB && bCanPlayA) {
          setAssignments((prev) => ({
            ...prev,
            [selection.slotIndex]: playerB ?? null,
            [slotIndex]: playerA ?? null,
          }));
          setError(null);
          setSuccess(false);
        } else {
          setError('These players cannot swap — position mismatch.');
        }
        setSelection(null);
        return;
      }

      if (selection.type === 'reserve') {
        const reservePlayerId = selection.playerId;
        const slotPos = slots[slotIndex];
        const entry = playerMap.get(reservePlayerId);
        if (!entry || !canPlaySlot(entry.player, slotPos)) {
          setError(`${entry?.player.web_name ?? entry?.player.name ?? 'Player'} cannot play ${slotPos}.`);
          setSelection(null);
          return;
        }
        setAssignments((prev) => ({ ...prev, [slotIndex]: reservePlayerId }));
        setError(null);
        setSuccess(false);
        setSelection(null);
        return;
      }

      if (selection.type === 'bench-slot') {
        // Move bench player into this starter slot
        const benchPlayerId = benchAssignments[selection.slot];
        if (!benchPlayerId) {
          setSelection({ type: 'starter', slotIndex });
          return;
        }
        const entryBench = playerMap.get(benchPlayerId);
        const slotPos = slots[slotIndex];
        if (!entryBench || !canPlaySlot(entryBench.player, slotPos)) {
          setError(`${entryBench?.player.web_name ?? entryBench?.player.name ?? 'Player'} cannot play ${slotPos}.`);
          setSelection(null);
          return;
        }

        // Try to swap the current starter into the vacated bench slot
        const currentStarterId = assignments[slotIndex];
        const entryStart = currentStarterId ? playerMap.get(currentStarterId) : null;

        if (entryStart && canPlayBenchSlot(entryStart.player, selection.slot)) {
          // Valid swap!
          setBenchAssignments((prev) => ({ ...prev, [selection.slot]: currentStarterId }));
        } else {
          // Send to reserves instead
          setBenchAssignments((prev) => ({ ...prev, [selection.slot]: null }));
        }

        setAssignments((prev) => ({ ...prev, [slotIndex]: benchPlayerId }));
        setError(null);
        setSuccess(false);
        setSelection(null);
        return;
      }
    },
    [selection, assignments, slots, playerMap, benchAssignments],
  );

  // ── Bench slot click ───────────────────────────────────────────────────

  const handleBenchSlotClick = useCallback(
    (slot: BenchSlot) => {
      if (!selection) {
        setSelection({ type: 'bench-slot', slot });
        return;
      }

      if (selection.type === 'bench-slot') {
        if (selection.slot === slot) {
          setSelection(null);
          return;
        }
        // Swap two bench slots
        const playerA = benchAssignments[selection.slot];
        const playerB = benchAssignments[slot];
        const entryA = playerA ? playerMap.get(playerA) : null;
        const entryB = playerB ? playerMap.get(playerB) : null;
        const aCanGoToSlot = !entryA || canPlayBenchSlot(entryA.player, slot);
        const bCanGoToSelectedSlot = !entryB || canPlayBenchSlot(entryB.player, selection.slot);

        if (aCanGoToSlot && bCanGoToSelectedSlot) {
          setBenchAssignments((prev) => ({
            ...prev,
            [selection.slot]: playerB ?? null,
            [slot]: playerA ?? null,
          }));
          setError(null);
          setSuccess(false);
        } else {
          setError(`Position mismatch — cannot swap ${selection.slot} and ${slot} bench slots.`);
        }
        setSelection(null);
        return;
      }

      if (selection.type === 'reserve') {
        const playerId = selection.playerId;
        const entry = playerMap.get(playerId);
        if (!entry || !canPlayBenchSlot(entry.player, slot)) {
          setError(
            `${entry?.player.web_name ?? entry?.player.name ?? 'Player'} cannot play the ${slot} bench slot.`,
          );
          setSelection(null);
          return;
        }
        // Old occupant of bench slot goes back to reserves automatically
        setBenchAssignments((prev) => ({ ...prev, [slot]: playerId }));
        setError(null);
        setSuccess(false);
        setSelection(null);
        return;
      }

      if (selection.type === 'starter') {
        // Move selected starter to this bench slot
        const starterPlayerId = assignments[selection.slotIndex];
        if (!starterPlayerId) {
          setSelection({ type: 'bench-slot', slot });
          return;
        }
        const entryStart = playerMap.get(starterPlayerId);
        if (!entryStart || !canPlayBenchSlot(entryStart.player, slot)) {
          setError(
            `${entryStart?.player.web_name ?? entryStart?.player.name ?? 'Player'} cannot play the ${slot} bench slot.`,
          );
          setSelection(null);
          return;
        }

        // Try to swap the current bench occupant back into the starter slot
        // Make sure `slots` parameter is accessible (it is, from outer scope)
        const currentBenchId = benchAssignments[slot];
        const entryBench = currentBenchId ? playerMap.get(currentBenchId) : null;
        const targetSlotPos = slots[selection.slotIndex];

        if (entryBench && canPlaySlot(entryBench.player, targetSlotPos)) {
          // Valid swap!
          setAssignments((prev) => ({ ...prev, [selection.slotIndex]: currentBenchId }));
        } else {
          // Send incompatible bench player to reserves
          setAssignments((prev) => ({ ...prev, [selection.slotIndex]: null }));
        }

        setBenchAssignments((prev) => ({ ...prev, [slot]: starterPlayerId }));
        setError(null);
        setSuccess(false);
        setSelection(null);
        return;
      }
    },
    [selection, assignments, benchAssignments, playerMap],
  );

  // ── Reserve player click ───────────────────────────────────────────────

  const handleReserveClick = useCallback(
    (playerId: string) => {
      if (!selection) {
        setSelection({ type: 'reserve', playerId });
        return;
      }

      if (selection.type === 'reserve') {
        setSelection(selection.playerId === playerId ? null : { type: 'reserve', playerId });
        return;
      }

      if (selection.type === 'starter') {
        const slotIndex = selection.slotIndex;
        const slotPos = slots[slotIndex];
        const entry = playerMap.get(playerId);
        if (!entry || !canPlaySlot(entry.player, slotPos)) {
          setError(`${entry?.player.web_name ?? entry?.player.name ?? 'Player'} cannot play ${slotPos}.`);
          setSelection(null);
          return;
        }
        setAssignments((prev) => ({ ...prev, [slotIndex]: playerId }));
        setError(null);
        setSuccess(false);
        setSelection(null);
        return;
      }

      if (selection.type === 'bench-slot') {
        const slot = selection.slot;
        const entry = playerMap.get(playerId);
        if (!entry || !canPlayBenchSlot(entry.player, slot)) {
          setError(
            `${entry?.player.web_name ?? entry?.player.name ?? 'Player'} cannot play the ${slot} bench slot.`,
          );
          setSelection(null);
          return;
        }
        setBenchAssignments((prev) => ({ ...prev, [slot]: playerId }));
        setError(null);
        setSuccess(false);
        setSelection(null);
        return;
      }
    },
    [selection, slots, playerMap],
  );

  // ── Valid swap targets for highlighting ────────────────────────────────

  const validSwapTargets = useMemo(() => {
    const targets = new Set<string>();
    if (!selection) return targets;

    if (selection.type === 'starter') {
      const currentPlayerId = assignments[selection.slotIndex];
      const currentEntry = currentPlayerId ? playerMap.get(currentPlayerId) : null;

      for (let i = 0; i < slots.length; i++) {
        if (i === selection.slotIndex) continue;
        const otherPlayerId = assignments[i];
        const otherEntry = otherPlayerId ? playerMap.get(otherPlayerId) : null;
        const currentCanGoThere = !currentEntry || canPlaySlot(currentEntry.player, slots[i]);
        const otherCanComeHere = !otherEntry || canPlaySlot(otherEntry.player, slots[selection.slotIndex]);
        if (currentCanGoThere && otherCanComeHere) targets.add(`starter-${i}`);
      }
      for (const entry of reserveEntries) {
        if (canPlaySlot(entry.player, slots[selection.slotIndex])) targets.add(`reserve-${entry.player.id}`);
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
      for (const entry of reserveEntries) {
        if (canPlayBenchSlot(entry.player, selection.slot)) targets.add(`reserve-${entry.player.id}`);
      }
    }

    if (selection.type === 'reserve') {
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
  }, [selection, assignments, benchAssignments, slots, playerMap, reserveEntries]);

  // ── Save ───────────────────────────────────────────────────────────────

  async function handleSave() {
    const starterPayload = slots.map((slot, i) => ({
      player_id: assignments[i] as string,
      slot,
    }));

    if (starterPayload.some((s) => !s.player_id)) {
      setError('All 11 starting slots must be filled before saving.');
      return;
    }

    const benchPayload: { player_id: string; slot: BenchSlot }[] = [];
    for (const slot of BENCH_SLOT_NAMES) {
      const playerId = benchAssignments[slot];
      if (playerId) benchPayload.push({ player_id: playerId, slot });
    }

    if (benchPayload.length !== 4) {
      setError(
        `Fill all 4 bench slots (DEF, MID, ATT, FLEX) before saving. Currently ${benchPayload.length}/4 assigned.`,
      );
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(false);
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

  const allBenchFilled = BENCH_SLOT_NAMES.every((slot) => benchAssignments[slot] != null);
  const canSave = !saving && slots.every((_, i) => assignments[i] != null) && allBenchFilled;

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className={styles.lineupEditor}>
      {/* Formation picker */}
      <div className={styles.formationRow}>
        <label className={styles.formationLabel}>Formation</label>
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

      {selection && (
        <div className={styles.swapHint}>
          {selection.type === 'starter' && 'Click a starter, bench slot, or reserve to swap.'}
          {selection.type === 'bench-slot' && `Bench slot ${selection.slot} selected. Click a reserve to assign, or a starter/other bench slot to swap.`}
          {selection.type === 'reserve' && 'Click a starter slot or bench slot to assign this player.'}
          <button type="button" className={styles.cancelSwap} onClick={() => setSelection(null)}>
            Cancel
          </button>
        </div>
      )}

      {/* ── Tier 1: Starting XI ─── */}
      <div className={styles.tierHeader}>
        <span className={styles.sectionDot} style={{ background: 'var(--color-accent-green)' }} />
        Starting XI
      </div>
      <div className={styles.starterGrid}>
        {slots.map((slotPos, i) => {
          const playerId = assignments[i];
          const entry = playerId ? playerMap.get(playerId) : null;
          const isSelected = selection?.type === 'starter' && selection.slotIndex === i;
          const isValidTarget = validSwapTargets.has(`starter-${i}`);
          return (
            <button
              key={i}
              type="button"
              className={`${styles.starterSlot} ${isSelected ? styles.slotSelected : ''} ${isValidTarget ? styles.slotValidTarget : ''} ${!playerId ? styles.slotEmpty : ''}`}
              onClick={() => handleStarterClick(i)}
            >
              <span className={styles.slotPosBadge} style={{ background: POS_COLOR[slotPos] }}>
                {slotPos}
              </span>
              {entry ? (
                <div className={styles.slotPlayerInfo}>
                  <span className={styles.slotPlayerName}>{entry.player.web_name ?? entry.player.name}</span>
                  <span className={styles.slotPlayerMeta}>
                    {entry.player.primary_position} &middot; {entry.player.pl_team}
                  </span>
                </div>
              ) : (
                <span className={styles.slotEmptyLabel}>Empty</span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Tier 2: Bench Slots ─── */}
      <div className={styles.tierHeader}>
        <span className={styles.sectionDot} style={{ background: 'var(--color-accent-blue)' }} />
        Bench (4 substitutes)
      </div>
      <div className={styles.benchGrid}>
        {BENCH_SLOT_NAMES.map((slot) => {
          const playerId = benchAssignments[slot];
          const entry = playerId ? playerMap.get(playerId) : null;
          const isSelected = selection?.type === 'bench-slot' && selection.slot === slot;
          const isValidTarget = validSwapTargets.has(`bench-${slot}`);
          return (
            <button
              key={slot}
              type="button"
              className={`${styles.benchSlot} ${isSelected ? styles.slotSelected : ''} ${isValidTarget ? styles.slotValidTarget : ''} ${!playerId ? styles.slotEmpty : ''}`}
              onClick={() => handleBenchSlotClick(slot)}
            >
              <span className={styles.benchSlotLabel}>{slot}</span>
              <span className={styles.benchSlotDesc}>{BENCH_SLOT_LABELS[slot]}</span>
              {entry ? (
                <>
                  <span
                    className={styles.slotPosBadge}
                    style={{ background: POS_COLOR[entry.player.primary_position] }}
                  >
                    {entry.player.primary_position}
                  </span>
                  <span className={styles.benchSlotName}>{entry.player.web_name ?? entry.player.name}</span>
                  <span className={styles.benchSlotClub}>{entry.player.pl_team}</span>
                </>
              ) : (
                <span className={styles.slotEmptyLabel}>Empty — click reserve to assign</span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Tier 3: Reserves ─── */}
      <div className={styles.benchSection}>
        <h3 className={styles.tierHeader}>
          <span className={styles.sectionDot} style={{ background: 'var(--color-text-muted)' }} />
          Reserves ({reserveEntries.length})
        </h3>
        {reserveEntries.length === 0 ? (
          <p className={styles.emptySection}>All players assigned to Starting XI or Bench.</p>
        ) : (
          <div className={styles.reserveList}>
            {reserveEntries.map((entry) => {
              const isSelected = selection?.type === 'reserve' && selection.playerId === entry.player.id;
              const isValidTarget = validSwapTargets.has(`reserve-${entry.player.id}`);
              return (
                <button
                  key={entry.id}
                  type="button"
                  className={`${styles.benchSlot} ${isSelected ? styles.slotSelected : ''} ${isValidTarget ? styles.slotValidTarget : ''}`}
                  onClick={() => handleReserveClick(entry.player.id)}
                >
                  <span
                    className={styles.slotPosBadge}
                    style={{ background: POS_COLOR[entry.player.primary_position] }}
                  >
                    {entry.player.primary_position}
                  </span>
                  <span className={styles.benchSlotName}>{entry.player.web_name ?? entry.player.name}</span>
                  <span className={styles.benchSlotClub}>{entry.player.pl_team}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Injured Reserve (read-only) ─── */}
      {irEntries.length > 0 && (
        <div className={styles.irSection}>
          <h3 className={styles.irTitle}>
            <span className={styles.sectionDot} style={{ background: 'var(--color-accent-red)' }} />
            Injured Reserve ({irEntries.length})
          </h3>
          <div className={styles.irList}>
            {irEntries.map((entry) => (
              <div key={entry.id} className={styles.irItem}>
                <span
                  className={styles.slotPosBadge}
                  style={{ background: POS_COLOR[entry.player.primary_position] }}
                >
                  {entry.player.primary_position}
                </span>
                <span className={styles.benchSlotName}>{entry.player.web_name ?? entry.player.name}</span>
                <span className={styles.benchSlotClub}>{entry.player.pl_team}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Save row */}
      <div className={styles.saveRow}>
        {error && <span className={styles.errorText}>{error}</span>}
        {success && !error && <span className={styles.successText}>Lineup saved successfully!</span>}
        <button className={styles.saveBtn} onClick={handleSave} disabled={!canSave}>
          {saving ? 'Saving\u2026' : 'Save Lineup'}
        </button>
      </div>
    </div>
  );
}
