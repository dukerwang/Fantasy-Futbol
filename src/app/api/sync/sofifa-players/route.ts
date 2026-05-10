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

function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .trim();
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface SoFifaSquadPlayer {
  id: number;
  fullName: string;
  commonName: string;
  positions: string[];
  roles: string[];
}

interface SoFifaTeamDetail {
  id: number;
  name: string;
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

  // 2. Teams are now entirely pre-fetched from HTML scraper
  if (!preloadedTeams) {
    return NextResponse.json({ error: 'preloadedTeams payload is required now that SoFIFA API is blocked.' }, { status: 400 });
  }
  
  const teams = preloadedTeams;

  // 4. Process squads → collect position updates
  const updates: Array<{
    id: string;
    primary_position: GranularPosition;
    secondary_positions: GranularPosition[];
  }> = [];
  let matched = 0;

  for (const team of teams) {

    for (const sp of team.players ?? []) {
      // Filter out SUB/RES
      const validPositions = sp.positions?.filter(p => !['SUB', 'RES'].includes(p)) || [];
      if (validPositions.length === 0) continue;

      const primaryRaw = validPositions[0];
      const secondaryRaw = validPositions.slice(1);
      const allRaw = new Set<string>([primaryRaw, ...secondaryRaw]);

      const finalAll = new Set<GranularPosition>();
      let primary = primaryRaw as GranularPosition | 'LM' | 'RM';

      const hasLM = allRaw.has('LM');
      const hasRM = allRaw.has('RM');
      const hasLB = allRaw.has('LB');
      const hasRB = allRaw.has('RB');
      const hasLW = allRaw.has('LW');
      const hasRW = allRaw.has('RW');
      
      const processed = new Set<string>();
      
      // Special Case: both LM and RM, and exactly one of LB or RB
      const hasExactlyOneFullback = (hasLB && !hasRB) || (!hasLB && hasRB);
      
      if (hasLM && hasRM && hasExactlyOneFullback) {
        finalAll.add('LW');
        finalAll.add('RW');
        if (hasLB) finalAll.add('LWB');
        if (hasRB) finalAll.add('RWB');
        
        if (primaryRaw === 'LM') primary = 'LW';
        else if (primaryRaw === 'RM') primary = 'RW';
        else if (primaryRaw === 'LB') primary = 'LWB';
        else if (primaryRaw === 'RB') primary = 'RWB';
        
        processed.add('LM');
        processed.add('RM');
        processed.add('LB');
        processed.add('RB');
        processed.add('LW');
        processed.add('RW');
      }

      const processSide = (side: 'L' | 'R') => {
        const M = `${side}M`;
        const B = `${side}B`;
        const W = `${side}W`;
        const WB = `${side}WB` as GranularPosition;
        
        if (processed.has(M) || processed.has(B) || processed.has(W)) return;
        
        const has_M = allRaw.has(M);
        const has_B = allRaw.has(B);
        const has_W = allRaw.has(W);
        
        // Does player have both fb and midfielder positions?
        if (!(has_M && has_B)) {
          if (has_M) {
            finalAll.add(W as GranularPosition);
            if (primaryRaw === M) primary = W as GranularPosition;
            processed.add(M);
          }
          if (has_B) {
            finalAll.add(B as GranularPosition);
            processed.add(B);
          }
          return;
        }
        
        // Player has both. Check if they have the same side wing
        if (has_W) {
          finalAll.add(W as GranularPosition);
          finalAll.add(WB);
          
          if (primaryRaw === M || primaryRaw === W) {
            primary = W as GranularPosition;
          } else if (primaryRaw === B) {
            primary = WB;
          }
          
          processed.add(M);
          processed.add(B);
          processed.add(W);
          return;
        }
        
        // Player has just M and B. Look at roles.
        let isAttackingOrInvertedWingback = false;
        if (sp.roles && sp.roles.length > 0) {
          const firstRole = sp.roles[0].toLowerCase();
          if (firstRole.includes('attacking wingback') || firstRole.includes('inverted wingback')) {
            isAttackingOrInvertedWingback = true;
          }
        }
        
        if (isAttackingOrInvertedWingback) {
          finalAll.add(WB);
          finalAll.add(B as GranularPosition);
          if (primaryRaw === M || primaryRaw === B) primary = WB;
        } else {
          finalAll.add(B as GranularPosition);
          finalAll.add(WB);
          if (primaryRaw === M || primaryRaw === B) primary = B as GranularPosition;
        }
        
        processed.add(M);
        processed.add(B);
      };
      
      processSide('L');
      processSide('R');
      
      for (const p of allRaw) {
        if (!processed.has(p)) {
          finalAll.add(p as GranularPosition);
        }
      }
      
      // Ensure primary is in the set
      finalAll.add(primary as GranularPosition);

      const finalSecondary = Array.from(finalAll).filter(p => p !== primary);

      // Match to our DB by name
      const common = sp.commonName || '';
      const normFull = normalizeName(sp.fullName || '');
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
        updates.push({ 
          id: dbMatch.id, 
          primary_position: primary as GranularPosition, 
          secondary_positions: finalSecondary 
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
            })
            .eq('id', u.id)
        )
      );
    }
  }

  return NextResponse.json({
    ok: true,
    teams: teams.length,
    matched,
    updated: updates.length,
  });
}
