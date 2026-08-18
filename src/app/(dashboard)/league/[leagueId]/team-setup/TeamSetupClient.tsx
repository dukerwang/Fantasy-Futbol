'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import CrestBuilder from '@/components/crest/CrestBuilder';
import { CrestConfig } from '@/components/crest/types';
import styles from './teamSetup.module.css';

interface Props {
  leagueId: string;
  leagueName: string;
  team: {
    id: string;
    team_name: string;
    abbreviation: string | null;
    logo_url: string | null;
    crest_config: any;
  };
  username: string;
}

export default function TeamSetupClient({ leagueId, leagueName, team, username }: Props) {
  const router = useRouter();
  const [step, setStep] = useState<'identity' | 'crest'>('identity');
  const [name, setName] = useState(team.team_name);
  const [abbr, setAbbr] = useState(team.abbreviation ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supabase = createClient();

  const handleNextStep = (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      setError('Team name is required');
      return;
    }

    if (!abbr.trim()) {
      setError('Team abbreviation is required');
      return;
    }

    const abbrClean = abbr.trim().substring(0, 4).toUpperCase();
    if (abbrClean.length < 2) {
      setError('Abbreviation must be at least 2 characters');
      return;
    }

    if (!/^[A-Z0-9]+$/.test(abbrClean)) {
      setError('Abbreviation must be alphanumeric (letters and numbers only)');
      return;
    }

    setError(null);
    setStep('crest');
  };

  const handleSaveCrest = async (crestConfig: CrestConfig) => {
    setLoading(true);
    setError(null);

    const abbrClean = abbr.trim().substring(0, 4).toUpperCase();

    const { error: updateErr } = await supabase
      .from('teams')
      .update({
        team_name: name.trim(),
        abbreviation: abbrClean,
        crest_config: crestConfig,
        logo_url: null, // Reset legacy logo url
      })
      .eq('id', team.id);

    if (updateErr) {
      setError(updateErr.message);
      setLoading(false);
      return;
    }

    setLoading(false);
    window.dispatchEvent(new Event('navigation-start'));
    router.push(`/league/${leagueId}`);
    router.refresh();
  };

  if (step === 'crest') {
    return (
      <div className={styles.setupLayout} style={{ padding: '2rem 1rem' }}>
        <div style={{ width: '100%', maxWidth: '1000px', margin: '0 auto' }}>
          <div style={{ marginBottom: '24px', textAlign: 'center' }}>
            <span className={styles.previewTitle}>Step 2 of 2</span>
            <h1 className={styles.panelTitle} style={{ marginTop: '4px' }}>Club crest</h1>
            <p className={styles.panelSubtitle}>
              Design the custom crest that represents <strong>{name}</strong> in the league standings.
            </p>
            {error && <p className={styles.errorText} style={{ marginTop: '12px' }}>{error}</p>}
          </div>
          
          <CrestBuilder
            initialConfig={team.crest_config}
            abbreviation={abbr}
            teamName={name}
            onSave={handleSaveCrest}
            onCancel={() => setStep('identity')}
            saveLabel="Register Club & Enter League →"
            loading={loading}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.setupLayout}>
      <div className={styles.setupContainer} style={{ gridTemplateColumns: '1fr', maxWidth: '600px' }}>
        {/* Left Form Panel */}
        <div className={styles.setupPanel}>
          <div className={styles.panelHeader}>
            <span className={styles.previewTitle}>Step 1 of 2</span>
            <h1 className={styles.panelTitle}>Club credentials</h1>
            <p className={styles.panelSubtitle}>
              Configure your credentials for <strong>{leagueName}</strong> before entering the draft room.
            </p>
          </div>

          <form onSubmit={handleNextStep} className={styles.form}>
            {/* Club Name */}
            <div className={styles.inputGroup}>
              <label className={styles.inputLabel} htmlFor="club-name">
                Club Name <span className={styles.requiredAsterisk}>*</span>
              </label>
              <input
                id="club-name"
                type="text"
                className={styles.textInput}
                placeholder="e.g. Duke's FC"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={20}
                autoComplete="off"
              />
              <div className={styles.inputFooter}>
                <p className={styles.inputHint}>Your full franchise name displayed across the league.</p>
                <span className={`${styles.charCount} ${name.length >= 18 ? styles.charCountWarn : ''}`}>
                  {name.length} / 20
                </span>
              </div>
            </div>

            {/* Abbreviation */}
            <div className={styles.inputGroup}>
              <label className={styles.inputLabel} htmlFor="club-abbr">
                Abbreviation <span className={styles.requiredAsterisk}>*</span>
              </label>
              <input
                id="club-abbr"
                type="text"
                className={styles.textInput}
                placeholder="e.g. DUD (2-4 characters)"
                value={abbr}
                onChange={(e) => setAbbr(e.target.value.toUpperCase())}
                required
                maxLength={4}
                autoComplete="off"
              />
              <p className={styles.inputHint}>Short letters used for lists, fixtures, and dashboards.</p>
            </div>

            {error && <p className={styles.errorText}>{error}</p>}

            <button type="submit" className={styles.submitBtn}>
              Continue to Crest Design →
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
