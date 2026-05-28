'use client';

import React, { useState, useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import styles from './sidebarChat.module.css';

interface Props {
  leagueId: string;
  currentUserId: string;
  currentUsername: string;
}

interface Message {
  id: string;
  sender_id: string;
  message: string;
  created_at: string;
}

interface ManagerInfo {
  name: string;
  initials: string;
  bg: string;
}

function getHslColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h = Math.abs(hash) % 360;
  return `linear-gradient(135deg, hsl(${h}, 50%, 45%), hsl(${(h + 40) % 360}, 55%, 35%))`;
}

export default function SidebarChat({
  leagueId,
  currentUserId,
  currentUsername
}: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [managers, setManagers] = useState<Record<string, ManagerInfo>>({});
  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [loading, setLoading] = useState(true);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const supabase = createClient();

  const scrollToBottom = (behavior: 'smooth' | 'auto' = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);

        // 1. Fetch all teams/members in this league to get usernames and logos
        const { data: teamsData } = await supabase
          .from('teams')
          .select('id, team_name, user_id, abbreviation, user:users(id, username, email)')
          .eq('league_id', leagueId);

        const m: Record<string, ManagerInfo> = {};
        for (const t of teamsData ?? []) {
          const userObj: any = Array.isArray(t.user) ? t.user[0] : t.user;
          const name = userObj?.username || userObj?.email?.split('@')[0] || 'Manager';
          const initials = t.abbreviation || name.substring(0, 2).toUpperCase();
          m[t.user_id] = {
            name,
            initials: initials.substring(0, 3),
            bg: getHslColor(t.id)
          };
        }
        setManagers(m);

        // 2. Fetch lobby messages (excluding DMs)
        const { data: msgsData } = await supabase
          .from('chat_messages')
          .select('id, sender_id, message, created_at')
          .eq('league_id', leagueId)
          .is('recipient_id', null)
          .order('created_at', { ascending: true })
          .limit(100);

        setMessages(msgsData ?? []);
      } catch (err) {
        console.error('Failed to load lobby chat logs:', err);
      } finally {
        setLoading(false);
        setTimeout(() => scrollToBottom('auto'), 100);
      }
    };

    fetchData();
  }, [leagueId, supabase]);

  // Connect to Supabase Realtime for Postgres Changes
  useEffect(() => {
    const channel = supabase
      .channel(`sidebar_lobby_chat:${leagueId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: `league_id=eq.${leagueId}`
        },
        (payload) => {
          const newMsg = payload.new as Message;
          // Ignore private DM messages in the public sidebar chat widget
          if ((newMsg as any).recipient_id !== null) return;

          setMessages((prev) => {
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [leagueId, supabase]);

  // Auto scroll on new messages
  useEffect(() => {
    scrollToBottom('smooth');
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || isSending) return;

    const messageText = inputValue.trim();
    setInputValue('');
    setIsSending(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leagueId,
          message: messageText,
          recipientId: null // Public lobby message
        })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.message) {
          setMessages((prev) => {
            if (prev.some((m) => m.id === data.message.id)) return prev;
            return [...prev, data.message];
          });
        }
      }
    } catch (err) {
      console.error('Failed to send lobby message:', err);
    } finally {
      setIsSending(false);
      setTimeout(() => scrollToBottom('smooth'), 50);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const formatMsgTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  };

  return (
    <div className={styles.chatContainer}>
      <header className={styles.chatHeader}>
        <h3 className={styles.chatTitle}>League Lobby Chat</h3>
        <span className={styles.chatSubtitle}>• public banter</span>
      </header>

      <div className={styles.messagesList} ref={listRef}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>
            Retrieving logs...
          </div>
        ) : messages.length > 0 ? (
          messages.map((m) => {
            const isSelf = m.sender_id === currentUserId;
            const manager = managers[m.sender_id] || {
              name: isSelf ? currentUsername : 'Manager',
              initials: isSelf ? currentUsername.substring(0, 2).toUpperCase() : 'M',
              bg: '#6b7280'
            };

            return (
              <div
                key={m.id}
                className={`${styles.msgRow} ${isSelf ? styles.msgRowSelf : ''}`}
              >
                {/* Fallback initials logo bubble */}
                <div className={styles.avatarBubble} style={{ background: manager.bg }}>
                  {manager.initials}
                </div>

                <div className={styles.bubbleWrap}>
                  <div className={`${styles.msgMeta} ${isSelf ? styles.msgMetaSelf : ''}`}>
                    <span className={styles.senderName}>{manager.name}</span>
                    <span className={styles.msgTime}>{formatMsgTime(m.created_at)}</span>
                  </div>
                  <div className={`${styles.msgText} ${isSelf ? styles.msgTextSelf : ''}`}>
                    {m.message}
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <div className={styles.emptyState}>
            <div className={styles.emptyTitle}>Lobby is Quiet</div>
            <p className={styles.emptyDesc}>
              Banter, draft strategies, or announcements start right here. Write the first message!
            </p>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className={styles.inputArea}>
        <form className={styles.form} onSubmit={handleSubmit}>
          <textarea
            className={styles.inputField}
            placeholder="Type a lobby message..."
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={loading}
          />
          <button
            className={styles.sendBtn}
            type="submit"
            disabled={!inputValue.trim() || isSending || loading}
          >
            {isSending ? '...' : 'Send'}
          </button>
        </form>
      </div>
    </div>
  );
}
