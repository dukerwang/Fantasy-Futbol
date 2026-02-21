/**
 * POST /api/cron/process-auctions
 *
 * Resolves all expired FAAB auctions. Call this via an external cron every 5–10 minutes.
 * Protect with: Authorization header containing CRON_SECRET env var.
 *
 * Logic per expired (league_id, player_id) auction group:
 *   1. Find the highest bidder.
 *   2. Validate they still have enough FAAB.
 *   3. Drop their nominated player (if any).
 *   4. Add the won player to their roster.
 *   5. Deduct FAAB.
 *   6. Approve the winning claim; reject all others.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(req: NextRequest) {
  const cronSecret = req.headers.get('x-cron-secret');
  if (!cronSecret || cronSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();

  // Find all expired pending auction claims
  const { data: expiredClaims, error: fetchError } = await admin
    .from('waiver_claims')
    .select(`
      *,
      player:players(id, name),
      team:teams(id, team_name, faab_budget, user_id)
    `)
    .eq('status', 'pending')
    .eq('is_auction', true)
    .lt('expires_at', new Date().toISOString())
    .order('faab_bid', { ascending: false }); // highest bid first within each group

  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 });
  if (!expiredClaims || expiredClaims.length === 0) {
    return NextResponse.json({ ok: true, processed: 0 });
  }

  // Group by (league_id, player_id)
  type Claim = (typeof expiredClaims)[number];
  const groups = new Map<string, Claim[]>();
  for (const claim of expiredClaims) {
    const key = `${claim.league_id}::${claim.player_id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(claim);
  }

  let processed = 0;

  for (const [, claims] of groups) {
    // Claims are already sorted by faab_bid DESC; first is the winner
    const winner = claims[0];
    const losers = claims.slice(1);
    const { league_id, player_id } = winner;

    try {
      if (!winner.team_id) {
        // System bid won! Nobody placed a manual bid on this high-value player.
        // It gracefully voids itself, and the player reverts to being a regular Free Agent.
        await admin
          .from('waiver_claims')
          .update({ status: 'rejected' })
          .in('id', claims.map((c) => c.id));

        processed++;
        continue;
      }

      // Re-fetch winner's current FAAB to guard against double-spending
      const { data: freshTeam } = await admin
        .from('teams')
        .select('faab_budget')
        .eq('id', winner.team_id)
        .single();

      if (!freshTeam || freshTeam.faab_budget < winner.faab_bid) {
        // Winner can't pay — reject everyone (simplest safe behaviour)
        await admin
          .from('waiver_claims')
          .update({ status: 'rejected' })
          .in('id', claims.map((c) => c.id));
        console.warn(`[process-auctions] Winner ${winner.team_id} lacks FAAB for player ${player_id}. All rejected.`);
        continue;
      }

      // Drop the nominated player if one was specified
      if (winner.drop_player_id) {
        await admin
          .from('roster_entries')
          .delete()
          .eq('team_id', winner.team_id)
          .eq('player_id', winner.drop_player_id);

        await admin.from('transactions').insert({
          league_id,
          team_id: winner.team_id,
          player_id: winner.drop_player_id,
          type: 'drop',
          notes: `Dropped to make room for auction winner: ${(winner.player as any)?.name ?? player_id}`,
        });
      }

      // Add the won player to the winner's roster
      await admin.from('roster_entries').upsert(
        {
          team_id: winner.team_id,
          player_id,
          status: 'bench',
          acquisition_type: 'waiver',
          acquisition_value: winner.faab_bid,
          acquired_at: new Date().toISOString(),
        },
        { onConflict: 'team_id,player_id' },
      );

      // Deduct FAAB from the winning team
      await admin
        .from('teams')
        .update({ faab_budget: freshTeam.faab_budget - winner.faab_bid })
        .eq('id', winner.team_id);

      // Log the winning transaction
      await admin.from('transactions').insert({
        league_id,
        team_id: winner.team_id,
        player_id,
        type: 'waiver_claim',
        faab_bid: winner.faab_bid,
        notes: `Won auction for ${(winner.player as any)?.name ?? player_id} with £${winner.faab_bid}m bid`,
      });

      // Mark winner approved, losers rejected
      await admin
        .from('waiver_claims')
        .update({ status: 'approved' })
        .eq('id', winner.id);

      if (losers.length > 0) {
        await admin
          .from('waiver_claims')
          .update({ status: 'rejected' })
          .in('id', losers.map((c) => c.id));
      }

      processed++;
    } catch (err) {
      console.error('[process-auctions] Error processing auction group:', err);
    }
  }

  return NextResponse.json({ ok: true, processed });
}
