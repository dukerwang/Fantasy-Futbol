'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FORMATION_SLOTS, POSITION_FLEX_MAP, getExpectedBenchSlots } from '@/types';
import type { Formation, GranularPosition, RosterEntry, Player, BenchSlot } from '@/types';
import styles from './my-team.module.css';

const FORMATIONS: Formation[] = ['4-3-3', '4-4-2', '3-5-2', '4-2-3-1', '3-4-3', '5-3-2'];

const POS_COLOR: Record<GranularPosition, string> = {
  GK: 'var(--color-pos-gk)',
  CB: 'var(--color-pos-cb)',
  LB: 'var(--color-pos-fb)',
  RB: 'var(--color-pos-fb)',
  DM: 'var(--color-pos-dm)',
  CM: 'var(--color-pos-cm)',
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
  | { type: 'bench'; playerId: string }
  | null;

function getPlayerPositions(player: Player): GranularPosition[] {
  return [player.primary_position, ...(player.secondary_positions ?? [])];
}

function canPlaySlot(player: Player, slotPos: GranularPosition): boolean {
  const allowed = POSITION_FLEX_MAP[slotPos];
  return getPlayerPositions(player).some((p) => allowed.includes(p));
}

export default function LineupEditor({
  teamId,
  allEntries,
  irEntries,
  initialFormation,
  initialAssignments,
  benchSize,
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [selection, setSelection] = useState<Selection>(null);

  const slots = FORMATION_SLOTS[formation];

  const assignedIds = useMemo(
    () => new Set(Object.values(assignments).filter(Boolean) as string[]),
    [assignments],
  );

  const playerMap = useMemo(() => {
    const map = new Map<string, RosterEntry & { player: Player }>();
    for (const e of allEntries) map.set(e.player.id, e);
    return map;
  }, [allEntries]);

  const benchEntries = useMemo(
    () => allEntries.filter((e) => !assignedIds.has(e.player.id)),
    [allEntries, assignedIds],
  );

  // Smart formation change: try to keep valid assignments
  function handleFormationChange(f: Formation) {
    const newSlots = FORMATION_SLOTS[f];
    const newAssignments: Record<number, string | null> = {};
    const usedPlayers = new Set<string>();

    // First pass: try to keep players in matching slot positions
    for (let i = 0; i < newSlots.length; i++) {
      newAssignments[i] = null;
    }

    // Map old assignments by position for reuse
    const oldSlots = FORMATION_SLOTS[formation];
    const oldByPosition = new Map<GranularPosition, string[]>();
    for (let i = 0; i < oldSlots.length; i++) {
      const playerId = assignments[i];
      if (!playerId) continue;
      const pos = oldSlots[i];
      if (!oldByPosition.has(pos)) oldByPosition.set(pos, []);
      oldByPosition.get(pos)!.push(playerId);
    }

    // Assign players to new slots, preferring same-position matches
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

    // Second pass: try to fill remaining empty slots with unassigned players
    // from the old lineup that are position-compatible
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

  // Click handlers for swap UX
  const handleStarterClick = useCallback(
    (slotIndex: number) => {
      if (!selection) {
        // Select this starter slot
        setSelection({ type: 'starter', slotIndex });
        return;
      }

      if (selection.type === 'starter') {
        if (selection.slotIndex === slotIndex) {
          // Deselect
          setSelection(null);
          return;
        }
        // Swap two starters
        const playerA = assignments[selection.slotIndex];
        const playerB = assignments[slotIndex];
        const slotPosA = slots[selection.slotIndex];
        const slotPosB = slots[slotIndex];

        // Validate both can play in each other's slot
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

      if (selection.type === 'bench') {
        // Move bench player into this starter slot
        const benchPlayerId = selection.playerId;
        const slotPos = slots[slotIndex];
        const entry = playerMap.get(benchPlayerId);

        if (!entry || !canPlaySlot(entry.player, slotPos)) {
          setError(`${entry?.player.web_name ?? entry?.player.name ?? 'Player'} cannot play ${slotPos}.`);
          setSelection(null);
          return;
        }

        // The player currently in the starter slot goes to bench
        const currentStarterId = assignments[slotIndex];
        setAssignments((prev) => ({
          ...prev,
          [slotIndex]: benchPlayerId,
        }));
        // currentStarterId is automatically benched (not in assignedIds)
        void currentStarterId; // no-op, state handles it
        setError(null);
        setSuccess(false);
        setSelection(null);
      }
    },
    [selection, assignments, slots, playerMap],
  );

  const handleBenchClick = useCallback(
    (playerId: string) => {
      if (!selection) {
        setSelection({ type: 'bench', playerId });
        return;
      }

      if (selection.type === 'bench') {
        if (selection.playerId === playerId) {
          setSelection(null);
          return;
        }
        // Can't swap two bench players (no effect on lineup)
        setSelection({ type: 'bench', playerId });
        return;
      }

      if (selection.type === 'starter') {
        // Move this bench player into the selected starter slot
        const slotIndex = selection.slotIndex;
        const slotPos = slots[slotIndex];
        const entry = playerMap.get(playerId);

        if (!entry || !canPlaySlot(entry.player, slotPos)) {
          setError(`${entry?.player.web_name ?? entry?.player.name ?? 'Player'} cannot play ${slotPos}.`);
          setSelection(null);
          return;
        }

        setAssignments((prev) => ({
          ...prev,
          [slotIndex]: playerId,
        }));
        setError(null);
        setSuccess(false);
        setSelection(null);
      }
    },
    [selection, slots, playerMap],
  );

  // Determine which bench/starter slots are valid swap targets for the current selection
  const validSwapTargets = useMemo(() => {
    const targets = new Set<string>();
    if (!selection) return targets;

    if (selection.type === 'starter') {
      const currentPlayerId = assignments[selection.slotIndex];
      const currentEntry = currentPlayerId ? playerMap.get(currentPlayerId) : null;

      // Other starter slots that could accept the current player (and vice versa)
      for (let i = 0; i < slots.length; i++) {
        if (i === selection.slotIndex) continue;
        const otherPlayerId = assignments[i];
        const otherEntry = otherPlayerId ? playerMap.get(otherPlayerId) : null;

        const currentCanGoThere = !currentEntry || canPlaySlot(currentEntry.player, slots[i]);
        const otherCanComeHere = !otherEntry || canPlaySlot(otherEntry.player, slots[selection.slotIndex]);

        if (currentCanGoThere && otherCanComeHere) {
          targets.add(`starter-${i}`);
        }
      }

      // Bench players that can fill this slot
      for (const entry of benchEntries) {
        if (canPlaySlot(entry.player, slots[selection.slotIndex])) {
          targets.add(`bench-${entry.player.id}`);
        }
      }
    }

    if (selection.type === 'bench') {
      const entry = playerMap.get(selection.playerId);
      if (!entry) return targets;

      // Starter slots this bench player could fill
      for (let i = 0; i < slots.length; i++) {
        if (canPlaySlot(entry.player, slots[i])) {
          targets.add(`starter-${i}`);
        }
      }
    }

    return targets;
  }, [selection, assignments, slots, playerMap, benchEntries]);

  async function handleSave() {
    const starterPayload = slots.map((slot, i) => ({
      player_id: assignments[i] as string,
      slot,
    }));

    if (starterPayload.some((s) => !s.player_id)) {
      setError('All 11 slots must be filled before saving.');
      return;
    }

    // Build bench payload with proper BenchSlot assignments
    const expectedBenchSlots = getExpectedBenchSlots(benchSize);
    const benchPayload = benchEntries.slice(0, expectedBenchSlots.length).map((entry, i) => ({
      player_id: entry.player.id,
      slot: expectedBenchSlots[i],
    }));

    if (benchPayload.length !== expectedBenchSlots.length) {
      setError(`Must have exactly ${expectedBenchSlots.length} bench players. Currently have ${benchEntries.length}.`);
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const res = await fetch(`/api/teams/${teamId}/lineup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          formation,
          starters: starterPayload,
          bench: benchPayload,
        }),
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

  const canSave = !saving && slots.every((_, i) => assignments[i] != null);

  return (
    <div className={styles.lineupEditor}>
      {/* Formation picker */}
      <div className={styles.formationRow}>
        <label className={styles.formationLabel} htmlFor="formation-select">
          Formation
        </label>
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
          Click a {selection.type === 'starter' ? 'starter or bench player' : 'starter slot'} to swap.
          <button
            type="button"
            className={styles.cancelSwap}
            onClick={() => setSelection(null)}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Starting XI — click-to-swap */}
      <div className={styles.starterGrid}>
        {slots.map((slotPos, i) => {
          const playerId = assignments[i];
          const entry = playerId ? playerMap.get(playerId) : null;
          const isSelected = selection?.type === 'starter' && selection.slotIndex === i;
          const isValidTarget = validSwapTargets.has(`starter-${i}`);
          const isEmpty = !playerId;

          return (
            <button
              key={i}
              type="button"
              className={`${styles.starterSlot} ${isSelected ? styles.slotSelected : ''} ${isValidTarget ? styles.slotValidTarget : ''} ${isEmpty ? styles.slotEmpty : ''}`}
              onClick={() => handleStarterClick(i)}
            >
              <span
                className={styles.slotPosBadge}
                style={{ background: POS_COLOR[slotPos] }}
              >
                {slotPos}
              </span>
              {entry ? (
                <div className={styles.slotPlayerInfo}>
                  <span className={styles.slotPlayerName}>
                    {entry.player.web_name ?? entry.player.name}
                  </span>
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

      {/* Bench — click-to-swap */}
      <div className={styles.benchSection}>
        <h3 className={styles.benchTitle}>
          <span className={styles.sectionDot} style={{ background: 'var(--color-text-muted)' }} />
          Bench ({benchEntries.length})
        </h3>
        {benchEntries.length === 0 ? (
          <p className={styles.emptySection}>All players assigned to starting XI.</p>
        ) : (
          <div className={styles.benchGrid}>
            {benchEntries.map((entry) => {
              const isSelected = selection?.type === 'bench' && selection.playerId === entry.player.id;
              const isValidTarget = validSwapTargets.has(`bench-${entry.player.id}`);

              return (
                <button
                  key={entry.id}
                  type="button"
                  className={`${styles.benchSlot} ${isSelected ? styles.slotSelected : ''} ${isValidTarget ? styles.slotValidTarget : ''}`}
                  onClick={() => handleBenchClick(entry.player.id)}
                >
                  <span
                    className={styles.slotPosBadge}
                    style={{ background: POS_COLOR[entry.player.primary_position] }}
                  >
                    {entry.player.primary_position}
                  </span>
                  <span className={styles.benchSlotName}>
                    {entry.player.web_name ?? entry.player.name}
                  </span>
                  <span className={styles.benchSlotClub}>{entry.player.pl_team}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* IR (read-only) */}
      {irEntries.length > 0 && (
        <div className={styles.irSection}>
          <h3 className={styles.irTitle}>
            <span
              className={styles.sectionDot}
              style={{ background: 'var(--color-accent-red)' }}
            />
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
                <span className={styles.benchSlotName}>
                  {entry.player.web_name ?? entry.player.name}
                </span>
                <span className={styles.benchSlotClub}>{entry.player.pl_team}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Save row */}
      <div className={styles.saveRow}>
        {error && <span className={styles.errorText}>{error}</span>}
        {success && !error && (
          <span className={styles.successText}>Lineup saved successfully!</span>
        )}
        <button className={styles.saveBtn} onClick={handleSave} disabled={!canSave}>
          {saving ? 'Saving\u2026' : 'Save Lineup'}
        </button>
      </div>
    </div>
  );
}
