'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

/**
 * Renders nothing. The detail page (pitch, per-player breakdown, match
 * report) is a plain server component with no live-refresh mechanism at all
 * — rather than restructure it to be prop-driven, this just subscribes to its
 * own `matchups` row (migration 104) and re-runs the server render on change,
 * matching how `matchups.score_a/b` now update on the fpl_live sync's own
 * schedule (migration 103) instead of only on page load.
 */
export default function MatchupLiveRefresh({ matchupId }: { matchupId: string }) {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`matchup-detail:${matchupId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'matchups', filter: `id=eq.${matchupId}` },
        () => router.refresh(),
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [matchupId, router]);

  return null;
}
