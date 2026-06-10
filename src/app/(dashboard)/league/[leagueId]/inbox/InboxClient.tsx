'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/ui/Icon';
import FormattedText from '@/components/ui/FormattedText';
import styles from './Inbox.module.css';

interface Notification {
  id: string;
  league_id: string;
  user_id: string;
  title: string;
  content: string;
  url?: string;
  read: boolean;
  created_at: string;
}

interface InboxClientProps {
  leagueId: string;
  leagueName: string;
}

export default function InboxClient({ leagueId, leagueName }: InboxClientProps) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const fetchNotifications = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/notifications?league_id=${leagueId}`);
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications || []);
      }
    } catch (err) {
      console.error('Failed to fetch notifications:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNotifications();
  }, [leagueId]);

  const handleMarkAllRead = async () => {
    try {
      const res = await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId, markAll: true })
      });
      if (res.ok) {
        setNotifications(prev => prev.map(n => ({ ...n, read: true })));
      }
    } catch (err) {
      console.error('Failed to mark all read:', err);
    }
  };

  const handleClearInbox = async () => {
    if (!confirm('Are you sure you want to clear your entire inbox for this league? This cannot be undone.')) {
      return;
    }
    try {
      const res = await fetch('/api/notifications', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId, clearAll: true })
      });
      if (res.ok) {
        setNotifications([]);
      }
    } catch (err) {
      console.error('Failed to clear inbox:', err);
    }
  };

  const handleMarkSingleRead = async (id: string) => {
    try {
      const res = await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notificationId: id })
      });
      if (res.ok) {
        setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
      }
    } catch (err) {
      console.error('Failed to mark notification read:', err);
    }
  };

  const handleDeleteSingle = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation(); // Stop row click trigger
    try {
      const res = await fetch('/api/notifications', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notificationId: id })
      });
      if (res.ok) {
        setNotifications(prev => prev.filter(n => n.id !== id));
      }
    } catch (err) {
      console.error('Failed to delete notification:', err);
    }
  };

  const handleRowClick = async (n: Notification) => {
    if (!n.read) {
      await handleMarkSingleRead(n.id);
    }
    if (n.url) {
      router.push(n.url);
    }
  };

  const getAlertIcon = (title: string, content: string) => {
    const text = (title + ' ' + content).toLowerCase();
    if (text.includes('trade')) return 'repeat';
    if (text.includes('draft')) return 'trophy';
    if (text.includes('outbid')) return 'alert';
    if (text.includes('waiver') || text.includes('dropped') || text.includes('drop')) return 'arrow-down';
    if (text.includes('match') || text.includes('gw') || text.includes('gameweek') || text.includes('won') || text.includes('summary')) return 'trending';
    return 'bell';
  };

  const formatFullTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const filteredNotifications = notifications.filter(n => {
    if (filter === 'unread') return !n.read;
    return true;
  });

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <div className={styles.container}>
      {/* Editorial Header */}
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>Inbox Ledger</h1>
          <div className={styles.actions}>
            {unreadCount > 0 && (
              <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={handleMarkAllRead}>
                <Icon name="check" size={16} /> Mark all read
              </button>
            )}
            {notifications.length > 0 && (
              <button className={`${styles.btn} ${styles.btnDanger}`} onClick={handleClearInbox}>
                <Icon name="x" size={16} /> Clear Inbox
              </button>
            )}
          </div>
        </div>
        <p className={styles.subtitle}>
          Personal ledger for <strong>{leagueName}</strong>. Real-time logging of trade transactions, waiver claims, financial activity, and head-to-head competition summary notifications.
        </p>
      </header>

      {/* Filter and Count Row */}
      <div className={styles.controls}>
        <div className={styles.tabs}>
          <button
            className={`${styles.tab} ${filter === 'all' ? styles.tabActive : ''}`}
            onClick={() => setFilter('all')}
          >
            All Alerts ({notifications.length})
          </button>
          <button
            className={`${styles.tab} ${filter === 'unread' ? styles.tabActive : ''}`}
            onClick={() => setFilter('unread')}
          >
            Unread ({unreadCount})
          </button>
        </div>
        <span style={{ fontSize: '13px', color: 'var(--color-text-muted)', fontFamily: 'var(--font-sans)' }}>
          Showing {filteredNotifications.length} of {notifications.length} alerts
        </span>
      </div>

      {/* Main Ledger List */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--color-text-muted)' }}>
          Loading your inbox ledger...
        </div>
      ) : filteredNotifications.length > 0 ? (
        <div className={styles.ledger}>
          {filteredNotifications.map(n => {
            const iconName = getAlertIcon(n.title, n.content);
            return (
              <div
                key={n.id}
                className={`${styles.row} ${!n.read ? styles.rowUnread : ''}`}
                onClick={() => handleRowClick(n)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') handleRowClick(n); }}
              >
                {/* Left: Dynamic Icon */}
                <div className={styles.iconWrapper}>
                  <Icon name={iconName} size={20} strokeWidth={1.5} />
                </div>

                {/* Center: Title, Description, Timestamp */}
                <div className={styles.rowContent}>
                  <div className={styles.rowHeader}>
                    <span className={styles.rowTitle}>{n.title}</span>
                    <span className={styles.rowTime}>{formatFullTime(n.created_at)}</span>
                  </div>
                  <p className={styles.rowBody}>
                    <FormattedText text={n.content} />
                  </p>

                  <div className={styles.rowFooter}>
                    {n.url ? (
                      <span className={`${styles.btn} ${styles.rowBtn} ${styles.btnPrimary}`}>
                        Review Event <span style={{ marginLeft: '4px', fontSize: '10px' }}>↗</span>
                      </span>
                    ) : (
                      <span />
                    )}

                    {/* Single notification deletion */}
                    <button
                      className={styles.deleteBtn}
                      onClick={(e) => handleDeleteSingle(e, n.id)}
                      title="Delete notification"
                      aria-label="Delete notification"
                    >
                      <Icon name="x" size={16} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>
            <Icon name="mail" size={48} strokeWidth={1} />
          </div>
          <h2 className={styles.emptyTitle}>
            {filter === 'unread' ? 'No Unread Alerts' : 'Inbox is Empty'}
          </h2>
          <p className={styles.emptyDesc}>
            {filter === 'unread'
              ? 'You have catch up on all events! Switch back to "All Alerts" to review historical ledger logs.'
              : 'There are no active notifications for your manager profile in this league yet.'}
          </p>
        </div>
      )}
    </div>
  );
}
