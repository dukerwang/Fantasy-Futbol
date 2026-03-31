# GEMINI.md — Planning Context

This file provides the architectural vision and context for **Antigravity (Gemini)** to plan features and UI/UX for the Fantasy Futbol project.

## 🏛️ Project Vision: "Dynasty Realism"
Our goal is to build the most realistic, data-driven fantasy soccer experience. We use empirical statistics (Sigmoid Engine) and strict granular positions to ensure the best real-world players are the best in-game assets.

## ⚽ The "Sigmoid Engine" (Scoring)
- **Philosophy**: All players are normalized against their position's 3-season baseline (23-26) using a sigmoid curve `1 / (1 + exp(-z))`.
- **Scaling**: A 4.0 rating is the baseline. High ratings (9.0+) are rare and exponentially rewarded in points.
- **Weights**: Stored in `src/lib/scoring/matchRating.ts`. Each position groups components (Match Impact, Defensive, Finishing, etc.) differently.
- **Finishing**: Attacker ratings are highly sensitive to Finishing (`stddev: 0.15`). Clinicality (goals vs xG) is the key driver of elite scores.

## 📊 Core Data Architecture
- **League Model**: 10-team Dynasty, total points for 38 games. Matchups are for secondary competitions (Cups).
- **Position System**: 12 Granular Positions (GK, CB, LB, RB, DM, CM, LM, RM, AM, LW, RW, ST). Players **cannot** be played out of position (Primary/Secondary only).
- **Waivers & FAAB**:
    - **Public Auction**: Managers can see each other's bids. 48h Waiver period after a drop.
    - **Severance Fee**: 10% market value (Transfermarkt) deducted from FAAB on every drop.
    - **Scout's Rebate**: 20% FAAB rebate to the *initial* bidder if someone else wins the auction.
- **Standings Logic**: Draw = 1pt if `ABS(score_a - score_b) <= 10`.

## 🎨 UI/UX Philosophy
- **Aesthetic**: Premium Dark (#0a0c10), high-contrast text (#e8eaf0), vibrant positional accents.
- **Components**: Always use Vanilla CSS Modules. Avoid Tailwind.
- **Definition of Done (DoD)**: Every planning artifact must include tasks for:
    - [ ] Error feedback (API failure)
    - [ ] Empty states (No data)
    - [ ] Skeletal loading states
    - [ ] Mobile-first responsive checks

## ⚠️ Fragile Patterns & Architectural Debt
- **ID Management**: `fpl_id` is for FPL-live data; `api_football_id` is for Transfermarkt/Market Value data. Always verify the source when mapping.
- **Match Status**: Use the production Vercel site (`fantasy-futbol-tau.vercel.app`) as the source of truth for active matches and lock statuses.
- **Scoring Cache**: Calculations are expensive. Ratings are currently cached in the `player_stats` table; don't trigger batch recalculations without a clear reason (e.g., engine logic update).

## 🗺️ Roadmap Priority
- [ ] **UI Overhaul**: Revamping the main league/team dashboard for a "WOW" premium look.
- [ ] **Transfer Market Polish**: Better bidding UX and clearer waiver notifications.
- [ ] **Dynasty Seeding**: Using `team_stats` to automate Tournament/Cup brackets.
