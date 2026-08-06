'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import type { SquadPeek } from '@/lib/teams/squadPeekTypes';
import SquadPeekDrawer from './SquadPeekDrawer';

/**
 * One drawer for the whole app, opened by team id from anywhere.
 *
 * Mirrors PlayerCardProvider: a single instance mounted in the dashboard
 * layout, so a crest in the standings table, a listing card, or a player card's
 * owner badge can all say "show me this club" without each surface owning a
 * modal, a fetch and a loading state of its own.
 */

interface SquadPeekContextValue {
  /** Opens the drawer for a club. `teamName` is only a placeholder for the header while it loads. */
  openPeek: (teamId: string, teamName?: string) => void;
  closePeek: () => void;
  prefetchPeek: (teamId: string) => void;
  openTeamId: string | null;
}

const SquadPeekContext = createContext<SquadPeekContextValue | null>(null);

/**
 * Peeks are read-only and cheap to re-open, so they're cached — but not for the
 * session. A roster changes the moment a trade or an auction settles, and a
 * squad that silently stayed as it was an hour ago is worse than a spinner.
 * A minute is long enough to cover hover-then-click and flicking between clubs.
 */
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; payload: SquadPeek }>();

function cacheKey(leagueId: string, teamId: string) {
  return `${leagueId}:${teamId}`;
}

function readCache(key: string): SquadPeek | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.payload;
}

export function SquadPeekProvider({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const leagueId = params?.leagueId as string | undefined;

  const [teamId, setTeamId] = useState<string | null>(null);
  const [placeholderName, setPlaceholderName] = useState<string | null>(null);
  const [data, setData] = useState<SquadPeek | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  // Keyed on the request, not just "is one running" — a hover starts the fetch
  // and the click a moment later has to JOIN it. Returning null for "already in
  // flight" made the click render the error state while its own data was
  // seconds from arriving.
  const inflight = useRef(new Map<string, Promise<SquadPeek | null>>());

  const load = useCallback(
    (league: string, target: string): Promise<SquadPeek | null> => {
      const key = cacheKey(league, target);
      const cached = readCache(key);
      if (cached) return Promise.resolve(cached);

      const running = inflight.current.get(key);
      if (running) return running;

      const request = (async () => {
        try {
          const res = await fetch(`/api/leagues/${league}/clubs/${target}/peek`);
          if (!res.ok) return null;
          const payload = (await res.json()) as SquadPeek;
          cache.set(key, { at: Date.now(), payload });
          return payload;
        } catch {
          return null;
        } finally {
          inflight.current.delete(key);
        }
      })();

      inflight.current.set(key, request);
      return request;
    },
    [],
  );

  const openPeek = useCallback(
    (target: string, teamName?: string) => {
      if (!leagueId) return;
      const mine = ++seq.current;
      setTeamId(target);
      setPlaceholderName(teamName ?? null);
      setError(null);

      const cached = readCache(cacheKey(leagueId, target));
      setData(cached);
      if (cached) return;

      load(leagueId, target).then((payload) => {
        // A slow response must not overwrite a club the user opened since.
        if (mine !== seq.current) return;
        if (payload) setData(payload);
        else setError('Couldn’t load this club right now.');
      });
    },
    [leagueId, load],
  );

  const closePeek = useCallback(() => {
    seq.current += 1;
    setTeamId(null);
    setPlaceholderName(null);
    setData(null);
    setError(null);
  }, []);

  const prefetchPeek = useCallback(
    (target: string) => {
      if (!leagueId) return;
      if (readCache(cacheKey(leagueId, target))) return;
      void load(leagueId, target);
    },
    [leagueId, load],
  );

  const value = useMemo<SquadPeekContextValue>(
    () => ({ openPeek, closePeek, prefetchPeek, openTeamId: teamId }),
    [openPeek, closePeek, prefetchPeek, teamId],
  );

  return (
    <SquadPeekContext.Provider value={value}>
      {children}
      {teamId && leagueId && (
        <SquadPeekDrawer
          leagueId={leagueId}
          teamId={teamId}
          placeholderName={placeholderName}
          data={data}
          error={error}
          onClose={closePeek}
        />
      )}
    </SquadPeekContext.Provider>
  );
}

/**
 * Null outside a provider rather than throwing, so a component that lives both
 * inside and outside the dashboard shell can offer the peek where it's
 * available and quietly skip it where it isn't (the share pages, for one).
 */
export function useSquadPeek(): SquadPeekContextValue | null {
  return useContext(SquadPeekContext);
}
