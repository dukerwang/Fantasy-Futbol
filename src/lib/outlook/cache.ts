import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OutlookContextBag, PlayerOutlook } from '@futbolpedia/engine';
import { PIPELINE_VERSION } from '@futbolpedia/engine';

export interface StoredPlayerOutlook extends PlayerOutlook {
  player_id: string;
  context_hash: string;
  pipeline_version: string;
  generated_at: string;
  updated_at: string;
}

export const OUTLOOK_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function hashOutlookContext(bag: OutlookContextBag): string {
  const payload = JSON.stringify({
    name: bag.name,
    club: bag.club,
    primary_position: bag.primary_position,
    secondary_positions: bag.secondary_positions,
    availability: bag.availability,
    injury_news: bag.injury_news,
    age: bag.age,
    market_value_eur_m: bag.market_value_eur_m,
    is_new_to_prem: bag.is_new_to_prem,
    current_season: bag.current_season,
    simulation_date: bag.simulation_date,
  });
  return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

export async function getStoredOutlook(
  admin: SupabaseClient,
  playerId: string,
): Promise<StoredPlayerOutlook | null> {
  const { data, error } = await admin
    .from('player_outlooks')
    .select('*')
    .eq('player_id', playerId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  return {
    player_id: data.player_id,
    outlook: data.outlook,
    sidecar: data.sidecar,
    context_hash: data.context_hash,
    pipeline_version: data.pipeline_version,
    generated_at: data.generated_at,
    updated_at: data.updated_at,
  };
}

export function isOutlookFresh(
  stored: StoredPlayerOutlook,
  contextHash: string,
  force = false,
): boolean {
  if (force) return false;
  if (stored.context_hash !== contextHash) return false;
  if (stored.pipeline_version !== PIPELINE_VERSION) return false;
  const age = Date.now() - new Date(stored.generated_at).getTime();
  return age < OUTLOOK_TTL_MS;
}

export async function upsertStoredOutlook(
  admin: SupabaseClient,
  playerId: string,
  outlook: PlayerOutlook,
  contextHash: string,
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await admin.from('player_outlooks').upsert(
    {
      player_id: playerId,
      outlook: outlook.outlook,
      sidecar: outlook.sidecar,
      context_hash: contextHash,
      pipeline_version: PIPELINE_VERSION,
      generated_at: now,
      updated_at: now,
    },
    { onConflict: 'player_id' },
  );

  if (error) throw new Error(error.message);
}
