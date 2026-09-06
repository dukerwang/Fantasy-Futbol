/**
 * Tell the clubs who said they wanted this player that he is now gettable.
 *
 * One helper behind all three supply events (a listing, a system auction, a
 * drop) so the three cannot drift into saying different things about the same
 * situation — the failure mode CLAUDE.md records for the ICT coefficients,
 * which were duplicated across two files and silently disagreed.
 *
 * Best-effort throughout: a notification must never fail the listing insert
 * or the drop it hangs off, so every call site wraps this and this wraps
 * itself. A manager who misses a ping is a nuisance; a drop that half-applies
 * is a corrupted roster.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { matchTargets, type MatchablePlayer } from './matchTargets';
import { targetStance } from './targetStance';
import type { ClubRef } from '@/lib/notifications/clubRef';

interface NotifyOptions {
  leagueId: string;
  player: MatchablePlayer & { name?: string | null };
  /** The club putting him on the market. Its own targets never match. */
  seller: (ClubRef & { id: string }) | null;
  /** Price of entry in €m, when the event has one. */
  floor?: number | null;
  auctionOpen?: boolean;
  expiresAt?: string | number | Date | null;
  /** Where the notification should land. */
  url: string;
  /**
   * The listed player's own listing id, when this fired from a listing. Used
   * only to tag the seller's two-sided notice so it folds rather than stacks.
   */
  listingId?: string | null;
}

export interface TargetNotifyResult {
  notified: number;
  /** Clubs that had NAMED this player — the two-sided case. */
  namedSuitors: { teamId: string; teamName: string; userId: string; stance: string }[];
}

export async function notifyTargetMatches(
  admin: SupabaseClient,
  opts: NotifyOptions,
): Promise<TargetNotifyResult> {
  const empty: TargetNotifyResult = { notified: 0, namedSuitors: [] };

  try {
    const matches = await matchTargets(admin, opts.leagueId, opts.player, {
      excludeTeamId: opts.seller?.id ?? null,
      floor: opts.floor ?? null,
    });

    if (matches.length === 0) return empty;

    const { createNotification } = await import('@/lib/notifications/createNotification');
    const {
      targetAvailableNotice,
      targetProfileMatchNotice,
      targetTwoSidedNotice,
    } = await import('@/lib/notifications/copy');

    const playerName = opts.player.name ?? 'a player';
    const seller: ClubRef = opts.seller ?? { team_name: 'A club', abbreviation: null };
    const clock = { auctionOpen: opts.auctionOpen, expiresAt: opts.expiresAt };

    const namedSuitors: TargetNotifyResult['namedSuitors'] = [];

    await Promise.all(
      matches.map(async (match) => {
        const stance = targetStance({
          open_to_sale: match.target.open_to_sale,
          open_to_trade: match.target.open_to_trade,
          open_to_loan: match.target.open_to_loan,
          budget: match.target.budget,
        });

        if (match.named) {
          namedSuitors.push({
            teamId: match.team.id,
            teamName: match.team.team_name,
            userId: match.team.user_id,
            stance: stance.headline,
          });
        }

        // A club that NAMED him hears that he is available; a club that named
        // his POSITION hears the weaker, honest version. Flattening the two
        // would cry wolf on every squad-filler at that position.
        const notice = match.named
          ? opts.seller
            ? targetTwoSidedNotice(seller, playerName, '', 'suitor')
            : targetAvailableNotice(seller, playerName, clock)
          : targetProfileMatchNotice(seller, playerName, match.target.position ?? '', clock);

        await createNotification(admin, {
          kind: 'targets',
          leagueId: opts.leagueId,
          userId: match.team.user_id,
          ...notice,
          url: opts.url,
          tag: `target-hit-${match.target.id}-${opts.player.id}`,
        });
      }),
    );

    return { notified: matches.length, namedSuitors };
  } catch (err) {
    console.error('[targets] Failed to notify target matches:', err);
    return empty;
  }
}

/**
 * The other half of a two-sided match: tell the SELLER that somebody was
 * already chasing the player he just listed. Only fires when a club had
 * named him — a positional profile is not "somebody wants your player".
 */
export async function notifySellerOfSuitors(
  admin: SupabaseClient,
  opts: {
    leagueId: string;
    sellerUserId: string;
    playerName: string;
    suitors: TargetNotifyResult['namedSuitors'];
    url: string;
    listingId?: string | null;
  },
): Promise<void> {
  if (opts.suitors.length === 0) return;

  try {
    const { createNotification } = await import('@/lib/notifications/createNotification');
    const { targetTwoSidedNotice } = await import('@/lib/notifications/copy');

    // One notice naming the first suitor, however many there are. A seller
    // does not need four separate pings to learn his player is wanted; the
    // board carries the full list.
    const [first] = opts.suitors;
    const more = opts.suitors.length - 1;
    const notice = targetTwoSidedNotice(
      { team_name: first.teamName, abbreviation: null },
      opts.playerName,
      more > 0 ? `${first.stance} · ${more} other${more > 1 ? 's' : ''} watching` : first.stance,
      'seller',
    );

    await createNotification(admin, {
      kind: 'targets',
      leagueId: opts.leagueId,
      userId: opts.sellerUserId,
      ...notice,
      url: opts.url,
      tag: `target-two-sided-${opts.listingId ?? opts.playerName}`,
    });
  } catch (err) {
    console.error('[targets] Failed to notify a seller of interested clubs:', err);
  }
}
