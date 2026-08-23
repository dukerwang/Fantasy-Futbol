/**
 * PROTOTYPE ONLY — not imported by any production code.
 *
 * A realistic mid-season slice shaped like `HomeModel` from
 * `src/lib/home/buildHomeModel.ts`. Deliberately not the GW1 all-zero state:
 * every variant has to be judged with a season actually in it.
 */

export type Outcome = 'W' | 'D' | 'L';

export interface ProtoClub {
  id: string;
  name: string;
  abbr: string;
  manager: string;
  /** Sampled from the position spine + medal tokens so rows can carry identity. */
  colorToken: string;
}

export const CLUBS: Record<string, ProtoClub> = {
  xabi: { id: 'xabi', name: 'Not Too Xabi', abbr: 'NTX', manager: 'duke', colorToken: '--color-pos-dm' },
  chelsz: { id: 'chelsz', name: 'ChelsZ FC', abbr: 'CHZ', manager: 'ZNoh', colorToken: '--color-pos-lb' },
  hayden: { id: 'hayden', name: 'Hayden FC', abbr: 'HAY', manager: 'Hayden7912', colorToken: '--color-pos-st' },
  pizza: { id: 'pizza', name: "Pizzaking's Club", abbr: 'PZK', manager: 'Pizzaking', colorToken: '--color-pos-gk' },
  tea: { id: 'tea', name: 'Tea FC', abbr: 'TEA', manager: 'chai', colorToken: '--color-pos-lwb' },
  totten: { id: 'totten', name: 'tottenyang FC', abbr: 'TOT', manager: 'tottenyang', colorToken: '--color-pos-am' },
};

export const MODEL = {
  leagueName: 'Matchday Militia',
  season: '2026-27',
  gameweek: 21,
  totalGameweeks: 38,
  club: CLUBS.xabi,
  subtitle: 'Matchday Militia · Matchweek 21 of 38 · managed by duke',

  figures: [
    { value: '2nd', stake: '4 behind ChelsZ' },
    { value: '13-3-4', stake: 'Won-drawn-lost' },
    { value: '€8.5m', stake: 'Match revenue this block' },
    { value: '€196m', stake: 'Club Balance · 3rd richest', accent: true },
  ],

  fixture: {
    gameweek: 21,
    when: 'Sat 17 Jan · 15:00',
    home: CLUBS.xabi,
    away: CLUBS.tea,
    homeMeta: '2nd · 13-3-4',
    awayMeta: '5th · 8-4-8',
    homeScore: 61.4,
    awayScore: 54.8,
    margin: 6.6,
    verdict: 'Ahead by 6.6 — outside the draw band',
    outcome: 'ahead' as const,
    markerPct: 62,
    stillToPlay: { mine: 2, theirs: 4 },
    topMine: 'B. Saka · 14.2',
    topTheirs: 'O. Watkins · 11.8',
    live: true,
  },

  xi: [
    { slot: 'GK', name: 'D. Raya', state: 'locked' as const, pts: '4.1' },
    { slot: 'LB', name: 'M. Kerkez', state: 'locked' as const, pts: '6.8' },
    { slot: 'CB', name: 'W. Saliba', state: 'locked' as const, pts: '7.2' },
    { slot: 'CB', name: 'J. Gvardiol', state: 'locked' as const, pts: '5.9' },
    { slot: 'RB', name: 'P. Porro', state: 'flag' as const, pts: '3.4' },
    { slot: 'DM', name: 'D. Rice', state: 'locked' as const, pts: '6.1' },
    { slot: 'CM', name: 'C. Palmer', state: 'locked' as const, pts: '9.4' },
    { slot: 'AM', name: 'M. Cunha', state: 'ok' as const, pts: '—' },
    { slot: 'LW', name: 'B. Saka', state: 'locked' as const, pts: '14.2' },
    { slot: 'RW', name: 'A. Semenyo', state: 'locked' as const, pts: '8.3' },
    { slot: 'ST', name: 'H. Ekitiké', state: 'ok' as const, pts: '—' },
  ],
  xiSummary: '9 locked, 2 still yours to change',

  table: [
    { rank: 1, movement: 0, club: CLUBS.chelsz, w: 15, d: 2, l: 3, pf: '1,284.6', pts: 47, form: ['W', 'W', 'D', 'W', 'W'] as Outcome[], isMe: false },
    { rank: 2, movement: 1, club: CLUBS.xabi, w: 13, d: 3, l: 4, pf: '1,241.9', pts: 42, form: ['W', 'L', 'W', 'W', 'D'] as Outcome[], isMe: true },
    { rank: 3, movement: -1, club: CLUBS.hayden, w: 12, d: 4, l: 4, pf: '1,218.3', pts: 40, form: ['D', 'W', 'L', 'W', 'W'] as Outcome[], isMe: false },
    { rank: 4, movement: 0, club: CLUBS.totten, w: 9, d: 5, l: 6, pf: '1,132.7', pts: 32, form: ['L', 'D', 'W', 'D', 'L'] as Outcome[], isMe: false },
    { rank: 5, movement: 0, club: CLUBS.tea, w: 8, d: 4, l: 8, pf: '1,098.4', pts: 28, form: ['L', 'W', 'L', 'D', 'W'] as Outcome[], isMe: false },
    { rank: 6, movement: 0, club: CLUBS.pizza, w: 4, d: 2, l: 14, pf: '967.2', pts: 14, form: ['L', 'L', 'D', 'L', 'L'] as Outcome[], isMe: false },
  ],

  market: [
    { name: 'Estêvão', position: 'RW', meta: 'Chelsea · 18', bid: '€82m', holder: 'you', leading: true, expires: '4h 12m' },
    { name: 'A. Isak', position: 'ST', meta: 'Liverpool · 26', bid: '€128m', holder: 'Hayden7912', leading: false, expires: '19h 40m' },
    { name: 'N. Madueke', position: 'LW', meta: 'Arsenal · 24', bid: '€44m', holder: 'ZNoh', leading: false, expires: '1d 6h' },
  ],
  marketSummary: '3 lots on the board',
  marketBudget: '€196m to spend',

  fronts: [
    { competition: 'League', value: '2nd', sub: '4 behind ChelsZ', prize: '€40m', tone: 'live' as const },
    { competition: 'Champions Cup', value: 'Semi-final', sub: 'vs Hayden FC', prize: '€50m', tone: 'live' as const },
    { competition: 'League Cup', value: 'Out', sub: 'Lost R2 to Tea FC', prize: '€25m', tone: 'out' as const },
  ],

  matchweek: [
    { home: CLUBS.chelsz, away: CLUBS.pizza, hs: 72.1, as: 41.3, live: true },
    { home: CLUBS.hayden, away: CLUBS.totten, hs: 58.9, as: 60.2, live: true },
  ],

  wire: [
    { text: 'ChelsZ FC secures the signature of Alexander Isak (€128m)', at: '2h ago' },
    { text: 'Not Too Xabi received €30m budget return for Cristian Romero', at: '1d ago' },
    { text: 'Solidarity payment from the €25m signing of Cristian Romero', at: '1d ago' },
    { text: "Pizzaking's Club listed Kai Havertz at €55m", at: '3d ago' },
  ],

  opponent: {
    club: CLUBS.tea,
    record: '4-1-2 all-time',
    lastMeeting: 'Won 71.2 – 58.4 · MW9',
  },
};

export const POSITION_ORDER = ['GK', 'LB', 'CB', 'CB', 'RB', 'DM', 'CM', 'AM', 'LW', 'RW', 'ST'];
