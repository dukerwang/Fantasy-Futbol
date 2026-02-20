'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './create.module.css';

export default function CreateLeagueForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [maxTeams, setMaxTeams] = useState(12);
  const [rosterSize, setRosterSize] = useState(15);
  const [faabBudget, setFaabBudget] = useState(100);
  const [draftType, setDraftType] = useState<'snake' | 'auction'>('snake');
  const [isDynasty, setIsDynasty] = useState(true);
  const [teamName, setTeamName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch('/api/leagues/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, teamName, maxTeams, rosterSize, faabBudget, draftType, isDynasty }),
    });

    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? 'Failed to create league');
      setLoading(false);
      return;
    }

    router.push(`/league/${json.leagueId}`);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      <div className={styles.formSection}>
        <h2 className={styles.formSectionTitle}>League Details</h2>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="league-name">
            League Name
          </label>
          <input
            id="league-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={styles.input}
            placeholder="Premier Fantasy Dynasty"
            required
            maxLength={80}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="team-name">
            Your Team Name
          </label>
          <input
            id="team-name"
            type="text"
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            className={styles.input}
            placeholder="The Invincibles"
            maxLength={50}
          />
        </div>
      </div>

      <div className={styles.formSection}>
        <h2 className={styles.formSectionTitle}>League Settings</h2>

        <div className={styles.fieldRow}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="max-teams">
              Max Teams
            </label>
            <select
              id="max-teams"
              value={maxTeams}
              onChange={(e) => setMaxTeams(Number(e.target.value))}
              className={styles.select}
            >
              {[8, 10, 12, 14, 16].map((n) => (
                <option key={n} value={n}>{n} teams</option>
              ))}
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="roster-size">
              Roster Size
            </label>
            <select
              id="roster-size"
              value={rosterSize}
              onChange={(e) => setRosterSize(Number(e.target.value))}
              className={styles.select}
            >
              {[12, 13, 15, 18, 20].map((n) => (
                <option key={n} value={n}>{n} players</option>
              ))}
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="faab">
              FAAB Budget (£m)
            </label>
            <select
              id="faab"
              value={faabBudget}
              onChange={(e) => setFaabBudget(Number(e.target.value))}
              className={styles.select}
            >
              {[50, 100, 200, 500].map((n) => (
                <option key={n} value={n}>£{n}m</option>
              ))}
            </select>
          </div>
        </div>

        <div className={styles.fieldRow}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="draft-type">
              Draft Type
            </label>
            <select
              id="draft-type"
              value={draftType}
              onChange={(e) => setDraftType(e.target.value as 'snake' | 'auction')}
              className={styles.select}
            >
              <option value="snake">Snake Draft</option>
              <option value="auction">Auction Draft</option>
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Dynasty Mode</label>
            <div className={styles.toggleRow}>
              <button
                type="button"
                onClick={() => setIsDynasty(true)}
                className={`${styles.toggleBtn} ${isDynasty ? styles.toggleBtnActive : ''}`}
              >
                Dynasty
              </button>
              <button
                type="button"
                onClick={() => setIsDynasty(false)}
                className={`${styles.toggleBtn} ${!isDynasty ? styles.toggleBtnActive : ''}`}
              >
                Redraft
              </button>
            </div>
          </div>
        </div>
      </div>

      {error && <p className={styles.error}>{error}</p>}

      <button type="submit" className={styles.submitBtn} disabled={loading}>
        {loading ? 'Creating…' : 'Create League'}
      </button>
    </form>
  );
}
