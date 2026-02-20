import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(req: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { inviteCode, teamName } = await req.json();

  if (!inviteCode?.trim()) {
    return NextResponse.json({ error: 'Invite code is required' }, { status: 400 });
  }

  const admin = createAdminClient();

  // Look up league by invite code
  const { data: league } = await admin
    .from('leagues')
    .select('id, name, max_teams, faab_budget, status')
    .eq('invite_code', inviteCode.trim().toUpperCase())
    .single();

  if (!league) {
    return NextResponse.json({ error: 'Invalid invite code' }, { status: 404 });
  }

  if (league.status === 'active' || league.status === 'complete') {
    return NextResponse.json({ error: 'This league is no longer accepting new members' }, { status: 400 });
  }

  // Check if user is already a member
  const { data: existing } = await admin
    .from('league_members')
    .select('user_id')
    .eq('league_id', league.id)
    .eq('user_id', user.id)
    .single();

  if (existing) {
    return NextResponse.json({ leagueId: league.id, alreadyMember: true });
  }

  // Check capacity
  const { count } = await admin
    .from('league_members')
    .select('*', { count: 'exact', head: true })
    .eq('league_id', league.id);

  if ((count ?? 0) >= league.max_teams) {
    return NextResponse.json({ error: 'This league is full' }, { status: 400 });
  }

  // Add member
  const { error: memberErr } = await admin.from('league_members').insert({
    league_id: league.id,
    user_id: user.id,
  });
  if (memberErr) return NextResponse.json({ error: memberErr.message }, { status: 500 });

  // Create their team
  const resolvedTeamName = teamName?.trim() || 'My Team';
  const { error: teamErr } = await admin.from('teams').insert({
    league_id: league.id,
    user_id: user.id,
    team_name: resolvedTeamName,
    faab_budget: league.faab_budget,
  });
  if (teamErr) return NextResponse.json({ error: teamErr.message }, { status: 500 });

  return NextResponse.json({ leagueId: league.id });
}
