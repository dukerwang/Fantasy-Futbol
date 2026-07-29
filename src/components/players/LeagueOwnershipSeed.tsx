'use client';

import type { PlayerOwnership } from '@/types';
import { primeLeagueOwnership } from '@/lib/players/cardCache';

interface Props {
  leagueId: string;
  ownership: Record<string, PlayerOwnership>;
}

/**
 * Publishes the league's owner-crest map into the card cache.
 *
 * Deliberately seeded during render rather than in an effect: React commits
 * child effects before parent ones, so a page's own priming would otherwise run
 * first and cache every player as ownerless. Rendering here is idempotent and
 * happens before any descendant renders, let alone before anyone clicks.
 */
export default function LeagueOwnershipSeed({ leagueId, ownership }: Props) {
  if (typeof window !== 'undefined') {
    primeLeagueOwnership(leagueId, ownership);
  }
  return null;
}
