/**
 * Gaffa — Mid-Season High-Value / Promoted-Club Auction Sweep
 *
 * Runs automatically as part of the nightly player sync (see
 * /api/sync/players), not a commissioner or admin-triggered action — there's
 * nothing destructive here (no drops, no locks), just opening a standard
 * 48-hour blind FAAB auction for players the transfer market has made
 * newly relevant, same as any other waiver auction.
 *
 * This closes the gap Kickoff leaves behind: Kickoff only scans for
 * high-value/promoted arrivals once, at the start of the season. Any player
 * who transfers into the Prem (or a promoted club adds mid-window) after
 * that point would otherwise never get swept into an auction.
 *
 * Reuses the exact same "who's eligible" logic as Kickoff
 * (findPromotedClubsAndArrivals) so the two mechanisms never disagree about
 * what counts as a high-value or promoted-club arrival.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { findPromotedClubsAndArrivals, AUCTION_THRESHOLD } from '@/lib/offseason/seasonKickoff';
import { sendEmail } from '@/lib/email/client';
import { getSystemAuctionsEmail } from '@/lib/email/templates';
import { createNotification } from '@/lib/notifications/createNotification';
import { buildAuctionSubject, buildFeaturedNotice } from '@/lib/notifications/valueTiers';
import { initialAuctionExpiry } from '@/lib/auction/timer';
import { getLeagueAuctionSettings } from '@/lib/auction/leagueAuctionSettings';

interface LeagueRow {
  id: string;
  name: string;
  previous_season: string | null;
}

export interface SeedResult {
  leagueId: string;
  leagueName: string;
  auctionsCreated: number;
  players: string[];
}

/**
 * Sweeps every in-season league for unowned high-value/promoted-club
 * players and opens a 48h system auction for any that qualify. Safe to run
 * repeatedly — players already owned or already in a pending auction are
 * skipped, so this is idempotent per player per league.
 */
export async function seedHighValueAuctions(admin: SupabaseClient): Promise<SeedResult[]> {
  // INVARIANT: nothing may be auctioned before a league has drafted.
  //
  // `status = 'active'` is what enforces it — a league is 'setup' or 'drafting'
  // until the final pick lands, so a €90m arrival on August 12th with a draft
  // scheduled for the 15th creates no auction and instead falls into the draft
  // pool, which draft/page.tsx builds from `players` where is_active = true with
  // no snapshot or cutoff.
  //
  // This filter reads like "leagues in play", so widening it would silently
  // start auctioning players out from under an undrafted league. Do not relax it
  // without replacing the guarantee. Asserted in
  // src/lib/auctions/__tests__/seedingWaves.test.ts.
  const { data: leagues } = await admin
    .from('leagues')
    .select('id, name, previous_season')
    .eq('status', 'active')
    .eq('roster_locked', false);

  const results: SeedResult[] = [];

  for (const league of (leagues ?? []) as LeagueRow[]) {
    try {
      const { candidates } = await findPromotedClubsAndArrivals(admin, league.id, league.previous_season);
      if (candidates.length === 0) continue;

      // One window for every seeding path — see initialAuctionExpiry's docblock
      // for the five places that previously disagreed.
      const { quietHours } = await getLeagueAuctionSettings(admin, league.id);
      const expiresAt = initialAuctionExpiry(Date.now(), quietHours);
      const auctionRows = candidates.map((p) => ({
        league_id: league.id,
        team_id: null,
        player_id: p.id,
        faab_bid: 0,
        priority: 999,
        status: 'pending',
        gameweek: 0,
        is_auction: true,
        expires_at: expiresAt,
        opens_at: null,
        // Reference price for the auction premium — see migration 070.
        market_value_at_auction: p.marketValue,
      }));

      const { error: insertErr } = await admin.from('waiver_claims').insert(auctionRows);
      if (insertErr) {
        console.error(`[seedHighValueAuctions] Failed to seed auctions for league ${league.id}:`, insertErr.message);
        continue;
      }

      results.push({
        leagueId: league.id,
        leagueName: league.name,
        auctionsCreated: candidates.length,
        players: candidates.map((p) => p.name),
      });

      await notifyLeague(admin, league.id, candidates);
    } catch (err) {
      console.error(`[seedHighValueAuctions] League ${league.id} failed:`, err);
    }
  }

  return results;
}

async function notifyLeague(
  admin: SupabaseClient,
  leagueId: string,
  candidates: { id: string; name: string; marketValue: number }[],
): Promise<void> {
  try {
    const { data: allTeams } = await admin.from('teams').select('id, user_id').eq('league_id', leagueId);
    if (!allTeams || allTeams.length === 0) return;

    const userIds = allTeams.map((t) => t.user_id);
    const { data: users } = await admin.from('users').select('email').in('id', userIds);
    const emails = (users ?? []).map((u) => u.email).filter(Boolean);

    if (emails.length > 0) {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://gaffa.live';
      const playerInfo = candidates.map((p) => ({ name: p.name, value: p.marketValue }));
      await sendEmail({
        to: emails,
        subject: buildAuctionSubject(playerInfo, 'Transfer Window Alert: New Players on Waivers'),
        html: getSystemAuctionsEmail(playerInfo, false, `${baseUrl}/league/${leagueId}`, AUCTION_THRESHOLD),
      });
    }

    const featuredNotice = buildFeaturedNotice(candidates.map((c) => ({ name: c.name, value: c.marketValue })));
    for (const t of allTeams) {
      await createNotification(admin, {
        leagueId,
        userId: t.user_id,
        title: 'New Transfer Auction Open',
        content: `**${candidates.length}** new high-value or promoted-club arrival(s) have hit the transfer market and gone up for a 48-hour system auction.${featuredNotice}`,
        url: `/league/${leagueId}`,
      });
    }
  } catch (err) {
    console.error('[seedHighValueAuctions] Failed to send notifications:', err);
  }
}
