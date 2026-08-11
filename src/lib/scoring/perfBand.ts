/**
 * How a score reads against the player's own positional median — the five
 * bands behind the performance ramp (`--color-perf-*` in globals.css).
 *
 * Lives here rather than in a component because two different surfaces need
 * the same answer: the baseline-rule figures and the points figure beside the
 * player's name. Defining the cut points twice is how they drift apart.
 *
 * The input is always a SIGMOID SCORE in 0–1, not a point total.
 * `sigmoidNormalize()` in matchRating.ts is centred on the positional median,
 * so 0.5 is that median for every component and every position — which is what
 * makes a single set of cut points valid across the whole taxonomy.
 *
 * `mid` is deliberately a band and not a point: 45–55 covers the noise either
 * side of the median, and it renders in plain ink because being average for
 * your position is not a verdict.
 */
export type PerfBand = 'poor' | 'low' | 'mid' | 'good' | 'best';

export function perfBand(score: number): PerfBand {
  const n = Math.round(score * 100);
  if (n <= 34) return 'poor';
  if (n <= 44) return 'low';
  if (n <= 55) return 'mid';
  if (n <= 69) return 'good';
  return 'best';
}

/** The globals.css utility class for a score's band. */
export function perfClass(score: number): string {
  return `g-perf-${perfBand(score)}`;
}
