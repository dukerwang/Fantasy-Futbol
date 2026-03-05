/**
 * POST /api/sync/sofifa-players
 *
 * Syncs player positions from SoFIFA (EA FC game data).
 * No API key required — free for non-commercial projects.
 * Rate limit: 60 req/min. We make ~22 requests total (well within limits).
 *
 * What it updates per player:
 *   - primary_position  (from position1 — granular EA FC position)
 *   - secondary_positions (from position2/3/4 — alternate positions in EA FC)
 *
 * Protected by CRON_SECRET header.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { GranularPosition } from '@/types';
import stringSimilarity from 'string-similarity';

export const maxDuration = 60; // 1 minute max for Vercel Hobby tier

const BASE_URL = 'https://api.sofifa.net';
const PL_LEAGUE_ID = 13;

// ── SoFIFA position ID → our GranularPosition ────────────────────────────────
// Full table from https://sofifa.com/document
const SOFIFA_TO_GRANULAR: Partial<Record<number, GranularPosition>> = {
  0: 'GK',
  1: 'CB',  // SW  (sweeper)
  2: 'RB',  // RWB
  3: 'RB',  // RB
  4: 'CB',  // RCB
  5: 'CB',  // CB
  6: 'CB',  // LCB
  7: 'LB',  // LB
  8: 'LB',  // LWB
  9: 'DM',  // RDM
  10: 'DM', // CDM
  11: 'DM', // LDM
  12: 'RM', // RM
  13: 'CM', // RCM
  14: 'CM', // CM
  15: 'CM', // LCM
  16: 'LM', // LM
  17: 'AM', // RAM
  18: 'AM', // CAM
  19: 'AM', // LAM
  20: 'RW', // RF
  21: 'ST', // CF
  22: 'LW', // LF
  23: 'RW', // RW
  24: 'ST', // RS
  25: 'ST', // ST
  26: 'ST', // LS
  27: 'LW', // LW
  // 28=SUB, 29=RES → intentionally omitted (map to undefined → null)
};

function toGranular(posId: number): GranularPosition | null {
  if (posId < 0) return null;
  return SOFIFA_TO_GRANULAR[posId] ?? null;
}

function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .trim();
}

async function sofiFetch<T>(path: string): Promise<T> {
  const cfClearance = process.env.SOFIFA_CF_CLEARANCE;
  if (!cfClearance) {
    throw new Error(
      'SOFIFA_CF_CLEARANCE not set. Open sofifa.com in your browser, ' +
      'DevTools → Application → Cookies → api.sofifa.net, copy the cf_clearance value.'
    );
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://sofifa.com/',
      'Cookie': `cf_clearance=${cfClearance}`,
    },
    next: { revalidate: 0 },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`SoFIFA ${res.status} on ${path}: ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  return json.data as T;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface SoFifaLeague {
  id: number;
  name: string;
  latestRoster: string;
}

interface SoFifaTeamStub {
  id: number;
  name: string;
}

interface SoFifaSquadPlayer {
  id: number;
  firstName: string;
  lastName: string;
  commonName: string;
  position1: number;
  position2: number;
  position3: number;
  position4: number;
}

interface SoFifaTeamDetail {
  players: SoFifaSquadPlayer[];
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Accept pre-fetched team data from the Playwright script (avoids Cloudflare)
  let preloadedTeams: SoFifaTeamDetail[] | null = null;
  try {
    const body = await req.json().catch(() => null);
    if (body?.preloadedTeams) preloadedTeams = body.preloadedTeams;
  } catch { /* no body */ }

  try {
    return await runSync(preloadedTeams);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[sofifa-sync]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function runSync(preloadedTeams: SoFifaTeamDetail[] | null) {
  const admin = createAdminClient();

  // 1. Load active players from DB for name matching
  const { data: dbPlayers, error: fetchError } = await admin
    .from('players')
    .select('id, name, web_name, primary_position')
    .eq('is_active', true);

  if (fetchError || !dbPlayers) {
    return NextResponse.json({ error: 'Failed to fetch players from DB' }, { status: 500 });
  }

  const nameMap = new Map<string, typeof dbPlayers[0]>();
  const nameList: string[] = [];

  for (const p of dbPlayers) {
    const normFull = normalizeName(p.name);
    const normWeb = p.web_name ? normalizeName(p.web_name) : null;
    nameMap.set(normFull, p);
    nameList.push(normFull);
    if (normWeb && normWeb !== normFull) {
      nameMap.set(normWeb, p);
      nameList.push(normWeb);
    }
  }

  // 2 & 3. Get team squads — either from pre-fetched data (Playwright) or SoFIFA API
  let teams: SoFifaTeamDetail[];
  let rosterLabel = 'preloaded';

  if (preloadedTeams) {
    teams = preloadedTeams;
  } else {
    const allLeagues = await sofiFetch<SoFifaLeague[]>('/leagues');
    const plLeague = allLeagues.find((l) => l.id === PL_LEAGUE_ID);
    if (!plLeague) {
      return NextResponse.json({ error: 'Premier League not found in SoFIFA leagues' }, { status: 502 });
    }
    rosterLabel = plLeague.latestRoster;
    const plTeams = await sofiFetch<SoFifaTeamStub[]>(`/league/${PL_LEAGUE_ID}/${rosterLabel}`);
    teams = [];
    for (const t of plTeams) {
      try {
        teams.push(await sofiFetch<SoFifaTeamDetail>(`/team/${t.id}`));
      } catch { /* skip on error */ }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  // 4. Process squads → collect position updates
  const updates: Array<{
    id: string;
    primary_position: GranularPosition;
    secondary_positions: GranularPosition[];
  }> = [];
  let matched = 0;

  for (const team of teams) {

    for (const sp of team.players ?? []) {
      const primary = toGranular(sp.position1);
      if (!primary) continue; // SUB / RES players — skip

      // Collect up to 3 valid secondary positions (deduplicated, not same as primary)
      const secondary: GranularPosition[] = [];
      for (const posId of [sp.position2, sp.position3, sp.position4]) {
        const g = toGranular(posId);
        if (g && g !== primary && !secondary.includes(g)) {
          secondary.push(g);
        }
      }

      // Match to our DB by name
      const fullName = [sp.firstName, sp.lastName].filter(Boolean).join(' ');
      const common = sp.commonName || '';
      const normFull = normalizeName(fullName);
      const normCommon = normalizeName(common);

      let dbMatch = nameMap.get(normFull) ?? nameMap.get(normCommon) ?? null;

      if (!dbMatch) {
        // Fuzzy fallback — try the more distinctive name first
        for (const candidate of [normFull, normCommon].filter(Boolean)) {
          const { bestMatch } = stringSimilarity.findBestMatch(candidate, nameList);
          if (bestMatch.rating > 0.82) {
            dbMatch = nameMap.get(bestMatch.target) ?? null;
            break;
          }
        }
      }

      if (dbMatch) {
        matched++;
        updates.push({ id: dbMatch.id, primary_position: primary, secondary_positions: secondary });
      }
    }

  }

  // 5. Batch update DB
  if (updates.length > 0) {
    const chunkSize = 50;
    for (let i = 0; i < updates.length; i += chunkSize) {
      const chunk = updates.slice(i, i + chunkSize);
      await Promise.all(
        chunk.map((u) =>
          admin
            .from('players')
            .update({
              primary_position: u.primary_position,
              secondary_positions: u.secondary_positions,
            })
            .eq('id', u.id)
        )
      );
    }
  }

  return NextResponse.json({
    ok: true,
    roster: rosterLabel,
    teams: teams.length,
    matched,
    updated: updates.length,
  });
}
