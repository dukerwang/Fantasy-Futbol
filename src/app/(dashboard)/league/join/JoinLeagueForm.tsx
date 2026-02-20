'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './join.module.css';

export default function JoinLeagueForm() {
  const router = useRouter();
  const [inviteCode, setInviteCode] = useState('');
  const [teamName, setTeamName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch('/api/leagues/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inviteCode, teamName }),
    });

    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? 'Failed to join league');
      setLoading(false);
      return;
    }

    router.push(`/league/${json.leagueId}`);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="invite-code">
          Invite Code
        </label>
        <input
          id="invite-code"
          type="text"
          value={inviteCode}
          onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
          className={styles.input}
          placeholder="e.g. ABC12345"
          required
          maxLength={20}
          autoComplete="off"
          spellCheck={false}
        />
        <p className={styles.hint}>Get this from your league commissioner.</p>
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

      {error && <p className={styles.error}>{error}</p>}

      <button type="submit" className={styles.submitBtn} disabled={loading}>
        {loading ? 'Joining…' : 'Join League'}
      </button>
    </form>
  );
}
