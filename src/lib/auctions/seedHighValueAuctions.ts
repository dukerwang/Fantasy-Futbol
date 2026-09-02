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
import { sendEmailToUsers } from '@/lib/email/sendEmailToUsers';
import { getSystemAuctionsEmail } from '@/lib/email/templates';
import { createNotification } from '@/lib/notifications/createNotification';
import { buildAuctionSubject, buildFeaturedNotice } from '@/lib/notifications/valueTiers';
import { timeLeft } from '@/lib/notifications/copy';
import { initialAuctionExpiry, nextCivilRelease } from '@/lib/auction/timer';
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
      const { candidates } = await findPromotedClubsAndArrivals(admin, league.id, league.previous_season, undefined, {
        requireTransferEvidence: true,
      });
      if (candidates.length === 0) continue;

      // One window for every seeding path — see initialAuctionExpiry's docblock
      // for the five places that previously disagreed.
      const { quietHours } = await getLeagueAuctionSettings(admin, league.id);
      const now = Date.now();
      const auctionRows = candidates.map((p) => {
        // A marquee arrival opens at the next noon rather than the moment the
        // nightly sync happens to run. Blind bidding makes the clock fair on
        // its own, but the "auction is live" notice is not: released at 4am it
        // reaches whoever is awake first, and the biggest lot of the window is
        // exactly where that head start is worth something. Cheaper lots still
        // open immediately — delaying those would block the routine streaming
        // this sweep exists to enable.
        const opensAtMs =
          Number(p.marketValue || 0) >= AUCTION_THRESHOLD
            ? nextCivilRelease(now, quietHours)
            : null;
        return {
          league_id: league.id,
          team_id: null,
          player_id: p.id,
          faab_bid: 0,
          priority: 999,
          status: 'pending',
          gameweek: 0,
          is_auction: true,
          // Measured from when the lot actually opens, so a deferred release
          // still gets its full tier window rather than losing the wait.
          expires_at: initialAuctionExpiry(opensAtMs ?? now, quietHours, p.marketValue),
          opens_at: opensAtMs === null ? null : new Date(opensAtMs).toISOString(),
          // Reference price for the auction premium — see migration 070.
          market_value_at_auction: p.marketValue,
        };
      });

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

      if (auctionRows[0]?.expires_at) {
        await notifyLeague(admin, league.id, candidates, auctionRows[0].expires_at);
      }
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
  expiresAt: string,
): Promise<void> {
  try {
    const { data: allTeams } = await admin.from('teams').select('id, user_id').eq('league_id', leagueId);
    if (!allTeams || allTeams.length === 0) return;

    const userIds = allTeams.map((t) => t.user_id);
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://gaffa.live';
    const playerInfo = candidates.map((p) => ({ name: p.name, value: p.marketValue }));
    await sendEmailToUsers(admin, {
      userIds,
      kind: 'auctions',
      subject: buildAuctionSubject(playerInfo, 'Transfer Window Alert: New Players on the Market'),
      html: getSystemAuctionsEmail(playerInfo, false, `${baseUrl}/league/${leagueId}`, AUCTION_THRESHOLD),
    });

    const featuredNotice = buildFeaturedNotice(candidates.map((c) => ({ name: c.name, value: c.marketValue })));
    const left = timeLeft(expiresAt);
    const clock = left
      ? left === 'closing now'
        ? ' Auctions closing now.'
        : ` Auctions open — ${left} to bid.`
      : ' Auctions are open.';
    for (const t of allTeams) {
      await createNotification(admin, {
        kind: 'auctions',
        leagueId,
        userId: t.user_id,
        title: 'New arrivals',
        pushTitle: 'Auctions open',
        content: `**${candidates.length}** new arrival${candidates.length === 1 ? ' has' : 's have'} hit the market.${clock}${featuredNotice}`,
        pushBody: left
          ? left === 'closing now'
            ? `${candidates.length} new auction${candidates.length === 1 ? '' : 's'} closing now.`
            : `${candidates.length} new auction${candidates.length === 1 ? '' : 's'}. ${left} to bid.`
          : `${candidates.length} new auction${candidates.length === 1 ? '' : 's'} are open.`,
        url: `/league/${leagueId}/transfers/auctions`,
      });
    }
  } catch (err) {
    console.error('[seedHighValueAuctions] Failed to send notifications:', err);
  }
}
