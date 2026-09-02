'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import Modal from '@/components/transfers/Modal';
import { Icon } from '@/components/ui/Icon';
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
  const [highlights, setHighlights] = useState<string[]>([]);
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

  // The notification row carries only title and summary. Highlights live on
  // the update itself, which every authenticated user may already read — see
  // the SELECT policy in migration 144 — so this is one extra read rather than
  // a widening of the notification payload for a field the bell never shows.
  useEffect(() => {
    const slug = notice?.url?.split('#')[1];
    if (!slug) return;
    let cancelled = false;
    createClient()
      .from('product_updates')
      .select('highlights')
      .eq('slug', slug)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        const rows = (data?.highlights ?? []) as string[];
        setHighlights(rows.filter((h) => typeof h === 'string' && h.trim().length > 0));
      });
    return () => {
      cancelled = true;
    };
  }, [notice?.url]);

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
    <Modal
      open
      title={notice.title}
      lead={
        <span className={styles.badge}>
          <Icon name="bell" size={16} strokeWidth={2} />
        </span>
      }
      onClose={dismiss}
    >
      <div className={styles.body}>
        <p className={styles.summary}>{notice.content}</p>
        {highlights.length > 0 && (
          <ul className={styles.highlights}>
            {highlights.map((h, i) => (
              <li key={h} className={styles.highlight}>
                <span className={styles.index} aria-hidden="true">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span>{h}</span>
              </li>
            ))}
          </ul>
        )}
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
