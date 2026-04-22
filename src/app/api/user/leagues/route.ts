import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ teams: [] }, { status: 401 });

  const admin = createAdminClient();

  const { data: teams } = await admin
    .from('teams')
    .select('id, team_name, league_id')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (!teams || teams.length === 0) return NextResponse.json({ teams: [] });

  const leagueIds = teams.map(t => t.league_id).filter(Boolean);
  const { data: leagues } = await admin
    .from('leagues')
    .select('id, name, status, season')
    .in('id', leagueIds);

  const leagueMap = new Map((leagues ?? []).map(l => [l.id, l]));

  const result = teams.map(t => ({
    id: t.id,
    team_name: t.team_name,
    league: leagueMap.get(t.league_id) ?? { id: t.league_id, name: 'Unknown', status: 'active', season: '' },
  }));

  return NextResponse.json({ teams: result });
}
