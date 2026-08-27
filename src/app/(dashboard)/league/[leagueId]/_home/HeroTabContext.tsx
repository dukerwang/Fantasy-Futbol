'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';

export type HeroTab = 'primary' | 'secondary';

interface HeroTabValue {
  tab: HeroTab;
  setTab: (tab: HeroTab) => void;
}

const HeroTabContext = createContext<HeroTabValue | null>(null);

/**
 * Shared state for the hero fixture's "Last week" / "Up next" toggle.
 *
 * The fixture card and the opponent rail card are siblings under the page,
 * not parent/child, but they show the same matchup and must flip together —
 * hence a context instead of prop-drilling or two independent toggles that
 * could drift out of sync.
 */
export function HeroTabProvider({
  initialTab,
  children,
}: {
  initialTab: HeroTab;
  children: ReactNode;
}) {
  const [tab, setTab] = useState<HeroTab>(initialTab);
  return <HeroTabContext.Provider value={{ tab, setTab }}>{children}</HeroTabContext.Provider>;
}

export function useHeroTab(): HeroTabValue {
  const ctx = useContext(HeroTabContext);
  if (!ctx) throw new Error('useHeroTab must be used within a HeroTabProvider');
  return ctx;
}
