import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect } from 'next/navigation';
import NavigationLink from '@/components/ui/NavigationLink';
import { Icon } from '@/components/ui/Icon';
import { getFplStatus } from '@/lib/fpl/api';
import { getGameweekFixtures, type GwFixture } from '@/lib/fpl/fixtures';
import { getCrestColor, getInitials } from './crest';
import LeagueGrid, { type LeagueCardData } from './LeagueGrid';
import Countdown from './Countdown';
import styles from './dashboard.module.css';

function snakeDraftOrder(pickNumber: number, numTeams: number): number {
  const round = Math.floor((pickNumber - 1) / numTeams);
  const posInRound = (pickNumber - 1) % numTeams;
  return round % 2 === 0 ? posInRound + 1 : numTeams - posInRound;
}

function formatDeadline(iso: string): string {
  const d = new Date(iso);
  const datePart = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London' });
  const timePart = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
  return `${datePart} · ${timePart}`;
}

function formatFixtureLine(f: GwFixture): string {
  if (!f.started) return `${f.homeShort} – ${f.awayShort}`;
  return `${f.homeShort} ${f.homeScore ?? 0}–${f.awayScore ?? 0} ${f.awayShort}`;
}

function formatFixtureMeta(f: GwFixture) {
  if (f.started && !f.finished) return { text: `${f.minutes}′`, live: true };
  if (f.finished) return { text: 'Full-time', live: false };
  if (f.kickoff) {
    const d = new Date(f.kickoff);
    return {
      text: d.toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }),
      live: false,
    };
  }
  return { text: '', live: false };
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const admin = createAdminClient();

  const [{ data: profile }, { data: teams }, fplStatus] = await Promise.all([
    admin.from('users').select('username').eq('id', user.id).single(),
    admin
      .from('teams')
      .select(`
        id, team_name, faab_budget, draft_order,
        league:leagues(id, name, status, season, max_teams, roster_size, commissioner_id)
      `)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false }),
    getFplStatus(),
  ]);

  const allTeams = (teams ?? []) as any[];
  const teamIds = allTeams.map((t) => t.id);
  const leagueIds = Array.from(new Set(allTeams.map((t) => t.league.id)));
  const draftingLeagueIds = Array.from(
    new Set(allTeams.filter((t) => t.league.status === 'drafting').map((t) => t.league.id))
  );

  const [{ data: standings }, { data: memberRows }, { data: draftTeamRows }, { data: draftPickRows }, fixtures] = await Promise.all([
    teamIds.length > 0
      ? admin.from('league_standings').select('team_id, rank').in('team_id', teamIds)
      : Promise.resolve({ data: [] as any[] }),
    leagueIds.length > 0
      ? admin.from('league_members').select('league_id').in('league_id', leagueIds)
      : Promise.resolve({ data: [] as any[] }),
    draftingLeagueIds.length > 0
      ? admin.from('teams').select('id, league_id').in('league_id', draftingLeagueIds)
      : Promise.resolve({ data: [] as any[] }),
    draftingLeagueIds.length > 0
      ? admin.from('draft_picks').select('league_id').in('league_id', draftingLeagueIds)
      : Promise.resolve({ data: [] as any[] }),
    fplStatus.nextDeadline ? getGameweekFixtures(fplStatus.currentGw) : Promise.resolve([] as GwFixture[]),
  ]);

  const rankMap = new Map((standings ?? []).map((s: any) => [s.team_id, s.rank]));

  const memberCountByLeague = new Map<string, number>();
  for (const row of memberRows ?? []) {
    memberCountByLeague.set(row.league_id, (memberCountByLeague.get(row.league_id) ?? 0) + 1);
  }

  const teamCountByLeague = new Map<string, number>();
  for (const row of draftTeamRows ?? []) {
    teamCountByLeague.set(row.league_id, (teamCountByLeague.get(row.league_id) ?? 0) + 1);
  }

  const pickCountByLeague = new Map<string, number>();
  for (const row of draftPickRows ?? []) {
    pickCountByLeague.set(row.league_id, (pickCountByLeague.get(row.league_id) ?? 0) + 1);
  }

  const leagueCards: LeagueCardData[] = allTeams.map((t) => {
    const league = t.league;
    const managerCount = memberCountByLeague.get(league.id) ?? 0;

    let yourPickSlot: number | null = null;
    let currentPickNumber: number | null = null;
    let currentRound: number | null = null;
    let totalRounds: number | null = null;
    let isMyTurn = false;

    if (league.status === 'drafting') {
      const numTeams = teamCountByLeague.get(league.id) ?? managerCount;
      const picksMade = pickCountByLeague.get(league.id) ?? 0;
      totalRounds = league.roster_size;
      yourPickSlot = t.draft_order ?? null;
      if (numTeams > 0) {
        currentPickNumber = picksMade + 1;
        currentRound = Math.ceil(currentPickNumber / numTeams);
        isMyTurn = t.draft_order === snakeDraftOrder(currentPickNumber, numTeams);
      }
    }

    return {
      id: league.id,
      name: league.name,
      status: league.status,
      season: league.season,
      teamName: t.team_name,
      crestColor: getCrestColor(league.id),
      crestInitials: getInitials(league.name),
      isCommissioner: league.commissioner_id === user.id,
      rank: rankMap.get(t.id) ?? null,
      faabBudget: t.faab_budget,
      managerCount,
      maxTeams: league.max_teams,
      yourPickSlot,
      currentPickNumber,
      currentRound,
      totalRounds,
      isMyTurn,
    };
  });

  const clubCount = leagueCards.length;
  const leader = leagueCards.find((c) => c.rank === 1);
  const heroSubtitle =
    clubCount === 0
      ? 'Create a league or join one with an invite code to get started.'
      : leader
        ? `${clubCount} ${clubCount === 1 ? 'club' : 'clubs'} across the pyramid — ${leader.name} sits top of the table.`
        : `${clubCount} ${clubCount === 1 ? 'club' : 'clubs'} across the pyramid.`;

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <div>
          <span className={styles.heroEyebrow}>Manager Hub</span>
          <h1 className={styles.greeting}>
            Welcome back, <span className={styles.username}>{profile?.username ?? 'Manager'}</span>.
          </h1>
          <p className={styles.heroSub}>{heroSubtitle}</p>
        </div>
        <div className={styles.heroActions}>
          <NavigationLink href="/league/join" className={styles.btnSecondary}>
            <Icon name="unlock" size={14} strokeWidth={1.8} />
            Join League
          </NavigationLink>
          <NavigationLink href="/league/create" className={styles.btnPrimary}>
            <Icon name="plus" size={14} strokeWidth={2.2} />
            Create League
          </NavigationLink>
        </div>
      </header>

      {fplStatus.nextDeadline && (
        <section className={styles.gwBanner} aria-label="Premier League gameweek status">
          <div className={styles.gwMain}>
            <span className={styles.gwLabel}>Gameweek {fplStatus.currentGw} · First Kickoff</span>
            <div className={styles.gwCount}>
              <Countdown deadline={fplStatus.nextDeadline} className={styles.gwCountStat} />
            </div>
            <p className={styles.gwDeadline}>{formatDeadline(fplStatus.nextDeadline)} UK time — each player locks individually when their club kicks off</p>
          </div>
          {fixtures.length > 0 && (
            <>
              <div className={styles.gwFixturesDivider} />
              <div className={styles.gwFixtures}>
                {fixtures.map((f) => {
                  const meta = formatFixtureMeta(f);
                  return (
                    <div key={f.id} className={styles.fixture}>
                      <span className={styles.fixtureTeams}>{formatFixtureLine(f)}</span>
                      <span className={meta.live ? styles.fixtureLive : styles.fixtureMeta}>{meta.text}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </section>
      )}

      {leagueCards.length > 0 ? (
        <LeagueGrid leagues={leagueCards} />
      ) : (
        <div className={styles.empty}>
          <p className={styles.emptyIcon}><Icon name="trophy" size={48} strokeWidth={1} /></p>
          <h2 className={styles.emptyTitle}>No leagues yet</h2>
          <p className={styles.emptyText}>Create a league and invite your friends to get started.</p>
          <div className={styles.emptyActions}>
            <NavigationLink href="/league/create" className={styles.btnPrimary}>
              <Icon name="plus" size={14} strokeWidth={2.2} />
              Create a League
            </NavigationLink>
            <NavigationLink href="/league/join" className={styles.btnSecondary}>
              <Icon name="unlock" size={14} strokeWidth={1.8} />
              Join with Invite Code
            </NavigationLink>
          </div>
        </div>
      )}
    </div>
  );
}
