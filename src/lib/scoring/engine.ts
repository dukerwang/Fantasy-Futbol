/**
 * Fantasy Futbol — Scoring Engine
 *
 * Converts raw match stats into fantasy points.
 * Scoring is granular-position-aware (CB vs FB vs GK etc.).
 * Rules are pulled from league.scoring_rules to allow per-league customisation.
 */

import type { GranularPosition, RawStats, ScoringRules } from '@/types';
import { DEFAULT_SCORING_RULES } from '@/types';

export interface ScoringBreakdown {
  total: number;
  lines: { category: string; points: number; detail: string }[];
}

/**
 * Calculate fantasy points for a single player's match stats.
 */
export function calculateFantasyPoints(
  stats: RawStats,
  position: GranularPosition,
  rules: ScoringRules = DEFAULT_SCORING_RULES
): ScoringBreakdown {
  const lines: ScoringBreakdown['lines'] = [];

  function add(category: string, points: number, detail: string) {
    if (points !== 0) {
      lines.push({ category, points, detail });
    }
  }

  // --- Minutes Played Bonus ---
  if (stats.minutes_played >= 60) {
    add('Appearance', rules.minutes_played_60, `${stats.minutes_played} mins (60+)`);
  } else if (stats.minutes_played >= 45) {
    add('Appearance', rules.minutes_played_45, `${stats.minutes_played} mins (45+)`);
  }

  // --- Attacking ---
  if (stats.goals > 0) {
    add('Goals', stats.goals * rules.goal, `${stats.goals} goal(s)`);
  }
  if (stats.assists > 0) {
    add('Assists', stats.assists * rules.assist, `${stats.assists} assist(s)`);
  }
  if (stats.shots_on_target > 0) {
    add(
      'Shots on Target',
      stats.shots_on_target * rules.shot_on_target,
      `${stats.shots_on_target} shot(s) on target`
    );
  }

  // --- Possession ---
  if (stats.key_passes > 0) {
    add('Key Passes', stats.key_passes * rules.key_pass, `${stats.key_passes} key pass(es)`);
  }
  if (stats.big_chances_created > 0) {
    add(
      'Big Chances Created',
      stats.big_chances_created * rules.big_chance_created,
      `${stats.big_chances_created} big chance(s) created`
    );
  }
  if (stats.dribbles_successful > 0) {
    add(
      'Dribbles',
      stats.dribbles_successful * rules.successful_dribble,
      `${stats.dribbles_successful} dribble(s) won`
    );
  }

  // Pass Completion Tiers (only for outfield players who passed enough)
  if (stats.passes_total >= 20) {
    if (stats.pass_completion_pct >= 90) {
      add(
        'Pass Completion',
        rules.pass_completion_tier_1,
        `${stats.pass_completion_pct.toFixed(0)}% completion (Tier 1)`
      );
    } else if (stats.pass_completion_pct >= 80) {
      add(
        'Pass Completion',
        rules.pass_completion_tier_2,
        `${stats.pass_completion_pct.toFixed(0)}% completion (Tier 2)`
      );
    }
  }

  // --- Defensive ---
  if (stats.tackles_won > 0) {
    add(
      'Tackles Won',
      stats.tackles_won * rules.tackle_won,
      `${stats.tackles_won} tackle(s) won`
    );
  }
  if (stats.interceptions > 0) {
    add(
      'Interceptions',
      stats.interceptions * rules.interception,
      `${stats.interceptions} interception(s)`
    );
  }
  if (stats.clearances > 0) {
    const pts = stats.clearances * rules.clearance;
    add('Clearances', pts, `${stats.clearances} clearance(s)`);
  }

  // --- Clean Sheets (position-weighted) ---
  if (stats.clean_sheet && stats.minutes_played >= 60) {
    const csPoints = getCleanSheetPoints(position, rules);
    if (csPoints > 0) {
      add('Clean Sheet', csPoints, `Clean sheet (${position})`);
    }
  }

  // --- Goalkeeping ---
  if (position === 'GK') {
    if (stats.saves > 0) {
      add('Saves', stats.saves * rules.save, `${stats.saves} save(s)`);
    }
    if (stats.penalty_saves > 0) {
      add(
        'Penalty Saves',
        stats.penalty_saves * rules.penalty_save,
        `${stats.penalty_saves} penalty save(s)`
      );
    }
    // Goals conceded deduction (per 2 goals, for GK)
    if (stats.goals_conceded >= 2) {
      const deductions = Math.floor(stats.goals_conceded / 2) * rules.goals_conceded_per_2;
      add(
        'Goals Conceded',
        deductions,
        `${stats.goals_conceded} goals conceded (-1 per 2)`
      );
    }
  }

  // --- Discipline ---
  if (stats.yellow_cards > 0) {
    add(
      'Yellow Card',
      stats.yellow_cards * rules.yellow_card,
      `${stats.yellow_cards} yellow card(s)`
    );
  }
  if (stats.red_cards > 0) {
    add('Red Card', stats.red_cards * rules.red_card, `${stats.red_cards} red card(s)`);
  }
  if (stats.own_goals > 0) {
    add('Own Goal', stats.own_goals * rules.own_goal, `${stats.own_goals} own goal(s)`);
  }
  if (stats.penalties_missed > 0) {
    add(
      'Penalty Missed',
      stats.penalties_missed * rules.penalty_missed,
      `${stats.penalties_missed} penalty miss(es)`
    );
  }

  const total = lines.reduce((sum, l) => sum + l.points, 0);
  return { total, lines };
}

function getCleanSheetPoints(position: GranularPosition, rules: ScoringRules): number {
  switch (position) {
    case 'GK':
      return rules.clean_sheet_gk;
    case 'CB':
      return rules.clean_sheet_cb;
    case 'LB':
    case 'RB':
      return rules.clean_sheet_fb;
    case 'DM':
      return rules.clean_sheet_dm;
    default:
      return 0;
  }
}

/**
 * Calculate total fantasy points for a team lineup in a gameweek.
 * Takes an array of (stats, position) pairs for each starter.
 */
export function calculateTeamPoints(
  players: { stats: RawStats; position: GranularPosition }[],
  rules: ScoringRules = DEFAULT_SCORING_RULES
): number {
  return players.reduce((total, p) => {
    const { total: pts } = calculateFantasyPoints(p.stats, p.position, rules);
    return total + pts;
  }, 0);
}

/**
 * Map an API-Football player statistics response to our RawStats format.
 * Returns null if the player didn't play.
 */
export function mapApiStatsToRawStats(
  apiStats: Record<string, unknown>,
  opponentGoals: number
): RawStats | null {
  const games = apiStats.games as Record<string, unknown> | undefined;
  const goals = apiStats.goals as Record<string, unknown> | undefined;
  const shots = apiStats.shots as Record<string, unknown> | undefined;
  const passes = apiStats.passes as Record<string, unknown> | undefined;
  const tackles = apiStats.tackles as Record<string, unknown> | undefined;
  const dribbles = apiStats.dribbles as Record<string, unknown> | undefined;
  const cards = apiStats.cards as Record<string, unknown> | undefined;
  const penalty = apiStats.penalty as Record<string, unknown> | undefined;
  const goalkeeper = apiStats.goalkeeper as Record<string, unknown> | undefined;

  const minutes = (games?.minutes as number | null) ?? 0;
  if (minutes === 0) return null;

  const passesTotal = (passes?.total as number | null) ?? 0;
  const passesAccurate = parseInt(String((passes?.accuracy as string | null) ?? '0'), 10) || 0;
  const passCompletionPct = passesTotal > 0 ? (passesAccurate / passesTotal) * 100 : 0;

  const saves = (goalkeeper?.saves as number | null) ?? 0;
  const goalsConceded = opponentGoals;

  return {
    minutes_played: minutes,
    goals: (goals?.total as number | null) ?? 0,
    assists: (goals?.assists as number | null) ?? 0,
    shots_total: (shots?.total as number | null) ?? 0,
    shots_on_target: (shots?.on as number | null) ?? 0,
    passes_total: passesTotal,
    passes_accurate: passesAccurate,
    pass_completion_pct: passCompletionPct,
    key_passes: (passes?.key as number | null) ?? 0,
    big_chances_created: 0, // Not available in API-Football free tier — will add if scraping
    dribbles_attempted: (dribbles?.attempts as number | null) ?? 0,
    dribbles_successful: (dribbles?.success as number | null) ?? 0,
    tackles_total: (tackles?.total as number | null) ?? 0,
    tackles_won: (tackles?.total as number | null) ?? 0, // API doesn't split won/total on free tier
    interceptions: (tackles?.interceptions as number | null) ?? 0,
    clearances: (tackles as Record<string, unknown>)?.blocks
      ? ((tackles as Record<string, unknown>).blocks as number)
      : 0,
    blocks: (tackles as Record<string, unknown>)?.blocks
      ? ((tackles as Record<string, unknown>).blocks as number)
      : 0,
    saves,
    goals_conceded: goalsConceded,
    penalty_saves: (penalty?.saved as number | null) ?? 0,
    yellow_cards: (cards?.yellow as number | null) ?? 0,
    red_cards: (cards?.red as number | null) ?? 0,
    own_goals: 0, // Not provided directly — derive from goals_conceded if needed
    penalties_missed: (penalty?.missed as number | null) ?? 0,
    clean_sheet: goalsConceded === 0,
  };
}
