'use client';

import { useEffect, useState } from 'react';
import { getPushAvailability, subscribeToPush, unsubscribeFromPush, type PushAvailability } from '@/lib/push/subscribe';
import styles from './NotificationsToggle.module.css';

export default function NotificationsToggle() {
  const [state, setState] = useState<PushAvailability | 'loading'>('loading');

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

  return (
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
  );
}
