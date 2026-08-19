'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import CrestBuilder from '@/components/crest/CrestBuilder';
import { CrestConfig } from '@/components/crest/types';
import styles from '../team-setup/teamSetup.module.css';

interface Props {
  leagueId: string;
  team: {
    id: string;
    team_name: string;
    abbreviation: string | null;
    crest_config: any;
  };
}

export default function CrestEditClient({ leagueId, team }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const supabase = createClient();

  const handleSave = async (crestConfig: CrestConfig) => {
    setLoading(true);
    setError(null);
    setSuccess(false);

    const { error: updateErr } = await supabase
      .from('teams')
      .update({
        crest_config: crestConfig,
        logo_url: null, // Clear legacy logo url
      })
      .eq('id', team.id);

    if (updateErr) {
      setError(updateErr.message);
      setLoading(false);
      return;
    }

    setSuccess(true);
    setLoading(false);
    
    // Quick delay to let the user see success before redirecting
    setTimeout(() => {
      window.dispatchEvent(new Event('navigation-start'));
      router.push(`/league/${leagueId}`);
      router.refresh();
    }, 800);
  };

  return (
    <div className={styles.setupLayout} style={{ padding: '3rem 1rem' }}>
      <div style={{ width: '100%', maxWidth: '1000px', margin: '0 auto' }}>
        <div style={{ marginBottom: '32px', textAlign: 'center' }}>
          <h1 className={styles.panelTitle}>Customize Club Crest</h1>
          <p className={styles.panelSubtitle}>
            Update the credentials and visual colors for <strong>{team.team_name}</strong>.
          </p>
          
          {error && (
            <p className={styles.errorText} style={{ marginTop: '16px' }}>
              {error}
            </p>
          )}
          
          {success && (
            <p style={{ color: 'var(--color-success)', fontWeight: 'bold', fontSize: '14px', marginTop: '16px' }}>
              ✓ Crest updated successfully! Returning to clubhouse...
            </p>
          )}
        </div>

        <CrestBuilder
          initialConfig={team.crest_config}
          abbreviation={team.abbreviation ?? 'CLUB'}
          teamName={team.team_name}
          onSave={handleSave}
          onCancel={() => {
            window.dispatchEvent(new Event('navigation-start'));
            router.push(`/league/${leagueId}`);
          }}
          saveLabel="Save Crest Design"
          loading={loading || success}
        />
      </div>
    </div>
  );
}
