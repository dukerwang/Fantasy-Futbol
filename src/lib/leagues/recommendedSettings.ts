export type LeagueSizeProfile = 'casual' | 'standard' | 'deep';

export interface RecommendedSettings {
  rosterSize: number;
  benchSize: number;
  irSize: number;
  faabBudget: number;
}

// Provisional — anchored to today's shipped default (10 teams / 20 roster /
// 4 bench / 2 IR) so nothing already running looks like a regression, and
// floored to never recommend thinner than that. Alpha-league experience
// already suggests even 20 runs short on depth once injuries pile up, so
// these bands are expected to move, not stay fixed.
const ROSTER_BANDS: Record<LeagueSizeProfile, [number, number, number]> = {
  // [4-5 teams, 6-7 teams, 8-12 teams]
  casual: [22, 20, 18],
  standard: [24, 22, 20],
  deep: [28, 26, 24],
};

const FAAB_BASE_AT_10: Record<LeagueSizeProfile, number> = {
  casual: 150,
  standard: 250,
  deep: 350,
};

function bandIndex(maxTeams: number): 0 | 1 | 2 {
  if (maxTeams <= 5) return 0;
  if (maxTeams <= 7) return 1;
  return 2;
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function round50(n: number) {
  return Math.round(n / 50) * 50;
}

export function computeRecommendedSettings({
  maxTeams,
  profile,
  isDynasty,
}: {
  maxTeams: number;
  profile: LeagueSizeProfile;
  isDynasty: boolean;
}): RecommendedSettings {
  const rosterSize = ROSTER_BANDS[profile][bandIndex(maxTeams)] - (isDynasty ? 0 : 2);
  const benchSize = Math.round(rosterSize * 0.2);
  const irSize = rosterSize < 18 ? 1 : rosterSize < 23 ? 2 : 3;
  const faabBudget = clamp(round50((FAAB_BASE_AT_10[profile] * 10) / maxTeams), 50, 500);

  return { rosterSize, benchSize, irSize, faabBudget };
}
