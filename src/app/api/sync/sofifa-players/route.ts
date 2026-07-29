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



export const maxDuration = 60; // 1 minute max for Vercel Hobby tier

const BASE_URL = 'https://api.sofifa.net';
const PL_LEAGUE_ID = 13;

// ── SoFIFA position ID → our GranularPosition ────────────────────────────────
// Full table from https://sofifa.com/document
const SOFIFA_ID_TO_RAW_STRING: Partial<Record<number, string>> = {
  0: 'GK',
  1: 'SW',
  2: 'RWB',
  3: 'RB',
  4: 'RCB',
  5: 'CB',
  6: 'LCB',
  7: 'LB',
  8: 'LWB',
  9: 'RDM',
  10: 'CDM',
  11: 'LDM',
  12: 'RM',
  13: 'RCM',
  14: 'CM',
  15: 'LCM',
  16: 'LM',
  17: 'RAM',
  18: 'CAM',
  19: 'LAM',
  20: 'RF',
  21: 'CF',
  22: 'LF',
  23: 'RW',
  24: 'RS',
  25: 'ST',
  26: 'LS',
  27: 'LW',
  // 28=SUB, 29=RES → intentionally omitted (map to undefined → null)
};

const POS_MAP: Record<string, GranularPosition> = {
  GK: 'GK',
  SW: 'CB',   // sweeper
  RWB: 'RWB',
  RB: 'RB',
  RCB: 'CB',
  CB: 'CB',
  LCB: 'CB',
  LB: 'LB',
  LWB: 'LWB',
  RDM: 'DM',
  CDM: 'DM',
  LDM: 'DM',
  RM: 'RW',
  RCM: 'CM',
  CM: 'CM',
  LCM: 'CM',
  LM: 'LW',
  RAM: 'AM',
  CAM: 'AM',
  LAM: 'AM',
  RF: 'RW',
  CF: 'ST',
  LF: 'LW',
  RW: 'RW',
  RS: 'ST',
  ST: 'ST',
  LS: 'ST',
  LW: 'LW',
  DM: 'DM', // self-map
  AM: 'AM', // self-map
};

function toRawString(posId: number): string | null {
  if (posId < 0) return null;
  return SOFIFA_ID_TO_RAW_STRING[posId] || null;
}

function normalizeName(name: string): string {
  if (!name) return '';
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
    .toLowerCase()
    .replace(/ß/g, 'ss')             // German Eszett
    .replace(/-/g, ' ')              // Replace hyphens with space
    .replace(/[^a-z0-9 ]/g, '')      // Strip other non-alphanumeric except spaces
    .replace(/\s+/g, ' ')            // Normalize multiple spaces
    .trim();
}

// Returns "first last" by taking only the first and last word of a multi-word name.
function firstLast(name: string) {
  const parts = name.split(' ').filter(Boolean);
  if (parts.length <= 2) return name;
  return `${parts[0]} ${parts[parts.length - 1]}`;
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
  fullName?: string;
  position1: number;
  position2: number;
  position3: number;
  position4: number;
  positions?: string[]; // from scraper
  roles?: string[];     // from scraper
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

  type DbPlayer = NonNullable<typeof dbPlayers>[number];
  const nameMap = new Map<string, DbPlayer>();

  function addToMap(key: string | null, player: DbPlayer) {
    if (!key) return;
    if (!nameMap.has(key)) {
      nameMap.set(key, player);
    }
  }

  for (const p of dbPlayers) {
    const normFull = normalizeName(p.name);
    const normWeb = p.web_name ? normalizeName(p.web_name) : null;

    addToMap(normFull, p);
    addToMap(normWeb, p);
    addToMap(firstLast(normFull), p);
    if (normWeb) addToMap(firstLast(normWeb), p);

    // Reverse 2-word names to support order variations (e.g. Endo Wataru <-> Wataru Endo)
    const fullParts = normFull.split(' ').filter(Boolean);
    if (fullParts.length === 2) {
      addToMap(`${fullParts[1]} ${fullParts[0]}`, p);
    }
    if (normWeb) {
      const webParts = normWeb.split(' ').filter(Boolean);
      if (webParts.length === 2) {
        addToMap(`${webParts[1]} ${webParts[0]}`, p);
      }
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
    sofifa_common_name: string | null;
  }> = [];
  let matched = 0;

  for (const team of teams) {

    for (const sp of team.players ?? []) {
      let sofifaPrimaryRaw: string | null = null;
      let positionsRaw: string[] = [];
      let roles: string[] = [];

      if (sp.positions) {
        positionsRaw = sp.positions;
        if (positionsRaw.length > 0) sofifaPrimaryRaw = positionsRaw[0];
        roles = sp.roles || [];
      } else {
        sofifaPrimaryRaw = toRawString(sp.position1);
        if (sofifaPrimaryRaw) positionsRaw.push(sofifaPrimaryRaw);
        for (const posId of [sp.position2, sp.position3, sp.position4]) {
          const str = toRawString(posId);
          if (str && !positionsRaw.includes(str)) positionsRaw.push(str);
        }
      }

      if (!sofifaPrimaryRaw) continue; // SUB / RES players — skip

      // ── New Hybrid Wide Player Rules ───────────────────────────────────────────
      const allRaw = new Set(positionsRaw);

      const hasLB = allRaw.has('LB') || allRaw.has('LWB');
      const hasLM = allRaw.has('LM');
      const hasLW = allRaw.has('LW') || allRaw.has('LF');

      const hasRB = allRaw.has('RB') || allRaw.has('RWB');
      const hasRM = allRaw.has('RM');
      const hasRW = allRaw.has('RW') || allRaw.has('RF');

      const hasBothMid = hasLM && hasRM;
      const hasOnlyOneFB = (hasLB && !hasRB) || (!hasLB && hasRB);

      const finalSet = new Set<GranularPosition>();

      let primary: GranularPosition = POS_MAP[sofifaPrimaryRaw] as GranularPosition;

      const applySide = (
        side: 'L' | 'R',
        hasFB: boolean,
        hasMid: boolean,
        hasWing: boolean
      ) => {
        const fb = `${side}B` as GranularPosition;
        const wb = `${side}WB` as GranularPosition;
        const wing = `${side}W` as GranularPosition;
        const midRaw = `${side}M`;
        const fbRaw = `${side}B`;
        const wingRaw = `${side}W`;

        const pCat = sofifaPrimaryRaw === midRaw ? 'mid' : sofifaPrimaryRaw === wingRaw ? 'wing' : sofifaPrimaryRaw === fbRaw ? 'fb' : 'other';

        // Special Case: both lm/rm, but only one lb/rb -> evaluate before roles
        if (hasBothMid && hasOnlyOneFB) {
          if (hasMid) {
            finalSet.add(wing);
            if (pCat === 'mid' || pCat === 'wing') primary = wing;
          }
          if (hasFB) {
            finalSet.add(wb);
            if (pCat === 'fb') primary = wb;
          }
          return;
        }

        // 1. Does not have both FB and Mid for this side
        if (!hasFB || !hasMid) {
          if (hasMid) {
            finalSet.add(wing);
            if (pCat === 'mid') primary = wing;
          }
          if (hasWing) {
            finalSet.add(wing);
            if (pCat === 'wing') primary = wing;
          }
          if (hasFB) {
            finalSet.add(fb);
            if (pCat === 'fb') primary = fb;
          }
          return;
        }

        // 2. Has FB, Mid, and Wing -> Check Primary Position
        if (hasFB && hasMid && hasWing) {
          if (pCat === 'mid' || pCat === 'wing') {
            primary = wing;
            finalSet.add(wing);
            finalSet.add(wb);
          } else if (pCat === 'fb') {
            primary = wb;
            finalSet.add(wb);
            finalSet.add(wing);
          } else {
            finalSet.add(wing);
            finalSet.add(wb);
          }
          return;
        }

        // 3. Has FB and Mid but no Wing -> Look at roles
        if (hasFB && hasMid && !hasWing) {
          const firstRoleLower = (roles[0] || '').toLowerCase();
          const isAttackingOrInverted = firstRoleLower.includes('attacking wingback') || firstRoleLower.includes('inverted wingback');

          if (isAttackingOrInverted) {
            if (pCat === 'fb' || pCat === 'mid') primary = wb;
            finalSet.add(wb);
            finalSet.add(fb);
          } else {
            if (pCat === 'fb' || pCat === 'mid') primary = fb;
            finalSet.add(fb);
            finalSet.add(wb);
          }
          return;
        }
      };

      applySide('L', hasLB, hasLM, hasLW);
      applySide('R', hasRB, hasRM, hasRW);

      // Add other positions (GK, CB, DM, CM, AM, ST)
      for (const raw of positionsRaw) {
        const mapped = POS_MAP[raw];
        if (mapped && !['LB', 'RB', 'LW', 'RW', 'LWB', 'RWB', 'LM', 'RM', 'LF', 'RF'].includes(raw)) {
          finalSet.add(mapped as GranularPosition);
        }
      }

      if (primary && !finalSet.has(primary)) {
        finalSet.add(primary);
      }

      // Final primary/secondary split
      const finalSecondary = Array.from(finalSet).filter(p => p !== primary);

      // Match to our DB by name
      const fullName = sp.fullName || [sp.firstName, sp.lastName].filter(Boolean).join(' ');
      const common = sp.commonName || '';
      const normFull = normalizeName(fullName);
      const normCommon = normalizeName(common);

      const candidates = Array.from(new Set([
        normFull, normCommon,
        firstLast(normFull), firstLast(normCommon),
      ])).filter(Boolean) as string[];

      let dbMatch = null;
      for (const c of candidates) {
        dbMatch = nameMap.get(c) ?? null;
        if (dbMatch) break;
      }

      const MANUAL_OVERRIDES: Record<string, string> = {
        'Louis Jordan Beyer': 'Jordan Beyer',
        'Toluwalase Emmanuel Arokodare': 'Tolu Arokodare',
        'Alejandro Jiménez Sánchez': 'Álex Jiménez Sánchez',
        'Tóth Alex László': 'Alex Tóth',
        'Xavier Quentin Shay Simons': 'Xavi Simons',
        'Valentín Mariano José Castellanos Giménez': 'Valentín Castellanos',
        'Abdul-Nasir Oluwatosin Oluwadoyinsolami Adarabioyo': 'Tosin Adarabioyo',
        'Eli Junior Eric Anat Kroupi': 'Junior Kroupi',
        'Eli Junior Kroupi': 'Junior Kroupi',
        'Adilson Angel Abreu de Almeida Gomés': 'Angel Gomes',
        'James William McConnell': 'James McConnell',
        'Lewis William Orford': 'Lewis Orford'
      };

      if (!dbMatch && MANUAL_OVERRIDES[fullName]) {
        dbMatch = nameMap.get(normalizeName(MANUAL_OVERRIDES[fullName])) ?? null;
      }

      if (!dbMatch && common && MANUAL_OVERRIDES[common]) {
        dbMatch = nameMap.get(normalizeName(MANUAL_OVERRIDES[common])) ?? null;
      }

      // Fuzzy matching is completely disabled to guarantee 100% precision and zero false positives.

      if (dbMatch) {
        matched++;
        updates.push({
          id: dbMatch.id,
          primary_position: primary as GranularPosition,
          secondary_positions: finalSecondary as GranularPosition[],
          sofifa_common_name: common || null,
        });
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
              sofifa_common_name: u.sofifa_common_name,
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
