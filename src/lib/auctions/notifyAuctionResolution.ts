/**
 * Turns a `resolve_single_player_auction_rpc` result into winner/seller/loser
 * emails + in-game notices.
 *
 * Pulled out of the process-auctions cron sweep so Buy Now purchases — which
 * resolve this same RPC inline (see auctions/bid/route.ts) — get identical
 * notifications instead of silently getting none. Once Buy Now resolves an
 * auction, the cron sweep never sees it again (it's no longer `pending`), so
 * this must be called from every place that can be the one to resolve it.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendEmail } from '@/lib/email/client';
import { getAuctionWonEmail, getPlayerSoldEmail } from '@/lib/email/templates';
import { createNotification } from '@/lib/notifications/createNotification';
import { buildHereWeGo } from '@/lib/notifications/hereWeGo';

export interface AuctionResolutionResult {
  success: boolean;
  won: boolean;
  deferred?: boolean;
  error?: string;
  winner_claim_id?: string;
  winner_team_id?: string;
  winner_team_name?: string;
  winner_user_id?: string;
  winner_bid?: number;
  winner_severance?: number;
  winner_status?: string;
  drop_player_name?: string;
  initiator_team_name?: string;
  scout_amount?: number;
  scout_team_id?: string;
  solidarity_per_club?: number;
  solidarity_club_count?: number;
  losing_teams?: { team_id: string; team_name: string; user_id: string; faab_bid: number }[];
  sale_listing_id?: string | null;
  seller_team_id?: string | null;
}

/** No-op unless `resData.won && resData.winner_team_id` — safe to call unconditionally after a resolve. */
export async function notifyAuctionResolution(
  admin: SupabaseClient,
  params: {
    leagueId: string;
    playerName: string;
    /** The player's real-world (Transfermarkt) market value, if known — tier escalates off whichever is higher: this or the winning bid, so a bargain FAAB pickup of a genuine superstar still reads as a big deal. */
    playerMarketValue?: number | null;
    /** Number of real (non-placeholder) bidders in the auction — drives the "atmosphere" copy. Buy Now purchases are uncontested by definition. */
    bidderCount: number;
    resData: AuctionResolutionResult;
  },
): Promise<void> {
  const { leagueId, playerName, playerMarketValue, bidderCount, resData } = params;
  if (!resData.won || !resData.winner_team_id) return;

  try {
    const { data: leagueTeams } = await admin
      .from('teams')
      .select('id, team_name, user_id')
      .eq('league_id', leagueId);

    const winnerTeamName = resData.winner_team_name;
    const winnerUserId = resData.winner_user_id;
    const dropPlayerName = resData.drop_player_name;
    const initiatorTeamName = resData.initiator_team_name;
    const winnerBid = resData.winner_bid!;
    const tierValue = Math.max(winnerBid, Number(playerMarketValue ?? 0));

    const userIds = (leagueTeams ?? []).map((t) => t.user_id);
    const { data: users } = await admin.from('users').select('email').in('id', userIds);
    const leagueEmails = (users ?? []).map((u) => u.email).filter(Boolean);

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://gaffa.live';

    if (leagueEmails.length > 0) {
      await sendEmail({
        to: leagueEmails,
        subject: `Auction Won: ${playerName} signed by ${winnerTeamName ?? 'Club'}`,
        html: getAuctionWonEmail(
          playerName,
          winnerTeamName ?? 'Unknown Club',
          winnerBid,
          tierValue,
          bidderCount,
          dropPlayerName || null,
          initiatorTeamName || null,
          `${baseUrl}/league/${leagueId}`,
        ),
      });
    }

    const winDetailMd = `**${playerName}** to **${winnerTeamName ?? 'Unknown Club'}** for €${winnerBid}m`;
    const { eyebrow, lead } = buildHereWeGo('signing', winDetailMd, tierValue);

    // 1. Notify the winner
    if (winnerUserId) {
      await createNotification(admin, {
        leagueId,
        userId: winnerUserId,
        title: eyebrow || 'Auction Won!',
        content: `${lead}${resData.winner_severance ? ` **${dropPlayerName}** was dropped to waivers to clear roster space.` : ''}`,
        url: `/league/${leagueId}/team`,
      });
    }

    // Public league lobby announcement — the live "here we go" news ticker.
    await admin.from('chat_messages').insert({
      league_id: leagueId,
      is_system: true,
      message: `[SYSTEM:ANNOUNCEMENT] ${lead}`,
    });

    // 1b. Notify the seller (if player sale)
    if (resData.sale_listing_id && resData.seller_team_id) {
      const { data: sellerTeam } = await admin
        .from('teams')
        .select('user_id, team_name')
        .eq('id', resData.seller_team_id)
        .single();

      if (sellerTeam?.user_id) {
        const sellDetailMd = `**${playerName}** to **${winnerTeamName}** for €${winnerBid}m`;
        const sellLine = buildHereWeGo('signing', sellDetailMd, tierValue);
        await createNotification(admin, {
          leagueId,
          userId: sellerTeam.user_id,
          title: sellLine.eyebrow || 'Player Sold!',
          content: sellLine.lead,
          url: `/league/${leagueId}/team`,
        });

        const { data: sellerUser } = await admin
          .from('users')
          .select('email')
          .eq('id', sellerTeam.user_id)
          .single();

        if (sellerUser?.email) {
          await sendEmail({
            to: [sellerUser.email],
            subject: `Player Sold! ${playerName} transfer complete`,
            html: getPlayerSoldEmail(playerName, winnerTeamName ?? 'Another club', winnerBid, tierValue, `${baseUrl}/league/${leagueId}`),
          });
        }
      }
    }

    // 2. Notify the losing bidders
    const losingBidders = resData.losing_teams ?? [];
    await Promise.all(
      losingBidders.map(async (loser) => {
        if (loser.user_id) {
          await createNotification(admin, {
            leagueId,
            userId: loser.user_id,
            title: 'Waiver Auction Lost',
            content: `Your waiver bid of **€${loser.faab_bid}m** for **${playerName}** was unsuccessful. **${winnerTeamName ?? 'Another team'}** won the signature for **€${winnerBid}m**.`,
            url: `/league/${leagueId}/players`,
          });
        }
      }),
    );
  } catch (err) {
    console.error('[notifyAuctionResolution] Failed to send auction result notifications:', err);
  }
}
