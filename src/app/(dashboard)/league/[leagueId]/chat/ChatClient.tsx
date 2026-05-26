'use client';

import React, { useState, useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Icon } from '@/components/ui/Icon';
import styles from './Chat.module.css';

interface UserInfo {
  id: string;
  username: string;
  avatar_url: string | null;
}

interface TeamInfo {
  id: string;
  team_name: string;
  user_id: string;
  user: UserInfo;
}

interface ChatMessage {
  id: string;
  league_id: string;
  sender_id: string;
  recipient_id: string | null;
  message: string;
  created_at: string;
  sender?: UserInfo;
}

interface ChatClientProps {
  leagueId: string;
  leagueName: string;
  currentUserId: string;
  currentUsername: string;
}

type TabState = 
  | { type: 'lobby' }
  | { type: 'dm'; userId: string; username: string; teamName: string };

export default function ChatClient({
  leagueId,
  leagueName,
  currentUserId,
  currentUsername
}: ChatClientProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [teams, setTeams] = useState<TeamInfo[]>([]);
  const [activeTab, setActiveTab] = useState<TabState>({ type: 'lobby' });
  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [unreadDMs, setUnreadDMs] = useState<Set<string>>(new Set());

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const supabase = createClient();

  // Scroll to bottom helper
  const scrollToBottom = (behavior: 'smooth' | 'auto' = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  };

  // Fetch initial logs on mount
  useEffect(() => {
    const fetchLogs = async () => {
      try {
        setLoading(true);
        const res = await fetch(`/api/chat?league_id=${leagueId}`);
        if (res.ok) {
          const data = await res.json();
          setMessages(data.messages || []);
          setTeams(data.teams || []);
        }
      } catch (err) {
        console.error('Failed to load chat logs:', err);
      } finally {
        setLoading(false);
        setTimeout(() => scrollToBottom('auto'), 100);
      }
    };

    fetchLogs();
  }, [leagueId]);

  // Connect to Supabase Realtime
  useEffect(() => {
    const channel = supabase
      .channel(`chat_messages:${leagueId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: `league_id=eq.${leagueId}`
        },
        (payload) => {
          const newMsg = payload.new as ChatMessage;

          // Deduplicate
          setMessages((prev) => {
            if (prev.some((m) => m.id === newMsg.id)) return prev;

            // Enrich sender data
            const senderTeam = teams.find((t) => t.user_id === newMsg.sender_id);
            const enriched: ChatMessage = {
              ...newMsg,
              sender: {
                id: newMsg.sender_id,
                username: senderTeam?.user?.username || (newMsg.sender_id === currentUserId ? currentUsername : 'Unknown Manager'),
                avatar_url: senderTeam?.user?.avatar_url || null
              }
            };

            // Set unread DM dots if sent to us and not currently focused
            if (newMsg.recipient_id === currentUserId) {
              const senderId = newMsg.sender_id;
              if (activeTab.type !== 'dm' || activeTab.userId !== senderId) {
                setUnreadDMs((prevSet) => {
                  const newSet = new Set(prevSet);
                  newSet.add(senderId);
                  return newSet;
                });
              }
            }

            return [...prev, enriched];
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [leagueId, teams, activeTab, currentUserId, currentUsername, supabase]);

  // Auto-scroll when new messages arrive or active tab changes
  useEffect(() => {
    scrollToBottom('smooth');
  }, [messages, activeTab]);

  // Clear unread indicator when selecting a DM
  useEffect(() => {
    if (activeTab.type === 'dm') {
      setUnreadDMs((prev) => {
        const next = new Set(prev);
        next.delete(activeTab.userId);
        return next;
      });
    }
  }, [activeTab]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || isSending) return;

    const messageText = inputValue.trim();
    setInputValue('');
    setIsSending(true);

    const recipientId = activeTab.type === 'dm' ? activeTab.userId : null;

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leagueId,
          message: messageText,
          recipientId
        })
      });

      if (res.ok) {
        const data = await res.json();
        // Append locally if not already appended by Realtime subscription
        if (data.message) {
          setMessages((prev) => {
            if (prev.some((m) => m.id === data.message.id)) return prev;
            return [...prev, data.message];
          });
        }
      }
    } catch (err) {
      console.error('Failed to send chat message:', err);
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

  // Filter messages for current thread view
  const currentMessages = messages.filter((m) => {
    if (activeTab.type === 'lobby') {
      return m.recipient_id === null;
    } else {
      // DM: between current user and activeTab.userId
      return (
        (m.sender_id === currentUserId && m.recipient_id === activeTab.userId) ||
        (m.sender_id === activeTab.userId && m.recipient_id === currentUserId)
      );
    }
  });

  // Filter out current user from managers DMs list
  const otherManagers = teams.filter((t) => t.user_id !== currentUserId);

  return (
    <div className={styles.chatLayout}>
      {/* Sidebar: Channels & Managers */}
      <aside className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <div className={styles.leagueNameTitle}>{leagueName}</div>
        </div>

        <div className={styles.sidebarContent}>
          {/* Public Channels Group */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>Channels</div>
            <button
              className={`${styles.sidebarBtn} ${activeTab.type === 'lobby' ? styles.sidebarBtnActive : ''}`}
              onClick={() => setActiveTab({ type: 'lobby' })}
            >
              <Icon name="message-square" className={styles.icon} size={16} />
              <span style={{ flex: 1, fontWeight: activeTab.type === 'lobby' ? 'bold' : 'normal' }}>
                📢 league-lobby
              </span>
            </button>
          </div>

          {/* DMs Group */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>Direct Messages</div>
            {otherManagers.length > 0 ? (
              otherManagers.map((team) => {
                const isActive = activeTab.type === 'dm' && activeTab.userId === team.user_id;
                const hasUnread = unreadDMs.has(team.user_id);
                const managerInitial = team.user.username ? team.user.username[0].toUpperCase() : '?';

                return (
                  <button
                    key={team.user_id}
                    className={`${styles.sidebarBtn} ${isActive ? styles.sidebarBtnActive : ''}`}
                    onClick={() =>
                      setActiveTab({
                        type: 'dm',
                        userId: team.user_id,
                        username: team.user.username,
                        teamName: team.team_name
                      })
                    }
                  >
                    <span className={styles.managerAvatar}>{managerInitial}</span>
                    <div className={styles.managerInfo}>
                      <span className={styles.managerName}>{team.user.username}</span>
                      <span className={styles.managerTeam}>{team.team_name}</span>
                    </div>
                    {hasUnread && <span className={styles.managerDot} />}
                  </button>
                );
              })
            ) : (
              <div style={{ padding: '0 20px', fontSize: '12px', color: 'var(--color-text-muted)' }}>
                No other managers found
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main Conversation Feed */}
      <section className={styles.mainPanel}>
        {/* Thread Header */}
        <header className={styles.panelHeader}>
          <div className={styles.panelTitle}>
            {activeTab.type === 'lobby' ? (
              <>
                <Icon name="message-square" size={18} strokeWidth={2} />
                <span>league-lobby</span>
                <span className={styles.panelSubtitle}>Public message board for everyone</span>
              </>
            ) : (
              <>
                <span className={styles.managerAvatar}>
                  {activeTab.username ? activeTab.username[0].toUpperCase() : '?'}
                </span>
                <span>{activeTab.username}</span>
                <span className={styles.panelSubtitle}>({activeTab.teamName}) — Private DM</span>
              </>
            )}
          </div>
        </header>

        {/* Message Log */}
        <div className={styles.messagesFeed} ref={feedRef}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--color-text-muted)' }}>
              Retrieving logs...
            </div>
          ) : currentMessages.length > 0 ? (
            currentMessages.map((m) => {
              const isSelf = m.sender_id === currentUserId;
              const senderName = m.sender?.username || 'Unknown';
              const teamInfo = teams.find((t) => t.user_id === m.sender_id);
              const teamLabel = teamInfo ? teamInfo.team_name : (isSelf ? 'My Club' : '');
              const initial = senderName ? senderName[0].toUpperCase() : '?';

              return (
                <div
                  key={m.id}
                  className={`${styles.msgRow} ${isSelf ? styles.msgRowSelf : ''}`}
                >
                  {/* Sender Avatar */}
                  <div className={`${styles.msgAvatar} ${isSelf ? styles.msgAvatarSelf : ''}`}>
                    {initial}
                  </div>

                  {/* Message Bubble & Meta */}
                  <div className={styles.msgBubble}>
                    <div className={`${styles.msgMeta} ${isSelf ? styles.msgMetaSelf : ''}`}>
                      <span className={styles.msgSender}>{senderName}</span>
                      {teamLabel && <span className={styles.msgTeam}>({teamLabel})</span>}
                      <span className={styles.msgTime}>{formatMsgTime(m.created_at)}</span>
                    </div>

                    <div
                      className={`
                        ${styles.msgTextCard} 
                        ${isSelf ? styles.msgTextCardSelf : ''} 
                        ${m.recipient_id ? styles.msgTextCardDM : ''}
                      `}
                    >
                      {m.message}
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <div className={styles.emptyState}>
              <div className={styles.emptyTitle}>
                {activeTab.type === 'lobby' ? 'Start the Conversation!' : `Message ${activeTab.username}`}
              </div>
              <p className={styles.emptyDesc}>
                {activeTab.type === 'lobby'
                  ? 'Welcome to the league lobby. Share draft strategies, make roster announcements, or engage in friendly banter.'
                  : `Send a direct, private message to ${activeTab.username}. Private messages are highly encrypted and visible only to the two of you.`}
              </p>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Text Input Area */}
        <div className={styles.inputArea}>
          <form className={styles.form} onSubmit={handleSubmit}>
            <div className={styles.textareaWrapper}>
              <textarea
                className={styles.inputField}
                placeholder={
                  activeTab.type === 'lobby'
                    ? 'Type a message to the league lobby...'
                    : `Send a private message to ${activeTab.username}...`
                }
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
                disabled={loading}
              />
            </div>
            <button
              className={styles.sendBtn}
              type="submit"
              disabled={!inputValue.trim() || isSending || loading}
            >
              {isSending ? 'Sending...' : 'Send'}
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
