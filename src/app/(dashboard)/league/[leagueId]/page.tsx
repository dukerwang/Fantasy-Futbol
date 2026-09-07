import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect, notFound } from 'next/navigation';

import { buildHomeModel } from '@/lib/home/buildHomeModel';
import { getFplStatus } from '@/lib/fpl/api';
import { processMatchupsForGameweek } from '@/lib/scoring/matchupProcessor';

import PreDraftLobby from './PreDraftLobby';
import { Masthead } from './_home/Masthead';
import Attention from './_home/Attention';
import Fixture, { SeasonClosed } from './_home/Fixture';
import { Market, Fronts, Matchweek, StandingsTable, TeamOfWeek } from './_home/Sections';
import Rail from './_home/Rail';
import { HeroTabProvider } from './_home/HeroTabContext';
import styles from './_home/home.module.css';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ leagueId: string }>;
}

/**
 * League Home.
 *
 * A thin renderer over `buildHomeModel`. Everything that used to be derived
 * inline here — form guides, hero state, spend totals, top performers — now
 * lives in the model, so the rules have one home and the JSX has none.
 *
 * Three things in this file are load-bearing and must survive any rewrite:
 *   1. the pre-draft early return, which skips every active-league fetch
 *   2. the `ensureSeasonScaffold` safety net, whose cup check is deliberately
 *      independent of its matchup check
 *   3. the server-side score sync, which avoids a 0.0–0.0 flash on first paint
 */
export default async function LeaguePage({ params }: Props) {
  const { leagueId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const admin = createAdminClient();

  const { data: league } = await admin.from('leagues').select('*').eq('id', leagueId).single();
  if (!league) notFound();

  // Membership and "my team" were two identical queries against `teams` --
  // same league, same user -- differing only in whether `abbreviation` was
  // selected. One row answers both questions.
  const { data: myTeam } = await admin
    .from('teams')
    .select('id, abbreviation')
    .eq('league_id', leagueId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!myTeam && league.commissioner_id !== user.id) redirect('/dashboard');

  if (myTeam && !myTeam.abbreviation) {
    redirect(`/league/${leagueId}/team-setup`);
  }

  // ── 1. Pre-draft early return ───────────────────────────────
  // Leagues that have not drafted yet skip every active-league fetch below.
  if (league.status === 'setup' || league.status === 'drafting') {
    const { data: preDraftTeams } = await admin
      .from('teams')
      .select(
        'id, team_name, draft_order, abbreviation, logo_url, crest_config, user_id, user:users(id, username, email)',
      )
      .eq('league_id', leagueId);

    const isCommissioner = league.commissioner_id === user.id;
    const currentUsername =
      user.user_metadata?.username ??
      user.user_metadata?.preferred_username ??
      user.email?.split('@')[0] ??
      'Manager';
    const myDetailedTeam =
      (preDraftTeams ?? []).find((t: { user_id: string }) => t.user_id === user.id) ?? null;

    return (
      <PreDraftLobby
        leagueId={leagueId}
        league={league}
        teams={(preDraftTeams ?? []) as never[]}
        myUserId={user.id}
        myTeam={myDetailedTeam as never}
        currentUsername={currentUsername}
        isCommissioner={isCommissioner}
      />
    );
  }

  // ── 2. Season scaffold safety net ───────────────────────────
  // For leagues whose draft completed before the ensureSeasonScaffold fix, or
  // via the SQL cron (which cannot call it). The cup check is INDEPENDENT of
  // the matchup check on purpose: gating the cup backfill behind "zero
  // matchups exist" is exactly what left two production leagues with a full
  // schedule and no cups, permanently.
  if (league.status === 'active') {
    const [{ count: matchupCount }, { count: tournamentCount }] = await Promise.all([
      admin
        .from('matchups')
        .select('id', { count: 'exact', head: true })
        .eq('league_id', leagueId),
      admin
        .from('tournaments')
        .select('id', { count: 'exact', head: true })
        .eq('league_id', leagueId),
    ]);

    if ((matchupCount ?? 0) === 0 || (tournamentCount ?? 0) === 0) {
      const { ensureSeasonScaffold } = await import('@/lib/schedule/ensureSeasonScaffold');
      await ensureSeasonScaffold(admin, leagueId, league.current_season);
    }
  }

  // ── 3. Server-side score sync ───────────────────────────────
  // If the current gameweek's matchup still reads 0.0–0.0, resolve it before
  // the first paint rather than letting the page flash zeros and correct
  // itself a moment later.
  if (myTeam) {
    const fplStatus = await getFplStatus();
    const { data: currentMatchup } = await admin
      .from('matchups')
      .select('id, status, score_a, score_b')
      .eq('league_id', leagueId)
      .eq('gameweek', fplStatus.currentGw)
      .or(`team_a_id.eq.${myTeam.id},team_b_id.eq.${myTeam.id}`)
      .maybeSingle();

    if (
      currentMatchup &&
      currentMatchup.status !== 'completed' &&
      Number(currentMatchup.score_a) === 0 &&
      Number(currentMatchup.score_b) === 0
    ) {
      await processMatchupsForGameweek(fplStatus.currentGw, fplStatus.isFinished);
    }
  }

  const model = await buildHomeModel(admin, leagueId, user.id);

  // A commissioner with no team of their own can reach this page; there is no
  // club to build the model around, so send them somewhere that works.
  if (!model) redirect(`/league/${leagueId}/standings`);

  return (
    <div className={styles.page}>
      <Masthead model={model} />
      <Attention items={model.attention} leagueId={leagueId} />

      <HeroTabProvider initialTab={model.preferSecondary ? 'secondary' : 'primary'}>
        <div className={styles.body}>
          <main className={styles.main}>
            {model.phase === 'closed' ? <SeasonClosed model={model} /> : <Fixture model={model} />}
            <Market model={model} />
            <Fronts model={model} />
            <Matchweek model={model} />
            <StandingsTable model={model} />
            <TeamOfWeek model={model} />
          </main>

          <Rail model={model} />
        </div>
      </HeroTabProvider>
    </div>
  );
}
