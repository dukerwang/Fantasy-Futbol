'use client';

import React, { useState, useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import FormattedText from '@/components/ui/FormattedText';
import CrestBadge from '@/components/crest/CrestBadge';
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
  teamName: string;
  teamId?: string;
  crestConfig: any;
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

        const res = await fetch(`/api/chat?league_id=${leagueId}`);
        if (!res.ok) {
          throw new Error(`Failed to fetch: ${res.status}`);
        }
        const data = await res.json();

        const m: Record<string, ManagerInfo> = {};
        for (const t of data.teams ?? []) {
          const userObj: any = Array.isArray(t.user) ? t.user[0] : t.user;
          const name = userObj?.username || userObj?.email?.split('@')[0] || 'Manager';
          m[t.user_id] = {
            name,
            teamName: t.team_name,
            teamId: t.id,
            crestConfig: t.crest_config
          };
        }
        setManagers(m);

        // Filter for public lobby messages (where recipient_id === null)
        const lobbyMsgs = (data.messages ?? []).filter((msg: any) => msg.recipient_id === null);
        setMessages(lobbyMsgs);
      } catch (err) {
        console.error('Failed to load lobby chat logs:', err);
      } finally {
        setLoading(false);
        setTimeout(() => scrollToBottom('auto'), 100);
      }
    };

    fetchData();
  }, [leagueId]);

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
        <h3 className={styles.chatTitle}>League Lobby</h3>
        <span className={styles.chatSubtitle}>• public banter</span>
      </header>

      <div className={styles.messagesList} ref={listRef}>
        {loading ? (
          <div className={styles.loadingStatus}>
            Retrieving logs...
          </div>
        ) : messages.length > 0 ? (
          messages.map((m) => {
            const isSelf = m.sender_id === currentUserId;
            const manager = managers[m.sender_id] || {
              name: isSelf ? currentUsername : 'Manager',
              teamName: isSelf ? currentUsername : 'Manager',
              crestConfig: null
            };

            return (
              <div
                key={m.id}
                className={`${styles.msgRow} ${isSelf ? styles.msgRowSelf : ''}`}
              >
                <div className={styles.avatarBubble}>
                  <CrestBadge config={manager.crestConfig} teamName={manager.teamName} teamId={manager.teamId} size={26} />
                </div>

                <div className={styles.bubbleWrap}>
                  <div className={`${styles.msgMeta} ${isSelf ? styles.msgMetaSelf : ''}`}>
                    <span className={styles.senderName}>{manager.name}</span>
                    <span className={styles.msgTime}>{formatMsgTime(m.created_at)}</span>
                  </div>
                  <div className={`${styles.msgText} ${isSelf ? styles.msgTextSelf : ''}`}>
                    <FormattedText text={m.message} />
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <div className={styles.emptyState}>
            <div className={styles.emptyTitle}>Lobby is quiet</div>
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
            placeholder="Type a message to the League lobby…"
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
