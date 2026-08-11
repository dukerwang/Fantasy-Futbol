import { perfClass } from '@/lib/scoring/perfBand';
import type { GranularPosition, RatingBreakdownItem } from '@/types';

/**
 * Long forms of the twelve tactical positions, for prose. The badge carries the
 * abbreviation; this is for the places that need a phrase — "median for an
 * attacking midfielder", "graded as a left wing-back".
 */
export const POSITION_LONG: Record<GranularPosition, string> = {
  GK: 'goalkeeper',
  CB: 'centre-back',
  LB: 'left-back',
  RB: 'right-back',
  LWB: 'left wing-back',
  RWB: 'right wing-back',
  DM: 'defensive midfielder',
  CM: 'central midfielder',
  AM: 'attacking midfielder',
  LW: 'left winger',
  RW: 'right winger',
  ST: 'striker',
};

interface Props {
  /** `MatchRating.breakdown` — already scored and normalised by the engine. */
  breakdown: RatingBreakdownItem[];
  /**
   * The position he was SCORED at, which is not always his own — an
   * out-of-position start or an auto-sub is rated at the slot he filled. This
   * drives both the hue and the caption, so it must be the scored position.
   */
  position: GranularPosition;
  /** Cap the rows; omit to show every weighted component. */
  limit?: number;
  className?: string;
}

/**
 * The baseline rule — Gaffa 2.0's signature component. Treatment lives in
 * globals.css under "GAFFA 2.0 — THE BASELINE RULE".
 *
 * A stat is never a bar filling toward a maximum. `score` is a sigmoid centred
 * on the median for this position, so 0.5 IS that median: the tick sits at a
 * constant 50% and the ticks stack into one engraved vertical rule.
 *
 * The figure is 0–100 and is the same number as the bar length: 0.874 draws a
 * bar at 87% and reads "87", with 50 his positional median. A signed ±50
 * reading was built and tried — see `Gaffa 2.0 Baseline Rule.dc.html` — and set
 * aside because it agrees with the rule but disagrees with the ink.
 *
 * Figures are coloured by the performance ramp (`perfClass`). The points figure
 * in `.g-player-head` should take the band of the COMPOSITE that produced it,
 * not of the raw point total, so the two agree.
 *
 * Give it the full width of its panel, on its own row beneath `.g-player-head`
 * — see the layout note in globals.css. Squeezed into a hero column it gets
 * about a quarter of the track it needs.
 *
 * Nothing here reads `rating_reference_stats`. The normalisation in
 * `matchRating.ts` already folded the positional median in, which is the whole
 * reason this can be a dumb presentational component.
 */
export default function BaselineRule({ breakdown, position, limit, className }: Props) {
  // The engine only puts weighted components in the breakdown, so an AM has no
  // Defensive row and a GK no Finishing. Filtering again is belt-and-braces
  // against a caller passing a hand-built array.
  const rows = breakdown
    .filter((r) => r.weight > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit ?? breakdown.length);

  if (rows.length === 0) return null;

  return (
    <div className={className}>
      <div
        className="g-baseline"
        style={{ ['--pf' as string]: `var(--color-pos-${position.toLowerCase()})` }}
      >
        {rows.map((r) => (
          <div
            key={r.key}
            className={`g-baseline-row${r.score < 0.5 ? ' is-under' : ''}`}
          >
            <span className="g-baseline-label">{r.component}</span>
            <div className="g-baseline-track">
              <div className="g-track g-baseline-bar">
                <div
                  className="g-baseline-ink"
                  style={{ ['--v' as string]: `${(r.score * 100).toFixed(1)}%` }}
                />
              </div>
              <div className="g-baseline-tick" />
            </div>
            <span className={`g-baseline-value ${perfClass(r.score)}`}>
              {Math.round(r.score * 100)}
            </span>
          </div>
        ))}
      </div>
      <div className="g-baseline-caption">
        50 = median for {'aeiou'.includes(POSITION_LONG[position][0]!) ? 'an' : 'a'}{' '}
        {POSITION_LONG[position]}
      </div>
    </div>
  );
}
