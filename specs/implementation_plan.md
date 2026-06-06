# implementation_plan.md

# Goal Description
Build a custom web-based fantasy football (soccer) application focused on Premier League dynasty leagues. The key differentiators are a granular 12-position system (e.g., separating fullbacks and wingbacks from centerbacks), a transfer compensation system for players leaving the league, and an algorithmic, value-based scoring model (the "Sigmoid Engine").

## Database Schema Overview

The database is built on PostgreSQL managed via Supabase, utilizing the following core tables:
- **users**: ID, email, username, avatar_url.
- **leagues**: ID, name, commissioner_id, season, max_teams, roster_size, bench_size, faab_budget, draft_type, scoring_rules, is_dynasty, status, draft_scheduled_at, taxi_size, taxi_age_limit.
- **teams**: ID, league_id, user_id, team_name, faab_budget, total_points, draft_order, logo_url.
- **players**: ID, fpl_id, api_football_id, web_name, name, date_of_birth, nationality, pl_team, pl_team_id, primary_position, secondary_positions, market_value, market_value_updated_at, is_active.
- **roster_entries**: ID, team_id, player_id, status (`active`, `bench`, `ir`, `taxi`), acquisition_type, acquisition_value, acquired_at.
- **matchups**: ID, league_id, gameweek, team_a_id, team_b_id, score_a, score_b, lineup_a, lineup_b, status.
- **player_stats**: ID, player_id, match_id, gameweek, season, stats (RawStats JSON), fantasy_points, match_rating.
- **transactions**: ID, league_id, team_id, player_id, type, faab_bid, compensation_amount, notes.
- **waiver_claims**: ID, league_id, team_id, player_id, drop_player_id, faab_bid, priority, status, gameweek, is_auction, expires_at.
- **trade_proposals**: ID, league_id, team_a_id, team_b_id, offered_players, requested_players, offered_faab, requested_faab, status, message.
- **rating_reference_stats**: position_group, component, median, stddev, season.
- **tournaments**: ID, league_id, name, type (`primary_cup`, `secondary_cup`, `consolation_cup`), status, season.
- **tournament_rounds**: ID, tournament_id, name, round_number, start_gameweek, end_gameweek, is_two_leg.
- **tournament_matchups**: ID, round_id, team_a_id, team_b_id, team_a_score_leg1, team_b_score_leg1, team_a_score_leg2, team_b_score_leg2, winner_id, next_matchup_id, bracket_position, status.

---

## Core Systems & Implementation Details

### 1. Granular Position & Lineup System
Standard fantasy soccer platforms merge defenders, midfielders, and forwards. Gaffa implements 12 distinct granular positions to align with modern tactical configurations:
- **GK**: Goalkeeper
- **CB**: Center-Back
- **LB / RB**: Left/Right Fullback
- **LWB / RWB**: Left/Right Wingback
- **DM**: Defensive Midfielder
- **CM**: Central Midfielder
- **AM**: Attacking Midfielder
- **LW / RW**: Left/Right Winger
- **ST**: Striker

#### Lineup and Formation Rules
- Formation options are strictly checked and supported: `4-3-3`, `4-2-1-3`, `4-2-2-2`, `3-4-1-2`, `3-5-2`, `5-3-2`, `3-4-3`.
- Players are eligible for slots matching their primary or secondary positions (synchronized from SoFIFA/EA FC squad updates).
- Lineups must be locked before the kickoff of the gameweek.
- Priority-based **Auto-Subs** are processed at gameweek resolution. Unused bench players who played contribute a **Bench Depth Bonus** (20% of their scoring rating).

---

### 2. Algorithmic "Sigmoid Engine" (Scoring V2)
Instead of arbitrary point allocations, players receive a contextual rating (1.0 to 10.0 scale) that is curved into fantasy points.

1. **Sigmoid Normalization**: Raw stats are normalized into a `0.0–1.0` component score using a logistic sigmoid function against position-specific seasonal medians/stddevs.
   $$score = \frac{1}{1 + e^{-Z}}, \quad Z = K \cdot \frac{value - median}{stddev}$$
2. **Positional Weighting**: Weighted composite ratings are calculated using position-specific weight profiles over 8 components:
   - *Match Impact* (BPS adjusted to avoid goal/assist double counting)
   - *Influence* (FPL influence metric)
   - *Creativity* (FPL creativity metric)
   - *Threat* (FPL threat metric)
   - *Defensive* (FPL defensive contribution + tackles + CBI + recoveries + clean sheet bonuses - goals conceded penalties)
   - *Goal Involvement* (Goals $\times 6$ + Assists $\times 4$)
   - *Finishing* (Expected goals outperformance)
   - *Save Score* (GK saves and penalty saves)
3. **Display Scale**: A Fotmob-calibrated rating `3.5 + 6.0 * composite` is displayed in the UI, anchoring the median starter at $\approx 6.5$.
4. **Points Curve**: Fantasy points are curved from the internal scoring rating (`1.0 + 9.0 * composite`):
   $$points = 10 \times \left(\frac{rating - 4.5}{2.0}\right)^{1.5}$$
5. **Out-of-Position (OOP) Penalty**: If a midfielder or attacker is fielded in a defensive slot (CB, LB, RB, LWB, RWB), a 20% penalty is applied to curb baseline-mismatch volume inflation.
6. **Role-Aware Post-Match Scoring**: Starters and auto-subs are re-scored using the baseline weights of the slot they actually filled in the matchup once the gameweek is finished.

---

### 3. Financial System & Transfer Compensation
- **Transfer Out Compensation**: When a player permanently leaves the Premier League (detected by FPL API status changes), owning fantasy teams are compensated:
  $$\text{FAAB Reimbursement} = \text{Player Market Value} \times 0.8$$
  The player is marked inactive, dropped from rosters, and transactions are logged.
- **Waivers and Auctions**: The FAAB economy uses a waiver system and 48-hour public auctions. Newly arriving high-value players ($\ge \text{£40m}$) automatically trigger a system auction and broadcast notification emails via Resend.
- **Transfermarkt Sync**: Market values are kept up to date using a fuzzy-matching script (`scripts/sync_transfermarkt.ts`) that ingests Transfermarkt valuations.

---

### 4. Concurrent Tournaments
- The regular season points standings run alongside knockout cups: **Champions Cup**, **Consolation Cup**, and **League Cup**.
- Bracket generation, leg progressions, tiebreaks, and winner allocations are automatically handled by database triggers and matchup processors.

---

## Verification Plan

### Automated Verification
- **Scoring Engine Tests**: Run and compare test cases converting RawStats inputs to ratings/points, verifying standard deviations and sigmoid distributions.
- **Lineup Verification**: Test lineup validations to ensure ineligible players cannot be saved to formation slots.

### Manual Verification
- **Data Syncs**: Test `/api/sync/players` (FPL), `/api/sync/sofifa-players` (SoFIFA), and `scripts/sync_transfermarkt.ts` (Transfermarkt) to verify schema mapping.
- **Draft Room**: Verify snake draft transitions, autopick timers, and roster sews.
