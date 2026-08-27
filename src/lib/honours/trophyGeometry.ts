/**
 * Gaffa trophy geometry — the shape and the light, with no React in it.
 *
 * Ported 1:1 from the approved prototype in `design-2.0/trophies/trophies.mjs`.
 * That file stays as the design record; this is the implementation. If a profile
 * changes, change it in both or the record stops being one.
 *
 * These are CUPS, drawn the way silverware is made: each is a TURNED PROFILE —
 * a radius sampled down the axis and revolved — so the silhouette carries real
 * mouldings (beads, fillets, collars, a knop) instead of one smooth curve with
 * texture painted on top.
 *
 * WHAT MAKES THE METAL READ AS METAL
 *
 * 1. THE WRAP. One light ramp, in objectBoundingBox space, re-stretched across
 *    every horizontal band of the profile. The specular therefore sits at the
 *    same fraction of the radius at every height and runs as ONE continuous
 *    line down the cup, tucking in at the stem and spreading at the foot. An
 *    earlier version gave each part (bowl / stem / foot) its own ramp across its
 *    own width, which made the highlight jump sideways at every part boundary —
 *    the foot looked like a different material bolted on.
 * 2. THE EDGE. Curved metal is brightest at its silhouette, where the surface
 *    turns away. Every part carries a fresnel edge; every moulding carries a
 *    shadow under the swell and a catch of light on top.
 * 3. VERTICAL FALLOFF, SMOOTHLY. An earlier version modelled a mirrored room
 *    with a hard horizon between bright ceiling and dark floor. It banded every
 *    cup across the middle, and softening it did not help: any two gradient
 *    stops close together read as a cut, and light does not cut. It is one
 *    monotonic ramp now, with the only colour change at zero opacity.
 *
 * viewBox is 0 0 120 190 for every trophy: cup in y 8..150, plinth in y 150..173.
 *
 * TWO RULES THIS FILE EXISTS TO HOLD
 *
 * 1. A trophy does not change colour with the viewer's theme. It is a physical
 *    object; the room around it is what goes light or dark. Nothing below is
 *    theme-aware, and nothing below may become theme-aware.
 * 2. ONE metal for all four, so finish never becomes a rank. They are told
 *    apart by silhouette and by the mouldings turned into them.
 */

import type { HonourKind } from './getClubHonours';

/** The metal. Fixed values, deliberately not design tokens — see rule 1. */
export const METAL = {
  hi: '#FFFFFB',      // specular core
  lit: '#F4F1E8',     // lit body
  body: '#DED8CB',    // mid
  shade: '#B0A899',   // turning away
  dark: '#857D6D',    // silhouette edge
  deep: '#5C5648',    // deepest occlusion
  engrave: '#E4DFD2',
  plinthTop: '#57503F',
  plinthBot: '#332F27',
  /** The one Gaffa mark on every object: an enamel fillet on the foot. */
  enamel: '#1C6B45',
} as const;

/** Fallback club colours when a team has no crest configured. */
export const DEFAULT_CLUB = { primary: '#146B40', secondary: '#E8E2D5' };

export interface ClubColours {
  primary: string;
  secondary: string;
}

export interface RibbonOpts {
  rotA: number;
  rotB: number;
  lenA: number;
  lenB: number;
  driftA: number;
  driftB: number;
  w?: number;
}

export interface CupSpec {
  /** [y, radius] control points, rim to foot. */
  profile: [number, number][];
  /** [y, strength] turned bands. */
  mouldings: [number, number][];
  /** [y, radius] of the mouth. */
  mouth: [number, number];
  /** [path, strokeWidth] — drawn once and mirrored. */
  handles: [string, number][];
  /** [x, y, radius] swells where a handle meets the body. */
  fillets: [number, number, number][];
  /** [x, y] where the club's ribbons knot on. */
  tie: [number, number];
  ribbon: RibbonOpts;
  /** [y, radius] of the enamel band. */
  enamel: [number, number];
}

/**
 * LEAGUE TITLE — The Broad Cup.
 * Widest bowl in the set on the shortest stem, with squared handles standing
 * clear above the rim. The shape of thirty-eight matchweeks, not one good night.
 */
const BROAD: CupSpec = {
  profile: [
    [60, 40], [62, 43], [65, 44], [68, 42.6], [72, 41.6],
    [80, 41], [88, 39.6], [96, 36.4], [104, 30.6], [110, 24],
    [115, 17], [118, 12.4],
    [120.5, 15.6], [123, 11.6],
    [127, 10.6], [131, 10.6],
    [134, 15.4], [137.5, 11.4],
    [140, 11.4], [142.5, 14.4],
    [146, 23], [149, 30], [150, 33],
  ],
  mouldings: [[68, 1], [96, 0.8], [120.5, 1], [134, 1], [142.5, 0.9]],
  mouth: [61, 41],
  handles: [['M26 84 L11 74 L11 33 L31 21', 11]],
  fillets: [[27, 84, 5.4]],
  tie: [13, 48],
  ribbon: { rotA: -12, rotB: 7, lenA: 70, lenB: 52, driftA: -7, driftB: 4 },
  enamel: [143.5, 15.5],
};

/**
 * CHAMPIONS CUP — The Great Cup.
 * Tallest in the set, and the only one whose handles sweep out past the bowl
 * entirely. An ogee bowl that swells at the waist and tucks hard into a long
 * stem, so the profile has a real S in it rather than one arc.
 */
const GREAT: CupSpec = {
  profile: [
    [26, 30], [28, 32.6], [31, 33.4], [34, 31.6], [38, 30],
    [46, 29.2], [56, 29.6], [66, 28.6], [76, 25.6],
    [86, 20.4], [94, 14.2], [100, 9.4],
    [102.5, 12.6], [105, 9],
    [110, 7.6], [118, 7.2],
    [122, 11.6], [126, 7.6],
    [132, 7.6], [136, 9.2],
    [140, 13.6], [145, 21], [148, 26.6], [150, 29.6],
  ],
  mouldings: [[34, 1], [66, 0.7], [102.5, 1], [122, 1], [140, 0.9]],
  mouth: [27, 30],
  handles: [['M45 111 C 7 98 2 31 27 12 C 42 3 54 13 51 27', 9.4]],
  fillets: [[46, 111, 5]],
  tie: [8, 58],
  ribbon: { rotA: -10, rotB: 9, lenA: 74, lenB: 55, driftA: -6, driftB: 5 },
  enamel: [141.5, 15],
};

/**
 * LEAGUE CUP — The Tall Cup.
 * A slender chalice on a long stem with scroll handles held tight to the body.
 * Nearly as tall as the Great Cup and half its width, so the two never get
 * confused in silhouette. The most mouldings of the four — a banded stem.
 */
const TALL: CupSpec = {
  profile: [
    [40, 22], [42, 24.2], [45, 25], [48, 23.4], [52, 22.4],
    [60, 22], [70, 22.4], [80, 20.4],
    [90, 16.4], [98, 11], [103, 7.4],
    [105.5, 10.4], [108, 7.2],
    [113, 6], [117, 5.8],
    [120.5, 9.4], [124, 6],
    [128, 5.8], [131.5, 9], [135, 6],
    [139, 6.6], [142, 9.6],
    [146, 17.6], [149, 24], [150, 26.6],
  ],
  mouldings: [[48, 1], [80, 0.7], [105.5, 1], [120.5, 0.9], [131.5, 0.9], [142, 0.9]],
  mouth: [41, 22],
  handles: [['M41 59 C 22 57 20 83 37 89', 7.6]],
  fillets: [[41, 59, 3.6], [37, 89, 3.6]],
  tie: [23, 74],
  ribbon: { rotA: -12, rotB: 6, lenA: 58, lenB: 44, driftA: -6, driftB: 3, w: 8.4 },
  enamel: [143, 12],
};

/**
 * CONSOLATION CUP — The Shallow Bowl.
 * Shortest and widest: a shallow dish on a stubby foot with small ring handles
 * at the lip. Low and unfussy — not apologetic, a different shape of prize.
 */
const SHALLOW: CupSpec = {
  profile: [
    [94, 43], [96, 46], [99, 47], [102, 45.4], [106, 44.4],
    [114, 43], [122, 39.6], [129, 33.4],
    [135, 25], [139, 17], [141.5, 12.6],
    [143.5, 13], [145, 16],
    [147.5, 24], [149.5, 30.6], [150, 33],
  ],
  mouldings: [[102, 1], [122, 0.8], [143.5, 0.9]],
  mouth: [95, 44],
  handles: [['M21 111 C 3 106 2 85 18 83 C 27 82 31 88 30 95', 7.8]],
  fillets: [[22, 111, 4]],
  tie: [9, 95],
  ribbon: { rotA: -10, rotB: 8, lenA: 50, lenB: 38, driftA: -5, driftB: 3, w: 8.4 },
  enamel: [145.5, 17],
};

export const CUPS: Record<HonourKind, CupSpec> = {
  league_title: BROAD,
  champions_cup: GREAT,
  league_cup: TALL,
  consolation_cup: SHALLOW,
};

export const OBJECT_NAMES: Record<HonourKind, string> = {
  league_title: 'The Broad Cup',
  champions_cup: 'The Great Cup',
  league_cup: 'The Tall Cup',
  consolation_cup: 'The Shallow Bowl',
};

/**
 * Tight bounds of each cup, plinth excluded, for the pip crop. On the shared
 * viewBox a pip is mostly the empty air above a short object; widths differ as
 * a result, and that is the point — a tall thin chalice beside a wide low bowl
 * is itself a distinguishing signal in a row.
 */
export const PIP_BOX: Record<HonourKind, [number, number, number, number]> = {
  league_title: [2, 20, 116, 132],
  champions_cup: [0, 10, 120, 142],
  league_cup: [18, 36, 84, 116],
  consolation_cup: [0, 80, 120, 72],
};

// ── Turning ─────────────────────────────────────────────────────────────────

/** Catmull-Rom through the profile control points, so beads stay crisp. */
export function turn(pts: [number, number][], steps = 11): [number, number][] {
  const P = [pts[0], ...pts, pts[pts.length - 1]];
  const out: [number, number][] = [];
  for (let i = 1; i < P.length - 2; i++) {
    const [y0, r0] = P[i - 1];
    const [y1, r1] = P[i];
    const [y2, r2] = P[i + 1];
    const [y3, r3] = P[i + 2];
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push([
        0.5 * (2 * y1 + (y2 - y0) * t + (2 * y0 - 5 * y1 + 4 * y2 - y3) * t2 + (-y0 + 3 * y1 - 3 * y2 + y3) * t3),
        0.5 * (2 * r1 + (r2 - r0) * t + (2 * r0 - 5 * r1 + 4 * r2 - r3) * t2 + (-r0 + 3 * r1 - 3 * r2 + r3) * t3),
      ]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** The revolved silhouette: down the right side, back up the left. */
export function silhouette(pts: [number, number][]): string {
  const s = turn(pts);
  const right = s.map(([y, r], i) => `${i ? 'L' : 'M'}${(60 + r).toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const left = [...s].reverse().map(([y, r]) => `L${(60 - r).toFixed(1)} ${y.toFixed(1)}`).join(' ');
  return `${right} ${left} Z`;
}

/** Radius at a given y, for placing mouldings and the contact shadow. */
export function radiusAt(pts: [number, number][], y: number): number {
  const s = turn(pts);
  let best = s[0];
  for (const p of s) if (Math.abs(p[0] - y) < Math.abs(best[0] - y)) best = p;
  return best[1];
}

export interface Band {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * One horizontal band per profile sample, each the true width of the object at
 * that height. Filled with the shared wrap ramp, which objectBoundingBox
 * re-stretches to each band — that is what makes this a lathe rather than a
 * shape with a gradient on it.
 */
export function bands(profile: [number, number][]): Band[] {
  const pts = turn(profile);
  const out: Band[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [y0, r0] = pts[i];
    const [y1, r1] = pts[i + 1];
    const r = Math.max(r0, r1, 0.6);
    out.push({
      x: Number((60 - r).toFixed(1)),
      y: Number(y0.toFixed(1)),
      w: Number((r * 2).toFixed(1)),
      h: Number((Math.max(y1 - y0, 0.01) + 0.7).toFixed(1)),
    });
  }
  return out;
}

/** An elliptical arc across the body at `y`, used for mouldings and enamel. */
export function bandArc(y: number, r: number, dx = 0, dy = 0): string {
  return `M${60 - r + dx} ${y + dy} A ${r} ${r * 0.24} 0 0 0 ${60 + r - dx} ${y + dy}`;
}

/** One tapered streamer with a swallowtail end, in local coordinates. */
export function streamerPath(len: number, drift: number, w: number): string {
  const h = w / 2;
  return `M${-h} 0 C ${-h - 1} ${len * 0.34} ${drift - h - 2} ${len * 0.7} ${drift - h} ${len}
          L ${drift} ${len - 8} L ${drift + h} ${len}
          C ${drift + h + 2} ${len * 0.7} ${h + 1} ${len * 0.34} ${h} 0 Z`;
}

/** The shadowed half of a streamer — the fold you see from this angle. */
export function streamerFold(len: number, drift: number, w: number): string {
  const h = w / 2;
  return `M${-h} 0 C ${-h - 1} ${len * 0.34} ${drift - h - 2} ${len * 0.7} ${drift - h} ${len}
          L ${drift} ${len - 8} L ${drift} 0 Z`;
}
