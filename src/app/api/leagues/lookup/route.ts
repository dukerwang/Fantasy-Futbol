import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(req: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const code = req.nextUrl.searchParams.get('code')?.trim().toLowerCase();
  if (!code) return NextResponse.json({ error: 'Invite code is required' }, { status: 400 });

  const admin = createAdminClient();

  const { data: league } = await admin
    .from('leagues')
    .select('id, name, max_teams, roster_size, faab_budget, is_dynasty, status')
    .eq('invite_code', code)
    .single();

  if (!league) {
    return NextResponse.json({ error: 'Invalid invite code' }, { status: 404 });
  }

  const { count } = await admin
    .from('league_members')
    .select('*', { count: 'exact', head: true })
    .eq('league_id', league.id);

  return NextResponse.json({
    name: league.name,
    maxTeams: league.max_teams,
    currentTeams: count ?? 0,
    rosterSize: league.roster_size,
    faabBudget: league.faab_budget,
    isDynasty: league.is_dynasty,
    status: league.status,
  });
}
