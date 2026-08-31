/**
 * PostgREST caps a response at 1,000 rows and says nothing when it truncates —
 * an unpaginated `.select()` on a table past that size silently returns a
 * prefix. This has bitten the codebase repeatedly (`sofifa_position_reference`,
 * the player sync); `player_stats` crosses the threshold a few gameweeks into
 * every season.
 *
 * Any read that can exceed a thousand rows goes through here.
 */
export const PAGE_SIZE = 1000;

export async function fetchAllPages<T>(
  run: (from: number, to: number) => PromiseLike<{ data: T[] | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; ; page++) {
    const { data } = await run(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return out;
}
