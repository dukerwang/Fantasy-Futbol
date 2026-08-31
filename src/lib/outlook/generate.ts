import type { SupabaseClient } from '@supabase/supabase-js';
import { generateOutlook } from '@futbolpedia/engine';
import type { FacetInputs } from '@futbolpedia/engine';
import type { Player } from '@/types';
import { FULL_PLAYER_SELECT } from '@/lib/constants/queries';
import {
  buildOutlookContextBagForPlayer,
  type BuildContextBagOptions,
} from '@/lib/outlook/contextBag';
import {
  getStoredOutlook,
  hashOutlookContext,
  isOutlookFresh,
  upsertStoredOutlook,
} from '@/lib/outlook/cache';
import { loadFacetInputs } from '@/lib/outlook/facetInputs';

export interface GeneratePlayerOutlookResult {
  playerId: string;
  skipped: boolean;
  outlook?: string;
  sidecar?: unknown;
}

function requireApiKey(): string {
  const key = process.env.API_KEY;
  if (!key) throw new Error('API_KEY is not configured');
  return key;
}

export async function loadPlayerForOutlook(
  admin: SupabaseClient,
  playerId: string,
): Promise<Player> {
  const { data, error } = await admin
    .from('players')
    .select(FULL_PLAYER_SELECT)
    .eq('id', playerId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error(`Player not found: ${playerId}`);
  return data as Player;
}

export async function generateAndStorePlayerOutlook(
  admin: SupabaseClient,
  playerId: string,
  options: {
    force?: boolean;
    bagOptions?: BuildContextBagOptions;
    /**
     * Pre-loaded measured record. A batch run should pass this — building it
     * per player would re-read the whole season's stats once per outlook.
     */
    facts?: FacetInputs;
  } = {},
): Promise<GeneratePlayerOutlookResult> {
  const player = await loadPlayerForOutlook(admin, playerId);
  const bag = await buildOutlookContextBagForPlayer(player, options.bagOptions);
  const contextHash = hashOutlookContext(bag);

  const existing = await getStoredOutlook(admin, playerId);
  if (existing && isOutlookFresh(existing, contextHash, options.force)) {
    return {
      playerId,
      skipped: true,
      outlook: existing.outlook,
      sidecar: existing.sidecar,
    };
  }

  // The measured record goes in as locked evidence so Futbolpedia judges WITH
  // the facts rather than instead of them — and does not spend a grounded
  // search call rediscovering set-piece duty FPL already publishes.
  const facts =
    options.facts ?? (await loadFacetInputs(admin, { playerIds: [playerId] })).inputs.get(playerId);

  const result = await generateOutlook({
    apiKey: requireApiKey(),
    contextBag: bag,
    facts,
  });
  await upsertStoredOutlook(admin, playerId, result, contextHash);

  return {
    playerId,
    skipped: false,
    outlook: result.outlook,
    sidecar: result.sidecar,
  };
}
