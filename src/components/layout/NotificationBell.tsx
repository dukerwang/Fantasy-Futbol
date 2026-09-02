'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Icon } from '@/components/ui/Icon';
import FormattedText from '@/components/ui/FormattedText';
import styles from './NotificationBell.module.css';

interface Notification {
  id: string;
  league_id: string;
  user_id: string;
  title: string;
  content: string;
  url?: string;
  read: boolean;
  created_at: string;
  leagues?: { name: string } | null;
}

interface NotificationBellProps {
  leagueId: string | null;
  onNavigate?: () => void;
}

export default function NotificationBell({ leagueId, onNavigate }: NotificationBellProps) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const fetchNotifications = async () => {
    try {
      const url = leagueId 
        ? `/api/notifications?league_id=${leagueId}` 
        : '/api/notifications';
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications || []);
      }
    } catch (err) {
      console.error('Failed to fetch notifications:', err);
    }
  };

  // Fetch on mount, when leagueId changes, or via Realtime update / tab visibility
  useEffect(() => {
    fetchNotifications();

    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      channel = supabase
        .channel(`user-notifications:${user.id}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'notifications',
            filter: `user_id=eq.${user.id}`,
          },
          () => {
            fetchNotifications();
          }
        )
        .subscribe();
    });

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchNotifications();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (channel) supabase.removeChannel(channel);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [leagueId]);

  // Handle outside click to close dropdown
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const unreadCount = notifications.filter(n => !n.read).length;
  const displayNotifications = notifications.slice(0, 5); // Show latest 5

  // There's no cross-league inbox page — outside a league context (e.g. the
  // dashboard bell), fall back to whichever league the most recent notification
  // belongs to rather than linking to the current page itself.
  const inboxLeagueId = leagueId ?? notifications[0]?.league_id ?? null;

  const handleMarkAllRead = async () => {
    try {
      const res = await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId: leagueId ?? undefined, markAll: true })
      });
      if (res.ok) {
        setNotifications(prev => prev.map(n => ({ ...n, read: true })));
      }
    } catch (err) {
      console.error('Failed to mark all as read:', err);
    }
  };

  const handleItemClick = async (n: Notification) => {
    setIsOpen(false);
    if (!n.read) {
      try {
        await fetch('/api/notifications', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notificationId: n.id })
        });
        setNotifications(prev => prev.map(item => item.id === n.id ? { ...item, read: true } : item));
      } catch (err) {
        console.error('Failed to mark notification as read:', err);
      }
    }
    if (n.url) {
      if (onNavigate) onNavigate();
      router.push(n.url);
    }
  };

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return 'Yesterday';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  return (
    <div className={styles.bellContainer} ref={dropdownRef}>
      <button
        className={`${styles.bellBtn} ${isOpen ? styles.bellBtnActive : ''}`}
        onClick={() => {
          setIsOpen(!isOpen);
          if (!isOpen) {
            fetchNotifications(); // Refresh on open
          }
        }}
        type="button"
        aria-label="Notifications"
      >
        <Icon name="bell" size={18} strokeWidth={1.5} />
        {unreadCount > 0 && (
          <span className={styles.badge}>
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className={styles.dropdown}>
          <div className={styles.header}>
            <span className={styles.title}>Notifications</span>
            {unreadCount > 0 && (
              <button className={styles.markAllBtn} onClick={handleMarkAllRead}>
                Mark all read
              </button>
            )}
          </div>

          <div className={styles.list}>
            {displayNotifications.length > 0 ? (
              displayNotifications.map(n => (
                <button
                  key={n.id}
                  className={`${styles.item} ${!n.read ? styles.itemUnread : ''}`}
                  onClick={() => handleItemClick(n)}
                >
                  {/* Only when the bell isn't already scoped to one league (e.g. the
                      /dashboard bell) — inside a league, the page itself already
                      says which one, the same way the inbox does. */}
                  {!leagueId && n.leagues?.name && (
                    <span className={`${styles.itemLeague} g-label-quiet`}>{n.leagues.name}</span>
                  )}
                  <div className={styles.itemHeader}>
                    <span className={styles.itemTitle}>{n.title}</span>
                    <span className={styles.itemTime}>{formatTime(n.created_at)}</span>
                  </div>
                  <p className={styles.itemContent}>
                    <FormattedText text={n.content} />
                  </p>
                </button>
              ))
            ) : (
              <div className={styles.empty}>
                <span className={styles.emptyTitle}>All caught up</span>
                <span className={styles.emptyText}>You don&apos;t have any notifications right now.</span>
              </div>
            )}
          </div>

          {inboxLeagueId && (
            <div className={styles.footer}>
              <Link
                href={`/league/${inboxLeagueId}/inbox`}
                className={styles.footerLink}
                onClick={() => {
                  setIsOpen(false);
                  if (onNavigate) onNavigate();
                }}
              >
                View All Inbox
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
