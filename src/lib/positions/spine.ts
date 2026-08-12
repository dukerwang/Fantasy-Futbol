import type { GranularPosition } from '@/types';

/**
 * The twelve-position spine, in phase-of-play order — keeper, defence,
 * midfield, attack. This is the order `.g-spectrum` paints, so the hue ramp
 * teaches the taxonomy rather than listing it alphabetically.
 *
 * Lives here because it now has more than one consumer. It was written twice
 * over — once in PitchUI, once in the stats pool — and design-2.0/README.md
 * records the same failure twice already (ListingCard's crest, the club page's
 * position badge): a duplicated constant does not merely drift, it eventually
 * becomes wrong. Two panels qualify for the spectrum today and both must paint
 * the same twelve hues in the same order or the device stops meaning anything.
 */
export const SPINE: GranularPosition[] = [
  'GK', 'CB', 'LB', 'RB', 'LWB', 'RWB', 'DM', 'CM', 'AM', 'LW', 'RW', 'ST',
];

/**
 * Feeds `--pf` for `.g-row`'s hover tint and the spectrum's twelve bands —
 * the two sanctioned uses of a position hue outside a badge. Nothing here
 * paints a fill: the colour law reserves these hues for the taxonomy, and
 * design-2.0/README.md § "What finishing the hub established" catalogues the
 * nine places they were borrowed to mean something else.
 */
export const POS_COLOR: Record<GranularPosition, string> = {
  GK: 'var(--color-pos-gk)',
  CB: 'var(--color-pos-cb)',
  LB: 'var(--color-pos-lb)',
  RB: 'var(--color-pos-rb)',
  LWB: 'var(--color-pos-lwb)',
  RWB: 'var(--color-pos-rwb)',
  DM: 'var(--color-pos-dm)',
  CM: 'var(--color-pos-cm)',
  AM: 'var(--color-pos-am)',
  LW: 'var(--color-pos-lw)',
  RW: 'var(--color-pos-rw)',
  ST: 'var(--color-pos-st)',
};
