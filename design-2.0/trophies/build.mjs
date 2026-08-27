/**
 * Generates the trophy-cabinet prototype artboards from trophies.mjs.
 * Run: node build.mjs
 */

import { writeFileSync } from 'node:fs';
import {
  trophySvg, KINDS, LABELS, OBJECT_NAMES, FINISHES, CLUB,
} from './trophies.mjs';

// ── Page palette, lifted from src/app/globals.css (never rounded) ───────────

const T = {
  light: {
    ground: '#F8F4EC', card: '#FCFAF7', inset: '#E2DFDA', secondary: '#EBE8E2',
    border: '#C2BDB5', borderSubtle: '#D9D5CF', borderStrong: '#8C857A',
    ink: '#1B1915', ink2: '#49443B', muted: '#635D51',
    accent: '#0C6D3E', onAccent: '#FFFFFF',
  },
  dark: {
    ground: '#1B1F29', card: '#272D39', inset: '#131720', secondary: '#242934',
    border: '#3F4552', borderSubtle: '#2D333E', borderStrong: '#707787',
    ink: '#EBE7E1', ink2: '#B5B0A7', muted: '#989389',
    accent: '#28A564', onAccent: '#1B1915',
  },
};

/**
 * The display.
 *
 * Two wrong answers first. A dark green back panel with brown ledges read as a
 * chalkboard and a chalk tray. Replacing it with a studio sweep — wall gradient
 * meeting a floor gradient at a horizon — was worse in a way that took a while
 * to see: the horizon ran straight across the panel at a fixed height, so every
 * trophy standing BELOW it sat on a visibly darker ground than the row above,
 * and the whole display looked like it changed colour halfway down. Two rows of
 * objects cannot share one floor line anyway without real perspective.
 *
 * So: no horizon, no floor, no split. One soft, even backdrop with a warm pool
 * of light in it. What grounds each trophy is its OWN contact shadow and its
 * own reflection, which is where grounding belongs.
 *
 * The backdrop follows the theme (it is the room's lighting) while the trophies
 * never do (they are objects).
 */
const SWEEP = {
  light: {
    top: '#F2ECE0', mid: '#E7DFCE', low: '#DED5C1',
    glow: 'rgba(255,250,236,.85)',
    ink: '#221E17', sub: '#6B6151',
  },
  dark: {
    top: '#262219', mid: '#1C1913', low: '#15120C',
    glow: 'rgba(255,238,196,.10)',
    ink: '#F0E9D8', sub: '#9A9078',
  },
};

const FONTS =
  '<link rel="preconnect" href="https://fonts.googleapis.com">' +
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,600;0,6..72,700;1,6..72,400&family=Hanken+Grotesk:wght@400;500;600;700&family=Archivo+Narrow:wght@500;600;700&display=swap">';

function themeCss(theme) {
  const p = T[theme];
  const s = `.t-${theme}`;
  return `
    ${s} { color:${p.ink}; }
    ${s} a { color:${p.accent}; } ${s} a:hover { color:${p.ink}; }
    ${s} .label { color:${p.muted}; }
    ${s} .dim { color:${p.ink2}; }
    ${s} .dot { color:${p.muted}; }
    ${s} .panel { background:${p.card};
      box-shadow:${theme === 'light'
        ? '0 1px 1px rgba(58,44,26,.05), 0 2px 5px rgba(58,44,26,.05), 0 18px 34px -14px rgba(58,44,26,.20), inset 0 1px 0 rgba(255,255,255,.9)'
        : '0 1px 1px rgba(0,0,0,.35), 0 2px 6px rgba(0,0,0,.30), 0 18px 34px -14px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.045)'}; }
  `;
}

function base(theme) {
  const p = T[theme];
  return `
    :root { color-scheme: ${theme}; }
    body { margin:0; background:${p.ground};
      font-family:'Hanken Grotesk',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
      -webkit-font-smoothing:antialiased; }
    .serif { font-family:'Newsreader',Georgia,'Times New Roman',serif; }
    .cond { font-family:'Archivo Narrow','Arial Narrow',sans-serif;
      letter-spacing:.06em; text-transform:uppercase; }
    .label { font-family:'Archivo Narrow','Arial Narrow',sans-serif;
      font-size:11px; font-weight:600; letter-spacing:.09em; text-transform:uppercase; }
    .panel { border-radius:10px; overflow:hidden; }
    h1,h2 { margin:0; text-wrap:balance; }
    ${themeCss('light')}
    ${themeCss('dark')}

    /* ── The display ───────────────────────────────────────────────────────
       A studio sweep, not a cabinet. '.sweep' is the seamless backdrop; the
       horizon sits where the wall meets the floor; '.pool' is the light behind
       the objects; '.mirror' is the reflection each trophy casts on the floor.
       There is deliberately no container around any individual trophy — that
       was what made the first pass read as flashcards. */
    .sweep { position:relative; border-radius:14px; overflow:hidden; isolation:isolate; }
    .pool { position:absolute; inset:0; z-index:0; pointer-events:none; }
    .stage { position:relative; z-index:1; display:flex; flex-direction:column; }
    .row { display:flex; align-items:flex-end; justify-content:center; gap:46px;
      padding:30px 40px 0; flex-wrap:wrap; }
    .stand { display:flex; flex-direction:column; align-items:center; flex:none; }
    /* The object and its reflection are one column; the reflection is the same
       markup flipped, faded out with a mask, and squashed the way a shallow
       reflection on a polished surface actually behaves. */
    .obj { display:block; }
    .mirrorWell { height:56px; overflow:hidden; margin-top:-1px; pointer-events:none; }
    .mirror { display:block; transform:scaleY(-.40); transform-origin:top center;
      opacity:.26; filter:blur(.7px);
      -webkit-mask-image:linear-gradient(to top, transparent 4%, #000 72%);
      mask-image:linear-gradient(to top, transparent 4%, #000 72%); }
    .nameplate { margin-top:8px; text-align:center; max-width:190px; }
    .nameplate .comp { font-family:'Newsreader',Georgia,serif; font-size:17px;
      font-weight:600; line-height:1.15; }
    .nameplate .fin { font-family:'Archivo Narrow','Arial Narrow',sans-serif;
      font-size:10px; font-weight:600; letter-spacing:.10em; text-transform:uppercase;
      margin-top:3px; }
    .caseHd { position:relative; z-index:1; display:flex; align-items:baseline;
      justify-content:space-between; gap:16px; padding:18px 26px 0; }
    .caseHd .t { font-family:'Archivo Narrow','Arial Narrow',sans-serif;
      font-size:11px; font-weight:600; letter-spacing:.11em; text-transform:uppercase; }

  `;
}

function dc(body, css, previewW, previewH) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  ${FONTS}
  <style>${css}</style>
</helmet>
${body}
</x-dc>
<script data-dc-script data-props='{"$preview":{"width":${previewW},"height":${previewH}}}'>
class Component extends DCLogic {}
</script>
</body>
</html>
`;
}

// ── Display helpers ─────────────────────────────────────────────────────────

/**
 * The seamless sweep: wall gradient into floor gradient, with a soft horizon
 * and a warm pool of light behind whatever stands on it.
 */
function sweep(theme, _horizon, inner) {
  const w = SWEEP[theme];
  return `<div class="sweep" style="background:radial-gradient(112% 86% at 50% 26%, ${w.top} 0%, ${w.mid} 58%, ${w.low} 100%)">
    <div class="pool" style="background:radial-gradient(46% 34% at 50% 34%, ${w.glow}, transparent 74%)"></div>
    ${inner}
  </div>`;
}

/** One trophy standing on the sweep: the object, its reflection, its nameplate. */
function stand(theme, svg, reflection, comp, sub, vacantEntry) {
  const w = SWEEP[theme];
  return `<div class="stand">
    <div class="obj">${svg}</div>
    <div class="mirrorWell" aria-hidden="true"><div class="mirror">${reflection}</div></div>
    <div class="nameplate">
      <div class="comp" style="color:${w.ink}${vacantEntry ? ';opacity:.5' : ''}">${comp}</div>
      ${sub ? `<div class="fin" style="color:${w.sub}${vacantEntry ? ';opacity:.75' : ''}">${sub}</div>` : ''}
    </div>
  </div>`;
}

const won = (theme, kind, season, uid, h = 240) =>
  stand(
    theme,
    trophySvg(kind, 'hero', uid, season, CLUB, h),
    trophySvg(kind, 'hero', `${uid}r`, season, CLUB, h),
    LABELS[kind],
    '',
  );

// ── Main.dc.html — the cabinet ──────────────────────────────────────────────

/**
 * One entry per TROPHY, not per competition. Two Champions Cups are two objects
 * on the display, each carrying its own year — as they would on a real shelf.
 */
const CABINET = [
  { kind: 'champions_cup', season: '2029-30' },
  { kind: 'league_title', season: '2028-29' },
  { kind: 'champions_cup', season: '2027-28' },
  { kind: 'league_cup', season: '2026-27' },
];

function mainBoard() {
  const w = SWEEP.light;
  const rows = `<div class="stage">
      <div class="row">${CABINET.slice(0, 3).map((t, i) => won('light', t.kind, t.season, `w${i}`)).join('')}</div>
      <div class="row" style="padding-top:6px;padding-bottom:34px">
        ${CABINET.slice(3).map((t, i) => won('light', t.kind, t.season, `x${i}`)).join('')}
      </div>
    </div>`;

  return dc(
    `<div class="t-light" style="padding:30px 34px 44px;display:flex;flex-direction:column;gap:24px;max-width:1180px;margin:0 auto">
      <nav style="display:flex;align-items:center;gap:8px;font-size:13px">
        <a href="#" style="text-decoration:none">Ravenhill Athletic</a>
        <span class="dot">/</span><span class="dim">Honours</span>
      </nav>

      <header style="display:flex;align-items:center;gap:20px">
        <div style="width:64px;height:64px;border-radius:6px;background:${CLUB.primary};display:flex;align-items:center;justify-content:center;flex:none">
          <span class="serif" style="color:${CLUB.secondary};font-size:26px;font-weight:700">RA</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:4px;min-width:0">
          <div class="label">Trophy cabinet</div>
          <h1 class="serif" style="font-size:40px;font-weight:700;letter-spacing:-.03em;line-height:1.02">Ravenhill Athletic</h1>
          <div class="dim" style="display:flex;align-items:baseline;flex-wrap:wrap;gap:8px;font-size:13px">
            <span>Duke</span><span class="dot">·</span>
            <span>${CABINET.length} trophies</span><span class="dot">·</span>
            <span>first won 2026-27</span>
          </div>
        </div>
      </header>

      ${sweep('light', 62, `<div class="caseHd">
          <span class="t" style="color:${w.sub}">Ravenhill Athletic</span>
          <span class="t" style="color:${w.sub}">${CABINET.length} won</span>
        </div>${rows}`)}

      <p class="dim" style="margin:0;font-size:13px;max-width:660px">
        Every cup carries this club's ribbons and its own year, cut into the base.
        The cabinet holds what this club has won and nothing else — no outlines of
        competitions it hasn't, which turns a trophy room into a list of failures.
      </p>
    </div>`,
    base('light'),
    1240,
    1240,
  );
}

// ── Trophies.dc.html — the objects, and the silhouette test ─────────────────

function trophiesBoard() {
  const clubs = [
    { name: 'Ravenhill Athletic', club: CLUB },
    { name: 'Cold Harbour FC', club: { primary: '#0F1E36', secondary: '#D4A017' } },
    { name: 'Saltmarsh United', club: { primary: '#582E60', secondary: '#A7F3D0' } },
  ];

  const clubRow = clubs
    .map((c, i) =>
      stand(
        'light',
        trophySvg('champions_cup', 'hero', `cl${i}`, '2026-27', c.club, 220),
        trophySvg('champions_cup', 'hero', `cl${i}r`, '2026-27', c.club, 220),
        c.name,
        'Champions Cup',
      ),
    )
    .join('');

  const fourRow = KINDS.map((k, i) =>
    stand(
      'light',
      trophySvg(k, 'hero', `t${i}`, '2026-27', CLUB),
      trophySvg(k, 'hero', `t${i}r`, '2026-27', CLUB),
      OBJECT_NAMES[k],
      `${LABELS[k]} · ${FINISHES[k]}`,
    ),
  ).join('');

  const pipRow = (theme) =>
    KINDS.map(
      (k, i) => `
      <div style="display:flex;flex-direction:column;align-items:center;gap:8px">
        ${trophySvg(k, 'pip', `p${theme[0]}${i}`)}
        <div class="label" style="font-size:10px">${OBJECT_NAMES[k].replace('The ', '')}</div>
      </div>`,
    ).join('');

  const pipHalf = (theme) => `
    <div class="t-${theme}" style="background:${T[theme].ground};padding:26px 30px;border-radius:10px;display:flex;flex-direction:column;gap:18px;flex:1 1 0">
      <span class="label">${theme === 'light' ? 'Cream Editorial' : 'Premium Dark'}</span>
      <div style="display:flex;gap:34px;align-items:flex-end">${pipRow(theme)}</div>
    </div>`;

  const heading = (h, sub) => `
    <div style="display:flex;flex-direction:column;gap:6px">
      <h2 class="serif" style="font-size:25px;font-weight:600;letter-spacing:-.02em">${h}</h2>
      <p class="dim" style="margin:0;font-size:14px;max-width:730px">${sub}</p>
    </div>`;

  return dc(
    `<div class="t-light" style="padding:36px 40px 44px;display:flex;flex-direction:column;gap:26px">
      ${heading(
        'Four cups, one metal',
        'One warm-neutral silver for all four — warmth in the metal rather than gold, and no ramp that could turn finish into rank. They are told apart by silhouette and surface. Fixed colour in both themes: a physical object doesn\u2019t repaint itself when you turn the lights down.',
      )}
      ${sweep('light', 66, `<div class="stage"><div class="row" style="padding-bottom:30px;gap:30px">${fourRow}</div></div>`)}

      ${heading(
        'The same cup, three clubs',
        'Ribbons come from the club\u2019s own crest colours, so no two cabinets hold a Champions Cup that looks the same.',
      )}
      ${sweep('light', 66, `<div class="stage"><div class="row" style="padding-bottom:30px;gap:56px">${clubRow}</div></div>`)}

      ${heading(
        'Silhouette test · 22px',
        'No colour, no metal, no ribbons. If you can\u2019t tell them apart here the form is wrong — this is the only size where shape does all the work.',
      )}
      <div style="display:flex;gap:18px">${pipHalf('light')}${pipHalf('dark')}</div>
    </div>`,
    base('light'),
    1240,
    1660,
  );
}

// ── Empty.dc.html — a club that has not won anything yet ───────────────────

function emptyBoard() {
  const half = (theme) => `
    <section class="t-${theme}" style="background:${T[theme].ground};padding:36px 40px;display:flex;flex-direction:column;gap:20px">
      <div class="label">${theme === 'light' ? 'Cream Editorial' : 'Premium Dark'}</div>
      ${sweep(theme, 64, `<div class="caseHd">
          <span class="t" style="color:${SWEEP[theme].sub}">Cold Harbour FC</span>
        </div>
        <div class="stage"><div style="padding:74px 40px 82px;text-align:center;display:flex;flex-direction:column;gap:10px;align-items:center">
          <div class="serif" style="font-size:25px;font-weight:600;letter-spacing:-.02em;color:${SWEEP[theme].ink}">No trophies yet</div>
          <div style="font-size:14px;line-height:1.5;max-width:380px;color:${SWEEP[theme].sub}">
            Cold Harbour hasn't won anything. The first honours are awarded when 2026-27 ends.
          </div>
        </div></div>`)}
    </section>`;

  return dc(`<div style="display:flex;flex-direction:column">${half('light')}${half('dark')}</div>`, base('light'), 1240, 900);
}

// ── Masthead.dc.html — the pip row in situ ─────────────────────────────────

function mastheadBoard() {
  // One pip per trophy, never a "x2" multiplier: if each win is its own object
  // then the row is a row of objects, and four of them should look like four.
  const masthead = (theme, trophies, name, club) => {
    const p = T[theme];
    return `
    <div class="panel" style="padding:24px 24px 20px;display:flex;gap:20px;align-items:flex-start">
      <div style="width:68px;height:68px;border-radius:6px;background:${club.primary};display:flex;align-items:center;justify-content:center;flex:none">
        <span class="serif" style="color:${club.secondary};font-size:27px;font-weight:700">${name.split(' ').map((x) => x[0]).join('')}</span>
      </div>
      <div style="flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:4px">
        <div class="label">2026-27 · Matchday Militia</div>
        <h1 class="serif" style="font-size:40px;font-weight:700;letter-spacing:-.03em;line-height:1.02">${name}</h1>
        <div class="dim" style="display:flex;align-items:baseline;flex-wrap:wrap;gap:8px;font-size:13px;line-height:1.3">
          <span>Duke</span><span class="dot">·</span><span>3rd</span><span>of 10</span>
          <span class="dot">·</span><span>12W · 3D · 7L</span>
        </div>
        ${
          trophies.length
            ? `<a href="#" style="display:flex;align-items:flex-end;gap:12px;margin-top:8px;text-decoration:none;color:${p.ink2}">
                 ${trophies.map((t, i) => trophySvg(t, 'pip', `s${theme[0]}${i}`)).join('')}
               </a>`
            : ''
        }
      </div>
    </div>`;
  };

  const half = (theme) => `
    <section class="t-${theme}" style="background:${T[theme].ground};padding:36px 40px;display:flex;flex-direction:column;gap:24px">
      <div class="label">${theme === 'light' ? 'Cream Editorial' : 'Premium Dark'}</div>
      ${masthead(theme, ['champions_cup', 'league_title', 'champions_cup', 'league_cup'], 'Ravenhill Athletic', CLUB)}
      <div class="label">No honours — the row is absent, not empty</div>
      ${masthead(theme, [], 'Cold Harbour FC', { primary: '#0F1E36', secondary: '#D4A017' })}
    </section>`;

  return dc(`<div style="display:flex;flex-direction:column">${half('light')}${half('dark')}</div>`, base('light'), 980, 1020);
}

// ── Write ───────────────────────────────────────────────────────────────────

const files = {
  'Main.dc.html': mainBoard(),
  'Trophies.dc.html': trophiesBoard(),
  'Masthead.dc.html': mastheadBoard(),
  'Empty.dc.html': emptyBoard(),
};

for (const [name, content] of Object.entries(files)) {
  writeFileSync(new URL(name, import.meta.url), content);
  console.log('wrote', name, `${(content.length / 1024).toFixed(1)}kb`);
}

writeFileSync(
  new URL('canvas.json', import.meta.url),
  JSON.stringify(
    {
      artboards: [
        { file: 'Main.dc.html', x: 0, y: 0, w: 1240, h: 1220, title: 'Cabinet' },
        { file: 'Trophies.dc.html', x: 1380, y: 0, w: 1240, h: 1620, title: 'The four objects' },
        { file: 'Empty.dc.html', x: 0, y: 1360, w: 1240, h: 900, title: 'Empty cabinet' },
        { file: 'Masthead.dc.html', x: 2760, y: 0, w: 980, h: 1020, title: 'Masthead strip' },
      ],
      launch: { view: 'canvas' },
    },
    null,
    2,
  ) + '\n',
);
console.log('wrote canvas.json');
