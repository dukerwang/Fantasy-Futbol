const FPL_TEAM_ID_TO_ABBREV: Record<number, string> = {
    1: 'ARS',
    2: 'AVL',
    3: 'BOU',
    4: 'BRE',
    5: 'BHA',
    6: 'CHE',
    7: 'COV',
    8: 'CRY',
    9: 'EVE',
    10: 'FUL',
    11: 'HUL',
    12: 'IPS',
    13: 'LEE',
    14: 'LIV',
    15: 'MCI',
    16: 'MUN',
    17: 'NEW',
    18: 'NFO',
    19: 'TOT',
    20: 'SUN',
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
