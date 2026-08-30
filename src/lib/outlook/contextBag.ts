import type { OutlookAvailability, OutlookContextBag } from '@futbolpedia/engine';
import type { GranularPosition, Player } from '@/types';
import { getPlayerDisplayName } from '@/lib/players/displayName';
import { getCurrentFplSeason } from '@/lib/season/currentSeason';

const ACADEMY_AGE_LIMIT = 21;

function mapFplStatus(status: string | null | undefined): OutlookAvailability {
  switch (status) {
    case 'a':
      return 'available';
    case 'i':
      return 'injured';
    case 'd':
      return 'doubtful';
    case 's':
      return 'suspended';
    case 'u':
      return 'unavailable';
    default:
      return 'unknown';
  }
}

function computeAge(dateOfBirth: string | null, asOf: Date): number | null {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;
  let age = asOf.getFullYear() - dob.getFullYear();
  const monthDiff = asOf.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && asOf.getDate() < dob.getDate())) age--;
  return age;
}

function isAcademyEligible(dateOfBirth: string | null, asOf: Date): boolean {
  const age = computeAge(dateOfBirth, asOf);
  return age != null && age <= ACADEMY_AGE_LIMIT;
}

export interface BuildContextBagOptions {
  simulationDate?: string;
  currentSeason?: string;
  isDynastyLeague?: boolean;
}

/**
 * Map a Gaffa Player row to a locked Futbolpedia context bag.
 * Excludes fantasy scoring fields (total_points, form, form_rating, ppg).
 */
export function buildOutlookContextBag(
  player: Player,
  options: BuildContextBagOptions = {},
): OutlookContextBag {
  const asOf = options.simulationDate ? new Date(options.simulationDate) : new Date();
  const simulationDate = options.simulationDate ?? asOf.toISOString().slice(0, 10);

  return {
    player_id: player.id,
    name: player.name,
    display_name: getPlayerDisplayName(player, 'full'),
    age: computeAge(player.date_of_birth, asOf),
    nationality: player.nationality,
    club: player.pl_team,
    primary_position: player.primary_position as GranularPosition,
    secondary_positions: (player.secondary_positions ?? []) as GranularPosition[],
    availability: mapFplStatus(player.fpl_status),
    injury_news: player.fpl_news,
    market_value_eur_m: player.market_value ?? null,
    is_new_to_prem: player.isNewToPrem ?? false,
    academy_eligible: isAcademyEligible(player.date_of_birth, asOf),
    simulation_date: simulationDate,
    current_season: options.currentSeason ?? '',
    is_dynasty_league: options.isDynastyLeague ?? true,
    pl_tenure: player.isNewToPrem ? 'new_to_prem' : 'established',
  };
}

export async function buildOutlookContextBagForPlayer(
  player: Player,
  options: BuildContextBagOptions = {},
): Promise<OutlookContextBag> {
  const currentSeason = options.currentSeason ?? (await getCurrentFplSeason());
  return buildOutlookContextBag(player, { ...options, currentSeason });
}
