import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect, notFound } from 'next/navigation';
import { buildTransfersModel } from '@/lib/transfers/buildTransfersModel';
import FreeAgentsClient from './FreeAgentsClient';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ leagueId: string }>;
}

export default async function FreeAgentsPage({ params }: Props) {
  const { leagueId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const admin = createAdminClient();
  const model = await buildTransfersModel(admin, leagueId, user.id);
  if (!model) notFound();

  // The player rows themselves are deliberately NOT in this payload — they come
  // from GET /transfers/free-agents, one page at a time. Embedding the whole
  // catalogue in the RSC payload is the exact regression this rewrite removed.
  return <FreeAgentsClient leagueId={leagueId} initial={model} />;
}
