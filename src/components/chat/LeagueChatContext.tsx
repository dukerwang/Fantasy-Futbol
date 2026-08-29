'use client';

import React, { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
import { usePathname } from 'next/navigation';

export type ChatTabState =
  | { type: 'lobby' }
  | { type: 'dm'; userId: string; username: string; teamName: string };

interface UnreadSummary {
  lobbyUnread: boolean;
  dmUnreadPeerIds: string[];
}

interface LeagueChatContextType {
  leagueId: string;
  isOpen: boolean;
  isMinimized: boolean;
  activeTab: ChatTabState;
  unreadSummary: UnreadSummary;
  openChat: (tab?: ChatTabState) => void;
  closeChat: () => void;
  toggleChat: () => void;
  minimizeChat: () => void;
  restoreChat: () => void;
  setActiveTab: (tab: ChatTabState) => void;
  setUnreadSummary: React.Dispatch<React.SetStateAction<UnreadSummary>>;
}

const LeagueChatContext = createContext<LeagueChatContextType | null>(null);

export function LeagueChatProvider({
  leagueId,
  children,
}: {
  leagueId: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [activeTab, setActiveTab] = useState<ChatTabState>({ type: 'lobby' });
  const [unreadSummary, setUnreadSummary] = useState<UnreadSummary>({
    lobbyUnread: false,
    dmUnreadPeerIds: [],
  });

  // If the user navigates directly to the dedicated full chat page,
  // close the onscreen widget so there aren't two chats open on screen.
  useEffect(() => {
    if (pathname?.startsWith(`/league/${leagueId}/chat`)) {
      setIsOpen(false);
    }
  }, [pathname, leagueId]);

  const openChat = useCallback((tab?: ChatTabState) => {
    if (tab) {
      setActiveTab(tab);
    }
    setIsOpen(true);
    setIsMinimized(false);
  }, []);

  const closeChat = useCallback(() => {
    setIsOpen(false);
    setIsMinimized(false);
  }, []);

  const toggleChat = useCallback(() => {
    setIsOpen((prev) => {
      if (prev && isMinimized) {
        setIsMinimized(false);
        return true;
      }
      return !prev;
    });
  }, [isMinimized]);

  const minimizeChat = useCallback(() => {
    setIsMinimized(true);
  }, []);

  const restoreChat = useCallback(() => {
    setIsMinimized(false);
    setIsOpen(true);
  }, []);

  const value = useMemo(
    () => ({
      leagueId,
      isOpen,
      isMinimized,
      activeTab,
      unreadSummary,
      openChat,
      closeChat,
      toggleChat,
      minimizeChat,
      restoreChat,
      setActiveTab,
      setUnreadSummary,
    }),
    [
      leagueId,
      isOpen,
      isMinimized,
      activeTab,
      unreadSummary,
      openChat,
      closeChat,
      toggleChat,
      minimizeChat,
      restoreChat,
      setActiveTab,
      setUnreadSummary,
    ]
  );

  return <LeagueChatContext.Provider value={value}>{children}</LeagueChatContext.Provider>;
}

export function useLeagueChat() {
  return useContext(LeagueChatContext);
}
