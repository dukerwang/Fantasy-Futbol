/**
 * Returns a background + text color pair based on fantasy points score intensity.
 * Used on player chip points badges in the matchup pitch view.
 */
export function getScoreIntensityColor(points: number): { bg: string; text: string } {
    if (points >= 18) return { bg: '#2d6a4f', text: '#fff' }; // elite
    if (points >= 12) return { bg: '#3A6B4A', text: '#fff' }; // great
    if (points >= 7)  return { bg: '#8B7355', text: '#fff' }; // solid
    if (points >= 3)  return { bg: '#B5651D', text: '#fff' }; // poor
    if (points >= 0)  return { bg: '#9B2335', text: '#fff' }; // bad
    return                   { bg: '#6B1E1E', text: '#fff' }; // negative
}
