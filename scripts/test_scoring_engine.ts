import { calculateMatchRating } from '../src/lib/scoring/engine';
import { RawStats } from '../src/types';

// A helper to make mock stats cleanly
function makeStats(overrides: Partial<RawStats>): RawStats {
  return {
    minutes_played: 90,
    goals: 0,
    assists: 0,
    shots_total: 0,
    shots_on_target: 0,
    passes_total: 40,
    passes_accurate: 35,
    pass_completion_pct: 87.5,
    key_passes: 0,
    big_chances_created: 0,
    dribbles_attempted: 0,
    dribbles_successful: 0,
    tackles_total: 0,
    tackles_won: 0,
    interceptions: 0,
    clearances: 0,
    blocks: 0,
    saves: 0,
    goals_conceded: 0,
    penalty_saves: 0,
    yellow_cards: 0,
    red_cards: 0,
    own_goals: 0,
    penalties_missed: 0,
    clean_sheet: false,
    bps: 10,
    influence: 10,
    creativity: 10,
    threat: 10,
    ict_index: 3.0,
    expected_goals: 0,
    expected_assists: 0,
    expected_goals_conceded: 0,
    fpl_tackles: 0,
    fpl_cbi: 0,
    fpl_recoveries: 0,
    ...overrides
  };
}

console.log("=== FANTASY FUTBOL MATCH RATING TEST ===\n");

// 1. Great Striker Performance (Haaland hat trick)
const hatTrickStriker = makeStats({
    goals: 3,
    bps: 75,
    influence: 80,
    creativity: 15,
    threat: 110,
    expected_goals: 1.5,
});
console.log("-----------------------------------------");
console.log("ST with a Hat Trick:");
let result1 = calculateMatchRating(hatTrickStriker, 'ST');
console.log(`Rating: ${result1.rating} / 10.0`);
console.log(`Fantasy Points: ${result1.fantasyPoints}`);
console.log("Breakdown:", result1.breakdown.filter((x: any) => x.weight > 0).map((x: any) => `${x.component}: ${(x.score * 10).toFixed(1)}/10 (wt: ${(x.weight).toFixed(2)})`).join(" | "));

// 2. Average Center Back (Clean Sheet, some defensive actions)
const avgCB = makeStats({
    clean_sheet: true,
    goals_conceded: 0,
    expected_goals_conceded: 0.5,
    bps: 22,
    influence: 20,
    fpl_tackles: 2,
    fpl_cbi: 5,
    fpl_recoveries: 4
});
console.log("\n-----------------------------------------");
console.log("CB with an average Clean Sheet:");
let result2 = calculateMatchRating(avgCB, 'CB');
console.log(`Rating: ${result2.rating} / 10.0`);
console.log(`Fantasy Points: ${result2.fantasyPoints}`);
console.log("Breakdown:", result2.breakdown.filter((x: any) => x.weight > 0).map((x: any) => `${x.component}: ${(x.score * 10).toFixed(1)}/10 (wt: ${(x.weight).toFixed(2)})`).join(" | "));

// 3. Playmaker Midfielder (De Bruyne 2 assists)
const amWithAssists = makeStats({
    assists: 2,
    bps: 45,
    influence: 55,
    creativity: 85,
    threat: 25,
    expected_assists: 0.8,
    key_passes: 5
});
console.log("\n-----------------------------------------");
console.log("AM with 2 Assists & high creativity:");
let result3 = calculateMatchRating(amWithAssists, 'AM');
console.log(`Rating: ${result3.rating} / 10.0`);
console.log(`Fantasy Points: ${result3.fantasyPoints}`);
console.log("Breakdown:", result3.breakdown.filter((x: any) => x.weight > 0).map((x: any) => `${x.component}: ${(x.score * 10).toFixed(1)}/10 (wt: ${(x.weight).toFixed(2)})`).join(" | "));

// 4. Bad Goalkeeper Performance (Conceded 4, no saves)
const badGk = makeStats({
    goals_conceded: 4,
    expected_goals_conceded: 1.2,
    saves: 1,
    bps: 5,
    influence: 5
});
console.log("\n-----------------------------------------");
console.log("GK conceding 4 goals on low xGC:");
let result4 = calculateMatchRating(badGk, 'GK');
console.log(`Rating: ${result4.rating} / 10.0`);
console.log(`Fantasy Points: ${result4.fantasyPoints}`);
console.log("Breakdown:", result4.breakdown.filter((x: any) => x.weight > 0).map((x: any) => `${x.component}: ${(x.score * 10).toFixed(1)}/10 (wt: ${(x.weight).toFixed(2)})`).join(" | "));

// 5. Short Sub Appearance (20 mins, did nothing)
const shortSub = makeStats({
    minutes_played: 20,
    bps: 3,
    influence: 2,
    creativity: 2,
    threat: 0
});
console.log("\n-----------------------------------------");
console.log("FWD Sub playing 20 minutes with no impact:");
let result5 = calculateMatchRating(shortSub, 'ST');
console.log(`Rating: ${result5.rating} / 10.0`);
console.log(`Fantasy Points: ${result5.fantasyPoints}`);
console.log("Breakdown:", result5.breakdown.filter((x: any) => x.weight > 0).map((x: any) => `${x.component}: ${(x.score * 10).toFixed(1)}/10 (wt: ${(x.weight).toFixed(2)})`).join(" | "));
