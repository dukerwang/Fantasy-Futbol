/**
 * src/lib/season/currentSeason.ts
 *
 * Single source of truth for the current FPL/fantasy season string.
 *
 * The season string format is "YYYY-YY" (e.g. "2025-26", "2026-27").
 * It is derived exclusively from the FPL bootstrap-static API — never
 * hardcoded — so season transitions happen automatically when FPL's data
 * switches over (mid-June each year).
 *
 * Usage:
 *   const season = await getCurrentFplSeason();          // "2025-26"
 *   const season = await getLatestReferenceStatsSeason(adminClient); // from DB
 *
 * Both functions are lightweight and safe to call multiple times per
 * request — results are module-level cached for the lifetime of the
 * serverless invocation.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

// ── Module-level cache (lives for the duration of one serverless invocation) ──
let _cachedFplSeason: string | null = null;
let _cachedRawFplSeason: string | null = null;
let _cachedRefStatsSeason: string | null = null;

/**
 * Derives the current FPL season string from the FPL bootstrap-static API.
 *
 * Strategy:
 *  1. Fetch the FPL events list.
 *  2. Find the event with the earliest deadline that has already passed
 *     (i.e., GW1 of the current season).
 *  3. Extract the year from that deadline and format as "YYYY-YY".
 *
 * Fallback: if the FPL API is unreachable, returns the fallback string
 * (used only during initial setup / API downtime — not as a static value).
 *
 * Example: GW1 deadline 2025-08-16 → "2025-26"
 */
export async function getCurrentFplSeason(fallback?: string, useRawSeason = false): Promise<string> {
  if (useRawSeason && _cachedRawFplSeason) return _cachedRawFplSeason;
  if (!useRawSeason && _cachedFplSeason) return _cachedFplSeason;

  const now = new Date();
  const currentYear = now.getFullYear();
  // June or later is the start of the offseason/lead-up to the next season
  const startYear = now.getMonth() >= 5 ? currentYear : currentYear - 1;
  const dynamicFallback = fallback ?? `${startYear}-${String(startYear + 1).slice(2)}`;

  try {
    const res = await fetch(
      'https://fantasy.premierleague.com/api/bootstrap-static/',
      { next: { revalidate: 3600 } },
    );
    if (!res.ok) return dynamicFallback;

    const data = await res.json();
    const events = (data.events ?? []) as { id: number; deadline_time: string; finished?: boolean }[];

    // GW1 has the earliest deadline — its year determines the season
    const gw1 = events.find((e) => e.id === 1);
    if (!gw1?.deadline_time) return dynamicFallback;

    const gw1Year = new Date(gw1.deadline_time).getFullYear();
    let season = `${gw1Year}-${String(gw1Year + 1).slice(2)}`; // e.g. "2025-26"

    if (useRawSeason) {
      _cachedRawFplSeason = season;
      return season;
    }

    // If the retrieved season is already finished (GW38 completed), we are in the offseason preparing for the next one
    const lastEvent = events[events.length - 1];
    if (lastEvent?.finished) {
      season = nextSeason(season);
    }

    _cachedFplSeason = season;
    return season;
  } catch {
    return dynamicFallback;
  }
}

/**
 * Checks if the current FPL season has kicked off (i.e. GW1 has started).
 */
export async function isFplSeasonKickedOff(): Promise<boolean> {
  try {
    const res = await fetch(
      'https://fantasy.premierleague.com/api/bootstrap-static/',
      { next: { revalidate: 3600 } },
    );
    if (!res.ok) return false;

    const data = await res.json();
    const events = (data.events ?? []) as { id: number; deadline_time: string; finished?: boolean }[];

    const gw1 = events.find((e) => e.id === 1);
    if (!gw1?.deadline_time) return false;

    const gw1Deadline = new Date(gw1.deadline_time);
    const now = new Date();

    return now >= gw1Deadline;
  } catch {
    return false;
  }
}

/**
 * Returns the most recent season available in rating_reference_stats.
 *
 * The scoring engine uses this to load sigmoid normalization baselines.
 * Falls back to getCurrentFplSeason() if the table is empty.
 */
export async function getLatestReferenceStatsSeason(
  admin: SupabaseClient,
): Promise<string> {
  if (_cachedRefStatsSeason) return _cachedRefStatsSeason;

  const { data } = await admin
    .from('rating_reference_stats')
    .select('season')
    .order('season', { ascending: false })
    .limit(1)
    .single();

  if (data?.season) {
    _cachedRefStatsSeason = data.season as string;
    return data.season as string;
  }

  // No reference stats yet — fall back to FPL-derived season
  const fplSeason = await getCurrentFplSeason();
  _cachedRefStatsSeason = fplSeason;
  return fplSeason;
}

/**
 * Bumps a "YYYY-YY" season string to the next season.
 * "2025-26" → "2026-27"
 * Used by the offseason reset orchestrator.
 */
export function nextSeason(current: string): string {
  const match = current.match(/^(\d{4})-(\d{2})$/);
  if (!match) return current;
  const startYear = parseInt(match[1], 10) + 1;
  return `${startYear}-${String(startYear + 1).slice(2)}`;
}

/**
 * Helper to get the previous season from a "YYYY-YY" season string.
 */
export function previousSeason(current: string): string {
  const match = current.match(/^(\d{4})-(\d{2})$/);
  if (!match) return current;
  const startYear = parseInt(match[1], 10) - 1;
  return `${startYear}-${String(startYear + 1).slice(2)}`;
}

