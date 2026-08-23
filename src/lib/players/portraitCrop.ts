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
 * across the players whose photos
 * already match the shared crop's assumption -- i.e. what the existing
 * `--g-portrait-zoom` / `--g-portrait-inset` values are implicitly tuned for.
 * A player measured at exactly these fractions gets the shared crop back
 * unchanged; anyone measured differently gets a zoom/inset solved to land
 * their head at the same on-screen size and position the shared crop already
 * gets right for everyone else.
 */

export const REF_HEAD_WIDTH_FRAC = 0.262;
export const REF_HEAD_TOP_FRAC = 0.1316;

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
 * Solves a per-player (zoom, inset) pair that reproduces, for this player's
 * own measured head-top/head-width fractions, the same rendered head size and
 * position the shared crop already produces for a player at the reference
 * fractions. Only meaningful for the primary 500x500 source -- the fallback
 * 220x280 source is a different picture with its own shared `-alt` crop, and
 * isn't measured by the backfill, so callers should not apply this to it.
 */
export function customPortraitCrop(
  size: PortraitSize,
  headTopPct: number | null | undefined,
  headWidthPct: number | null | undefined,
): { zoomPct: number; insetPx: number } | null {
  if (headTopPct == null || headWidthPct == null || headWidthPct <= 0) return null;

  const { zoomPct: defaultZoom, insetPx: defaultInset, boxPx } = SIZE_DEFAULTS[size];

  const zoomPct = defaultZoom * (REF_HEAD_WIDTH_FRAC / headWidthPct);
  const targetHeadTopPx = defaultInset + REF_HEAD_TOP_FRAC * (defaultZoom / 100) * boxPx;
  const insetPx = targetHeadTopPx - headTopPct * (zoomPct / 100) * boxPx;

  return { zoomPct, insetPx };
}
