/**
 * Gaffa — Season Kickoff
 *
 * Runs after Season Reset, once the commissioner-free grace period for
 * relegated/departed players is over. This is a platform-admin action
 * (see /admin/offseason), not something league commissioners trigger.
 *
 * For one league, this:
 * 1. Re-syncs players from FPL (latest squads for the new season)
 * 2. Processes relegation/transfer-out compensation (grace period ends)
 * 3. Seeds a 96-hour blind FAAB auction for every unowned player that is
 *    either high-value (>= £50m market value) or from a newly-promoted club
 * 4. Sends email + in-game notifications
 * 5. Unlocks rosters and flips the league to `status: 'active'`
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { sendEmailToUsers } from '@/lib/email/sendEmailToUsers';
import { getSystemAuctionsEmail } from '@/lib/email/templates';
import { previewRelegationCompensation, processRelegationCompensation } from '@/lib/offseason/relegationHandler';
import { syncPlayersFromFpl } from '@/lib/players/syncPlayers';
import { createNotification } from '@/lib/notifications/createNotification';
import { getPlayerDisplayName } from '@/lib/players/displayName';
import { initialAuctionExpiry } from '@/lib/auction/timer';
import { getLeagueAuctionSettings } from '@/lib/auction/leagueAuctionSettings';
import { assignReleaseWaves } from '@/lib/auctions/seedingWaves';
import { buildAuctionSubject, buildFeaturedNotice } from '@/lib/notifications/valueTiers';

export const AUCTION_THRESHOLD = 50.0;

interface LeagueRow {
  id: string;
  status: string;
  current_season: string;
  previous_season: string | null;
  roster_locked: boolean;
}

interface SummerArrival {
  id: string;
  name: string;
  marketValue: number;
  pl_team: string | null;
  isPromoted: boolean;
}

export interface KickoffPreview {
  leagueId: string;
  leagueStatus: string;
  rosterLocked: boolean;
  relegationPlayers: Awaited<ReturnType<typeof previewRelegationCompensation>>;
  totalRelegationFaab: number;
  summerArrivals: SummerArrival[];
}

export interface KickoffResult {
  leagueId: string;
  relegationResults: Awaited<ReturnType<typeof processRelegationCompensation>>;
  auctionsCreated: number;
  auctionedPlayers: string[];
}

/**
 * Shared by both Kickoff and the ongoing mid-season auction sweep — finds
 * every unowned, non-auctioned player in one league who is either
 * high-value (>= £50m) or from a club not present in that league's
 * previous season (i.e. promoted).
 */
export async function findPromotedClubsAndArrivals(
  admin: SupabaseClient,
  leagueId: string,
  previousSeason: string | null,
  /**
   * Explicit set of clubs that made up the previous season. Kickoff passes a
   * snapshot taken *before* it re-syncs from FPL — that's the only reliable
   * baseline, because after the sync last season's clubs and this season's
   * clubs are both sitting in `players` and `pl_season` tagging can't tell
   * them apart. Omitted by the mid-season sweep, which falls back to tags.
   */
  previousClubs?: Set<string>,
  options?: {
    /**
     * Kickoff wants every unowned high-value player as its one-time initial
     * pool — there's no prior state to compare against, so "high-value" alone
     * is the right bar. The ongoing mid-season sweep reuses this same
     * eligibility check, but its whole premise (see seedHighValueAuctions.ts)
     * is catching players who transfer in *after* kickoff — so for it,
     * "unowned and expensive" isn't enough on its own, or any star who simply
     * never got drafted reads as a fresh arrival. Set true to also require
     * `pl_team_changed_at` evidence that the player's club actually changed.
     */
    requireTransferEvidence?: boolean;
  },
): Promise<{ promotedClubs: Set<string>; candidates: SummerArrival[] }> {
  // roster_entries has no league_id column — ownership is only reachable
  // through teams. The previous query silently errored, which left the
  // "already owned" filter empty and put rostered players up for auction.
  const { data: leagueTeams, error: teamsErr } = await admin
    .from('teams')
    .select('id')
    .eq('league_id', leagueId);
  if (teamsErr) throw new Error(`Failed to load league teams: ${teamsErr.message}`);

  const teamIds = (leagueTeams ?? []).map((t) => t.id);
  let ownedPlayerIds = new Set<string>();
  if (teamIds.length > 0) {
    const { data: ownedEntries, error: ownedErr } = await admin
      .from('roster_entries')
      .select('player_id')
      .in('team_id', teamIds)
      .not('player_id', 'is', null);
    if (ownedErr) throw new Error(`Failed to load rostered players: ${ownedErr.message}`);
    ownedPlayerIds = new Set((ownedEntries ?? []).map((e) => e.player_id));
  }

  // Retained players have no roster entry — the whole point is that they are
  // not squad members — so a roster-only ownership check reads them as free
  // agents and puts them on the block out from under the manager who paid for
  // them with forgone compensation. Rights are ownership for this purpose.
  const { getRightsHeldPlayerIds } = await import('@/lib/departures/decisions');
  for (const id of await getRightsHeldPlayerIds(admin, leagueId)) {
    ownedPlayerIds.add(id);
  }

  // Every system auction this league has EVER opened, not just the live ones.
  // Filtering on status='pending' meant a player whose auction expired unsold
  // became eligible again on the next sweep, re-auctioning the same free agents
  // indefinitely. A system auction is a one-time "this player just became
  // available" event, so once a league has had one for a player, it's done.
  // (team_id IS NULL distinguishes the system-seeded anchor row from the
  // managers' actual bids, which share the same table.)
  const { data: priorAuctions, error: auctionErr } = await admin
    .from('waiver_claims')
    .select('player_id')
    .eq('league_id', leagueId)
    .eq('is_auction', true)
    .is('team_id', null);
  if (auctionErr) throw new Error(`Failed to load prior auctions: ${auctionErr.message}`);
  const auctionPlayerIds = new Set((priorAuctions ?? []).map((a) => a.player_id));

  let prevTeams = previousClubs ?? new Set<string>();

  if (prevTeams.size === 0) {
    const { data: prevPlayers } = await admin
      .from('players')
      .select('pl_team')
      .eq('pl_season', previousSeason ?? '');
    prevTeams = new Set((prevPlayers ?? []).map((p) => p.pl_team).filter(Boolean));
  }

  const { data: currPlayers } = await admin.from('players').select('pl_team').eq('is_active', true);
  const promotedClubs = new Set<string>();
  // If prevTeams is empty we have no baseline at all — treating every club as
  // promoted would auction the entire league, so detect nothing instead.
  if (prevTeams.size > 0) {
    for (const p of currPlayers ?? []) {
      if (p.pl_team && !prevTeams.has(p.pl_team)) promotedClubs.add(p.pl_team);
    }
  }

  const { data: allCandidatePlayers } = await admin
    .from('players')
    .select('id, name, web_name, market_value, pl_team, pl_team_changed_at')
    .eq('is_active', true);

  const requireTransferEvidence = options?.requireTransferEvidence ?? false;

  const candidates = (allCandidatePlayers ?? [])
    .filter((p) => {
      if (ownedPlayerIds.has(p.id) || auctionPlayerIds.has(p.id)) return false;
      let isHighValue = Number(p.market_value || 0) >= AUCTION_THRESHOLD;
      if (isHighValue && requireTransferEvidence) isHighValue = p.pl_team_changed_at != null;
      const isPromoted = !!(p.pl_team && promotedClubs.has(p.pl_team));
      return isHighValue || isPromoted;
    })
    .map((p) => ({
      id: p.id,
      name: getPlayerDisplayName(p, 'full'),
      marketValue: p.market_value as number,
      pl_team: p.pl_team,
      isPromoted: !!(p.pl_team && promotedClubs.has(p.pl_team)),
    }));

  return { promotedClubs, candidates };
}

export async function previewSeasonKickoff(admin: SupabaseClient, leagueId: string): Promise<KickoffPreview> {
  const { data: league, error } = await admin
    .from('leagues')
    .select('id, status, current_season, previous_season, roster_locked')
    .eq('id', leagueId)
    .single();

  if (error || !league) throw new Error('League not found');
  const l = league as LeagueRow;

  // Open decisions for any departure the sync has detected but not yet
  // recorded, so the preview reflects the full bill rather than only what last
  // night's cron happened to catch. Idempotent, and opening a pending decision
  // is not itself destructive — it is what the nightly sync would do anyway.
  const { recordDepartures } = await import('@/lib/departures/detect');
  await recordDepartures(admin, leagueId, {
    seasonFrom: l.previous_season ?? l.current_season,
    decideBy: null,
    notify: false,
  });

  const { candidates } = await findPromotedClubsAndArrivals(admin, leagueId, l.previous_season);
  const relegationPreview = await previewRelegationCompensation(admin, leagueId);

  return {
    leagueId,
    leagueStatus: l.status,
    rosterLocked: l.roster_locked,
    relegationPlayers: relegationPreview,
    totalRelegationFaab: relegationPreview.reduce((s, p) => s + p.compensationFaab, 0),
    summerArrivals: candidates,
  };
}

export async function runSeasonKickoff(admin: SupabaseClient, leagueId: string): Promise<KickoffResult> {
  const { data: league, error } = await admin
    .from('leagues')
    .select('id, status, roster_locked, previous_season, current_season')
    .eq('id', leagueId)
    .single();

  if (error || !league) throw new Error('League not found');
  const l = league as LeagueRow;

  if (l.status !== 'offseason') {
    throw new Error(`League ${leagueId} is not in offseason. Cannot kick off.`);
  }

  // Refuse to run against a league that fails preflight. The admin UI shows
  // this before the button is enabled, but the check lives here too so a direct
  // API call can't skip it — Kickoff is irreversible, and the failures it
  // guards against (paying compensation for players still in the PL, pricing a
  // payout off a junk market value) are silent and expensive.
  const { runKickoffPreflight } = await import('@/lib/offseason/kickoffPreflight');
  const preflight = await runKickoffPreflight(admin, leagueId);
  if (!preflight.ready) {
    const blockers = preflight.issues.filter((i) => i.severity === 'blocker');
    throw new Error(
      `Preflight failed for ${preflight.leagueName}: ${blockers.map((b) => b.message).join(' | ')}`,
    );
  }

  const seasonFrom = l.previous_season ?? l.current_season;
  const seasonTo = l.current_season;

  // Snapshot last season's club set BEFORE the sync. Once the sync lands,
  // last season's squads and this season's squads are both in `players` and
  // there's no way left to tell which clubs are newly promoted.
  const { data: preSyncPlayers } = await admin.from('players').select('pl_team').eq('is_active', true);
  const previousClubs = new Set<string>(
    (preSyncPlayers ?? []).map((p) => p.pl_team).filter(Boolean) as string[],
  );

  // Re-sync players from FPL so promoted-club squads are current before we
  // decide who's a "new arrival" for this league's auction seeding.
  const syncResult = await syncPlayersFromFpl(admin);
  if (syncResult.error) {
    throw new Error(`Player sync failed: ${syncResult.error}`);
  }

  // Seed auctions BEFORE processing relegation drops. Relegation is the
  // destructive half — if auction seeding is going to fail (bad column, RLS,
  // constraint), it must fail while the league is still untouched and the
  // whole action is safe to retry.
  const { candidates: playersToAuction } = await findPromotedClubsAndArrivals(
    admin,
    leagueId,
    seasonFrom,
    previousClubs,
  );

  if (playersToAuction.length > 0) {
    const { quietHours } = await getLeagueAuctionSettings(admin, leagueId);
    const now = Date.now();

    // Only the elite tier is staggered. Promoted-club players are cheap and
    // numerous, and delaying them would block routine roster building.
    const elite = playersToAuction.filter((p) => Number(p.marketValue || 0) >= AUCTION_THRESHOLD);
    const rest = playersToAuction.filter((p) => Number(p.marketValue || 0) < AUCTION_THRESHOLD);

    const { count: teamCount } = await admin
      .from('teams')
      .select('id', { count: 'exact', head: true })
      .eq('league_id', leagueId);

    const waved = assignReleaseWaves(elite, teamCount ?? 0, now);

    const auctionInserts = [
      ...waved.map((p) => ({ player: p, opensAtMs: p.opensAtMs })),
      ...rest.map((p) => ({ player: p, opensAtMs: null as number | null })),
    ].map(({ player, opensAtMs }) => ({
      league_id: leagueId,
      team_id: null,
      player_id: player.id,
      faab_bid: 0,
      priority: 999,
      status: 'pending',
      gameweek: 0,
      is_auction: true,
      // The 72h window runs from when the auction OPENS, not from kickoff —
      // otherwise a wave four releases already expired.
      expires_at: initialAuctionExpiry(opensAtMs ?? now, quietHours),
      opens_at: opensAtMs === null ? null : new Date(opensAtMs).toISOString(),
      // Reference price for the auction premium — see migration 070.
      market_value_at_auction: player.marketValue,
    }));

    const { error: insertErr } = await admin.from('waiver_claims').insert(auctionInserts);
    if (insertErr) throw new Error(`Failed to create summer auctions: ${insertErr.message}`);
  }

  // Grace period ends now — relegated/departed players are dropped & paid out.
  const relegationResults = await processRelegationCompensation(admin, leagueId, seasonFrom, seasonTo);

  // --- Notifications (best-effort; never fail kickoff over notification issues) ---
  try {
    const { data: allTeams } = await admin.from('teams').select('id, user_id').eq('league_id', leagueId);
    if (allTeams && allTeams.length > 0) {
      const userIds = allTeams.map((t) => t.user_id);
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://gaffa.live';
      const playerInfo = playersToAuction.map((p) => ({ name: p.name, value: p.marketValue }));
      await sendEmailToUsers(admin, {
        userIds,
        kind: 'club',
        subject: buildAuctionSubject(playerInfo, 'The Season Has Begun!'),
        html: getSystemAuctionsEmail(playerInfo, true, `${baseUrl}/league/${leagueId}`, AUCTION_THRESHOLD),
      });

      const featuredNotice = buildFeaturedNotice(playersToAuction.map((p) => ({ name: p.name, value: p.marketValue })));
      for (const t of allTeams) {
        await createNotification(admin, {
          kind: 'club',
          leagueId,
          userId: t.user_id,
          title: 'Season started',
          pushTitle: 'Season started',
          content: `The new season is underway. Rosters are unlocked, and **${playersToAuction.length}** summer arrivals have gone to auction.${featuredNotice}`,
          pushBody: `${playersToAuction.length} summer auction${playersToAuction.length === 1 ? '' : 's'} open. 72h to bid.`,
          url: `/league/${leagueId}`,
        });
      }

      const userIdByTeamId = new Map(allTeams.map((t) => [t.id, t.user_id]));
      for (const r of relegationResults) {
        for (const affected of r.affectedRosters) {
          const userId = userIdByTeamId.get(affected.teamId);
          if (userId) {
            await createNotification(admin, {
              kind: 'club',
              leagueId,
              userId,
              title: 'Relegation Paid',
              content: `**${r.playerName}** (${r.club}) has been dropped due to relegation. You have been compensated with **+€${r.compensationFaab}m**.`,
              url: `/league/${leagueId}/finance`,
            });
          }
        }
      }
    }
  } catch (err) {
    console.error('[seasonKickoff] Failed to send kickoff notifications:', err);
  }

  const { error: updateErr } = await admin
    .from('leagues')
    .update({ status: 'active', roster_locked: false, updated_at: new Date().toISOString() })
    .eq('id', leagueId);

  if (updateErr) throw new Error(`Failed to activate league: ${updateErr.message}`);

  return {
    leagueId,
    relegationResults,
    auctionsCreated: playersToAuction.length,
    auctionedPlayers: playersToAuction.map((p) => p.name),
  };
}
