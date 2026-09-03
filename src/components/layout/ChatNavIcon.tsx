'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Icon } from '@/components/ui/Icon';
import { useLeagueChat } from '@/components/chat/LeagueChatContext';
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
  const chatContext = useLeagueChat();
  const setUnreadSummary = chatContext?.setUnreadSummary;
  const setUnreadSummaryRef = useRef(setUnreadSummary);
  useEffect(() => {
    setUnreadSummaryRef.current = setUnreadSummary;
  }, [setUnreadSummary]);

  const [summary, setSummary] = useState<UnreadSummary>({ lobbyUnread: false, dmUnreadPeerIds: [] });
  const supabase = createClient();
  const isFetchingRef = useRef(false);
  const lastFetchedRef = useRef(0);

  const fetchUnread = useCallback(async () => {
    if (!leagueId) return;
    const now = Date.now();
    // Throttle: never fetch more than once every 5 seconds and prevent overlapping requests
    if (isFetchingRef.current || now - lastFetchedRef.current < 5000) return;
    isFetchingRef.current = true;
    lastFetchedRef.current = now;

    try {
      const res = await fetch(`/api/chat/unread?league_id=${leagueId}`);
      if (res.ok) {
        const data = await res.json();
        const unreadData = {
          lobbyUnread: !!data.lobbyUnread,
          dmUnreadPeerIds: data.dmUnreadPeerIds || [],
        };
        setSummary(unreadData);
        setUnreadSummaryRef.current?.(unreadData);
      }
    } catch (err) {
      console.error('Failed to fetch chat unread summary:', err);
    } finally {
      isFetchingRef.current = false;
    }
  }, [leagueId]);

  // Fetch on mount / league change, or when tab regains visibility
  useEffect(() => {
    fetchUnread();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchUnread();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchUnread]);

  // Instant badge on new messages, rather than waiting for next poll
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
            setSummary((prev) => {
              const updated = { ...prev, lobbyUnread: true };
              setUnreadSummaryRef.current?.(updated);
              return updated;
            });
          } else if (currentUserId && msg.recipient_id === currentUserId && msg.sender_id) {
            const senderId = msg.sender_id;
            setSummary((prev) => {
              const updated = prev.dmUnreadPeerIds.includes(senderId)
                ? prev
                : { ...prev, dmUnreadPeerIds: [...prev.dmUnreadPeerIds, senderId] };
              setUnreadSummaryRef.current?.(updated);
              return updated;
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [leagueId, supabase]);

  // Sync with chatContext if it updates unreadSummary
  const effectiveSummary = chatContext ? chatContext.unreadSummary : summary;
  const hasUnread = effectiveSummary.lobbyUnread || effectiveSummary.dmUnreadPeerIds.length > 0;
  const isChatPage = pathname?.startsWith(`/league/${leagueId}/chat`);
  const isWidgetOpen = chatContext?.isOpen && !chatContext?.isMinimized;

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    // If user holds cmd/ctrl/shift, allow default link behavior to open in new tab
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      return;
    }

    // If already on the dedicated chat page, navigate normally
    if (isChatPage) {
      onNavigate?.();
      return;
    }

    // If chat context is available on-screen, toggle the widget without page transition!
    if (chatContext) {
      e.preventDefault();
      chatContext.toggleChat();
    } else {
      onNavigate?.();
    }
  };

  return (
    <div className={styles.container}>
      <Link
        href={`/league/${leagueId}/chat`}
        className={`${topBarStyles.iconBtn} ${isChatPage || isWidgetOpen ? topBarStyles.iconBtnActive : ''}`}
        title={isChatPage ? 'League chat' : isWidgetOpen ? 'Close chat' : 'Open chat'}
        aria-label="League chat"
        onClick={handleClick}
      >
        <Icon name="message-square" size={18} strokeWidth={1.5} />
        {hasUnread && <span className={styles.dot} />}
      </Link>
    </div>
  );
}
