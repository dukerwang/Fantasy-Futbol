import type { OutlookContextBag, OutlookExtraction, PlayerOutlook } from '../../types/outlook';

export interface GoldenCase {
  id: string;
  label: string;
  bag: OutlookContextBag;
  extraction: OutlookExtraction;
  outlook: PlayerOutlook;
  /** Outlook must NOT match these (e.g. scoring inflation). */
  forbiddenPatterns?: RegExp[];
}

const BASE_DATE = '2026-08-26';
const SEASON = '2026-27';

function bag(
  overrides: Partial<OutlookContextBag> & Pick<OutlookContextBag, 'player_id' | 'name' | 'display_name' | 'club' | 'primary_position'>,
): OutlookContextBag {
  return {
    age: 27,
    nationality: 'England',
    secondary_positions: [],
    availability: 'available',
    injury_news: null,
    market_value_eur_m: 20,
    is_new_to_prem: false,
    academy_eligible: false,
    simulation_date: BASE_DATE,
    current_season: SEASON,
    is_dynasty_league: true,
    pl_tenure: 'established',
    ...overrides,
  };
}

function ext(overrides: Partial<OutlookExtraction>): OutlookExtraction {
  return {
    verified_facts: [],
    status_summary: '',
    role_summary: '',
    career_phase: 'unknown',
    data_gaps: [],
    conflicting_reports: [],
    current_head_coach: null,
    pl_mobility: 'unknown',
    mobility_summary: '',
    ...overrides,
  };
}

function outlookText(
  text: string,
  _tags: string[],
  confidence: 'high' | 'medium' | 'low' = 'high',
): PlayerOutlook {
  return {
    outlook: text,
    sidecar: {
      quality: 'high',
      minutes_role: 'nailed',
      career_phase: 'peak',
      dynasty_value: 'win_now',
      pl_mobility: 'stable',
      risk_flags: [],
      style: [],
      set_pieces: [],
      confidence,
      horizons_touched: ['near', 'long'],
      evidence_gaps: [],
      generated_at: `${BASE_DATE}T00:00:00.000Z`,
      model_id: 'gemini-3.7-flash',
      pipeline_version: '0.3.0',
    },
  };
}

/** Hand-authored valid outlooks for gate/regression tests — not live model output. */
export const GOLDEN_CASES: GoldenCase[] = [
  {
    id: 'tarkowski-cb-floor',
    label: 'Plateau CB — scoring inflation guard',
    bag: bag({ player_id: '1', name: 'James Tarkowski', display_name: 'James Tarkowski', club: 'Everton', primary_position: 'CB', age: 32, market_value_eur_m: 12 }),
    extraction: ext({ verified_facts: ['First-choice CB'], status_summary: 'Fit', role_summary: 'Nailed starter', career_phase: 'plateau', data_gaps: [], conflicting_reports: [] }),
    outlook: outlookText(
      'James Tarkowski is fit and entrenched as Everton\'s first-choice centre-back, logging heavy defensive volume most weeks with limited progressive carrying. At 32 he profiles as a plateau-phase starter whose value is durability and aerial defending rather than upside growth. Expect steady minutes and a reliable floor with occasional set-piece threat, and a longer arc defined by reliability over breakout potential rather than a changing role.',
      ['reliable_starter', 'plateau', 'aerial_defending'],
    ),
    forbiddenPatterns: [/\btop[- ]scor/i, /\bfantasy points/i, /\bmatch rating/i],
  },
  {
    id: 'szoboszlai-mid-volatility',
    label: 'Peak mid — set-piece routes',
    bag: bag({ player_id: '2', name: 'Dominik Szoboszlai', display_name: 'Dominik Szoboszlai', club: 'Liverpool', primary_position: 'CM', secondary_positions: ['AM'], age: 25, market_value_eur_m: 70 }),
    extraction: ext({ verified_facts: ['Set-piece taker'], status_summary: 'Available', role_summary: 'Central midfielder with set pieces', career_phase: 'peak', data_gaps: [], conflicting_reports: [] }),
    outlook: outlookText(
      'Dominik Szoboszlai looks nailed in Liverpool\'s midfield with set-piece responsibility and real chance volume when deployed advanced. The wrinkle is tactical: deeper usage would cap his ceiling, but dead-ball involvement keeps a floor either way. Peak-age contributor with multiple routes to weekly output and genuine variance tied to where he\'s deployed. Long-term value depends on Liverpool keeping him advanced and on the ball rather than as a deeper controller.',
      ['set_piece_routes', 'peak', 'role_volatility'],
    ),
  },
  {
    id: 'injured-returning',
    label: 'Returning from injury',
    bag: bag({ player_id: '3', name: 'Martin Odegaard', display_name: 'Martin Ødegaard', club: 'Arsenal', primary_position: 'AM', age: 27, availability: 'doubtful', injury_news: 'Knee — 75% chance of playing' }),
    extraction: ext({ verified_facts: ['Training again'], status_summary: 'Doubtful but progressing', role_summary: 'No.10 when fit', career_phase: 'peak', data_gaps: ['full training load unknown'], conflicting_reports: [] }),
    outlook: outlookText(
      'Martin Ødegaard is progressing back from a knee issue and remains doubtful for immediate selection, though the club sound confident he can feature soon. When fit he remains Arsenal\'s primary creative hub in the final third, with tempo control and set-piece quality defining his weekly influence. Near term the question is minutes security; longer term he still profiles as a peak-age playmaker whose value tracks availability more than any tactical reinvention.',
      ['minutes_risk', 'playmaker', 'peak'],
      'medium',
    ),
  },
  {
    id: 'suspended',
    label: 'Suspended',
    bag: bag({ player_id: '4', name: 'Test Player', display_name: 'Test Player', club: 'Chelsea', primary_position: 'ST', availability: 'suspended', injury_news: 'Suspended — 1 match' }),
    extraction: ext({ verified_facts: ['Red card suspension'], status_summary: 'Suspended one match', role_summary: 'Starting striker when eligible', career_phase: 'peak', data_gaps: [], conflicting_reports: [] }),
    outlook: outlookText(
      'Test Player is suspended for the immediate gameweek after picking up a red card, so he is unavailable for selection this round. When eligible he remains Chelsea\'s focal striker with penalty responsibility and the bulk of centre-forward minutes. Short term managers should expect a blank week; over the rest of the season he still profiles as a high-minute striker whose output tracks service and fitness more than a changed role.',
      ['suspension', 'striker', 'peak'],
    ),
  },
  {
    id: 'rotation-winger',
    label: 'Rotation risk winger',
    bag: bag({ player_id: '5', name: 'Noni Madueke', display_name: 'Noni Madueke', club: 'Arsenal', primary_position: 'RW', age: 23, market_value_eur_m: 45 }),
    extraction: ext({ verified_facts: ['Competition on right flank'], status_summary: 'Fit', role_summary: 'Rotation winger', career_phase: 'emerging', data_gaps: ['exact minute share unclear'], conflicting_reports: [] }),
    outlook: outlookText(
      'Noni Madueke is fit but fighting for minutes on Arsenal\'s right flank with genuine competition for the same role. When he starts he offers direct dribbling and end-product in bursts rather than a locked weekly floor. Near term expect rotation and volatile involvement; longer term he remains an emerging wide forward whose value climbs only if he wins a stable starting spot through sustained output.',
      ['minutes_risk', 'emerging', 'volatile'],
      'medium',
    ),
  },
  {
    id: 'new-to-prem',
    label: 'New Premier League arrival',
    bag: bag({ player_id: '6', name: 'New Signing', display_name: 'New Signing', club: 'West Ham', primary_position: 'CM', is_new_to_prem: true, age: 24, market_value_eur_m: 35 }),
    extraction: ext({ verified_facts: ['Summer signing'], status_summary: 'Available', role_summary: 'Competing for CM spot', career_phase: 'emerging', data_gaps: ['PL adaptation sample small'], conflicting_reports: [] }),
    outlook: outlookText(
      'New Signing arrived this summer and is still establishing himself in West Ham\'s midfield rotation after a strong record abroad. Early minutes look competitive rather than guaranteed, with adaptation to the league\'s tempo the main swing factor over the next month. Longer term he profiles as an emerging central midfielder whose ceiling depends on winning a defined role rather than spot starts off the bench.',
      ['new_arrival', 'emerging', 'minutes_risk'],
      'medium',
    ),
  },
  {
    id: 'u21-academy',
    label: 'U21 academy eligible',
    bag: bag({ player_id: '7', name: 'Youth Prospect', display_name: 'Youth Prospect', club: 'Brighton', primary_position: 'AM', age: 19, academy_eligible: true, market_value_eur_m: 8 }),
    extraction: ext({ verified_facts: ['Limited PL minutes'], status_summary: 'Available', role_summary: 'Squad option', career_phase: 'emerging', data_gaps: ['starter pathway unclear'], conflicting_reports: [] }),
    outlook: outlookText(
      'Youth Prospect is available but still on the fringes of Brighton\'s matchday squad with only scattered minutes so far. At 19 he offers creative flashes in short cameos rather than a reliable weekly workload. Near term he is a developmental watch rather than a locked starter; over several seasons his value tracks whether he graduates into a defined role or remains a squad depth piece.',
      ['developmental', 'emerging', 'minutes_risk'],
      'low',
    ),
  },
  {
    id: 'decline-risk-veteran',
    label: 'Decline-risk veteran',
    bag: bag({ player_id: '8', name: 'Veteran CM', display_name: 'Veteran CM', club: 'Fulham', primary_position: 'CM', age: 34, market_value_eur_m: 5 }),
    extraction: ext({ verified_facts: ['Reduced mobility noted'], status_summary: 'Fit', role_summary: 'Rotation midfielder', career_phase: 'decline_risk', data_gaps: [], conflicting_reports: [] }),
    outlook: outlookText(
      'Veteran CM remains fit but is increasingly managed in Fulham\'s midfield rotation as legs and recovery become limiting factors at 34. When he plays he still offers experience and retention in possession, though defensive range has narrowed. Near term expect spot starts and late subs; longer term he profiles as a decline-phase squad piece whose value is situational rather than weekly volume.',
      ['decline_risk', 'rotation', 'experience'],
    ),
  },
  {
    id: 'gk-starter',
    label: 'Nailed goalkeeper',
    bag: bag({ player_id: '9', name: 'David Raya', display_name: 'David Raya', club: 'Arsenal', primary_position: 'GK', age: 30, market_value_eur_m: 40 }),
    extraction: ext({ verified_facts: ['No.1 keeper'], status_summary: 'Available', role_summary: 'First-choice GK', career_phase: 'peak', data_gaps: [], conflicting_reports: [] }),
    outlook: outlookText(
      'David Raya is Arsenal\'s undisputed first-choice goalkeeper with every expectation of 90-minute weeks behind a strong defensive unit. His value is clean-sheet volume, shot-stopping reliability, and distribution composure rather than open-play creation. Near term he offers a high floor tied to Arsenal\'s defensive form; longer term he remains a peak-age keeper whose weekly output tracks team defensive performance more than individual breakout.',
      ['reliable_starter', 'goalkeeper', 'peak'],
    ),
  },
  {
    id: 'thin-data-hedge',
    label: 'Thin search data — low confidence',
    bag: bag({ player_id: '10', name: 'Obscure Bench', display_name: 'Obscure Bench', club: 'Wolves', primary_position: 'CB', age: 28, market_value_eur_m: 3 }),
    extraction: ext({ verified_facts: [], status_summary: 'Unknown', role_summary: 'Squad defender', career_phase: 'unknown', data_gaps: ['recent minutes', 'injury status', 'role'], conflicting_reports: [] }),
    outlook: outlookText(
      'Obscure Bench profiles as a squad centre-back at Wolves, though recent usage and fitness details are thin in available reporting. When selected he likely offers basic defensive cover rather than a defined weekly role. Near term treat minutes as uncertain; longer term he reads as a depth defender whose value only becomes clear if he wins consistent selection.',
      ['depth', 'minutes_risk'],
      'low',
    ),
  },
];

// Expand to 30 cases by varying positions and scenarios
const POSITIONS: Array<{ name: string; club: string; pos: OutlookContextBag['primary_position'] }> = [
  { name: 'Left Back', club: 'Newcastle', pos: 'LB' },
  { name: 'Right Back', club: 'Tottenham', pos: 'RB' },
  { name: 'Wing Back', club: 'Bournemouth', pos: 'LWB' },
  { name: 'Defensive Mid', club: 'Crystal Palace', pos: 'DM' },
  { name: 'Central Mid', club: 'Aston Villa', pos: 'CM' },
  { name: 'Attacking Mid', club: 'Nottingham Forest', pos: 'AM' },
  { name: 'Left Winger', club: 'Brentford', pos: 'LW' },
  { name: 'Right Winger', club: 'Leeds', pos: 'RW' },
  { name: 'Striker', club: 'Burnley', pos: 'ST' },
  { name: 'Centre Back Two', club: 'Sunderland', pos: 'CB' },
  { name: 'RWB Option', club: 'Fulham', pos: 'RWB' },
  { name: 'Dual Role', club: 'Brighton', pos: 'CM' },
  { name: 'Penalty Taker', club: 'Everton', pos: 'ST' },
  { name: 'Set Piece CB', club: 'West Ham', pos: 'CB' },
  { name: 'Bench AM', club: 'Chelsea', pos: 'AM' },
  { name: 'Loan Return', club: 'Liverpool', pos: 'LW' },
  { name: 'International Duty', club: 'Arsenal', pos: 'CM' },
  { name: 'Manager Change', club: 'Leicester', pos: 'DM' },
  { name: 'Winter Signing', club: 'Man City', pos: 'RW' },
  { name: 'Long Term Injured', club: 'Man United', pos: 'CM' },
];

for (let i = 0; i < POSITIONS.length; i++) {
  const p = POSITIONS[i];
  const id = `generated-${i + 11}`;
  const injured = p.name === 'Long Term Injured';
  GOLDEN_CASES.push({
    id,
    label: `${p.pos} — ${p.name}`,
    bag: bag({
      player_id: String(i + 11),
      name: p.name,
      display_name: p.name,
      club: p.club,
      primary_position: p.pos,
      availability: injured ? 'injured' : 'available',
      injury_news: injured ? 'Hamstring — out several weeks' : null,
      age: 24 + (i % 10),
    }),
    extraction: ext({
      verified_facts: [`Plays ${p.pos} for ${p.club}`],
      status_summary: injured ? 'Injured' : 'Available',
      role_summary: injured ? 'Out until fit' : 'In squad rotation',
      career_phase: i % 3 === 0 ? 'emerging' : i % 3 === 1 ? 'peak' : 'plateau',
      data_gaps: i % 5 === 0 ? ['exact role under new manager'] : [],
      conflicting_reports: [],
    }),
    outlook: outlookText(
      `${p.name} ${injured ? 'is currently sidelined with a hamstring issue and unavailable for immediate selection' : 'is available and part of the squad picture'} at ${p.club}, where he profiles primarily as a ${p.pos}. ${injured ? 'Near term managers should expect absences while he returns to match fitness;' : 'Near term his minutes depend on selection competition and tactical fit;'} longer term he reads as a ${i % 3 === 0 ? 'developing' : i % 3 === 1 ? 'peak-age' : 'plateau-phase'} ${p.pos.toLowerCase()} whose weekly value tracks involvement and role clarity more than a sudden profile change.`,
      [p.pos.toLowerCase(), injured ? 'injury' : 'rotation'],
      i % 5 === 0 ? 'medium' : 'high',
    ),
  });
}
