'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './league.module.css';
import type { Team } from '@/types';

interface Props {
  leagueId: string;
  initialTeams: Pick<Team, 'id' | 'team_name' | 'draft_order'>[];
}

export default function DraftOrderManager({ leagueId, initialTeams }: Props) {
  const router = useRouter();

  // Sort teams: those with draft_order set come first in order, rest alphabetically
  const sorted = [...initialTeams].sort((a, b) => {
    if (a.draft_order !== null && b.draft_order !== null) return a.draft_order - b.draft_order;
    if (a.draft_order !== null) return -1;
    if (b.draft_order !== null) return 1;
    return a.team_name.localeCompare(b.team_name);
  });

  const [teams, setTeams] = useState(sorted);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function moveUp(index: number) {
    if (index === 0) return;
    setTeams((prev) => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  }

  function moveDown(index: number) {
    if (index === teams.length - 1) return;
    setTeams((prev) => {
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
  }

  function randomize() {
    setTeams((prev) => {
      const next = [...prev];
      for (let i = next.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [next[i], next[j]] = [next[j], next[i]];
      }
      return next;
    });
  }

  async function startDraft() {
    setLoading(true);
    setError(null);

    const order = teams.map((t, i) => ({ teamId: t.id, draftOrder: i + 1 }));

    const res = await fetch(`/api/leagues/${leagueId}/draft/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order }),
    });

    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? 'Failed to start draft');
      setLoading(false);
      return;
    }

    router.push(`/league/${leagueId}/draft`);
    router.refresh();
  }

  return (
    <div className={styles.draftOrderSection}>
      <div className={styles.draftOrderHeader}>
        <h3 className={styles.draftOrderTitle}>Draft Order</h3>
        <button
          type="button"
          onClick={randomize}
          className={styles.randomizeBtn}
          disabled={loading}
        >
          Randomize
        </button>
      </div>

      <p className={styles.draftOrderHint}>
        Drag or use the arrows to set the order. Round 1 picks top → bottom; Round 2 reverses (snake).
      </p>

      <ol className={styles.draftOrderList}>
        {teams.map((team, i) => (
          <li key={team.id} className={styles.draftOrderItem}>
            <span className={styles.draftSlotNum}>{i + 1}</span>
            <span className={styles.draftSlotName}>{team.team_name}</span>
            <div className={styles.draftSlotBtns}>
              <button
                type="button"
                onClick={() => moveUp(i)}
                disabled={i === 0 || loading}
                className={styles.reorderBtn}
                aria-label="Move up"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => moveDown(i)}
                disabled={i === teams.length - 1 || loading}
                className={styles.reorderBtn}
                aria-label="Move down"
              >
                ↓
              </button>
            </div>
          </li>
        ))}
      </ol>

      {error && <p className={styles.draftOrderError}>{error}</p>}

      <button
        type="button"
        onClick={startDraft}
        className={styles.startDraftBtn}
        disabled={loading}
      >
        {loading ? 'Starting…' : 'Start Draft'}
      </button>
    </div>
  );
}
