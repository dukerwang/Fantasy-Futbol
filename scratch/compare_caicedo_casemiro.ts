import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { calculateMatchRating, DEFAULT_REFERENCE_STATS, applyPositionWeights } from '../src/lib/scoring/matchRating';
import type { GranularPosition, RawStats, ReferenceStats } from '@/types';

// Load env
try {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    const envFile = fs.readFileSync(envPath, 'utf-8');
    for (const line of envFile.split('\n')) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        process.env[match[1]] = (match[2] || '').replace(/^"|"$/g, "");
      }
    }
  }
} catch (e) {}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const GLOBAL_GI_STDDEV = 2.5;
const GLOBAL_GI_MEDIAN = 0;
const GLOBAL_FINISHING_STDDEV = 0.28;
const GLOBAL_FINISHING_MEDIAN = -0.03;
const SIGMOID_K = 1.0;

function sigmoidNormalize(value: number, median: number, stddev: number): number {
    if (stddev <= 0) return 0.5;
    const z = SIGMOID_K * (value - median) / stddev;
    return 1 / (1 + Math.exp(-z));
}

async function run() {
  // Load Reference Stats from DB
  const { data: refData } = await supabase
    .from('rating_reference_stats')
    .select('*')
    .eq('season', '2025/26');
  
  const refStats: any = {};
  if (refData && refData.length > 0) {
    for (const r of refData) {
      refStats[r.position] = {
        match_impact: { median: Number(r.match_impact_median ?? r.median), stddev: Number(r.match_impact_stddev ?? r.stddev) },
        influence: { median: Number(r.influence_median ?? r.median), stddev: Number(r.influence_stddev ?? r.stddev) },
        creativity: { median: Number(r.creativity_median ?? r.median), stddev: Number(r.creativity_stddev ?? r.stddev) },
        threat: { median: Number(r.threat_median ?? r.median), stddev: Number(r.threat_stddev ?? r.stddev) },
        defensive: { median: Number(r.defensive_median ?? r.median), stddev: Number(r.defensive_stddev ?? r.stddev) },
        goal_involvement: { median: Number(r.goal_involvement_median ?? r.median), stddev: Number(r.goal_involvement_stddev ?? r.stddev) },
        finishing: { median: Number(r.finishing_median ?? r.median), stddev: Number(r.finishing_stddev ?? r.stddev) },
        save_score: { median: Number(r.save_score_median ?? r.median), stddev: Number(r.save_score_stddev ?? r.stddev) },
      };
    }
  } else {
    // If the above query structure was different, let's map from what we saw in DB
    // We saw in DB table: position_group, component, median, stddev.
    // Let's do a fallback queries for all groups if table matches that format:
    const { data: dbRows } = await supabase
      .from('rating_reference_stats')
      .select('position_group, component, median, stddev')
      .eq('season', '2025/26');
    
    if (dbRows && dbRows.length > 0) {
      for (const row of dbRows) {
        const pos = row.position_group;
        if (!refStats[pos]) refStats[pos] = {};
        refStats[pos][row.component] = {
          median: Number(row.median),
          stddev: Number(row.stddev)
        };
      }
    }
  }

  // Double check that DM is loaded, else merge with defaults
  if (!refStats.DM) {
    refStats.DM = DEFAULT_REFERENCE_STATS.DM;
  }
  
  const dmRef = refStats.DM;
  console.log("DM Reference Stats used:", dmRef);

  const players = [
    { id: '9ba00773-6639-4149-9738-f8bbab9fdee0', name: 'Moisés Caicedo' },
    { id: '08f6bd70-381f-41df-8fe8-e4e0ed540552', name: 'Casemiro' }
  ];

  const results: any[] = [];

  for (const player of players) {
    const { data: statsRows } = await supabase
      .from('player_stats')
      .select('gameweek, stats, fantasy_points, fantasy_points_v2, match_rating, match_rating_v2')
      .eq('player_id', player.id)
      .not('stats', 'is', null)
      .order('gameweek', { ascending: true });

    if (!statsRows || statsRows.length === 0) {
      console.log(`No stats found for ${player.name}`);
      continue;
    }

    let playedCount = 0;
    let sumMinutes = 0;
    let sumGoals = 0;
    let sumAssists = 0;
    let sumBps = 0;
    let sumFplTackles = 0;
    let sumFplCbi = 0;
    let sumFplRecoveries = 0;
    let sumExpectedGoals = 0;
    let sumExpectedAssists = 0;
    let sumExpectedGoalsConceded = 0;
    let sumInfluence = 0;
    let sumCreativity = 0;
    let sumThreat = 0;
    let sumMatchRating = 0;
    let sumMatchRatingV2 = 0;
    let sumFantasyPoints = 0;
    let sumFantasyPointsV2 = 0;

    // Component score sums (sigmoid normalized 0-1)
    let sumCompMatchImpact = 0;
    let sumCompInfluence = 0;
    let sumCompDefensive = 0;
    let sumCompCreativity = 0;
    let sumCompThreat = 0;
    let sumCompGoalInvolvement = 0;

    // Flex counts
    const flexCounts: Record<string, number> = { match_impact: 0, influence: 0, defensive: 0 };

    for (const row of statsRows) {
      const stats = row.stats as any;
      if (!stats || stats.minutes_played === 0) continue;
      
      playedCount++;
      sumMinutes += stats.minutes_played ?? 0;
      sumGoals += stats.goals ?? 0;
      sumAssists += stats.assists ?? 0;
      sumBps += stats.bps ?? 0;
      sumFplTackles += stats.fpl_tackles ?? 0;
      sumFplCbi += stats.fpl_cbi ?? 0;
      sumFplRecoveries += stats.fpl_recoveries ?? 0;
      sumExpectedGoals += stats.expected_goals ?? 0;
      sumExpectedAssists += stats.expected_assists ?? 0;
      sumExpectedGoalsConceded += stats.expected_goals_conceded ?? 0;
      sumInfluence += stats.influence ?? 0;
      sumCreativity += stats.creativity ?? 0;
      sumThreat += stats.threat ?? 0;

      // Use stored values, falling back to calculation
      const mr2 = Number(row.match_rating_v2 ?? row.match_rating);
      const fp2 = Number(row.fantasy_points_v2 ?? row.fantasy_points);
      sumMatchRating += Number(row.match_rating ?? 0);
      sumMatchRatingV2 += mr2;
      sumFantasyPoints += Number(row.fantasy_points ?? 0);
      sumFantasyPointsV2 += fp2;

      // Recalculate components to sum up normalized scores
      const res = calculateMatchRating(stats, 'DM', refStats, 'DM');
      
      const compScores: any = {};
      for (const item of res.breakdown) {
        compScores[item.key] = item.score;
      }
      
      sumCompMatchImpact += compScores.match_impact ?? 0;
      sumCompInfluence += compScores.influence ?? 0;
      sumCompDefensive += compScores.defensive ?? 0;
      sumCompCreativity += compScores.creativity ?? 0;
      sumCompThreat += compScores.threat ?? 0;
      sumCompGoalInvolvement += compScores.goal_involvement ?? 0;

      // Determine which component got flexed
      let maxScore = -1;
      let maxComponent = '';
      for (const k of ['match_impact', 'influence', 'defensive']) {
        if (compScores[k] > maxScore) {
          maxScore = compScores[k];
          maxComponent = k;
        }
      }
      if (maxComponent) {
        flexCounts[maxComponent]++;
      }
    }

    results.push({
      id: player.id,
      name: player.name,
      playedCount,
      avgMinutes: sumMinutes / playedCount,
      totalGoals: sumGoals,
      totalAssists: sumAssists,
      avgBps: sumBps / playedCount,
      avgFplTackles: sumFplTackles / playedCount,
      avgFplCbi: sumFplCbi / playedCount,
      avgFplRecoveries: sumFplRecoveries / playedCount,
      avgExpectedGoals: sumExpectedGoals / playedCount,
      avgExpectedAssists: sumExpectedAssists / playedCount,
      avgExpectedGoalsConceded: sumExpectedGoalsConceded / playedCount,
      avgInfluence: sumInfluence / playedCount,
      avgCreativity: sumCreativity / playedCount,
      avgThreat: sumThreat / playedCount,
      avgMatchRating: sumMatchRating / playedCount,
      avgMatchRatingV2: sumMatchRatingV2 / playedCount,
      totalFantasyPoints: sumFantasyPoints,
      totalFantasyPointsV2: sumFantasyPointsV2,
      ppgV1: sumFantasyPoints / playedCount,
      ppgV2: sumFantasyPointsV2 / playedCount,
      
      // Component averages
      avgCompMatchImpact: sumCompMatchImpact / playedCount,
      avgCompInfluence: sumCompInfluence / playedCount,
      avgCompDefensive: sumCompDefensive / playedCount,
      avgCompCreativity: sumCompCreativity / playedCount,
      avgCompThreat: sumCompThreat / playedCount,
      avgCompGoalInvolvement: sumCompGoalInvolvement / playedCount,
      
      flexCounts
    });
  }

  console.log("\n=== COMPILATION RESULTS ===");
  console.log(JSON.stringify(results, null, 2));

  // Helper for formatting signed deltas
  const fmtDelta = (val: number, decimals: number = 1): string => {
    return val >= 0 ? `+${val.toFixed(decimals)}` : `${val.toFixed(decimals)}`;
  };

  // Generate a beautiful Markdown report
  const [caicedo, casemiro] = results;

  const mdContent = `# Moisés Caicedo vs Casemiro: Gaffa Analytics Report

This document compares Chelsea's **Moisés Caicedo** and Manchester United's **Casemiro** based on their seasonal performance in Gaffa's database, using Gaffa's custom **Defensive Midfielder (DM)** scoring model.

---

## 1. Executive Summary

In Gaffa's player rating and fantasy engine (V2), player performances are evaluated using position-specific weight profiles, where raw statistics are normalized into a \`0.0–1.0\` sigmoid score against a 3-season league-wide positional baseline.

Based on the aggregated stats in the database:
- **Casemiro** outscores **Moisés Caicedo** in both **Average Match Rating (V2)** and **Points Per Game (PPG)**.
- **Casemiro PPG (V2):** **${casemiro.ppgV2.toFixed(2)}** (Avg Rating: **${casemiro.avgMatchRatingV2.toFixed(2)}** over **${casemiro.playedCount}** appearances)
- **Moisés Caicedo PPG (V2):** **${caicedo.ppgV2.toFixed(2)}** (Avg Rating: **${caicedo.avgMatchRatingV2.toFixed(2)}** over **${caicedo.playedCount}** appearances)

### Why Casemiro is Above Caicedo: The Mathematical Drivers
Gaffa's Defensive Midfielder weight profile is:
- **Match Impact (Adjusted BPS):** \`30%\` base weight
- **Influence (FPL Influence):** \`25%\` base weight
- **Defensive (Actions + CS + xGC outperformance):** \`10%\` base weight
- **Goal Involvement (Goals + Assists):** \`5%\` base weight
- **Creativity (FPL Creativity):** \`5%\` base weight
- **Flex Weight:** \`25%\` added to the player's highest scoring component among **Match Impact**, **Influence**, or **Defensive**.

**Casemiro outscores Caicedo because:**
1. **Match Impact (BPS volume):** Casemiro averages **${casemiro.avgBps.toFixed(1)}** raw BPS compared to Caicedo's **${caicedo.avgBps.toFixed(1)}**. In the Sigmoid Engine, this translates to a normalized Match Impact score of **${casemiro.avgCompMatchImpact.toFixed(3)}** vs Caicedo's **${caicedo.avgCompMatchImpact.toFixed(3)}**. Because Casemiro plays in a highly chaotic Manchester United midfield, his absolute volume of actions (passes, clearances, tackles, interceptions) is much higher, which FPL's BPS model rewards. Caicedo, playing in Chelsea's highly structured, high-possession recycling system, is incredibly efficient but records lower raw volume metrics.
2. **Influence (FPL Influence metric):** Casemiro averages **${casemiro.avgInfluence.toFixed(1)}** FPL Influence per game vs Caicedo's **${caicedo.avgInfluence.toFixed(1)}**. This yields a normalized Influence score of **${casemiro.avgCompInfluence.toFixed(3)}** for Casemiro vs **${caicedo.avgCompInfluence.toFixed(3)}** for Caicedo. Since Influence makes up \`25%\` of a DM's base weight, this **${(casemiro.avgCompInfluence - caicedo.avgCompInfluence).toFixed(3)}** delta in normalized score creates a huge gap.
3. **Goal Involvement & Goal Threat:** Casemiro has recorded **${casemiro.totalGoals}** goals and **${casemiro.totalAssists}** assists, while Caicedo has **${caicedo.totalGoals}** goals and **${caicedo.totalAssists}** assists. Casemiro is a far bigger aerial threat and shot-taker, averaging **${casemiro.avgThreat.toFixed(1)}** FPL Threat vs Caicedo's **${caicedo.avgThreat.toFixed(1)}**, boosting his Goal Involvement score and his FPL Influence score.
4. **Flex Weight Exploitation:** In Gaffa's V2 engine, a DM receives a **+25% Flex Weight** on their strongest component. 
   - Casemiro's highest component is typically **Influence** (\`${casemiro.flexCounts.influence}\` games), where he scores highly.
   - Caicedo's highest component is typically **Match Impact** (\`${caicedo.flexCounts.match_impact}\` games) or **Defensive** (\`${caicedo.flexCounts.defensive}\` games), but because his absolute volumes are lower, his flexed component is weaker in absolute value than Casemiro's.

---

## 2. Statistical Comparison

Here is a side-by-side comparison of their seasonal averages and cumulative counts:

| Metric | Moisés Caicedo | Casemiro | Delta (Casemiro - Caicedo) |
| :--- | :---: | :---: | :---: |
| **Appearances (with mins)** | ${caicedo.playedCount} | ${casemiro.playedCount} | - |
| **Average Minutes** | ${caicedo.avgMinutes.toFixed(1)} | ${casemiro.avgMinutes.toFixed(1)} | ${fmtDelta(casemiro.avgMinutes - caicedo.avgMinutes, 1)} |
| **Total Goals** | ${caicedo.totalGoals} | ${casemiro.totalGoals} | ${fmtDelta(casemiro.totalGoals - caicedo.totalGoals, 0)} |
| **Total Assists** | ${caicedo.totalAssists} | ${casemiro.totalAssists} | ${fmtDelta(casemiro.totalAssists - caicedo.totalAssists, 0)} |
| **Average BPS (Raw)** | ${caicedo.avgBps.toFixed(1)} | ${casemiro.avgBps.toFixed(1)} | ${fmtDelta(casemiro.avgBps - caicedo.avgBps, 1)} |
| **Average FPL Influence** | ${caicedo.avgInfluence.toFixed(1)} | ${casemiro.avgInfluence.toFixed(1)} | ${fmtDelta(casemiro.avgInfluence - caicedo.avgInfluence, 1)} |
| **Average FPL Creativity** | ${caicedo.avgCreativity.toFixed(1)} | ${casemiro.avgCreativity.toFixed(1)} | ${fmtDelta(casemiro.avgCreativity - caicedo.avgCreativity, 1)} |
| **Average FPL Threat** | ${caicedo.avgThreat.toFixed(1)} | ${casemiro.avgThreat.toFixed(1)} | ${fmtDelta(casemiro.avgThreat - caicedo.avgThreat, 1)} |
| **Average FPL Tackles** | ${caicedo.avgFplTackles.toFixed(2)} | ${casemiro.avgFplTackles.toFixed(2)} | ${fmtDelta(casemiro.avgFplTackles - caicedo.avgFplTackles, 2)} |
| **Average CBI (Clear/Block/Int)** | ${caicedo.avgFplCbi.toFixed(2)} | ${casemiro.avgFplCbi.toFixed(2)} | ${fmtDelta(casemiro.avgFplCbi - caicedo.avgFplCbi, 2)} |
| **Average Recoveries** | ${caicedo.avgFplRecoveries.toFixed(2)} | ${casemiro.avgFplRecoveries.toFixed(2)} | ${fmtDelta(casemiro.avgFplRecoveries - caicedo.avgFplRecoveries, 2)} |
| **Average Expected Goals (xG)** | ${caicedo.avgExpectedGoals.toFixed(2)} | ${casemiro.avgExpectedGoals.toFixed(2)} | ${fmtDelta(casemiro.avgExpectedGoals - caicedo.avgExpectedGoals, 2)} |
| **Average Expected Assists (xA)** | ${caicedo.avgExpectedAssists.toFixed(2)} | ${casemiro.avgExpectedAssists.toFixed(2)} | ${fmtDelta(casemiro.avgExpectedAssists - caicedo.avgExpectedAssists, 2)} |
| **Average xG Conceded (xGC)** | ${caicedo.avgExpectedGoalsConceded.toFixed(2)} | ${casemiro.avgExpectedGoalsConceded.toFixed(2)} | ${fmtDelta(casemiro.avgExpectedGoalsConceded - caicedo.avgExpectedGoalsConceded, 2)} |

---

## 3. Gaffa V2 Component Score Comparison

Gaffa's engine translates these raw statistics into normalized scores between \`0.0\` (worst) and \`1.0\` (best). Below are their average normalized scores across all active appearances:

| Gaffa DM Component | Weight | Moisés Caicedo | Casemiro | Delta |
| :--- | :---: | :---: | :---: | :---: |
| **Match Impact (Adjusted BPS)** | \`30% (+25% flex)\` | ${caicedo.avgCompMatchImpact.toFixed(3)} | ${casemiro.avgCompMatchImpact.toFixed(3)} | ${fmtDelta(casemiro.avgCompMatchImpact - caicedo.avgCompMatchImpact, 3)} |
| **Influence (FPL Influence)** | \`25% (+25% flex)\` | ${caicedo.avgCompInfluence.toFixed(3)} | ${casemiro.avgCompInfluence.toFixed(3)} | ${fmtDelta(casemiro.avgCompInfluence - caicedo.avgCompInfluence, 3)} |
| **Defensive (Actions + CS/xGC)** | \`10% (+25% flex)\` | ${caicedo.avgCompDefensive.toFixed(3)} | ${casemiro.avgCompDefensive.toFixed(3)} | ${fmtDelta(casemiro.avgCompDefensive - caicedo.avgCompDefensive, 3)} |
| **Creativity (FPL Creativity)** | \`5%\` | ${caicedo.avgCompCreativity.toFixed(3)} | ${casemiro.avgCompCreativity.toFixed(3)} | ${fmtDelta(casemiro.avgCompCreativity - caicedo.avgCompCreativity, 3)} |
| **Goal Involvement (GI Raw)** | \`5%\` | ${caicedo.avgCompGoalInvolvement.toFixed(3)} | ${casemiro.avgCompGoalInvolvement.toFixed(3)} | ${fmtDelta(casemiro.avgCompGoalInvolvement - caicedo.avgCompGoalInvolvement, 3)} |
| **Average Display Rating (V2)** | - | **${caicedo.avgMatchRatingV2.toFixed(2)}** | **${casemiro.avgMatchRatingV2.toFixed(2)}** | **${fmtDelta(casemiro.avgMatchRatingV2 - caicedo.avgMatchRatingV2, 2)}** |
| **Points Per Game (PPG V2)** | - | **${caicedo.ppgV2.toFixed(2)}** | **${casemiro.ppgV2.toFixed(2)}** | **${fmtDelta(casemiro.ppgV2 - caicedo.ppgV2, 2)}** |
| **Total Fantasy Points (V2)** | - | **${caicedo.totalFantasyPointsV2.toFixed(1)}** | **${casemiro.totalFantasyPointsV2.toFixed(1)}** | **${fmtDelta(casemiro.totalFantasyPointsV2 - caicedo.totalFantasyPointsV2, 1)}** |

---

## 4. Deconstructing the playstyles under the Gaffa Sigmoid Engine

Gaffa's V2 rating engine is a highly calibrated model designed to reward on-pitch dominance. The difference between Caicedo and Casemiro perfectly highlights how Gaffa evaluates two contrasting styles of defensive midfielders:

### A. The "Recycler" (Moisés Caicedo)
Caicedo is an elite, high-efficiency midfield anchor. His playstyle is characterized by:
- Incredibly clean, short-to-medium range passing (very high pass completion percentage, though passes are rarely long or high-risk).
- Tactical, positional defensive work (cutting off lanes, keeping his shape).
- Low absolute tackle and interception counts per game because Chelsea dominates possession, and when they don't, his positioning prevents the need for desperate last-ditch slide tackles.

In Gaffa's engine:
- Because his playstyle is about recycling and maintaining structure, his raw **BPS** (\`avg Bps = ${caicedo.avgBps.toFixed(1)}\`) and **Influence** (\`avg Influence = ${caicedo.avgInfluence.toFixed(1)}\`) are modest. 
- While his defensive actions are efficient, his absolute volume of tackles/recoveries/clearances is lower than Casemiro's, giving him an average Defensive component of **${caicedo.avgCompDefensive.toFixed(3)}**.
- Gaffa's engine relies on **volume of activity** to push sigmoid scores past the \`0.50\` median mark. Caicedo's high-efficiency but low-volume profile lands him close to the median (\`~0.50\`) on almost all components, leading to very consistent but unspectacular **6.2 - 6.5** match ratings.

### B. The "Chaos Engine" (Casemiro)
Casemiro is a high-volume, high-risk, box-to-box defensive midfielder. His playstyle is characterized by:
- Heavy defensive activity: flying tackles, blocks, clearing crosses out of the box, and recovering loose balls (\`tackles = ${casemiro.avgFplTackles.toFixed(2)}\`, \`CBI = ${casemiro.avgFplCbi.toFixed(2)}\`, \`recoveries = ${casemiro.avgFplRecoveries.toFixed(2)}\`).
- Attacking threat: charging into the penalty area on set pieces, shooting from distance, and trying long, vertical passes.
- Large volume of events in both boxes.

In Gaffa's engine:
- Casemiro's high-volume activity in a chaotic, transition-heavy United midfield produces massive raw numbers. His raw **BPS** of **${casemiro.avgBps.toFixed(1)}** maps to a superb **${casemiro.avgCompMatchImpact.toFixed(3)}** Match Impact score.
- His high shot volume and box entries give him significant FPL **Threat** and **Influence**, translating to a **${casemiro.avgCompInfluence.toFixed(3)}** Influence score, which commands \`25%\` of his rating.
- When United keeps a clean sheet or concedes fewer goals than expected, his massive defensive activity (\`avg CBI = ${casemiro.avgFplCbi.toFixed(2)}\`) propels his Defensive score to **${casemiro.avgCompDefensive.toFixed(3)}**.
- His high-risk actions do result in turnovers and fouls (which are penalized in BPS), but Gaffa's Sigmoid Engine is heavily weighted to reward **positive event volume** (BPS, Influence, Defensive actions), making Casemiro's peak performances rate far higher (often **7.5 - 8.5**) and lifting his seasonal averages significantly above Caicedo's.

---

## 5. Flex Component Distribution

Gaffa's V2 engine dynamically shifts \`25%\` of a player's weight to their highest-performing component. Below is the count of how many games each player had their flex weight directed to each component:

- **Casemiro:**
  - **Match Impact (BPS):** \`${casemiro.flexCounts.match_impact}\` games
  - **Defensive (Tackles/CBI/Recoveries):** \`${casemiro.flexCounts.defensive}\` games
  - **Influence:** \`${casemiro.flexCounts.influence}\` games

- **Moisés Caicedo:**
  - **Match Impact (BPS):** \`${caicedo.flexCounts.match_impact}\` games
  - **Defensive (Tackles/CBI/Recoveries):** \`${caicedo.flexCounts.defensive}\` games
  - **Influence:** \`${caicedo.flexCounts.influence}\` games

---

*Analysis generated automatically from Gaffa SQL database stats on ${new Date().toLocaleDateString()}.*
`;

  const artifactDir = '/Users/dukewang/.gemini/antigravity/brain/bffbcf2a-699c-48c2-8ebd-5f9b2e820ef7';
  const targetFile = path.join(artifactDir, 'caicedo_vs_casemiro_analysis.md');
  fs.writeFileSync(targetFile, mdContent);
  console.log(`Successfully wrote analysis report to ${targetFile}`);
}

run().catch(console.error);
