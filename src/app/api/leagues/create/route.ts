import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { DEFAULT_SCORING_RULES } from '@/types';

export async function POST(req: NextRequest) {
  // Verify the requesting user is authenticated
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { name, teamName, maxTeams, rosterSize, faabBudget, draftType, isDynasty } = await req.json();

  if (!name?.trim()) return NextResponse.json({ error: 'League name is required' }, { status: 400 });

  // Use service role to bypass RLS for all inserts
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // 1. Create the league
  const { data: league, error: leagueErr } = await admin.from('leagues').insert({
    name: name.trim(),
    commissioner_id: user.id,
    max_teams: maxTeams ?? 12,
    roster_size: rosterSize ?? 20,
    bench_size: 4,
    faab_budget: faabBudget ?? 100,
    draft_type: draftType ?? 'snake',
    is_dynasty: isDynasty ?? true,
    scoring_rules: DEFAULT_SCORING_RULES,
    season: '2025-26',
  }).select('id, invite_code').single();

  if (leagueErr) return NextResponse.json({ error: leagueErr.message }, { status: 500 });

  // 2. Add commissioner as league member
  const { error: memberErr } = await admin.from('league_members').insert({
    league_id: league.id,
    user_id: user.id,
  });
  if (memberErr) return NextResponse.json({ error: memberErr.message }, { status: 500 });

  // 3. Create the commissioner's team
  const resolvedTeamName = teamName?.trim() || 'My Team';
  const { error: teamErr } = await admin.from('teams').insert({
    league_id: league.id,
    user_id: user.id,
    team_name: resolvedTeamName,
    faab_budget: faabBudget ?? 100,
  });
  if (teamErr) return NextResponse.json({ error: teamErr.message }, { status: 500 });

  return NextResponse.json({ leagueId: league.id, inviteCode: league.invite_code });
}
