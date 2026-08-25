'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useParams } from 'next/navigation';
import type { Player, PlayerOwnership } from '@/types';
import PlayerDetailsModal from './PlayerDetailsModal';
import {
  fetchFront,
  getCachedFront,
  getOwnershipFor,
  prefetchPlayerCard,
  primeFront,
  warmImages,
} from '@/lib/players/cardCache';

export interface OpenPlayerOptions {
  /**
   * Overrides the league-wide owner map seeded by LeagueOwnershipSeed. Only
   * needed when a caller knows better than that map — `null` means known free
   * agent, which is worth stating for a draft pool.
   */
  ownership?: PlayerOwnership | null;
  /** Shows a "Draft Pick" button in the modal. */
  onPick?: (player: Player) => void;
  /** Shows a "Nominate" button in the modal. */
  onNominate?: (player: Player) => void;
}

interface PlayerCardContextValue {
  /** Opens the card immediately from data the caller already holds. */
  openPlayer: (player: Player, options?: OpenPlayerOptions) => void;
  /**
   * Opens the card for a player the caller only has an id for. Resolves the
   * front payload first (usually from cache, so still instant) rather than
   * flashing an empty card.
   *
   * Prefer `openPlayer` whenever the page already loaded a Player row —
   * matchup used to wait on `/api/players/:id/card` on every click for
   * that reason. `openPlayerById` is for narrative/activity text that
   * only has an id.
   */
  openPlayerById: (playerId: string, options?: OpenPlayerOptions) => void;
  /** Warms photo + payloads on hover/focus so the click has nothing to wait on. */
  prefetchPlayer: (player: { id: string; photo_url?: string | null }) => void;
  /** Seeds the cache with server-hydrated rows. Safe to call on every render. */
  primePlayers: (players: Player[]) => void;
  closePlayer: () => void;
  /** True while `openPlayerById` is resolving a cold player. */
  isResolving: boolean;
}

const PlayerCardContext = createContext<PlayerCardContextValue | null>(null);

/** How many list photos to pre-decode when a page primes its rows. */
const WARM_PHOTO_COUNT = 24;

export function PlayerCardProvider({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const leagueId = params?.leagueId as string | undefined;

  const [player, setPlayer] = useState<Player | null>(null);
  const [ownership, setOwnership] = useState<PlayerOwnership | null | undefined>(undefined);
  const [actions, setActions] = useState<Pick<OpenPlayerOptions, 'onPick' | 'onNominate'>>({});
  const [isResolving, setIsResolving] = useState(false);

  // Guards against a slow resolve landing after the user opened someone else.
  const requestSeq = useRef(0);
  const hoverTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const closePlayer = useCallback(() => {
    requestSeq.current += 1;
    setPlayer(null);
    setOwnership(undefined);
    setActions({});
    setIsResolving(false);
  }, []);

  const openPlayer = useCallback(
    (next: Player, options?: OpenPlayerOptions) => {
      requestSeq.current += 1;
      setPlayer(next);
      setOwnership(
        options?.ownership !== undefined
          ? options.ownership
          : getOwnershipFor(next.id, leagueId),
      );
      setActions({ onPick: options?.onPick, onNominate: options?.onNominate });
      setIsResolving(false);
    },
    [leagueId],
  );

  const openPlayerById = useCallback(
    (playerId: string, options?: OpenPlayerOptions) => {
      const cached = getCachedFront(playerId, leagueId);
      if (cached) {
        openPlayer(cached.player, options);
        return;
      }

      const seq = ++requestSeq.current;
      setIsResolving(true);
      fetchFront(playerId, leagueId).then((front) => {
        if (seq !== requestSeq.current) return;
        setIsResolving(false);
        if (!front) return;
        setPlayer(front.player);
        setOwnership(
          options?.ownership !== undefined
            ? options.ownership
            : getOwnershipFor(playerId, leagueId) ?? front.ownership,
        );
        setActions({ onPick: options?.onPick, onNominate: options?.onNominate });
      });
    },
    [leagueId, openPlayer],
  );

  const prefetchPlayer = useCallback(
    (target: { id: string; photo_url?: string | null }) => {
      // A brush-past shouldn't cost a request; a deliberate hover should.
      if (hoverTimers.current.has(target.id)) return;
      const timer = setTimeout(() => {
        hoverTimers.current.delete(target.id);
        prefetchPlayerCard(target, leagueId);
      }, 80);
      hoverTimers.current.set(target.id, timer);
    },
    [leagueId],
  );

  const primePlayers = useCallback(
    (players: Player[]) => {
      for (const p of players) primeFront(p, leagueId);
      warmImages(players.slice(0, WARM_PHOTO_COUNT).map((p) => p.photo_url));
    },
    [leagueId],
  );

  useEffect(() => {
    const timers = hoverTimers.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  const value = useMemo<PlayerCardContextValue>(
    () => ({ openPlayer, openPlayerById, prefetchPlayer, primePlayers, closePlayer, isResolving }),
    [openPlayer, openPlayerById, prefetchPlayer, primePlayers, closePlayer, isResolving],
  );

  return (
    <PlayerCardContext.Provider value={value}>
      {children}
      <PlayerDetailsModal
        player={player}
        ownership={ownership}
        onClose={closePlayer}
        onPick={actions.onPick}
        onNominate={actions.onNominate}
      />
    </PlayerCardContext.Provider>
  );
}

export function usePlayerCard(): PlayerCardContextValue {
  const ctx = useContext(PlayerCardContext);
  if (!ctx) {
    throw new Error('usePlayerCard must be used inside a PlayerCardProvider');
  }
  return ctx;
}

/**
 * Convenience props for any clickable player row/tile. Spread onto the element
 * to get prefetch-on-intent for free:
 *
 *   <tr {...playerHoverProps(prefetchPlayer, player)} onClick={...}>
 */
export function playerHoverProps(
  prefetch: (p: { id: string; photo_url?: string | null }) => void,
  player: { id: string; photo_url?: string | null },
) {
  return {
    onPointerEnter: () => prefetch(player),
    onFocus: () => prefetch(player),
  };
}
