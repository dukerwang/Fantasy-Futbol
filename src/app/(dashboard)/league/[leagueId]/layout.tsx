import { createAdminClient } from '@/lib/supabase/admin';
import { notFound } from 'next/navigation';
import LeagueOwnershipSeed from '@/components/players/LeagueOwnershipSeed';
import { buildLeagueOwnershipMap } from '@/lib/players/cardData';
import { LeagueChatProvider } from '@/components/chat/LeagueChatContext';
import LeagueChatWidget from '@/components/chat/LeagueChatWidget';

interface Props {
    children: React.ReactNode;
    params: Promise<{ leagueId: string }>;
}

export default async function LeagueLayout({ children, params }: Props) {
    const { leagueId } = await params;

    const admin = createAdminClient();
    const [{ data: league }, ownership] = await Promise.all([
        admin.from('leagues').select('status').eq('id', leagueId).single(),
        // Two queries for the whole league. Seeding it here is what lets any
        // page underneath paint a player card's owner crest with no request.
        buildLeagueOwnershipMap(admin, leagueId),
    ]);

    if (!league) notFound();

    return (
        <LeagueChatProvider leagueId={leagueId}>
            <LeagueOwnershipSeed leagueId={leagueId} ownership={ownership} />
            {children}
            <LeagueChatWidget />
        </LeagueChatProvider>
    );
}
