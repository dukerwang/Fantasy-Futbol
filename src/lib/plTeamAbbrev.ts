/** FPL `teams[].id` → official-style three-letter codes (2025–26 ordering). */
const FPL_TEAM_ID_TO_ABBREV: Record<number, string> = {
    1: 'ARS',
    2: 'AVL',
    3: 'BUR',
    4: 'BOU',
    5: 'BRE',
    6: 'BHA',
    7: 'CHE',
    8: 'CRY',
    9: 'EVE',
    10: 'FUL',
    11: 'LEE',
    12: 'LIV',
    13: 'MCI',
    14: 'MUN',
    15: 'NEW',
    16: 'NFO',
    17: 'SUN',
    18: 'TOT',
    19: 'WHU',
    20: 'WOL',
};

/**
 * Three-letter club label for UI. Prefer `pl_team_id` when present (stable across renames).
 */
export function plTeamThreeLetter(
    plTeamId: number | null | undefined,
    plTeamName?: string | null,
): string {
    if (plTeamId != null && FPL_TEAM_ID_TO_ABBREV[plTeamId]) {
        return FPL_TEAM_ID_TO_ABBREV[plTeamId];
    }
    const raw = (plTeamName ?? '').trim();
    if (!raw) return '—';
    const letters = raw.replace(/[^a-zA-Z]/g, '');
    if (letters.length >= 3) return letters.slice(0, 3).toUpperCase();
    return raw.slice(0, 3).toUpperCase();
}
