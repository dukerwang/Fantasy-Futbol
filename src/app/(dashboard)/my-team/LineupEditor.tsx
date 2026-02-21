'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FORMATION_SLOTS, POSITION_FLEX_MAP } from '@/types';
import type { Formation, GranularPosition, RosterEntry, Player } from '@/types';
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const slots = FORMATION_SLOTS[formation];
  const assignedIds = new Set(
    Object.values(assignments).filter(Boolean) as string[]
  );

  function handleFormationChange(f: Formation) {
    setFormation(f);
    const newSlots = FORMATION_SLOTS[f];
    const reset: Record<number, string | null> = {};
    for (let i = 0; i < newSlots.length; i++) reset[i] = null;
    setAssignments(reset);
    setError(null);
    setSuccess(false);
  }

  function getEligiblePlayers(slotPos: GranularPosition, slotIndex: number) {
    const allowed = POSITION_FLEX_MAP[slotPos];
    return allEntries.filter((entry) => {
      const p = entry.player;
      const positions: GranularPosition[] = [
        p.primary_position,
        ...(p.secondary_positions ?? []),
      ];
      if (!positions.some((pos) => allowed.includes(pos))) return false;
      // Exclude players already assigned to a different slot
      if (assignedIds.has(p.id) && assignments[slotIndex] !== p.id) return false;
      return true;
    });
  }

  const benchEntries = allEntries.filter((e) => !assignedIds.has(e.player.id));

  async function handleSave() {
    const starters = slots.map((slot, i) => ({
      player_id: assignments[i] as string,
      slot,
    }));

    if (starters.some((s) => !s.player_id)) {
      setError('All 11 slots must be filled before saving.');
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const bench = benchEntries.map((e) => e.player.id);
      const res = await fetch(`/api/teams/${teamId}/lineup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ formation, starters, bench }),
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
        <select
          id="formation-select"
          className={styles.formationSelect}
          value={formation}
          onChange={(e) => handleFormationChange(e.target.value as Formation)}
        >
          {FORMATIONS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </div>

      {/* Slot table */}
      <table className={styles.slotsTable}>
        <thead>
          <tr>
            <th className={styles.slotTh}>#</th>
            <th className={styles.slotTh}>Pos</th>
            <th className={styles.slotTh}>Player</th>
          </tr>
        </thead>
        <tbody>
          {slots.map((slotPos, i) => {
            const eligible = getEligiblePlayers(slotPos, i);
            const currentId = assignments[i];
            // If the current assignment is no longer in the eligible list (e.g. after
            // another slot took the player), surface it anyway so the row isn't blank.
            const currentEntry =
              currentId && !eligible.find((e) => e.player.id === currentId)
                ? allEntries.find((e) => e.player.id === currentId)
                : undefined;

            return (
              <tr key={i} className={styles.slotRow}>
                <td className={styles.slotNum}>{i + 1}</td>
                <td className={styles.slotPos}>
                  <span
                    className={styles.posBadge}
                    style={{ background: POS_COLOR[slotPos] }}
                  >
                    {slotPos}
                  </span>
                </td>
                <td className={styles.slotCell}>
                  <select
                    className={styles.slotSelect}
                    value={currentId ?? ''}
                    onChange={(e) => {
                      setAssignments((prev) => ({
                        ...prev,
                        [i]: e.target.value || null,
                      }));
                      setError(null);
                      setSuccess(false);
                    }}
                  >
                    <option value="">— select player —</option>
                    {eligible.map((entry) => (
                      <option key={entry.player.id} value={entry.player.id}>
                        {entry.player.web_name ?? entry.player.name} (
                        {entry.player.primary_position}) — {entry.player.pl_team}
                      </option>
                    ))}
                    {currentEntry && (
                      <option key={currentEntry.player.id} value={currentEntry.player.id}>
                        {currentEntry.player.web_name ?? currentEntry.player.name} (
                        {currentEntry.player.primary_position}) — {currentEntry.player.pl_team}
                      </option>
                    )}
                  </select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Bench (auto) */}
      <div className={styles.benchSection}>
        <h3 className={styles.benchTitle}>
          <span className={styles.sectionDot} style={{ background: 'var(--color-text-muted)' }} />
          Bench ({benchEntries.length})
        </h3>
        {benchEntries.length === 0 ? (
          <p className={styles.emptySection}>All players assigned to starting XI.</p>
        ) : (
          <div className={styles.benchList}>
            {benchEntries.map((entry) => (
              <div key={entry.id} className={styles.benchItem}>
                <span
                  className={styles.posBadge}
                  style={{ background: POS_COLOR[entry.player.primary_position] }}
                >
                  {entry.player.primary_position}
                </span>
                <span className={styles.benchName}>
                  {entry.player.web_name ?? entry.player.name}
                </span>
                <span className={styles.benchClub}>{entry.player.pl_team}</span>
              </div>
            ))}
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
                  className={styles.posBadge}
                  style={{ background: POS_COLOR[entry.player.primary_position] }}
                >
                  {entry.player.primary_position}
                </span>
                <span className={styles.benchName}>
                  {entry.player.web_name ?? entry.player.name}
                </span>
                <span className={styles.benchClub}>{entry.player.pl_team}</span>
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
          {saving ? 'Saving…' : 'Save Lineup'}
        </button>
      </div>
    </div>
  );
}
