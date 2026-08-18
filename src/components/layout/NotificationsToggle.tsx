'use client';

import { useEffect, useState } from 'react';
import { getPushAvailability, subscribeToPush, unsubscribeFromPush, type PushAvailability } from '@/lib/push/subscribe';
import styles from './NotificationsToggle.module.css';

interface NotificationsToggleProps {
  leagueId?: string | null;
}

export default function NotificationsToggle({ leagueId }: NotificationsToggleProps) {
  const [state, setState] = useState<PushAvailability | 'loading'>('loading');
  const [testSent, setTestSent] = useState(false);

  useEffect(() => {
    getPushAvailability().then(setState);
  }, []);

  async function handleToggle() {
    if (state === 'subscribed') {
      setState('loading');
      await unsubscribeFromPush();
      setState('unsubscribed');
      return;
    }
    if (state === 'unsubscribed') {
      setState('loading');
      try {
        await subscribeToPush();
        setState('subscribed');
      } catch {
        setState('unsubscribed');
      }
    }
  }

  if (state === 'unsupported') return null;

  if (state === 'needs-install') {
    return <div className={styles.hint}>Add Gaffa to your Home Screen to enable notifications.</div>;
  }

  const isOn = state === 'subscribed';

  async function handleSendTest() {
    if (!leagueId) return;
    setTestSent(true);
    await fetch('/api/push/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leagueId }),
    });
    setTimeout(() => setTestSent(false), 3000);
  }

  return (
    <>
      <div className={styles.row}>
        <span className={styles.label}>Push notifications</span>
        <button
          type="button"
          role="switch"
          aria-checked={isOn}
          aria-label="Toggle push notifications"
          disabled={state === 'loading'}
          onClick={handleToggle}
          className={`${styles.switch} ${isOn ? styles.switchOn : ''}`}
        >
          <span className={styles.switchThumb} />
        </button>
      </div>
      {isOn && leagueId && (
        <button type="button" onClick={handleSendTest} className={styles.testLink}>
          {testSent ? 'Test notification sent' : 'Send test notification'}
        </button>
      )}
    </>
  );
}
