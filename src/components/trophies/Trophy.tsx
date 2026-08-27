/**
 * Gaffa trophies.
 *
 * A ported 1:1 from the approved prototype in `design-2.0/trophies/`. The shape
 * and the light live in `src/lib/honours/trophyGeometry.ts` — read the header
 * there before changing anything about how these are drawn.
 *
 * Three sizes off one set of paths:
 *   hero — the cabinet. Full material, the year engraved on the plinth.
 *   card — a smaller standing cup. The plinth plate is blank: at this size a
 *          year would be about three pixels tall, and a smudge pretending to be
 *          a date is worse than an empty plate.
 *   pip  — silhouette only, for the club masthead. No plinth, no ribbons, no
 *          metal. Shape does all the work, which is what the four profiles were
 *          drawn to survive.
 *
 * NOT an entry in `Icon.tsx`: these are illustrations with a lighting model, not
 * UI glyphs, and they do not belong in that set.
 */

import { useId } from 'react';
import type { HonourKind } from '@/lib/honours/getClubHonours';
import {
  METAL as M, CUPS, PIP_BOX, DEFAULT_CLUB,
  silhouette, radiusAt, bands, bandArc, streamerPath, streamerFold,
  type ClubColours, type RibbonOpts,
} from '@/lib/honours/trophyGeometry';
import { HONOUR_LABELS as LABELS } from '@/lib/honours/getClubHonours';

export type TrophySize = 'hero' | 'card' | 'pip';

const HEIGHTS: Record<TrophySize, number> = { hero: 240, card: 76, pip: 22 };

interface Props {
  kind: HonourKind;
  size?: TrophySize;
  /** Engraved on the plinth at hero size. One object, one year. */
  season?: string | null;
  /** The winning club's own colours, for the ribbons. */
  club?: ClubColours | null;
  /** Override the rendered height in px. */
  height?: number;
  className?: string;
}

// ── Parts ───────────────────────────────────────────────────────────────────

/**
 * A moulding: the thin turned band at a bead or fillet. A shadow under the
 * swell and a catch of light on top of it, which is what tells the eye a lathe
 * has been here.
 */
function Moulding({ y, r, strength }: { y: number; r: number; strength: number }) {
  return (
    <>
      <path d={bandArc(y, r)} fill="none" stroke="#000" strokeOpacity={0.20 * strength} strokeWidth={1.1 * strength} />
      <path d={bandArc(y, r, 1, -1.2)} fill="none" stroke="#FFFDF6" strokeOpacity={0.55 * strength} strokeWidth={0.9 * strength} />
    </>
  );
}

/**
 * The mouth. The eye is barely above the rim, so the opening is a shallow
 * ellipse; and the inside of a polished cup is not black — it is the same metal
 * in shadow, with the far wall catching light and throwing it back across.
 */
function Mouth({ cy, rx, uid }: { cy: number; rx: number; uid: string }) {
  const ry = rx * 0.15;
  return (
    <g>
      <ellipse cx={60} cy={cy} rx={rx} ry={ry} fill={`url(#${uid}-well)`} />
      <path
        d={`M${60 - rx + 1.4} ${cy + 0.2} A ${rx - 1.4} ${ry - 0.5} 0 0 0 ${60 + rx - 1.4} ${cy + 0.2}`}
        fill="none" stroke={M.lit} strokeWidth={Math.max(ry * 0.5, 1.1)} strokeOpacity={0.6}
      />
      <path
        d={`M${60 - rx + 2.2} ${cy - 0.5} A ${rx - 2.2} ${ry - 0.8} 0 0 1 ${60 + rx - 2.2} ${cy - 0.5}`}
        fill="none" stroke="#000" strokeWidth={Math.max(ry * 0.4, 0.9)} strokeOpacity={0.35}
      />
      <ellipse cx={60} cy={cy} rx={rx} ry={ry} fill="none" stroke={`url(#${uid}-lip)`} strokeWidth={2.4} />
      <path d={`M${60 - rx} ${cy} A ${rx} ${ry} 0 0 1 ${60 + rx} ${cy}`} fill="none" stroke={M.hi} strokeOpacity={0.7} strokeWidth={1} />
    </g>
  );
}

/**
 * A handle in the same light as the body: a dark under-edge, the tube, the
 * vertical falloff masked to the stroke, then a fresnel catch offset toward the
 * light and an occlusion offset away from it. Drawn as a stroke because a
 * handle IS a bent rod, and because a stroked path can be masked.
 */
function Handle({ d, w, uid, k, mirror }: { d: string; w: number; uid: string; k: number; mirror?: boolean }) {
  const id = `${uid}-h${k}${mirror ? 'm' : ''}`;
  return (
    <g transform={mirror ? 'translate(120 0) scale(-1 1)' : undefined}>
      <mask id={id}>
        <path d={d} fill="none" stroke="#fff" strokeWidth={w} strokeLinecap="round" />
      </mask>
      <path d={d} fill="none" stroke={M.deep} strokeOpacity={0.6} strokeWidth={w + 1.1} strokeLinecap="round" />
      <path d={d} fill="none" stroke={M.body} strokeWidth={w} strokeLinecap="round" />
      <g mask={`url(#${id})`}>
        <rect x={0} y={0} width={120} height={190} fill={`url(#${uid}-env)`} />
        <rect x={0} y={0} width={120} height={190} fill={`url(#${uid}-form)`} />
      </g>
      <path
        d={d} fill="none" stroke={M.hi} strokeOpacity={0.75}
        strokeWidth={Math.max(w * 0.22, 0.9)} strokeLinecap="round"
        transform={`translate(${-w * 0.24} ${-w * 0.24})`}
      />
      <path
        d={d} fill="none" stroke={M.deep} strokeOpacity={0.35}
        strokeWidth={Math.max(w * 0.16, 0.7)} strokeLinecap="round"
        transform={`translate(${w * 0.3} ${w * 0.3})`}
      />
    </g>
  );
}

function Streamer({ x, y, rot, len, drift, w, colour }: {
  x: number; y: number; rot: number; len: number; drift: number; w: number; colour: string;
}) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot})`}>
      <path d={streamerPath(len, drift, w)} fill={colour} />
      <path d={streamerFold(len, drift, w)} fill="#000" opacity={0.22} />
    </g>
  );
}

/**
 * One knot's worth of cloth. Two streamers falling on visibly different lines —
 * drawn on the same line they read as a single ribbon.
 */
function RibbonPair({ x, y, club, o }: { x: number; y: number; club: ClubColours; o: RibbonOpts }) {
  const w = o.w ?? 9.2;
  return (
    <g>
      <Streamer x={x + 3.4} y={y + 1.8} rot={o.rotB} len={o.lenB} drift={o.driftB} w={w - 1.6} colour={club.secondary} />
      <Streamer x={x - 2.6} y={y} rot={o.rotA} len={o.lenA} drift={o.driftA} w={w} colour={club.primary} />
      <ellipse cx={x} cy={y} rx={6.6} ry={4.8} fill={club.primary} />
      <ellipse cx={x} cy={y} rx={6.6} ry={4.8} fill="#000" opacity={0.18} />
      <ellipse cx={x - 1.7} cy={y - 1.4} rx={3.6} ry={2.4} fill="#fff" opacity={0.24} />
    </g>
  );
}

/**
 * Both handles get ribbons — a cup with one is a cup someone half-dressed. The
 * right-hand pair is mirrored and trimmed shorter so the sides read as cloth
 * tied twice, not as one shape reflected.
 */
function Ribbons({ x, y, club, o }: { x: number; y: number; club: ClubColours; o: RibbonOpts }) {
  const right: RibbonOpts = { ...o, lenA: o.lenA * 0.9, lenB: o.lenB * 0.94 };
  return (
    <>
      <RibbonPair x={x} y={y} club={club} o={o} />
      <g transform="translate(120 0) scale(-1 1)">
        <RibbonPair x={x} y={y + 1.6} club={club} o={right} />
      </g>
    </>
  );
}

// ── Defs ────────────────────────────────────────────────────────────────────

function Defs({ uid, hero }: { uid: string; hero: boolean }) {
  return (
    <defs>
      {/* THE light ramp, once. Re-stretched across every band of the profile,
          so the specular sits at the same fraction of the radius at every
          height and runs as one continuous line down the cup. */}
      <linearGradient id={`${uid}-wrap`} gradientUnits="objectBoundingBox" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor={M.dark} />
        <stop offset="3.5%" stopColor={M.lit} />
        <stop offset="8%" stopColor={M.shade} />
        <stop offset="26%" stopColor={M.body} />
        <stop offset="37%" stopColor={M.lit} />
        <stop offset="42%" stopColor={M.hi} />
        <stop offset="48%" stopColor={M.lit} />
        <stop offset="62%" stopColor={M.body} />
        <stop offset="78%" stopColor={M.shade} />
        <stop offset="89%" stopColor={M.lit} />
        <stop offset="95%" stopColor={M.dark} />
        <stop offset="100%" stopColor={M.deep} />
      </linearGradient>

      {/* Vertical light. One monotonic ramp: brightest at the top, gone by
          two-thirds down, then a warm bounce off the surface underneath. The
          only colour change happens at zero opacity, so it can never draw a
          line — an earlier version modelled a mirrored room with a hard horizon
          and banded every cup across the middle. */}
      <linearGradient id={`${uid}-env`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="190">
        <stop offset="0%" stopColor="#FFFFFF" stopOpacity={0.26} />
        <stop offset="24%" stopColor="#FFFFFF" stopOpacity={0.15} />
        <stop offset="46%" stopColor="#FFFFFF" stopOpacity={0.06} />
        <stop offset="64%" stopColor="#FFFFFF" stopOpacity={0} />
        <stop offset="82%" stopColor="#EEE0BE" stopOpacity={0.07} />
        <stop offset="100%" stopColor="#EEE0BE" stopOpacity={0.20} />
      </linearGradient>

      <linearGradient id={`${uid}-form`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="190">
        <stop offset="0%" stopColor="#000" stopOpacity={0.10} />
        <stop offset="22%" stopColor="#000" stopOpacity={0.03} />
        <stop offset="50%" stopColor="#000" stopOpacity={0} />
        <stop offset="78%" stopColor="#000" stopOpacity={0.03} />
        <stop offset="100%" stopColor="#000" stopOpacity={0.09} />
      </linearGradient>

      <linearGradient id={`${uid}-lip`} gradientUnits="objectBoundingBox" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor={M.dark} />
        <stop offset="18%" stopColor={M.hi} />
        <stop offset="46%" stopColor={M.body} />
        <stop offset="70%" stopColor={M.lit} />
        <stop offset="100%" stopColor={M.shade} />
      </linearGradient>

      <linearGradient id={`${uid}-well`} gradientUnits="objectBoundingBox" x1="0.15" y1="0" x2="0.85" y2="1">
        <stop offset="0%" stopColor="#2E2A20" />
        <stop offset="34%" stopColor="#3E392C" />
        <stop offset="62%" stopColor="#6B6353" />
        <stop offset="88%" stopColor="#8E866F" />
        <stop offset="100%" stopColor="#4A4436" />
      </linearGradient>

      {/* The plinth is lit from the same side as the cup. Without this the base
          reads as a separate object under a different lamp. */}
      <linearGradient id={`${uid}-across`} gradientUnits="objectBoundingBox" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="#000" stopOpacity={0.30} />
        <stop offset="20%" stopColor="#000" stopOpacity={0.05} />
        <stop offset="42%" stopColor="#FFF" stopOpacity={0.22} />
        <stop offset="64%" stopColor="#000" stopOpacity={0.04} />
        <stop offset="100%" stopColor="#000" stopOpacity={0.34} />
      </linearGradient>

      <linearGradient id={`${uid}-plinth`} gradientUnits="objectBoundingBox" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={M.plinthTop} />
        <stop offset="100%" stopColor={M.plinthBot} />
      </linearGradient>

      {hero && (
        <radialGradient id={`${uid}-glint`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity={0.95} />
          <stop offset="55%" stopColor="#FFFFFF" stopOpacity={0.30} />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity={0} />
        </radialGradient>
      )}
    </defs>
  );
}

// ── The component ───────────────────────────────────────────────────────────

export default function Trophy({ kind, size = 'hero', season, club, height, className }: Props) {
  const reactId = useId();
  const uid = `t${reactId.replace(/[:»]/g, '')}`;
  const spec = CUPS[kind];
  const h = height ?? HEIGHTS[size];
  const label = LABELS[kind];

  if (size === 'pip') {
    const [vx, vy, vw, vh] = PIP_BOX[kind];
    return (
      <svg
        width={Math.round((h * vw) / vh)} height={h}
        viewBox={`${vx} ${vy} ${vw} ${vh}`}
        role="img" aria-label={label} className={className} style={{ display: 'block' }}
      >
        <g fill="currentColor">
          {spec.handles.map(([d, w], i) => (
            <g key={i}>
              <path d={d} fill="none" stroke="currentColor" strokeWidth={w + 1.6} strokeLinecap="round" />
              <g transform="translate(120 0) scale(-1 1)">
                <path d={d} fill="none" stroke="currentColor" strokeWidth={w + 1.6} strokeLinecap="round" />
              </g>
            </g>
          ))}
          <path d={silhouette(spec.profile)} />
        </g>
      </svg>
    );
  }

  const hero = size === 'hero';
  const colours = club ?? DEFAULT_CLUB;
  const outline = silhouette(spec.profile);
  const [mouthY, mouthR] = spec.mouth;
  const [enamelY, enamelR] = spec.enamel;

  return (
    <svg
      width={Math.round((h * 120) / 190)} height={h} viewBox="0 0 120 190"
      role="img" aria-label={season ? `${label}, ${season}` : label}
      className={className} style={{ display: 'block' }}
    >
      <Defs uid={uid} hero={hero} />

      {spec.handles.map(([d, w], i) => (
        <g key={i}>
          <Handle d={d} w={w} uid={uid} k={i} />
          <Handle d={d} w={w} uid={uid} k={i} mirror />
        </g>
      ))}

      {/* Where a handle meets the body: cast handles swell into the bowl, they
          are not welded rod. Drawn before the body so the body covers the join. */}
      {spec.fillets.map(([fx, fy, fr], i) => (
        <g key={i}>
          <ellipse cx={fx} cy={fy} rx={fr} ry={fr * 0.8} fill={M.shade} />
          <ellipse cx={120 - fx} cy={fy} rx={fr} ry={fr * 0.8} fill={M.shade} />
          <ellipse cx={fx - fr * 0.3} cy={fy - fr * 0.3} rx={fr * 0.5} ry={fr * 0.4} fill={M.lit} opacity={0.7} />
          <ellipse cx={120 - fx - fr * 0.3} cy={fy - fr * 0.3} rx={fr * 0.5} ry={fr * 0.4} fill={M.lit} opacity={0.7} />
        </g>
      ))}

      {/* The body, turned: one band per profile sample, each the true width of
          the object at that height, all sharing the one wrap ramp. */}
      <g>
        <clipPath id={`${uid}-clip`}>
          <path d={outline} />
        </clipPath>
        <g clipPath={`url(#${uid}-clip)`}>
          {bands(spec.profile).map((b, i) => (
            <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} fill={`url(#${uid}-wrap)`} />
          ))}
          <rect x={0} y={0} width={120} height={190} fill={`url(#${uid}-env)`} />
          <rect x={0} y={0} width={120} height={190} fill={`url(#${uid}-form)`} />
          {spec.mouldings.map(([y, strength], i) => (
            <Moulding key={i} y={y} r={radiusAt(spec.profile, y)} strength={strength} />
          ))}
        </g>
        <path d={outline} fill="none" stroke={M.deep} strokeOpacity={0.45} strokeWidth={0.9} />
        <path d={outline} fill="none" stroke={M.hi} strokeOpacity={0.4} strokeWidth={0.6} transform="translate(-0.5 -0.5)" />
      </g>

      <path d={bandArc(enamelY, enamelR)} fill="none" stroke={M.enamel} strokeWidth={2.8} />
      <path d={bandArc(enamelY, enamelR, 1.5, -0.9)} fill="none" stroke="#fff" strokeOpacity={0.22} strokeWidth={1} />

      <Mouth cy={mouthY} rx={mouthR} uid={uid} />

      {hero && (
        <ellipse
          cx={60 - mouthR * 0.52} cy={mouthY + (150 - mouthY) * 0.3}
          rx={mouthR * 0.2} ry={(150 - mouthY) * 0.12}
          fill={`url(#${uid}-glint)`} opacity={0.55}
        />
      )}

      {/* Contact shadow, so the cup sits on its plinth rather than butting it. */}
      <ellipse cx={60} cy={150} rx={radiusAt(spec.profile, 149) + 2} ry={2.6} fill="#000" opacity={0.30} />
      <ellipse cx={60} cy={149.4} rx={radiusAt(spec.profile, 149)} ry={1.9} fill="#000" opacity={0.22} />

      <Ribbons x={spec.tie[0]} y={spec.tie[1]} club={colours} o={spec.ribbon} />

      {/* The plinth, and the year cut into it. */}
      <g>
        <path d="M26 150 L94 150 L91 157 L29 157 Z" fill={`url(#${uid}-plinth)`} />
        <path d="M29 157 L91 157 L88 173 L32 173 Z" fill={`url(#${uid}-plinth)`} />
        <path d="M26 150 L94 150 L91 157 L29 157 Z" fill="#fff" opacity={0.16} />
        <path d="M29 157 L91 157 L88 173 L32 173 Z" fill={`url(#${uid}-across)`} opacity={0.5} />
        <path d="M26 150 L94 150 L91 157 L29 157 Z" fill={`url(#${uid}-across)`} opacity={0.3} />
        {hero ? (
          <>
            <rect x={37} y={159.5} width={46} height={10.5} rx={1} fill="#000" opacity={0.34} />
            <rect x={37.5} y={160} width={45} height={9.5} rx={1} fill="none" stroke="#fff" strokeOpacity={0.12} />
            {season && (
              <text
                x={60} y={167.5} textAnchor="middle"
                fontFamily="'Archivo Narrow','Arial Narrow',sans-serif"
                fontSize={7.2} fontWeight={600} letterSpacing={0.4}
                fill={M.engrave} textLength={38} lengthAdjust="spacingAndGlyphs"
              >
                {season}
              </text>
            )}
          </>
        ) : (
          <rect x={40} y={161} width={40} height={8} rx={1} fill="#000" opacity={0.22} />
        )}
      </g>
    </svg>
  );
}
