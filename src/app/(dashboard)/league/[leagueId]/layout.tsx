import { createAdminClient } from '@/lib/supabase/admin';
import { notFound } from 'next/navigation';

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

    return <>{children}</>;
}
