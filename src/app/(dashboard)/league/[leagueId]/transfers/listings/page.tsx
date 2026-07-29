import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect, notFound } from 'next/navigation';
import { buildTransfersModel } from '@/lib/transfers/buildTransfersModel';
import ListingsClient from './ListingsClient';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ leagueId: string }>;
}

export default async function ListingsPage({ params }: Props) {
  const { leagueId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const admin = createAdminClient();
  const model = await buildTransfersModel(admin, leagueId, user.id);

  // No league, or the caller has no club in it.
  if (!model) notFound();

  return <ListingsClient leagueId={leagueId} initial={model} />;
}
