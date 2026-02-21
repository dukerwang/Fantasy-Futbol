import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ leagueId: string }> }
) {
    try {
        const { leagueId } = await params;

        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const admin = createAdminClient();

        // Verify league & roles
        const { data: league, error: leagueErr } = await admin
            .from('leagues')
            .select('*')
            .eq('id', leagueId)
            .single();

        if (leagueErr || !league) {
            return NextResponse.json({ error: 'League not found' }, { status: 404 });
        }

        const isCommissioner = league.commissioner_id === user.id;

        if (isCommissioner) {
            // Commissioner action: DELETE the entire league.
            // Thanks to ON DELETE CASCADE on all foreign keys, this will automatically wipe:
            // - teams, league_members, drafted players, waiver claims, transactions, etc.
            const { error: deleteErr } = await admin
                .from('leagues')
                .delete()
                .eq('id', leagueId);

            if (deleteErr) throw deleteErr;

            return NextResponse.json({ success: true, action: 'deleted' });
        } else {
            // Member action: Leave the league.
            // 1. Delete their team (cascades to their roster, claims, etc)
            const { error: teamErr } = await admin
                .from('teams')
                .delete()
                .eq('league_id', leagueId)
                .eq('user_id', user.id);

            if (teamErr) throw teamErr;

            // 2. Remove from league_members
            const { error: memberErr } = await admin
                .from('league_members')
                .delete()
                .eq('league_id', leagueId)
                .eq('user_id', user.id);

            if (memberErr) throw memberErr;

            return NextResponse.json({ success: true, action: 'left' });
        }

    } catch (error: any) {
        console.error('Leave/Delete league error:', error);
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
    }
}
