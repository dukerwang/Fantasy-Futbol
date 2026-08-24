'use client';

import { useEffect, useState } from 'react';

/**
 * One interval for the whole page.
 *
 * `TransferMarketClient.tsx:153-156` called `setNow(Date.now())` every second at
 * the top of a 1003-line component, re-rendering the entire market 60 times a
 * minute whether or not anything on screen had a clock. With 60 concurrent
 * auctions that is the difference between a page that idles and a page that
 * pins a core.
 *
 * Here a single module-level interval feeds a subscriber Set, and only
 * components that actually render a countdown subscribe. The interval does not
 * exist at all while nothing is counting.
 */

type Listener = (now: number) => void;

const listeners = new Set<Listener>();
let handle: ReturnType<typeof setInterval> | null = null;

function start() {
  if (handle) return;
  handle = setInterval(() => {
    const now = Date.now();
    for (const fn of listeners) fn(now);
  }, 1000);
}

function stop() {
  if (handle && listeners.size === 0) {
    clearInterval(handle);
    handle = null;
  }
}

/**
 * Server clock offset.
 *
 * Every auction deadline is computed server-side and `place_auction_bid_rpc`
 * rejects bids on an expired auction, so a client whose clock runs two minutes
 * fast would show "ended" on auctions that are still taking bids — and hide the
 * bid button on them. `serverNow` from the hub payload pins the difference once.
 */
let skewMs = 0;

export function setServerClock(serverNowIso: string) {
  const parsed = new Date(serverNowIso).getTime();
  if (!Number.isNaN(parsed)) skewMs = parsed - Date.now();
}

/** Server-corrected wall clock. */
export function serverTime(): number {
  return Date.now() + skewMs;
}

/** Subscribe to the shared tick. Returns server-corrected milliseconds. */
export function useTick(enabled = true): number {
  const [now, setNow] = useState(() => serverTime());

  useEffect(() => {
    if (!enabled) return;
    const fn: Listener = (raw) => setNow(raw + skewMs);
    listeners.add(fn);
    start();
    return () => {
      listeners.delete(fn);
      stop();
    };
  }, [enabled]);

  return now;
}

/**
 * Format a remaining duration the way a transfer deadline reads: coarse when
 * far out, precise only when it matters.
 */
export function formatRemaining(msLeft: number): string {
  if (msLeft <= 0) return 'ended';

  const s = Math.floor(msLeft / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;

  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

/** Clock copy for a live auction. Past zero with the lot still open is settling, not ended. */
export function formatAuctionClock(msLeft: number, stillLive: boolean): string {
  if (msLeft > 0) return formatRemaining(msLeft);
  return stillLive ? 'settling' : 'ended';
}

/** True when the clock is close enough that the card should feel urgent. */
export function isClosing(msLeft: number): boolean {
  return msLeft > 0 && msLeft < 60 * 60 * 1000;
}
