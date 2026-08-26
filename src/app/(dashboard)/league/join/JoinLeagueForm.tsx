'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './join.module.css';

interface LeaguePreview {
  name: string;
  maxTeams: number;
  currentTeams: number;
  rosterSize: number;
  faabBudget: number;
  isDynasty: boolean;
  status: 'setup' | 'drafting' | 'active' | 'completed';
}

export default function JoinLeagueForm() {
  const router = useRouter();
  const [inviteCode, setInviteCode] = useState('');
  const [teamName, setTeamName] = useState('');
  const [preview, setPreview] = useState<LeaguePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (inviteCode.trim().length < 4) return;

    const timer = setTimeout(async () => {
      const res = await fetch(`/api/leagues/lookup?code=${encodeURIComponent(inviteCode.trim())}`);
      const json = await res.json();
      if (!res.ok) {
        setPreviewError(json.error ?? 'Invite code not found');
        return;
      }
      setPreview(json);
    }, 400);

    return () => clearTimeout(timer);
  }, [inviteCode]);

  const isFull = preview ? preview.currentTeams >= preview.maxTeams : false;
  const isClosed = preview ? preview.status === 'active' || preview.status === 'completed' : false;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch('/api/leagues/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inviteCode, teamName: teamName.trim() || undefined }),
    });

    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? 'Failed to join league');
      setLoading(false);
      return;
    }

    window.dispatchEvent(new Event('navigation-start'));
    router.push(`/league/${json.leagueId}/team-setup`);
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
          onChange={(e) => {
            setInviteCode(e.target.value.toUpperCase());
            setPreview(null);
            setPreviewError(null);
          }}
          className={styles.input}
          placeholder="e.g. ABC12345"
          required
          maxLength={20}
          autoComplete="off"
          spellCheck={false}
        />
        <p className={styles.hint}>Get this from your league commissioner.</p>
      </div>

      {previewError && <p className={styles.error}>{previewError}</p>}

      {preview && (
        <div className={styles.previewCard}>
          <p className={styles.previewName}>{preview.name}</p>
          <div className={styles.previewStats}>
            <span>{preview.currentTeams}/{preview.maxTeams} teams</span>
            <span>{preview.rosterSize}-man rosters</span>
            <span>{preview.isDynasty ? 'Dynasty' : 'Redraft'}</span>
            <span>€{preview.faabBudget}m budget</span>
          </div>
          {isFull && <p className={styles.previewWarning}>This league is full.</p>}
          {!isFull && isClosed && (
            <p className={styles.previewWarning}>This league is no longer accepting new members.</p>
          )}
        </div>
      )}

      {preview && !isFull && !isClosed && (
        <div className={styles.field}>
          <label className={styles.label} htmlFor="team-name">
            Team Name
          </label>
          <input
            id="team-name"
            type="text"
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            className={styles.input}
            placeholder="Your Club"
            maxLength={40}
          />
        </div>
      )}

      {error && <p className={styles.error}>{error}</p>}

      <button
        type="submit"
        className={styles.submitBtn}
        disabled={loading || isFull || isClosed}
      >
        {loading ? 'Joining…' : 'Join League'}
      </button>
    </form>
  );
}
