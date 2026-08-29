'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Icon } from '@/components/ui/Icon';
import FormattedText from '@/components/ui/FormattedText';
import CrestBadge from '@/components/crest/CrestBadge';
import TradeOfferCard, { type TradeSummary } from '@/components/chat/TradeOfferCard';
import LoanOfferCard, { type LoanSummary } from '@/components/chat/LoanOfferCard';
import { useLeagueChat, type ChatTabState } from './LeagueChatContext';
import styles from './LeagueChatWidget.module.css';

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

export default function LeagueChatWidget() {
  const chatContext = useLeagueChat();

  if (!chatContext || !chatContext.leagueId) return null;

  return <LeagueChatWidgetContent {...chatContext} leagueId={chatContext.leagueId} />;
}

function LeagueChatWidgetContent({
  leagueId,
  isOpen,
  isMinimized,
  activeTab,
  unreadSummary,
  openChat,
  closeChat,
  minimizeChat,
  restoreChat,
  setActiveTab,
  setUnreadSummary,
}: ReturnType<typeof useLeagueChat> & NonNullable<ReturnType<typeof useLeagueChat>>) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [teams, setTeams] = useState<TeamInfo[]>([]);
  const [trades, setTrades] = useState<Record<string, TradeSummary>>({});
  const [loans, setLoans] = useState<Record<string, LoanSummary>>({});
  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUsername, setCurrentUsername] = useState<string>('Manager');
  const [currentTeamId, setCurrentTeamId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'chat' | 'channels'>('chat');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const supabase = createClient();

  const scrollToBottom = (behavior: 'smooth' | 'auto' = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  };

  // Fetch current user
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      setCurrentUserId(user.id);
      supabase
        .from('users')
        .select('username')
        .eq('id', user.id)
        .single()
        .then(({ data }) => {
          if (data?.username) setCurrentUsername(data.username);
        });
    });
  }, [supabase]);

  // Initial fetch of logs when opened or leagueId changes
  useEffect(() => {
    if (!isOpen && !isMinimized) return;

    let isMounted = true;
    const fetchLogs = async () => {
      try {
        setLoading(true);
        const res = await fetch(`/api/chat?league_id=${leagueId}`);
        if (res.ok && isMounted) {
          const data = await res.json();
          setMessages(data.messages || []);
          setTeams(data.teams || []);
          setTrades(data.trades || {});
          setLoans(data.loans || {});

          if (currentUserId && data.teams) {
            const myTeam = data.teams.find((t: TeamInfo) => t.user_id === currentUserId);
            if (myTeam) setCurrentTeamId(myTeam.id);
          }
        }
      } catch (err) {
        console.error('Failed to load chat logs for widget:', err);
      } finally {
        if (isMounted) {
          setLoading(false);
          setTimeout(() => scrollToBottom('auto'), 80);
        }
      }
    };

    fetchLogs();

    return () => {
      isMounted = false;
    };
  }, [leagueId, isOpen, isMinimized, currentUserId]);

  // Sync initial unread state
  useEffect(() => {
    const fetchUnread = async () => {
      try {
        const res = await fetch(`/api/chat/unread?league_id=${leagueId}`);
        if (res.ok) {
          const data = await res.json();
          setUnreadSummary({
            lobbyUnread: !!data.lobbyUnread,
            dmUnreadPeerIds: data.dmUnreadPeerIds || [],
          });
        }
      } catch (err) {
        console.error('Failed to fetch unread summary in widget:', err);
      }
    };
    fetchUnread();
  }, [leagueId, setUnreadSummary]);

  // Mark conversation read helper
  const markRead = useCallback(
    (peerId: string | null) => {
      fetch('/api/chat/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId, peerId }),
      }).catch((err) => console.error('Failed to mark chat read:', err));
    },
    [leagueId]
  );

  // Refresh negotiations (trade/loan cards)
  const refreshNegotiations = useCallback(async () => {
    try {
      const res = await fetch(`/api/chat?league_id=${leagueId}`);
      if (res.ok) {
        const data = await res.json();
        setTrades(data.trades || {});
        setLoans(data.loans || {});
      }
    } catch (err) {
      console.error('Failed to refresh negotiation cards in widget:', err);
    }
  }, [leagueId]);

  // Supabase Realtime for Messages
  useEffect(() => {
    if (!leagueId) return;

    const channel = supabase
      .channel(`widget_chat_messages:${leagueId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: `league_id=eq.${leagueId}`,
        },
        (payload) => {
          const newMsg = payload.new as ChatMessage;

          if (newMsg.trade_id || newMsg.loan_id) {
            refreshNegotiations();
          }

          setMessages((prev) => {
            if (prev.some((m) => m.id === newMsg.id)) return prev;

            const senderTeam = newMsg.sender_id ? teams.find((t) => t.user_id === newMsg.sender_id) : undefined;
            const enriched: ChatMessage = {
              ...newMsg,
              sender: newMsg.sender_id
                ? {
                    id: newMsg.sender_id,
                    username:
                      senderTeam?.user?.username ||
                      (newMsg.sender_id === currentUserId ? currentUsername : 'Unknown Manager'),
                    avatar_url: senderTeam?.user?.avatar_url || null,
                  }
                : undefined,
            };

            // Manage unread state
            if (newMsg.recipient_id === currentUserId && newMsg.sender_id) {
              const senderId = newMsg.sender_id;
              if (!isOpen || activeTab.type !== 'dm' || activeTab.userId !== senderId) {
                setUnreadSummary((prevSummary) => ({
                  ...prevSummary,
                  dmUnreadPeerIds: prevSummary.dmUnreadPeerIds.includes(senderId)
                    ? prevSummary.dmUnreadPeerIds
                    : [...prevSummary.dmUnreadPeerIds, senderId],
                }));
              } else {
                markRead(senderId);
              }
            } else if (newMsg.recipient_id === null && newMsg.sender_id !== currentUserId) {
              if (!isOpen || activeTab.type !== 'lobby') {
                setUnreadSummary((prevSummary) => ({ ...prevSummary, lobbyUnread: true }));
              } else {
                markRead(null);
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
  }, [
    leagueId,
    teams,
    activeTab,
    currentUserId,
    currentUsername,
    isOpen,
    supabase,
    refreshNegotiations,
    markRead,
    setUnreadSummary,
  ]);

  // Realtime for negotiations (trade_proposals, player_loans)
  useEffect(() => {
    if (!leagueId) return;

    const channel = supabase
      .channel(`widget_chat_negotiations:${leagueId}`)
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

  // Auto-scroll on new messages or tab change
  useEffect(() => {
    if (isOpen && !isMinimized && viewMode === 'chat') {
      scrollToBottom('smooth');
    }
  }, [messages, activeTab, isOpen, isMinimized, viewMode]);

  // Switch to chat thread view whenever activeTab changes (e.g. from OpponentCard "Message @manager" or DM selection)
  useEffect(() => {
    if (activeTab) {
      setViewMode('chat');
    }
  }, [activeTab]);

  // Mark active tab as read when open
  useEffect(() => {
    if (!isOpen || isMinimized) return;

    if (activeTab.type === 'dm') {
      setUnreadSummary((prev) => ({
        ...prev,
        dmUnreadPeerIds: prev.dmUnreadPeerIds.filter((id) => id !== activeTab.userId),
      }));
      markRead(activeTab.userId);
    } else {
      setUnreadSummary((prev) => ({ ...prev, lobbyUnread: false }));
      markRead(null);
    }
  }, [activeTab, isOpen, isMinimized, markRead, setUnreadSummary]);

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
          recipientId,
        }),
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
      console.error('Failed to send chat message in widget:', err);
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
      hour12: true,
    });
  };

  // Filter messages for current tab
  const currentMessages = useMemo(() => {
    return messages.filter((m) => {
      if (activeTab.type === 'lobby') {
        return m.recipient_id === null;
      } else {
        return (
          (m.sender_id === currentUserId && m.recipient_id === activeTab.userId) ||
          (m.sender_id === activeTab.userId && m.recipient_id === currentUserId)
        );
      }
    });
  }, [messages, activeTab, currentUserId]);

  // DM peers activity sorting
  const dmLastActivity = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of messages) {
      if (!m.recipient_id) continue;
      const peerId =
        m.sender_id === currentUserId ? m.recipient_id : m.recipient_id === currentUserId ? m.sender_id : null;
      if (!peerId) continue;
      const existing = map.get(peerId);
      if (!existing || m.created_at > existing) {
        map.set(peerId, m.created_at);
      }
    }
    return map;
  }, [messages, currentUserId]);

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

  const hasAnyUnread = unreadSummary.lobbyUnread || unreadSummary.dmUnreadPeerIds.length > 0;

  // Render Minimized Pill
  if (isMinimized) {
    const activeLabel =
      activeTab.type === 'lobby'
        ? 'League Lobby'
        : `@${activeTab.username}`;

    return (
      <div className={styles.minimizedPill} onClick={restoreChat} role="button" tabIndex={0}>
        <Icon name="message-square" size={16} strokeWidth={2} />
        <span className={styles.minimizedLabel}>{activeLabel}</span>
        {hasAnyUnread && <span className={styles.minimizedUnreadDot} />}
        <button
          className={styles.minimizedCloseBtn}
          type="button"
          aria-label="Dismiss chat"
          onClick={(e) => {
            e.stopPropagation();
            closeChat();
          }}
        >
          <Icon name="x" size={12} strokeWidth={2.5} />
        </button>
      </div>
    );
  }

  if (!isOpen) return null;

  return (
    <>
      {/* Mobile backdrop tap to close */}
      <div className={styles.backdrop} onClick={closeChat} />

      <aside className={styles.widgetContainer} aria-label="League chat overlay">
        {/* Header */}
        <header className={styles.widgetHeader}>
          <div className={styles.headerLeft}>
            {viewMode === 'chat' ? (
              <button
                className={styles.headerBackBtn}
                type="button"
                onClick={() => setViewMode('channels')}
                aria-label="View all channels"
                title="View all channels"
              >
                <Icon name="chevron-left" size={16} strokeWidth={2.5} />
                <span>Chats</span>
              </button>
            ) : (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <Icon name="message-square" size={16} strokeWidth={2} />
                <span className={styles.headerTitle}>Chats</span>
              </span>
            )}

            {viewMode === 'chat' && (
              <div className={styles.headerTitleWrapper}>
                {activeTab.type === 'lobby' ? (
                  <>
                    <Icon name="message-square" size={15} strokeWidth={2} />
                    <span className={styles.headerTitle}>League Lobby</span>
                  </>
                ) : (
                  <>
                    <span className={styles.channelItemAvatar}>
                      <CrestBadge
                        config={teams.find((t) => t.user_id === activeTab.userId)?.crest_config}
                        teamName={activeTab.teamName}
                        teamId={teams.find((t) => t.user_id === activeTab.userId)?.id}
                        size={22}
                      />
                    </span>
                    <span className={styles.headerTitle}>{activeTab.username}</span>
                    <span className={styles.headerSubtitle}>({activeTab.teamName})</span>
                  </>
                )}
              </div>
            )}
          </div>

          <div className={styles.headerRightActions}>
            {/* Direct link to dedicated full chat page */}
            <Link
              href={`/league/${leagueId}/chat`}
              className={styles.headerActionBtn}
              title="Open full chat page"
              aria-label="Open full chat page"
              onClick={closeChat}
            >
              <Icon name="external-link" size={15} strokeWidth={2} />
            </Link>

            {/* Minimize button */}
            <button
              className={styles.headerActionBtn}
              type="button"
              title="Minimize chat"
              aria-label="Minimize chat"
              onClick={minimizeChat}
            >
              <Icon name="minus" size={16} strokeWidth={2.5} />
            </button>

            {/* Close / Dismiss button */}
            <button
              className={styles.headerActionBtn}
              type="button"
              title="Close chat"
              aria-label="Close chat"
              onClick={closeChat}
            >
              <Icon name="x" size={16} strokeWidth={2.5} />
            </button>
          </div>
        </header>

        {/* Channel Switcher Tab Bar (when in Chat mode on Desktop) */}
        {viewMode === 'chat' && (
          <div className={styles.channelTabBar}>
            <button
              type="button"
              className={`${styles.tabBtn} ${activeTab.type === 'lobby' ? styles.tabBtnActive : ''}`}
              onClick={() => setActiveTab({ type: 'lobby' })}
            >
              <Icon name="message-square" size={13} strokeWidth={2} />
              <span>Lobby</span>
              {unreadSummary.lobbyUnread && activeTab.type !== 'lobby' && <span className={styles.tabBadge} />}
            </button>

            <button
              type="button"
              className={`${styles.tabBtn} ${activeTab.type === 'dm' ? styles.tabBtnActive : ''}`}
              onClick={() => setViewMode('channels')}
            >
              <Icon name="users" size={13} strokeWidth={2} />
              <span>
                {activeTab.type === 'dm' ? `@${activeTab.username}` : 'Direct Messages'}
              </span>
              {unreadSummary.dmUnreadPeerIds.length > 0 && <span className={styles.tabBadge} />}
            </button>
          </div>
        )}

        {/* View Mode: Channel List */}
        {viewMode === 'channels' ? (
          <div className={styles.channelListView}>
            {/* Lobby Section */}
            <div className={styles.channelSection}>
              <div className={styles.channelSectionTitle}>Public Channels</div>
              <button
                type="button"
                className={`${styles.channelItem} ${activeTab.type === 'lobby' ? styles.channelItemActive : ''} ${unreadSummary.lobbyUnread ? styles.channelItemUnread : ''}`}
                onClick={() => {
                  setActiveTab({ type: 'lobby' });
                  setViewMode('chat');
                }}
              >
                <div className={styles.channelItemAvatar}>
                  <Icon name="message-square" size={18} strokeWidth={2} />
                </div>
                <div className={styles.channelItemInfo}>
                  <span className={styles.channelItemName}>League Lobby</span>
                  <span className={styles.channelItemSub}>Public message board for everyone</span>
                </div>
                {unreadSummary.lobbyUnread && <span className={styles.channelDot} />}
              </button>
            </div>

            {/* Direct Messages Section */}
            <div className={styles.channelSection}>
              <div className={styles.channelSectionTitle}>Direct Messages</div>
              {otherManagers.length > 0 ? (
                otherManagers.map((team) => {
                  const isActive = activeTab.type === 'dm' && activeTab.userId === team.user_id;
                  const hasUnread = unreadSummary.dmUnreadPeerIds.includes(team.user_id);

                  return (
                    <button
                      key={team.user_id}
                      type="button"
                      className={`${styles.channelItem} ${isActive ? styles.channelItemActive : ''} ${hasUnread ? styles.channelItemUnread : ''}`}
                      onClick={() => {
                        setActiveTab({
                          type: 'dm',
                          userId: team.user_id,
                          username: team.user.username,
                          teamName: team.team_name,
                        });
                        setViewMode('chat');
                      }}
                    >
                      <div className={styles.channelItemAvatar}>
                        <CrestBadge config={team.crest_config} teamName={team.team_name} teamId={team.id} size={24} />
                      </div>
                      <div className={styles.channelItemInfo}>
                        <span className={styles.channelItemName}>{team.user.username}</span>
                        <span className={styles.channelItemSub}>{team.team_name}</span>
                      </div>
                      {hasUnread && <span className={styles.channelDot} />}
                    </button>
                  );
                })
              ) : (
                <div className={styles.channelEmpty}>No other managers found</div>
              )}
            </div>
          </div>
        ) : (
          /* View Mode: Active Message Thread */
          <div className={styles.threadView}>
            <div className={styles.messagesFeed} ref={feedRef}>
              {loading ? (
                <div className={styles.feedStatus}>Retrieving messages...</div>
              ) : currentMessages.length > 0 ? (
                currentMessages.map((m) => {
                  const isSelf = !m.is_system && m.sender_id === currentUserId;
                  const senderName = m.sender?.username || 'Unknown';
                  const teamInfo = teams.find((t) => t.user_id === m.sender_id);
                  const teamLabel = teamInfo ? teamInfo.team_name : isSelf ? 'My Club' : '';

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
                          <Icon name="trophy" size={14} />
                        </div>
                      ) : (
                        <div className={styles.msgAvatar}>
                          <CrestBadge
                            config={teamInfo?.crest_config}
                            teamName={teamLabel || senderName}
                            teamId={teamInfo?.id}
                            size={24}
                          />
                        </div>
                      )}

                      {/* Bubble */}
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
                          <TradeOfferCard
                            trade={trade}
                            leagueId={leagueId}
                            currentTeamId={currentTeamId}
                            onActionComplete={refreshNegotiations}
                          />
                        ) : loan ? (
                          <LoanOfferCard
                            loan={loan}
                            leagueId={leagueId}
                            currentTeamId={currentTeamId}
                            onActionComplete={refreshNegotiations}
                          />
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
                    {activeTab.type === 'lobby' ? 'League Lobby' : `Message @${activeTab.username}`}
                  </div>
                  <p className={styles.emptyDesc}>
                    {activeTab.type === 'lobby'
                      ? 'Share banter, transfer gossip, or announcements.'
                      : `Private direct messages with @${activeTab.username}.`}
                  </p>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className={styles.inputArea}>
              <form className={styles.form} onSubmit={handleSubmit}>
                <div className={styles.textareaWrapper}>
                  <textarea
                    className={styles.inputField}
                    placeholder={
                      activeTab.type === 'lobby'
                        ? 'Type a message to the lobby…'
                        : `Message @${activeTab.username}…`
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
                  {isSending ? '...' : 'Send'}
                </button>
              </form>
            </div>
          </div>
        )}
      </aside>
    </>
  );
}
