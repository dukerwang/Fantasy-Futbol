/**
 * Per-player correction for the Gaffa 2.0 portrait crop.
 *
 * The shared crop (globals.css, `--g-portrait-zoom` / `--g-portrait-inset`)
 * assumes every player's 500x500 PL cut-out frames the head the same way. It
 * doesn't: some players' photos (a growing minority, not limited to new
 * signings) have the head noticeably bigger and positioned almost flush to
 * the top of the frame, instead of the ~13%-down headroom the shared crop was
 * measured against. Applying the one global crop to those crowds the head
 * against the top edge and makes it look oversized relative to everyone else.
 *
 * REF_HEAD_WIDTH_FRAC / REF_HEAD_TOP_FRAC are the mean head-width and
 * head-top fractions measured (`scratch/measure_portrait_reference.mjs`)
 * across the players whose photos already match the shared crop's
 * assumption -- i.e. what the existing `--g-portrait-zoom` /
 * `--g-portrait-inset` values are implicitly tuned for. A player measured at
 * exactly these fractions gets the shared crop back unchanged; anyone
 * measured differently gets a zoom/inset solved to land their head at the
 * same on-screen size and position the shared crop already gets right for
 * everyone else.
 *
 * Head width is measured 5-8% of the frame height below the hairline, NOT
 * the widest point across the whole head region -- a player with voluminous
 * hair (afro, dreadlocks) has it flare out well past that band, and an
 * earlier version of the backfill read that flare as head width, shrinking
 * the whole photo to compensate for a "wide head" that was actually hair
 * (found via Jérémy Doku, 2026-08-24: measured 36% at the old widest-point
 * method vs 28% at this one, in line with reference).
 *
 * PremiumPlayerCard.tsx (the 220x280 "tall" source, a different picture from
 * the same photoshoot) deliberately does NOT use a correction like this one.
 * Tried 2026-08-24, reverted the same day: that card's box already closely
 * matches the tall source's own aspect ratio, so a fixed 1:1 scale already
 * looks consistent card-to-card. Correcting each player's zoom to normalize
 * head width traded that away -- every photo became a different size
 * depending on how PL happened to frame that player, which reads as
 * inconsistent across a set of cards even though each one is individually
 * "more correct". Migration 135's portrait_tall_head_top_pct/width_pct
 * columns are unused as of that revert; left populated rather than dropped.
 */

export const REF_HEAD_WIDTH_FRAC = 0.2365;
export const REF_HEAD_TOP_FRAC = 0.1310;

export type PortraitSize = 'lg' | 'md' | 'sm';

/**
 * Mirrors the `--g-portrait-*` custom properties set per size in globals.css
 * — must stay numerically identical to those, since this is the target every
 * player's custom crop is solved against. insetPx is negative: Duke asked
 * (2026-08-23) for every portrait moved up universally, so the image's top
 * edge sits above the frame and gets clipped by the frame's `overflow: hidden`.
 */
const SIZE_DEFAULTS: Record<PortraitSize, { zoomPct: number; insetPx: number; boxPx: number }> = {
  lg: { zoomPct: 156.25, insetPx: -3, boxPx: 104 },
  md: { zoomPct: 156.25, insetPx: -2, boxPx: 66 },
  sm: { zoomPct: 150, insetPx: -2, boxPx: 44 },
};

/**
 * Solves a per-player (zoom, inset) pair that reproduces, for a player at
 * `headTopPct`/`headWidthPct`, the same rendered head size and position a
 * player at the reference fractions gets under `defaultZoomPct`/`defaultInsetPx`
 * in a `boxPx`-wide frame.
 */
function solveCrop(
  headTopPct: number | null | undefined,
  headWidthPct: number | null | undefined,
  refWidthFrac: number,
  refTopFrac: number,
  defaultZoomPct: number,
  defaultInsetPx: number,
  boxPx: number,
): { zoomPct: number; insetPx: number } | null {
  if (headTopPct == null || headWidthPct == null || headWidthPct <= 0) return null;

  const zoomPct = defaultZoomPct * (refWidthFrac / headWidthPct);
  const targetHeadTopPx = defaultInsetPx + refTopFrac * (defaultZoomPct / 100) * boxPx;
  const insetPx = targetHeadTopPx - headTopPct * (zoomPct / 100) * boxPx;

  return { zoomPct, insetPx };
}

/**
 * Only meaningful for the primary 500x500 source -- the fallback 220x280
 * source is a different picture with its own shared `-alt` crop, and isn't
 * measured by this function, so callers should not apply it to that source.
 */
export function customPortraitCrop(
  size: PortraitSize,
  headTopPct: number | null | undefined,
  headWidthPct: number | null | undefined,
): { zoomPct: number; insetPx: number } | null {
  const { zoomPct, insetPx, boxPx } = SIZE_DEFAULTS[size];
  return solveCrop(headTopPct, headWidthPct, REF_HEAD_WIDTH_FRAC, REF_HEAD_TOP_FRAC, zoomPct, insetPx, boxPx);
}
