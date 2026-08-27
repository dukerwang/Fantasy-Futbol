/**
 * Gaffa trophy geometry.
 *
 * These are CUPS, drawn the way silverware is actually made: each one is a
 * TURNED PROFILE — a radius sampled down the axis and revolved — so the
 * silhouette carries real mouldings (beads, fillets, collars, a knop) instead
 * of being one smooth bezier with texture painted on top. That was the previous
 * approach and it is why it read as cheap: flat shapes with tacked-on pattern.
 *
 * WHAT MAKES METAL LOOK LIKE METAL HERE
 *
 * Three things, in order of how much they matter:
 *
 * 1. THE WRAP. Around the axis, light runs dark edge → body → hot specular →
 *    body → dark edge → bright fresnel rim. Each PART gets its own wrap sized
 *    to its own width, because a 7-unit stem and a 42-unit bowl do not share a
 *    ramp. Clipped to one silhouette, so there are no seams. On a body of
 *    revolution this is the cue that does nearly all the work.
 * 2. THE EDGE. Curved metal is brightest right at its silhouette, where the
 *    surface turns away. Every part carries a fresnel edge, and every moulding
 *    carries its own shadow under the swell and its own catch of light on top.
 * 3. VERTICAL FALLOFF, SMOOTHLY. An earlier version modelled a mirrored room
 *    with a hard horizon between a bright ceiling and a dark floor. It banded
 *    every cup across the middle, and toning it down did not fix it: any two
 *    stops close together read as a cut, and light does not cut. It is one
 *    monotonic ramp now, with the only colour change at zero opacity.
 *
 * viewBox is 0 0 120 190: cup in y 8..150, plinth in y 150..173.
 *
 * THREE RULES THIS FILE EXISTS TO HOLD:
 *
 * 1. A trophy does not change colour with the viewer's theme. It is a physical
 *    object; the room around it is what goes light or dark.
 * 2. ONE metal for all four, so finish never becomes a rank. They are told
 *    apart by silhouette and by the mouldings turned into them.
 * 3. The club is ON the object — ribbons on both handles, in the club's own
 *    two colours, the way the Premier League trophy takes its champion's.
 *
 * Run `node build.mjs` to regenerate the .dc.html artboards.
 */

// ── The metal. Fixed. Not theme-aware. ──────────────────────────────────────

export const M = {
  // Warm-neutral silver: warmth IN the metal, never yellow. Two earlier passes
  // missed either side of this — a blue-grey steel that read cold and machined,
  // then a saturated gilt that read brassy and cartoon.
  hi: '#FFFFFB',      // specular core
  lit: '#F4F1E8',     // lit body
  body: '#DED8CB',    // mid
  shade: '#B0A899',   // turning away
  dark: '#857D6D',    // silhouette edge
  deep: '#5C5648',    // deepest occlusion
  engrave: '#E4DFD2',
  plinthTop: '#57503F',
  plinthBot: '#332F27',
  // The one Gaffa mark on every object: an enamel fillet on the foot.
  enamel: '#1C6B45',
};

/** The prototype's stand-in club. Real values come from teams.crest_config. */
export const CLUB = { primary: '#A62626', secondary: '#E4DCC9' };

// ── Turning ─────────────────────────────────────────────────────────────────

/** Catmull-Rom through the profile control points, so beads stay crisp. */
function turn(pts, steps = 7) {
  const P = [pts[0], ...pts, pts[pts.length - 1]];
  const out = [];
  for (let i = 1; i < P.length - 2; i++) {
    const [y0, r0] = P[i - 1], [y1, r1] = P[i], [y2, r2] = P[i + 1], [y3, r3] = P[i + 2];
    for (let s = 0; s < steps; s++) {
      const t = s / steps, t2 = t * t, t3 = t2 * t;
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
function silhouette(pts) {
  const s = turn(pts);
  const right = s.map(([y, r], i) => `${i ? 'L' : 'M'}${(60 + r).toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const left = [...s].reverse().map(([y, r]) => `L${(60 - r).toFixed(1)} ${y.toFixed(1)}`).join(' ');
  return `${right} ${left} Z`;
}

/** Radius at a given y, for placing mouldings and shadows on the profile. */
function radiusAt(pts, y) {
  const s = turn(pts);
  let best = s[0];
  for (const p of s) if (Math.abs(p[0] - y) < Math.abs(best[0] - y)) best = p;
  return best[1];
}

// ── Shading ─────────────────────────────────────────────────────────────────

/**
 * THE light ramp, once, in objectBoundingBox space.
 *
 * This is the whole shading model for the body. It gets re-stretched across
 * every horizontal band of the profile (see `bandedBody`), so the specular sits
 * at the same fraction of the radius at every height and therefore runs as one
 * continuous line down the object, following the profile in and out.
 *
 * The previous version gave each PART (bowl, stem, foot) its own ramp mapped
 * across that part's own width. The claim in this file that it produced no
 * seams was simply false: at every part boundary the highlight jumped sideways,
 * which is why the foot looked like a different material bolted on.
 */
function wrapDef(id) {
  return `<linearGradient id="${id}" gradientUnits="objectBoundingBox" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0%" stop-color="${M.dark}"/>
    <stop offset="3.5%" stop-color="${M.lit}"/>
    <stop offset="8%" stop-color="${M.shade}"/>
    <stop offset="26%" stop-color="${M.body}"/>
    <stop offset="37%" stop-color="${M.lit}"/>
    <stop offset="42%" stop-color="${M.hi}"/>
    <stop offset="48%" stop-color="${M.lit}"/>
    <stop offset="62%" stop-color="${M.body}"/>
    <stop offset="78%" stop-color="${M.shade}"/>
    <stop offset="89%" stop-color="${M.lit}"/>
    <stop offset="95%" stop-color="${M.dark}"/>
    <stop offset="100%" stop-color="${M.deep}"/>
  </linearGradient>`;
}

function defs(uid, detail) {
  return `<defs>
    ${wrapDef(`${uid}-wrap`)}
    <!-- Vertical light, and nothing else.
         THREE PASSES GOT THIS WRONG, all the same way. The model was a mirrored
         room: bright ceiling, hard horizon, dark floor. Softening the horizon
         did not help, because the problem was never how strong it was — it was
         that ANY pair of stops close together is a cut, and real light does not
         cut. It falls off.
         So there is no horizon now. One monotonic ramp: brightest at the top,
         fading to nothing by two-thirds down, then a warm bounce coming back up
         off the surface underneath. The single colour change happens where the
         opacity is zero, so it can never draw a line. Form on a body of
         revolution comes from the horizontal wrap anyway — that is the cue that
         was doing the real work the whole time. -->
    <linearGradient id="${uid}-env" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="190">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.26"/>
      <stop offset="24%" stop-color="#FFFFFF" stop-opacity="0.15"/>
      <stop offset="46%" stop-color="#FFFFFF" stop-opacity="0.06"/>
      <stop offset="64%" stop-color="#FFFFFF" stop-opacity="0"/>
      <stop offset="82%" stop-color="#EEE0BE" stop-opacity="0.07"/>
      <stop offset="100%" stop-color="#EEE0BE" stop-opacity="0.20"/>
    </linearGradient>
    <!-- Vertical falloff: the top lip catches the light, the underside of every
         curve loses it. Layered under the environment, not instead of it. -->
    <linearGradient id="${uid}-form" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="190">
      <stop offset="0%" stop-color="#000" stop-opacity="0.10"/>
      <stop offset="22%" stop-color="#000" stop-opacity="0.03"/>
      <stop offset="50%" stop-color="#000" stop-opacity="0"/>
      <stop offset="78%" stop-color="#000" stop-opacity="0.03"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0.09"/>
    </linearGradient>
    ${detail === 'hero' ? `<radialGradient id="${uid}-glint" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.95"/>
      <stop offset="55%" stop-color="#FFFFFF" stop-opacity="0.30"/>
      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>
    </radialGradient>` : ''}
    <linearGradient id="${uid}-well" gradientUnits="objectBoundingBox" x1="0.15" y1="0" x2="0.85" y2="1">
      <stop offset="0%" stop-color="#2E2A20"/><stop offset="34%" stop-color="#3E392C"/>
      <stop offset="62%" stop-color="#6B6353"/><stop offset="88%" stop-color="#8E866F"/>
      <stop offset="100%" stop-color="#4A4436"/>
    </linearGradient>
    <!-- The same light direction as the cup's wrap, for the plinth: without it
         the base reads as a separate object under a different lamp. -->
    <linearGradient id="${uid}-across" gradientUnits="objectBoundingBox" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#000" stop-opacity="0.30"/>
      <stop offset="20%" stop-color="#000" stop-opacity="0.05"/>
      <stop offset="42%" stop-color="#FFF" stop-opacity="0.22"/>
      <stop offset="64%" stop-color="#000" stop-opacity="0.04"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0.34"/>
    </linearGradient>
    <linearGradient id="${uid}-plinth" gradientUnits="objectBoundingBox" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${M.plinthTop}"/><stop offset="100%" stop-color="${M.plinthBot}"/>
    </linearGradient>
  </defs>`;
}

/**
 * A moulding: the thin turned band at a bead or fillet. Two lines — a shadow
 * under the swell and a catch of light on top of it — which is what actually
 * tells the eye a lathe has been here.
 */
function moulding(y, r, strength = 1) {
  return `<path d="M${60 - r} ${y} A ${r} ${r * 0.24} 0 0 0 ${60 + r} ${y}" fill="none" stroke="#000" stroke-opacity="${0.20 * strength}" stroke-width="${1.1 * strength}"/>
    <path d="M${60 - r + 1} ${y - 1.2} A ${r} ${r * 0.24} 0 0 0 ${60 + r - 1} ${y - 1.2}" fill="none" stroke="#FFFDF6" stroke-opacity="${0.55 * strength}" stroke-width="${0.9 * strength}"/>`;
}

/**
 * The mouth of the cup: the dark interior, the far inner wall catching light,
 * and the lip rolling over the top. A flat black ellipse was another of the
 * decal tells.
 */
function mouth(cy, rx, uid) {
  // A near-circular black ellipse was reading as a hole punched in the page.
  // The eye is barely above the rim, so the opening is a shallow ellipse; and
  // the inside of a polished cup is not black — it is the same metal in shadow,
  // with the FAR wall catching light and throwing it back across the well.
  const ry = rx * 0.15;
  return `<g>
    <ellipse cx="60" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#${uid}-well)"/>
    <path d="M${60 - rx + 1.4} ${cy + 0.2} A ${rx - 1.4} ${ry - 0.5} 0 0 0 ${60 + rx - 1.4} ${cy + 0.2}"
          fill="none" stroke="${M.lit}" stroke-width="${Math.max(ry * 0.5, 1.1)}" stroke-opacity="0.60"/>
    <path d="M${60 - rx + 2.2} ${cy - 0.5} A ${rx - 2.2} ${ry - 0.8} 0 0 1 ${60 + rx - 2.2} ${cy - 0.5}"
          fill="none" stroke="#000" stroke-width="${Math.max(ry * 0.4, 0.9)}" stroke-opacity="0.35"/>
    <ellipse cx="60" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="url(#${uid}-lip)" stroke-width="2.4"/>
    <path d="M${60 - rx} ${cy} A ${rx} ${ry} 0 0 1 ${60 + rx} ${cy}" fill="none" stroke="${M.hi}" stroke-opacity="0.7" stroke-width="1"/>
  </g>`;
}

// ── Handles ─────────────────────────────────────────────────────────────────

/**
 * A handle in the same lighting as the body: dark under-edge, the tube, the
 * environment reflection masked to the stroke, then a fresnel catch. Drawn as
 * strokes because a handle IS a bent rod, and because a stroked path can be
 * masked to receive the same horizon as everything else.
 */
function handle(d, w, uid, key, mirror) {
  const m = mirror ? ' transform="translate(120 0) scale(-1 1)"' : '';
  const id = `${uid}-h${key}${mirror ? 'm' : ''}`;
  return `<g${m}>
    <mask id="${id}"><path d="${d}" fill="none" stroke="#fff" stroke-width="${w}" stroke-linecap="round"/></mask>
    <path d="${d}" fill="none" stroke="${M.deep}" stroke-opacity="0.6" stroke-width="${w + 1.1}" stroke-linecap="round"/>
    <path d="${d}" fill="none" stroke="${M.body}" stroke-width="${w}" stroke-linecap="round"/>
    <g mask="url(#${id})">
      <rect x="0" y="0" width="120" height="190" fill="url(#${uid}-env)"/>
      <rect x="0" y="0" width="120" height="190" fill="url(#${uid}-form)"/>
    </g>
    <path d="${d}" fill="none" stroke="${M.hi}" stroke-opacity="0.75" stroke-width="${Math.max(w * 0.22, 0.9)}"
          stroke-linecap="round" transform="translate(-${w * 0.24} -${w * 0.24})"/>
    <path d="${d}" fill="none" stroke="${M.deep}" stroke-opacity="0.35" stroke-width="${Math.max(w * 0.16, 0.7)}"
          stroke-linecap="round" transform="translate(${w * 0.3} ${w * 0.3})"/>
  </g>`;
}

// ── Club streamers ──────────────────────────────────────────────────────────

function streamer(x, y, rot, len, drift, w, color) {
  const h = w / 2;
  const body = `M${-h} 0 C ${-h - 1} ${len * 0.34} ${drift - h - 2} ${len * 0.7} ${drift - h} ${len}
                L ${drift} ${len - 8} L ${drift + h} ${len}
                C ${drift + h + 2} ${len * 0.7} ${h + 1} ${len * 0.34} ${h} 0 Z`;
  return `<g transform="translate(${x} ${y}) rotate(${rot})">
    <path d="${body}" fill="${color}"/>
    <path d="M${-h} 0 C ${-h - 1} ${len * 0.34} ${drift - h - 2} ${len * 0.7} ${drift - h} ${len}
             L ${drift} ${len - 8} L ${drift} 0 Z" fill="#000" opacity="0.22"/>
    <path d="M${h - 1.1} 0 C ${h - 0.4} ${len * 0.34} ${drift + h - 1.5} ${len * 0.7} ${drift + h - 1.1} ${len}
             L ${drift + h} ${len} C ${drift + h + 2} ${len * 0.7} ${h + 1} ${len * 0.34} ${h} 0 Z"
          fill="#fff" opacity="0.16"/>
  </g>`;
}

function ribbonPair(x, y, club, opts = {}) {
  const { rotA = -14, rotB = 6, lenA = 66, lenB = 50, driftA = -8, driftB = 4, w = 9.2 } = opts;
  return `<g>
    ${streamer(x + 3.4, y + 1.8, rotB, lenB, driftB, w - 1.6, club.secondary)}
    ${streamer(x - 2.6, y, rotA, lenA, driftA, w, club.primary)}
    <ellipse cx="${x}" cy="${y}" rx="6.6" ry="4.8" fill="${club.primary}"/>
    <ellipse cx="${x}" cy="${y}" rx="6.6" ry="4.8" fill="#000" opacity="0.18"/>
    <ellipse cx="${x - 1.7}" cy="${y - 1.4}" rx="3.6" ry="2.4" fill="#fff" opacity="0.24"/>
  </g>`;
}

/**
 * Both handles get ribbons — a cup with one is a cup someone half-dressed. The
 * right-hand pair is mirrored and trimmed shorter so the sides read as cloth
 * tied twice, not as one shape reflected.
 */
function ribbons(x, y, club, detail, opts = {}) {
  if (detail === 'pip') return '';
  const right = { ...opts, lenA: (opts.lenA ?? 66) * 0.9, lenB: (opts.lenB ?? 50) * 0.94 };
  return `${ribbonPair(x, y, club, opts)}
    <g transform="translate(120 0) scale(-1 1)">${ribbonPair(x, y + 1.6, club, right)}</g>`;
}

// ── Assembling a cup ────────────────────────────────────────────────────────

/**
 * The body, turned.
 *
 * One horizontal band per profile sample, each stretched to that band's own
 * width and filled with the same ramp — which is what a lathe-turned surface
 * actually looks like under one light. Clipped to the silhouette so the bands
 * never show at the edges. Then the smooth vertical falloff over all of it, the
 * mouldings, and the fresnel edge.
 */
function body(uid, profile, mouldings, detail) {
  const d = silhouette(profile);
  const clip = `${uid}-clip`;
  const pts = turn(profile, 11);
  const bands = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [y0, r0] = pts[i];
    const [y1, r1] = pts[i + 1];
    const r = Math.max(r0, r1, 0.6);
    const h = Math.max(y1 - y0, 0.01) + 0.7;
    bands.push(`<rect x="${(60 - r).toFixed(1)}" y="${y0.toFixed(1)}" width="${(r * 2).toFixed(1)}" height="${h.toFixed(1)}" fill="url(#${uid}-wrap)"/>`);
  }
  return `<g>
    <clipPath id="${clip}"><path d="${d}"/></clipPath>
    <g clip-path="url(#${clip})">
      ${bands.join('')}
      <rect x="0" y="0" width="120" height="190" fill="url(#${uid}-env)"/>
      <rect x="0" y="0" width="120" height="190" fill="url(#${uid}-form)"/>
      ${detail === 'pip' ? '' : mouldings.map(([y, sc]) => moulding(y, radiusAt(profile, y), sc)).join('')}
    </g>
    <path d="${d}" fill="none" stroke="${M.deep}" stroke-opacity="0.45" stroke-width="0.9"/>
    <path d="${d}" fill="none" stroke="${M.hi}" stroke-opacity="0.4" stroke-width="0.6" transform="translate(-0.5 -0.5)"/>
  </g>`;
}

/** Where the cup meets its plinth: contact shadow, not a butt joint. */
function contact(r) {
  return `<ellipse cx="60" cy="150" rx="${r + 2}" ry="2.6" fill="#000" opacity="0.30"/>
    <ellipse cx="60" cy="149.4" rx="${r}" ry="1.9" fill="#000" opacity="0.22"/>`;
}

// ── The plinth ──────────────────────────────────────────────────────────────

function plinth(uid, detail, season) {
  const plate = detail === 'hero'
    ? `<rect x="37" y="159.5" width="46" height="10.5" rx="1" fill="#000" opacity="0.34"/>
       <rect x="37.5" y="160" width="45" height="9.5" rx="1" fill="none" stroke="#fff" stroke-opacity="0.12"/>
       ${season ? `<text x="60" y="167.5" text-anchor="middle" font-family="'Archivo Narrow','Arial Narrow',sans-serif" font-size="7.2" font-weight="600" letter-spacing="0.4" fill="${M.engrave}" textLength="38" lengthAdjust="spacingAndGlyphs">${season}</text>` : ''}`
    : `<rect x="40" y="161" width="40" height="8" rx="1" fill="#000" opacity="0.22"/>`;
  return `<g>
    <path d="M26 150 L94 150 L91 157 L29 157 Z" fill="url(#${uid}-plinth)"/>
    <path d="M29 157 L91 157 L88 173 L32 173 Z" fill="url(#${uid}-plinth)"/>
    <path d="M26 150 L94 150 L91 157 L29 157 Z" fill="#fff" opacity="0.16"/>
    <path d="M29 157 L91 157 L88 173 L32 173 Z" fill="url(#${uid}-across)" opacity="0.5"/>
    <path d="M26 150 L94 150 L91 157 L29 157 Z" fill="url(#${uid}-across)" opacity="0.3"/>
    ${plate}
  </g>`;
}

// ── The four cups ───────────────────────────────────────────────────────────

/**
 * LEAGUE TITLE — The Broad Cup.
 * Widest bowl in the set on the shortest stem, with squared handles standing
 * clear above the rim. A deep bead under the lip, a second at the waist, a
 * stepped foot. The shape of thirty-eight matchweeks, not one good night.
 */
const BROAD = {
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
const GREAT = {
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
const TALL = {
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
const SHALLOW = {
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

const SPECS = {
  league_title: BROAD,
  champions_cup: GREAT,
  league_cup: TALL,
  consolation_cup: SHALLOW,
};

function cup(kind, uid, detail, club) {
  const S = SPECS[kind];
  const [mouthY, mouthR] = S.mouth;
  const handles = S.handles
    .map(([d, w], i) => handle(d, w, uid, i, false) + handle(d, w, uid, i, true))
    .join('');
  const [ey, er] = S.enamel;
  const fillets = detail === 'pip' ? '' : (S.fillets ?? [])
    .map(([fx, fy, fr]) => `<ellipse cx="${fx}" cy="${fy}" rx="${fr}" ry="${fr * 0.8}" fill="${M.shade}"/>
      <ellipse cx="${120 - fx}" cy="${fy}" rx="${fr}" ry="${fr * 0.8}" fill="${M.shade}"/>
      <ellipse cx="${fx - fr * 0.3}" cy="${fy - fr * 0.3}" rx="${fr * 0.5}" ry="${fr * 0.4}" fill="${M.lit}" opacity="0.7"/>
      <ellipse cx="${120 - fx - fr * 0.3}" cy="${fy - fr * 0.3}" rx="${fr * 0.5}" ry="${fr * 0.4}" fill="${M.lit}" opacity="0.7"/>`)
    .join('');
  return `<g>
    ${handles}
    ${fillets}
    ${body(uid, S.profile, S.mouldings, detail)}
    ${detail === 'pip' ? '' : `<path d="M${60 - er} ${ey} A ${er} ${er * 0.24} 0 0 0 ${60 + er} ${ey}" fill="none" stroke="${M.enamel}" stroke-width="2.8"/>
      <path d="M${60 - er + 1.5} ${ey - 0.9} A ${er} ${er * 0.24} 0 0 0 ${60 + er - 1.5} ${ey - 0.9}" fill="none" stroke="#fff" stroke-opacity="0.22" stroke-width="1"/>`}
    ${detail === 'pip' ? '' : mouth(mouthY, mouthR, uid)}
    ${detail === 'hero' ? `<ellipse cx="${60 - mouthR * 0.52}" cy="${mouthY + (150 - mouthY) * 0.3}" rx="${mouthR * 0.2}" ry="${(150 - mouthY) * 0.12}" fill="url(#${uid}-glint)" opacity="0.55"/>` : ''}
    ${detail === 'pip' ? '' : contact(radiusAt(S.profile, 149))}
    ${ribbons(S.tie[0], S.tie[1], club, detail, S.ribbon)}
  </g>`;
}

/** Lip gradient id per instance — the rolled edge around the mouth. */
function lipDef(uid) {
  return `<linearGradient id="${uid}-lip" gradientUnits="objectBoundingBox" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0%" stop-color="${M.dark}"/><stop offset="18%" stop-color="${M.hi}"/>
    <stop offset="46%" stop-color="${M.body}"/><stop offset="70%" stop-color="${M.lit}"/>
    <stop offset="100%" stop-color="${M.shade}"/>
  </linearGradient>`;
}

// ── Public API ──────────────────────────────────────────────────────────────

export const KINDS = Object.keys(SPECS);
export const LABELS = {
  league_title: 'League Title',
  champions_cup: 'Champions Cup',
  league_cup: 'League Cup',
  consolation_cup: 'Consolation Cup',
};
export const OBJECT_NAMES = {
  league_title: 'The Broad Cup',
  champions_cup: 'The Great Cup',
  league_cup: 'The Tall Cup',
  consolation_cup: 'The Shallow Bowl',
};
export const FINISHES = {
  league_title: 'Beaded lip · stepped foot',
  champions_cup: 'Ogee bowl · swept handles',
  league_cup: 'Banded stem · scroll handles',
  consolation_cup: 'Rolled lip · ring handles',
};

export const SIZES = { hero: 240, card: 76, pip: 22 };

/** Tight bounds of each cup (plinth excluded) for the pip crop. */
const PIP_BOX = {
  league_title: [2, 20, 116, 132],
  champions_cup: [0, 10, 120, 142],
  league_cup: [18, 36, 84, 116],
  consolation_cup: [0, 80, 120, 72],
};

/**
 * @param kind   one of KINDS
 * @param size   'hero' | 'card' | 'pip'
 * @param uid    unique per instance — SVG gradient ids are document-global
 * @param season engraved on the plinth at hero size; one object, one year
 * @param club   {primary, secondary} — the winning club's own colours
 * @param h      override the rendered height in px
 */
export function trophySvg(kind, size, uid, season, club = CLUB, h = SIZES[size]) {
  const S = SPECS[kind];
  if (size === 'pip') {
    // Silhouette only: one flat fill, no plinth, no ribbons, no material. This
    // is the test the forms have to pass — cropped per shape, because on the
    // shared viewBox every pip is mostly empty air above a short object.
    const [vx, vy, vw, vh] = PIP_BOX[kind];
    const handles = S.handles
      .map(([d, w]) => `<path d="${d}" fill="none" stroke="currentColor" stroke-width="${w + 1.6}" stroke-linecap="round"/>
        <g transform="translate(120 0) scale(-1 1)"><path d="${d}" fill="none" stroke="currentColor" stroke-width="${w + 1.6}" stroke-linecap="round"/></g>`)
      .join('');
    return `<svg width="${Math.round((h * vw) / vh)}" height="${h}" viewBox="${vx} ${vy} ${vw} ${vh}" role="img" aria-label="${LABELS[kind]}" style="display:block">
      <g fill="currentColor">${handles}<path d="${silhouette(S.profile)}"/></g>
    </svg>`;
  }
  return `<svg width="${Math.round((h * 120) / 190)}" height="${h}" viewBox="0 0 120 190" role="img" aria-label="${LABELS[kind]}" style="display:block">
    ${defs(uid, size)}
    <defs>${lipDef(uid)}</defs>
    ${cup(kind, uid, size, club)}
    ${plinth(uid, size, season)}
  </svg>`;
}
