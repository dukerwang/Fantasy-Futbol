import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { DEFAULT_SCORING_RULES } from '@/types';
import { getCurrentFplSeason, previousSeason } from '@/lib/season/currentSeason';

export async function POST(req: NextRequest) {
  // Verify the requesting user is authenticated
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { name, teamName, maxTeams, rosterSize, benchSize, irSize, faabBudget, isDynasty, auctionTimezone } = await req.json();

  if (!name?.trim()) return NextResponse.json({ error: 'League name is required' }, { status: 400 });

  const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
  const clampedMaxTeams = clamp(Math.round(maxTeams ?? 10), 4, 12);
  const clampedRosterSize = clamp(Math.round(rosterSize ?? 20), 16, 30);
  const clampedBenchSize = clamp(Math.round(benchSize ?? 4), 2, 6);
  const clampedIrSize = clamp(Math.round(irSize ?? 2), 1, 3);
  const clampedFaabBudget = clamp(Math.round(faabBudget ?? 250), 50, 500);

  // Use service role to bypass RLS for all inserts
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // 1. Create the league
  // current_season = upcoming/live FPL year; previous_season = last completed
  // year whose archives feed the draft board. Never leave previous_season on
  // the stale column default (2024-25) — that season has no archive rows.
  const currentSeason = await getCurrentFplSeason();
  const priorSeason = previousSeason(currentSeason);
  const { data: league, error: leagueErr } = await admin.from('leagues').insert({
    name: name.trim(),
    commissioner_id: user.id,
    max_teams: clampedMaxTeams,
    roster_size: clampedRosterSize,
    bench_size: clampedBenchSize,
    ir_size: clampedIrSize,
    faab_budget: clampedFaabBudget,
    draft_type: 'snake',
    is_dynasty: isDynasty ?? true,
    // Quiet hours are meaningless without a zone, and the column has no default
    // because the right value depends on where the managers live. The client
    // sends its own IANA zone; do NOT fall back to Intl here, because this runs
    // on Vercel and would resolve to UTC — which for a US league puts "quiet
    // hours" in the middle of their evening and closes auctions mid-workday.
    auction_timezone: auctionTimezone || 'Europe/London',
    scoring_rules: DEFAULT_SCORING_RULES,
    season: currentSeason,
    current_season: currentSeason,
    previous_season: priorSeason,
  }).select('id, invite_code').single();

  if (leagueErr) return NextResponse.json({ error: leagueErr.message }, { status: 500 });

  // 2. Add commissioner as league member
  const { error: memberErr } = await admin.from('league_members').insert({
    league_id: league.id,
    user_id: user.id,
  });
  if (memberErr) return NextResponse.json({ error: memberErr.message }, { status: 500 });

  // 3. Create the commissioner's team
  const { data: profile } = await admin
    .from('users')
    .select('username')
    .eq('id', user.id)
    .single();
  const username = profile?.username || user.user_metadata?.username || user.email?.split('@')[0] || 'Manager';
  const resolvedTeamName = teamName?.trim() || `${username}'s Club`;

  const { error: teamErr } = await admin.from('teams').insert({
    league_id: league.id,
    user_id: user.id,
    team_name: resolvedTeamName,
    abbreviation: null,
    faab_budget: clampedFaabBudget,
  });
  if (teamErr) return NextResponse.json({ error: teamErr.message }, { status: 500 });

  return NextResponse.json({ leagueId: league.id, inviteCode: league.invite_code });
}
