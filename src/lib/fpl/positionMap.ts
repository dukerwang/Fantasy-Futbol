import type { GranularPosition } from '@/types';

/**
 * Position overrides for FPL player data.
 *
 * FPL uses 4 positions: GK / DEF / MID / FWD
 * We map them to 9 granular positions: GK CB FB DM CM AM LW RW ST
 *
 * Defaults applied in the sync route:
 *   GK  → GK
 *   DEF → CB   (override here for full-backs)
 *   MID → CM   (override here for DMs, AMs, LWs, RWs)
 *   FWD → ST   (override here for wingers listed as FWD)
 *
 * Keys: `${first_name} ${second_name}`.toLowerCase()
 * Fallback key: web_name.toLowerCase()
 *
 * Last reviewed: 2025-26 season squads (post-Jan 2026 transfer window).
 */
export const FPL_POSITION_OVERRIDES: Record<string, GranularPosition> = {
  // Arsenal
  'josh nichols': 'RB',
  'tommy setford': 'GK',
  'max dowman': 'AM',

  // Aston Villa
  'james wright': 'GK',
  'sam proctor': 'GK',

  // Bournemouth
  'callan mckenna': 'GK',
  'malcom dacosta': 'ST',

  // Brentford
  'luka bentt': 'RW',

  // Chelsea
  'max merrick': 'GK',
  'ryan kavuma-mcqueen': 'LW',
  'landon emenalo': 'CM',

  // Crystal Palace
  'asher agbinone': 'LW',

  // Everton
  'braiden graham': 'ST',
  'reece welch': 'CB',
  'callum bates': 'CM',

  // Liverpool
  'kieran morrison': 'RW',
  'jayden danns': 'ST',
  'wellity lucky': 'CB',
  'amara nallo': 'CB',

  // Man City
  'ryan mcaidoo': 'AM',

  // Man Utd
  'godwill kukonki': 'CB',
  'jayce fitzgerald': 'CM',
  'jim thwaites': 'CM',

  // Newcastle
  'seung-soo park': 'LW',
  'miodrag pivaš': 'CB',

  // Wolves
  'ethan sutherland': 'LB',
  'nathan fraser': 'ST',
  'leon chiwome': 'ST',
};





/**
 * Default positions when FPL element_type has no override.
 */
const FPL_DEFAULT_POSITION: Record<number, GranularPosition> = {
  1: 'GK',
  2: 'CB',
  3: 'CM',
  4: 'ST',
};

/**
 * Resolve granular position for an FPL player element.
 * Tries full name first, then web_name as fallback.
 */
export function resolvePosition(
  firstName: string,
  secondName: string,
  webName: string,
  elementType: number
): GranularPosition {
  const fullKey = `${firstName} ${secondName}`.toLowerCase();
  const webKey = webName.toLowerCase();

  return (
    FPL_POSITION_OVERRIDES[fullKey] ??
    FPL_POSITION_OVERRIDES[webKey] ??
    FPL_DEFAULT_POSITION[elementType] ??
    'CM'
  );
}

