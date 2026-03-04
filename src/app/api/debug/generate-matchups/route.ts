import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { insertMatchups } from '@/lib/schedule/insertMatchups';

export async function GET(req: NextRequest) {
    const leagueId = req.nextUrl.searchParams.get('leagueId');
    if (!leagueId) {
        return NextResponse.json({ error: 'leagueId query param required' }, { status: 400 });
    }

    const admin = createAdminClient();
    const result = await insertMatchups(admin, leagueId);
    return NextResponse.json(result);
}
