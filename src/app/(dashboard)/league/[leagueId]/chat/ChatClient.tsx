'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Icon } from '@/components/ui/Icon';
import FormattedText from '@/components/ui/FormattedText';
import CrestBadge from '@/components/crest/CrestBadge';
import TradeOfferCard, { type TradeSummary } from '@/components/chat/TradeOfferCard';
import LoanOfferCard, { type LoanSummary } from '@/components/chat/LoanOfferCard';
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
  crest_config?: any;
  user: UserInfo;
}

interface ChatMessage {
  id: string;
  league_id: string;
  sender_id: string | null;
  recipient_id: string | null;
  message: string;
  created_at: string;
  is_system?: boolean;
  trade_id?: string | null;
  loan_id?: string | null;
  sender?: UserInfo;
}

interface ChatClientProps {
  leagueId: string;
  leagueName: string;
  currentUserId: string;
  currentUsername: string;
  currentTeamId: string | null;
}

type TabState = 
  | { type: 'lobby' }
  | { type: 'dm'; userId: string; username: string; teamName: string };

export default function ChatClient({
  leagueId,
  leagueName,
  currentUserId,
  currentUsername,
  currentTeamId
}: ChatClientProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [teams, setTeams] = useState<TeamInfo[]>([]);
  const [trades, setTrades] = useState<Record<string, TradeSummary>>({});
  const [loans, setLoans] = useState<Record<string, LoanSummary>>({});
  const [activeTab, setActiveTab] = useState<TabState>({ type: 'lobby' });
  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [unreadDMs, setUnreadDMs] = useState<Set<string>>(new Set());
  const [mobileView, setMobileView] = useState<'list' | 'chat'>('list');

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
          setTrades(data.trades || {});
          setLoans(data.loans || {});
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

  // Seed unread DM dots from persisted read state so they survive a reload,
  // instead of only reflecting messages received live while this page is open.
  useEffect(() => {
    const fetchUnread = async () => {
      try {
        const res = await fetch(`/api/chat/unread?league_id=${leagueId}`);
        if (res.ok) {
          const data = await res.json();
          setUnreadDMs(new Set<string>(data.dmUnreadPeerIds || []));
        }
      } catch (err) {
        console.error('Failed to load chat unread summary:', err);
      }
    };
    fetchUnread();
  }, [leagueId]);

  // Persist a conversation as read-up-to-now (lobby, or a specific DM peer)
  const markRead = useCallback((peerId: string | null) => {
    fetch('/api/chat/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leagueId, peerId }),
    }).catch((err) => console.error('Failed to mark chat read:', err));
  }, [leagueId]);

  // Re-resolve live trade/loan negotiation summaries — called when a new
  // proposal message arrives (its trade_id/loan_id won't be in the map yet)
  // and after the viewer acts on a card, for an instant local reflection
  // ahead of the Realtime UPDATE below.
  const refreshNegotiations = useCallback(async () => {
    try {
      const res = await fetch(`/api/chat?league_id=${leagueId}`);
      if (res.ok) {
        const data = await res.json();
        setTrades(data.trades || {});
        setLoans(data.loans || {});
      }
    } catch (err) {
      console.error('Failed to refresh negotiation cards:', err);
    }
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

          // A proposal card for a trade/loan we haven't seen yet — resolve it
          // (name/status/etc.) since the map from initial load won't have it.
          if (newMsg.trade_id || newMsg.loan_id) {
            refreshNegotiations();
          }

          // Deduplicate
          setMessages((prev) => {
            if (prev.some((m) => m.id === newMsg.id)) return prev;

            // Enrich sender data (skip for system messages)
            const senderTeam = newMsg.sender_id ? teams.find((t) => t.user_id === newMsg.sender_id) : undefined;
            const enriched: ChatMessage = {
              ...newMsg,
              sender: newMsg.sender_id ? {
                id: newMsg.sender_id,
                username: senderTeam?.user?.username || (newMsg.sender_id === currentUserId ? currentUsername : 'Unknown Manager'),
                avatar_url: senderTeam?.user?.avatar_url || null
              } : undefined
            };

            // Set unread DM dots if sent to us and not currently focused;
            // otherwise (we're actively looking at this thread) keep the
            // persisted read cursor moving so it doesn't go stale on reload.
            if (newMsg.recipient_id === currentUserId && newMsg.sender_id) {
              const senderId = newMsg.sender_id;
              if (activeTab.type !== 'dm' || activeTab.userId !== senderId) {
                setUnreadDMs((prevSet) => {
                  const newSet = new Set(prevSet);
                  newSet.add(senderId);
                  return newSet;
                });
              } else {
                markRead(senderId);
              }
            } else if (newMsg.recipient_id === null && newMsg.sender_id !== currentUserId && activeTab.type === 'lobby') {
              markRead(null);
            }

            return [...prev, enriched];
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [leagueId, teams, activeTab, currentUserId, currentUsername, supabase, refreshNegotiations, markRead]);

  // Live-update trade/loan cards when the underlying deal is resolved —
  // whether that happens here in chat or elsewhere (the Deals page, another
  // tab). Only `status` (and a couple of terminal fields) can change after a
  // proposal is inserted, so a targeted merge is enough; no re-fetch needed.
  useEffect(() => {
    const channel = supabase
      .channel(`chat_negotiations:${leagueId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'trade_proposals', filter: `league_id=eq.${leagueId}` },
        (payload) => {
          const row = payload.new as { id: string; status: string };
          setTrades((prev) => (prev[row.id] ? { ...prev, [row.id]: { ...prev[row.id], status: row.status } } : prev));
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'player_loans', filter: `league_id=eq.${leagueId}` },
        (payload) => {
          const row = payload.new as { id: string; status: string };
          setLoans((prev) => (prev[row.id] ? { ...prev, [row.id]: { ...prev[row.id], status: row.status } } : prev));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [leagueId, supabase]);

  // Auto-scroll when new messages arrive or active tab changes
  useEffect(() => {
    scrollToBottom('smooth');
  }, [messages, activeTab]);

  // Mark the newly-focused conversation as read, both locally (clear the
  // sidebar dot) and persisted server-side (so the nav badge and a reload
  // both reflect it, not just this open tab).
  useEffect(() => {
    if (activeTab.type === 'dm') {
      setUnreadDMs((prev) => {
        const next = new Set(prev);
        next.delete(activeTab.userId);
        return next;
      });
      markRead(activeTab.userId);
    } else {
      markRead(null);
    }
  }, [activeTab, markRead]);

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

  // Most recent message timestamp per DM peer (either direction), so the
  // sidebar can order threads like a normal messaging app.
  const dmLastActivity = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of messages) {
      if (!m.recipient_id) continue; // lobby message, not a DM
      const peerId = m.sender_id === currentUserId ? m.recipient_id : m.recipient_id === currentUserId ? m.sender_id : null;
      if (!peerId) continue;
      const existing = map.get(peerId);
      if (!existing || m.created_at > existing) {
        map.set(peerId, m.created_at);
      }
    }
    return map;
  }, [messages, currentUserId]);

  // Filter out current user from managers DMs list, most recently active first;
  // managers with no message history yet fall to the bottom, alphabetically.
  const otherManagers = useMemo(() => {
    const others = teams.filter((t) => t.user_id !== currentUserId);
    return [...others].sort((a, b) => {
      const aTime = dmLastActivity.get(a.user_id);
      const bTime = dmLastActivity.get(b.user_id);
      if (aTime && bTime) return bTime.localeCompare(aTime);
      if (aTime) return -1;
      if (bTime) return 1;
      return a.team_name.localeCompare(b.team_name);
    });
  }, [teams, dmLastActivity, currentUserId]);

  return (
    <div className={`${styles.chatLayout} ${mobileView === 'chat' ? styles.mobileShowChat : styles.mobileShowList}`}>
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
              onClick={() => {
                setActiveTab({ type: 'lobby' });
                setMobileView('chat');
              }}
            >
              <Icon name="message-square" className={styles.icon} size={16} />
              <span style={{ flex: 1, fontWeight: activeTab.type === 'lobby' ? 'bold' : 'normal' }}>
                League lobby
              </span>
            </button>
          </div>

          {/* DMs Group */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>Direct messages</div>
            {otherManagers.length > 0 ? (
              otherManagers.map((team) => {
                const isActive = activeTab.type === 'dm' && activeTab.userId === team.user_id;
                const hasUnread = unreadDMs.has(team.user_id);

                return (
                  <button
                    key={team.user_id}
                    className={`${styles.sidebarBtn} ${isActive ? styles.sidebarBtnActive : ''} ${hasUnread && !isActive ? styles.sidebarBtnUnread : ''}`}
                    onClick={() => {
                      setActiveTab({
                        type: 'dm',
                        userId: team.user_id,
                        username: team.user.username,
                        teamName: team.team_name
                      });
                      setMobileView('chat');
                    }}
                  >
                    <span className={styles.managerAvatar}>
                      <CrestBadge config={team.crest_config} teamName={team.team_name} teamId={team.id} size={24} />
                    </span>
                    <div className={styles.managerInfo}>
                      <span className={styles.managerName}>{team.user.username}</span>
                      <span className={styles.managerTeam}>{team.team_name}</span>
                    </div>
                    {hasUnread && <span className={styles.managerDot} />}
                  </button>
                );
              })
            ) : (
              <div className={styles.sidebarEmpty}>
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
          {/* Back button (Mobile Only) */}
          <button
            className={styles.mobileBackBtn}
            onClick={() => setMobileView('list')}
            type="button"
            aria-label="Back to chats list"
          >
            <Icon name="chevron-left" size={18} strokeWidth={2.5} />
            <span>Chats</span>
          </button>

          <div className={styles.panelTitle}>
            {activeTab.type === 'lobby' ? (
              <>
                <Icon name="message-square" size={18} strokeWidth={2} />
                <span>League lobby</span>
                <span className={styles.panelSubtitle}>Public message board for everyone</span>
              </>
            ) : (
              <>
                <span className={styles.managerAvatar}>
                  <CrestBadge
                    config={teams.find((t) => t.user_id === activeTab.userId)?.crest_config}
                    teamName={activeTab.teamName}
                    teamId={teams.find((t) => t.user_id === activeTab.userId)?.id}
                    size={24}
                  />
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
            <div className={styles.feedStatus}>
              Retrieving logs...
            </div>
          ) : currentMessages.length > 0 ? (
            currentMessages.map((m) => {
              const isSelf = !m.is_system && m.sender_id === currentUserId;
              const senderName = m.sender?.username || 'Unknown';
              const teamInfo = teams.find((t) => t.user_id === m.sender_id);
              const teamLabel = teamInfo ? teamInfo.team_name : (isSelf ? 'My Club' : '');

              const isSystemAnnouncement = m.is_system === true;
              const trade = m.trade_id ? trades[m.trade_id] : undefined;
              const loan = m.loan_id ? loans[m.loan_id] : undefined;

              return (
                <div
                  key={m.id}
                  className={`${styles.msgRow} ${isSelf ? styles.msgRowSelf : ''} ${isSystemAnnouncement ? styles.msgRowSystem : ''}`}
                >
                  {/* Sender Avatar */}
                  {isSystemAnnouncement ? (
                    <div className={`${styles.msgAvatar} ${styles.msgAvatarSystem}`}>
                      <Icon name="trophy" size={16} />
                    </div>
                  ) : (
                    <div className={styles.msgAvatar}>
                      <CrestBadge config={teamInfo?.crest_config} teamName={teamLabel || senderName} teamId={teamInfo?.id} size={30} />
                    </div>
                  )}

                  {/* Message Bubble & Meta */}
                  <div className={styles.msgBubble}>
                    {isSystemAnnouncement ? (
                      <div className={styles.msgMeta}>
                        <span className={styles.msgSenderSystem}>Gaffa</span>
                        <span className={styles.msgTime}>{formatMsgTime(m.created_at)}</span>
                      </div>
                    ) : (
                      <div className={`${styles.msgMeta} ${isSelf ? styles.msgMetaSelf : ''}`}>
                        <span className={styles.msgSender}>{senderName}</span>
                        {teamLabel && <span className={styles.msgTeam}>({teamLabel})</span>}
                        <span className={styles.msgTime}>{formatMsgTime(m.created_at)}</span>
                      </div>
                    )}

                    {trade ? (
                      <TradeOfferCard trade={trade} leagueId={leagueId} currentTeamId={currentTeamId} onActionComplete={refreshNegotiations} />
                    ) : loan ? (
                      <LoanOfferCard loan={loan} leagueId={leagueId} currentTeamId={currentTeamId} onActionComplete={refreshNegotiations} />
                    ) : (
                      <div
                        className={`
                          ${styles.msgTextCard} 
                          ${isSelf ? styles.msgTextCardSelf : ''} 
                          ${m.recipient_id ? styles.msgTextCardDM : ''}
                          ${isSystemAnnouncement ? styles.msgTextCardSystem : ''}
                        `}
                      >
                        <FormattedText
                          text={
                            isSystemAnnouncement
                              ? m.message.replace(/^(?:📢\s*)?\[SYSTEM:ANNOUNCEMENT\]\s*/i, '').replace(/^📢\s*/, '')
                              : m.message
                          }
                        />
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          ) : (
            <div className={styles.emptyState}>
              <div className={styles.emptyTitle}>
                {activeTab.type === 'lobby' ? 'Start the conversation' : `Message ${activeTab.username}`}
              </div>
              <p className={styles.emptyDesc}>
                {activeTab.type === 'lobby'
                  ? 'Welcome to the League lobby. Share draft strategies, make roster announcements, or engage in friendly banter.'
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
                    ? 'Type a message to the League lobby…'
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
