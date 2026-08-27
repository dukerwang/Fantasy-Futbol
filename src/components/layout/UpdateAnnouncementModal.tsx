'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Modal from '@/components/transfers/Modal';
import styles from './UpdateAnnouncementModal.module.css';

interface Notification {
  id: string;
  title: string;
  content: string;
  url?: string;
  read: boolean;
  kind?: string | null;
  created_at: string;
}

/**
 * Pops once, at most, for the newest unread major product update — same
 * notification row the bell already shows, so dismissing either one clears
 * both. Mounted once in the dashboard shell rather than per-page.
 */
export default function UpdateAnnouncementModal() {
  const [notice, setNotice] = useState<Notification | null>(null);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    fetch('/api/notifications')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const notifications = (data.notifications ?? []) as Notification[];
        const next = notifications.find((n) => n.kind === 'product' && !n.read);
        if (next) setNotice(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!notice) return null;

  const dismiss = () => {
    setNotice(null);
    fetch('/api/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notificationId: notice.id }),
    }).catch(() => {});
  };

  return (
    <Modal open title="Gaffa Updated" onClose={dismiss}>
      <div className={styles.body}>
        <h3 className={styles.title}>{notice.title}</h3>
        <p className={styles.summary}>{notice.content}</p>
        <button
          type="button"
          className={styles.cta}
          onClick={() => {
            dismiss();
            router.push(notice.url ?? '/updates');
          }}
        >
          See what&rsquo;s new
        </button>
      </div>
    </Modal>
  );
}
