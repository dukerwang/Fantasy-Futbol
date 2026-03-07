/**
 * POST /api/cron/process-auctions
 *
 * Resolves all expired FAAB auctions. Call this via an external cron every 5–10 minutes.
 * Protect with: x-cron-secret header matching CRON_SECRET env var.
 *
 * Logic per expired (league_id, player_id) auction group:
 *   1. Separate system placeholder claims from real manager bids.
 *   2. Waterfall through real bids (highest first) until a manager who can afford
 *      their bid + drop-player severance fee (10% of drop player market value) is found.
 *   3. Process the winner: drop nominated player (charging severance), add won player,
 *      deduct total FAAB cost, log transactions.
 *   4. Award Scout's Rebate (20%, capped £5m) to the auction initiator if a different
 *      team won.
 *   5. Approve winning claim, reject all others.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const maxDuration = 60; // 1 minute max for Vercel Hobby tier


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
      player:players!waiver_claims_player_id_fkey(id, name),
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
  // Sort within each group by faab_bid DESC so winner is first element.
  type Claim = (typeof expiredClaims)[number];
  const groups = new Map<string, Claim[]>();
  for (const claim of expiredClaims) {
    const key = `${claim.league_id}::${claim.player_id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(claim);
  }

  let processed = 0;

  for (const [, claims] of groups) {
    const { league_id, player_id } = claims[0];

    try {
      // Separate the system-seed placeholder from real manager bids.
      // Real bids are already sorted faab_bid DESC (highest first).
      const realClaims = claims.filter((c) => c.team_id !== null);

      if (realClaims.length === 0) {
        // No manager placed a bid — void the auction; player re-enters free agency.
        await admin
          .from('waiver_claims')
          .update({ status: 'rejected' })
          .in('id', claims.map((c) => c.id));
        processed++;
        continue;
      }

      // ── Waterfall: find the first bidder who can cover bid + severance fee ──
      let winner: Claim | null = null;
      let winnerSeveranceFee = 0;
      let winnerFreshFaab = 0;

      for (const candidate of realClaims) {
        // Re-fetch FAAB to guard against same-tick double-spend
        const { data: freshTeam } = await admin
          .from('teams')
          .select('faab_budget')
          .eq('id', candidate.team_id!)
          .single();

        if (!freshTeam) continue;

        // Severance fee = 10% of dropped player's market value (rounded down)
        let severanceFee = 0;
        let dropPlayerName = '';
        if (candidate.drop_player_id) {
          const { data: dropPlayer } = await admin
            .from('players')
            .select('market_value, name')
            .eq('id', candidate.drop_player_id)
            .single();
          if (dropPlayer) {
            severanceFee = Math.floor(Number(dropPlayer.market_value || 0) * 0.1);
            dropPlayerName = dropPlayer.name;
          }
        }

        const totalRequired = candidate.faab_bid + severanceFee;
        if (freshTeam.faab_budget < totalRequired) {
          console.warn(
            `[process-auctions] ${candidate.team_id} needs £${totalRequired}m ` +
            `(bid £${candidate.faab_bid}m + £${severanceFee}m severance) ` +
            `but only has £${freshTeam.faab_budget}m. Skipping to next bidder.`,
          );
          continue;
        }

        winner = candidate;
        winnerSeveranceFee = severanceFee;
        winnerFreshFaab = freshTeam.faab_budget;
        // Attach the fetched drop player name to the candidate object so we can use it below
        (winner as any).drop_player_name = dropPlayerName;
        break;
      }

      if (!winner) {
        // No valid winner found — reject all claims, player returns to free agency.
        await admin
          .from('waiver_claims')
          .update({ status: 'rejected' })
          .in('id', claims.map((c) => c.id));
        console.warn(`[process-auctions] No valid winner for player ${player_id} in league ${league_id}. All claims rejected.`);
        processed++;
        continue;
      }

      const losers = claims.filter((c) => c.id !== winner!.id);

      // Drop the nominated player (charging severance if applicable)
      if (winner.drop_player_id) {
        await admin
          .from('roster_entries')
          .delete()
          .eq('league_id', league_id)
          .eq('team_id', winner.team_id!)
          .eq('player_id', winner.drop_player_id);

        const severanceNote = winnerSeveranceFee > 0
          ? ` (£${winnerSeveranceFee}m severance paid)`
          : '';
        const dropName = (winner as any).drop_player_name || winner.drop_player_id;
        await admin.from('transactions').insert({
          league_id,
          team_id: winner.team_id,
          player_id: winner.drop_player_id,
          type: 'drop',
          compensation_amount: winnerSeveranceFee,
          notes: `Dropped to make room for auction winner: ${(winner.player as any)?.name ?? player_id} (dropped ${dropName})${severanceNote}`,
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

      // Deduct total cost (bid + severance) from the winning team
      const totalCost = winner.faab_bid + winnerSeveranceFee;
      await admin
        .from('teams')
        .update({ faab_budget: winnerFreshFaab - totalCost })
        .eq('id', winner.team_id!);

      // Log the winning transaction
      const winNote = winnerSeveranceFee > 0
        ? `Won auction for ${(winner.player as any)?.name ?? player_id} with £${winner.faab_bid}m bid (+ £${winnerSeveranceFee}m drop severance)`
        : `Won auction for ${(winner.player as any)?.name ?? player_id} with £${winner.faab_bid}m bid`;
      await admin.from('transactions').insert({
        league_id,
        team_id: winner.team_id,
        player_id,
        type: 'waiver_claim',
        faab_bid: winner.faab_bid,
        compensation_amount: winnerSeveranceFee,
        notes: winNote,
      });

      // ── Scout's Rebate (Finder's Fee) ──────────────────────────────────────
      // Initiator = earliest-created claim. System claims (team_id: null) excluded.
      const initiator = claims.reduce<Claim>((earliest, c) =>
        new Date(c.created_at) < new Date(earliest.created_at) ? c : earliest,
        claims[0],
      );

      if (
        initiator.team_id &&
        initiator.team_id !== winner.team_id &&
        winner.faab_bid > 0
      ) {
        const rebateAmount = Math.min(Math.floor(winner.faab_bid * 0.2), 5);
        if (rebateAmount > 0) {
          const { data: initiatorTeam } = await admin
            .from('teams')
            .select('faab_budget')
            .eq('id', initiator.team_id)
            .single();

          if (initiatorTeam) {
            await admin
              .from('teams')
              .update({ faab_budget: initiatorTeam.faab_budget + rebateAmount })
              .eq('id', initiator.team_id);

            await admin.from('transactions').insert({
              league_id,
              team_id: initiator.team_id,
              player_id,
              type: 'rebate',
              faab_bid: rebateAmount,
              notes: `Scout's rebate: 20% of £${winner.faab_bid}m winning bid for ${(winner.player as any)?.name ?? player_id}`,
            });
          }
        }
      }

      // Mark winner approved, all others rejected
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
