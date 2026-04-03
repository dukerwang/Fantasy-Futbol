import { createAdminClient } from '@/lib/supabase/admin';
import { notFound } from 'next/navigation';
import AppShell from '@/components/layout/AppShell';

interface Props {
    children: React.ReactNode;
    params: Promise<{ leagueId: string }>;
}

export default async function LeagueLayout({ children, params }: Props) {
    const { leagueId } = await params;

    const admin = createAdminClient();
    const { data: league } = await admin
        .from('leagues')
        .select('status')
        .eq('id', leagueId)
        .single();

    if (!league) notFound();

    return (
        <AppShell leagueId={leagueId} leagueStatus={league.status}>
            {children}
        </AppShell>
    );
}
