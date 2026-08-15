'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Icon } from '@/components/ui/Icon';
import topBarStyles from './TopBar.module.css';
import styles from './ChatNavIcon.module.css';

interface ChatNavIconProps {
  leagueId: string;
  onNavigate?: () => void;
}

interface UnreadSummary {
  lobbyUnread: boolean;
  dmUnreadPeerIds: string[];
}

export default function ChatNavIcon({ leagueId, onNavigate }: ChatNavIconProps) {
  const pathname = usePathname();
  const [summary, setSummary] = useState<UnreadSummary>({ lobbyUnread: false, dmUnreadPeerIds: [] });
  const supabase = createClient();

  const fetchUnread = useCallback(async () => {
    try {
      const res = await fetch(`/api/chat/unread?league_id=${leagueId}`);
      if (res.ok) {
        const data = await res.json();
        setSummary({
          lobbyUnread: !!data.lobbyUnread,
          dmUnreadPeerIds: data.dmUnreadPeerIds || [],
        });
      }
    } catch (err) {
      console.error('Failed to fetch chat unread summary:', err);
    }
  }, [leagueId]);

  // Re-check on mount/league change and on every route change (the cheapest
  // shared signal that the chat page might have just marked something read),
  // plus a 60s poll as a fallback for changes from elsewhere.
  useEffect(() => {
    fetchUnread();
  }, [pathname, fetchUnread]);

  useEffect(() => {
    const interval = setInterval(fetchUnread, 60000);
    return () => clearInterval(interval);
  }, [fetchUnread]);

  // Instant badge on new messages, rather than waiting up to 60s for the next poll
  useEffect(() => {
    let currentUserId: string | null = null;

    supabase.auth.getUser().then(({ data }) => {
      currentUserId = data.user?.id ?? null;
    });

    const channel = supabase
      .channel(`chat_nav_icon:${leagueId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `league_id=eq.${leagueId}` },
        (payload) => {
          const msg = payload.new as { sender_id: string | null; recipient_id: string | null };
          if (msg.sender_id === currentUserId) return; // your own message is never unread for you
          if (msg.recipient_id === null) {
            setSummary((prev) => ({ ...prev, lobbyUnread: true }));
          } else if (currentUserId && msg.recipient_id === currentUserId && msg.sender_id) {
            const senderId = msg.sender_id;
            setSummary((prev) =>
              prev.dmUnreadPeerIds.includes(senderId)
                ? prev
                : { ...prev, dmUnreadPeerIds: [...prev.dmUnreadPeerIds, senderId] }
            );
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  const hasUnread = summary.lobbyUnread || summary.dmUnreadPeerIds.length > 0;
  const isActive = pathname?.startsWith(`/league/${leagueId}/chat`);

  return (
    <div className={styles.container}>
      <Link
        href={`/league/${leagueId}/chat`}
        className={`${topBarStyles.iconBtn} ${isActive ? topBarStyles.iconBtnActive : ''}`}
        title="League chat lobby"
        aria-label="League chat lobby"
        onClick={() => onNavigate?.()}
      >
        <Icon name="message-square" size={18} strokeWidth={1.5} />
        {hasUnread && <span className={styles.dot} />}
      </Link>
    </div>
  );
}
