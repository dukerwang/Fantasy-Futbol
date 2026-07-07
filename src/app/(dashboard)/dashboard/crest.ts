// Deterministic per-league crest styling — no logo field exists in the schema,
// so each league gets a monogram colored from the position-color spine
// (src/app/globals.css) instead of a random/arbitrary hue.
const CREST_COLORS = [
  '--color-pos-st',
  '--color-pos-cb',
  '--color-pos-dm',
  '--color-pos-am',
  '--color-pos-wb',
  '--color-pos-gk',
] as const;

export function getCrestColor(leagueId: string): string {
  let hash = 0;
  for (let i = 0; i < leagueId.length; i++) {
    hash = (hash * 31 + leagueId.charCodeAt(i)) >>> 0;
  }
  return `var(${CREST_COLORS[hash % CREST_COLORS.length]})`;
}

export function getInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return (words[0]?.slice(0, 2) ?? '??').toUpperCase();
}
