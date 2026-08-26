'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { computeRecommendedSettings, type LeagueSizeProfile } from '@/lib/leagues/recommendedSettings';
import styles from './create.module.css';

const MAX_TEAMS_OPTIONS = [4, 5, 6, 7, 8, 9, 10, 11, 12];
const ROSTER_SIZE_OPTIONS = Array.from({ length: 15 }, (_, i) => i + 16); // 16..30
const BENCH_SIZE_OPTIONS = [2, 3, 4, 5, 6];
const IR_SIZE_OPTIONS = [1, 2, 3];
const FAAB_OPTIONS = [50, 100, 150, 200, 250, 300, 350, 400, 450, 500];

const PROFILES: { value: LeagueSizeProfile; label: string; blurb: string }[] = [
  { value: 'casual', label: 'Casual', blurb: 'Leaner rosters, more waiver-wire activity' },
  { value: 'standard', label: 'Standard', blurb: 'The proven default across live leagues' },
  { value: 'deep', label: 'Deep Dynasty', blurb: 'Bigger rosters for stashing prospects' },
];

export default function CreateLeagueForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [maxTeams, setMaxTeams] = useState(10);
  const [profile, setProfile] = useState<LeagueSizeProfile>('standard');
  const [isDynasty, setIsDynasty] = useState(true);

  const initial = computeRecommendedSettings({ maxTeams: 10, profile: 'standard', isDynasty: true });
  const [rosterSize, setRosterSize] = useState(initial.rosterSize);
  const [benchSize, setBenchSize] = useState(initial.benchSize);
  const [irSize, setIrSize] = useState(initial.irSize);
  // 250 matches the API default and docs/USER_GUIDE.md §8. The form used to
  // default to 150, so every league made through the UI silently started a
  // third poorer than the documented figure.
  const [faabBudget, setFaabBudget] = useState(initial.faabBudget);

  // Each derived field tracks the recommendation until the user edits it
  // directly. Picking a different preset re-arms every field, overwriting
  // manual edits — that's the one bulk action allowed to clobber them.
  const [autoRoster, setAutoRoster] = useState(true);
  const [autoBench, setAutoBench] = useState(true);
  const [autoIr, setAutoIr] = useState(true);
  const [autoFaab, setAutoFaab] = useState(true);

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const recommended = computeRecommendedSettings({ maxTeams, profile, isDynasty });

  function applyRecommended(next: { maxTeams?: number; profile?: LeagueSizeProfile; isDynasty?: boolean }, rearmAll: boolean) {
    const r = computeRecommendedSettings({
      maxTeams: next.maxTeams ?? maxTeams,
      profile: next.profile ?? profile,
      isDynasty: next.isDynasty ?? isDynasty,
    });
    if (rearmAll || autoRoster) setRosterSize(r.rosterSize);
    if (rearmAll || autoBench) setBenchSize(r.benchSize);
    if (rearmAll || autoIr) setIrSize(r.irSize);
    if (rearmAll || autoFaab) setFaabBudget(r.faabBudget);
    if (rearmAll) {
      setAutoRoster(true);
      setAutoBench(true);
      setAutoIr(true);
      setAutoFaab(true);
    }
  }

  function handleMaxTeamsChange(n: number) {
    setMaxTeams(n);
    applyRecommended({ maxTeams: n }, false);
  }

  function handleProfileChange(p: LeagueSizeProfile) {
    setProfile(p);
    applyRecommended({ profile: p }, true);
  }

  function handleDynastyChange(dynasty: boolean) {
    setIsDynasty(dynasty);
    applyRecommended({ isDynasty: dynasty }, false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    // Auction quiet hours are meaningless without a zone, and this has to be
    // read in the browser: the same call on the server returns Vercel's UTC,
    // not where the managers actually live.
    const auctionTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    const res = await fetch('/api/leagues/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name, maxTeams, rosterSize, benchSize, irSize, faabBudget, isDynasty, auctionTimezone,
      }),
    });

    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? 'Failed to create league');
      setLoading(false);
      return;
    }

    window.dispatchEvent(new Event('navigation-start'));
    router.push(`/league/${json.leagueId}/team-setup`);
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
            maxLength={40}
          />
          <span className={`${styles.charCount} ${name.length >= 36 ? styles.charCountWarn : ''}`}>
            {name.length} / 40
          </span>
        </div>
      </div>

      <div className={styles.formSection}>
        <h2 className={styles.formSectionTitle}>League Size</h2>

        <div className={styles.toggleRow}>
          {PROFILES.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => handleProfileChange(p.value)}
              className={`${styles.toggleBtn} ${profile === p.value ? styles.toggleBtnActive : ''}`}
              title={p.blurb}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className={styles.fieldRow}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="max-teams">
              Max Teams
            </label>
            <select
              id="max-teams"
              value={maxTeams}
              onChange={(e) => handleMaxTeamsChange(Number(e.target.value))}
              className={styles.select}
            >
              {MAX_TEAMS_OPTIONS.map((n) => (
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
              onChange={(e) => { setRosterSize(Number(e.target.value)); setAutoRoster(false); }}
              className={styles.select}
            >
              {ROSTER_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>{n} players</option>
              ))}
            </select>
            {rosterSize !== recommended.rosterSize && (
              <span className={styles.recommendedHint}>Recommended: {recommended.rosterSize}</span>
            )}
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="bench-size">
              Bench Size
            </label>
            <select
              id="bench-size"
              value={benchSize}
              onChange={(e) => { setBenchSize(Number(e.target.value)); setAutoBench(false); }}
              className={styles.select}
            >
              {BENCH_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>{n} bench</option>
              ))}
            </select>
            {benchSize !== recommended.benchSize && (
              <span className={styles.recommendedHint}>Recommended: {recommended.benchSize}</span>
            )}
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="ir-size">
              IR Slots
            </label>
            <select
              id="ir-size"
              value={irSize}
              onChange={(e) => { setIrSize(Number(e.target.value)); setAutoIr(false); }}
              className={styles.select}
            >
              {IR_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>{n} IR</option>
              ))}
            </select>
            {irSize !== recommended.irSize && (
              <span className={styles.recommendedHint}>Recommended: {recommended.irSize}</span>
            )}
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="faab">
              Club Balance (€m)
            </label>
            <select
              id="faab"
              value={faabBudget}
              onChange={(e) => { setFaabBudget(Number(e.target.value)); setAutoFaab(false); }}
              className={styles.select}
            >
              {FAAB_OPTIONS.map((n) => (
                <option key={n} value={n}>€{n}m</option>
              ))}
            </select>
            {faabBudget !== recommended.faabBudget && (
              <span className={styles.recommendedHint}>Recommended: €{recommended.faabBudget}m</span>
            )}
          </div>
        </div>
      </div>

      <div className={styles.formSection}>
        <h2 className={styles.formSectionTitle}>Format</h2>

        <div className={styles.field}>
          <label className={styles.label}>Dynasty Mode</label>
          <div className={styles.toggleRow}>
            <button
              type="button"
              onClick={() => handleDynastyChange(true)}
              className={`${styles.toggleBtn} ${isDynasty ? styles.toggleBtnActive : ''}`}
            >
              Dynasty
            </button>
            <button
              type="button"
              onClick={() => handleDynastyChange(false)}
              className={`${styles.toggleBtn} ${!isDynasty ? styles.toggleBtnActive : ''}`}
            >
              Redraft
            </button>
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
