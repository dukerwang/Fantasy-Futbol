/**
 * tm_season_year.mjs
 *
 * Prints the season's start year (e.g. "2025" for the 2025-26 season) to
 * stdout, for use as `python -m tfmkt <crawler> --season <year>` in
 * .github/workflows/sync-transfermarkt.yml.
 *
 * Transfermarkt's `saison_id` matches FPL's season-start year, so this
 * mirrors getCurrentFplSeason() in src/lib/season/currentSeason.ts exactly
 * (GW1-deadline-year, bumped to next season once the current one has
 * finished) rather than hardcoding a year — see that file's docstring for
 * why the season is never hardcoded. Duplicated instead of imported because
 * no scripts/*.ts here import the @/ tsconfig path alias standalone scripts
 * don't have it wired up.
 *
 * Usage: node scripts/tm_season_year.mjs
 */

async function main() {
  const now = new Date();
  const currentYear = now.getFullYear();
  const startYear = now.getMonth() >= 5 ? currentYear : currentYear - 1;
  const fallback = startYear;

  try {
    const res = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/');
    if (!res.ok) {
      process.stdout.write(String(fallback));
      return;
    }

    const data = await res.json();
    const events = data.events ?? [];
    const gw1 = events.find((e) => e.id === 1);
    if (!gw1?.deadline_time) {
      process.stdout.write(String(fallback));
      return;
    }

    let seasonStartYear = new Date(gw1.deadline_time).getFullYear();

    const lastEvent = events[events.length - 1];
    if (lastEvent?.finished) {
      seasonStartYear += 1;
    }

    process.stdout.write(String(seasonStartYear));
  } catch {
    process.stdout.write(String(fallback));
  }
}

main();
