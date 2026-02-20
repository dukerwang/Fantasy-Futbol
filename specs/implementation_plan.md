# implementation_plan.md

# Goal Description
Build a custom web-based fantasy football (soccer) application focused on Premier League dynasty leagues. The key differentiators are a granular position system (e.g., separating Fullbacks from Centerbacks), a transfer compensation system for players leaving the league, and a transparent, value-based scoring model.

## User Review Required
> [!IMPORTANT]
> **Data Source Strategy**: User requires a **Free Tier** solution. We will target **API-Football (Free plan: 100 reqs/day)** as the primary source. If granular stats (tackles, interceptions) are locked behind a paywall, we will investigate scraping reputable free sources (like Fbref) as a fallback, though this increases technical complexity.

> [!WARNING]
> **Transfer Market Values**: We will use **Transfermarkt** as the source of truth for player values. Since there is no official free API, we will implement a scraper or use an open-source wrapper (e.g., `transfermarkt-api`) to periodically fetch market values. This will likely be a background scheduled job (cron).

## Proposed Architecture

### Tech Stack
-   **Frontend Framework**: Next.js 14+ (App Router).
-   **Language**: TypeScript.
-   **Styling**: Vanilla CSS (CSS Modules) with a focus on modern, premium aesthetics (Variables for theming).
-   **Database**: PostgreSQL (managed via Supabase).
-   **Auth**: Supabase Auth (Email/Password + Social optional).
-   **Hosting**: Vercel.

### Database Schema Overview
-   **Users**: ID, email, username, avatar.
-   **Leagues**: ID, name, settings (scoring rules, roster slots).
-   **Teams**: ID, league_id, user_id, team_name, faab_budget.
-   **Players**: ID, api_id, name, team (PL), **granular_position** (Array: ['CB', 'CDM']), market_value.
-   **RosterEntries**: team_id, player_id, status (Active, Bench, IR).
-   **Matchups**: week, team_a, team_b, score_a, score_b.
-   **PlayerStats**: player_id, match_id, stats_json (granular data).

## Proposed Changes (Phase 1: MVP)

### 1. Granular Position System
Standard fantasy apps use `DEF`, `MID`, `FWD`. We will implement:
-   **GK**: Goalkeeper
-   **CB**: Center Back
-   **FB**: Fullback / Wingback
-   **DM**: Defensive Midfielder
-   **CM/AM**: Central/Attacking Midfielder
-   **W**: Winger
-   **CF/ST**: Striker
*Logic*: Players will have primary and secondary positions.
*Missing Piece Identified*: **Lineup Validation**. With strict positions, we need "Flexible Formations" (e.g., allowing 4-3-3 or 3-5-2) or "Flex Slots" (e.g., a CDM can fill a CM slot, but a CB cannot). We will implement a **Formation-Based** lineup system where the user selects a formation (e.g., 4-3-3) and slots adjust accordingly.

### 2. Transfer Compensation Logic
-   **Trigger**: When a player transfers *out* of the PL.
-   **Source**: Comparison of PL roster vs Active PL Players list + Transfermarkt "Transfers" feed.
-   **Action**:
    1.  Mark player as `inactive/transferred`.
    2.  Calculate compensation: `Compensation = TransfermarktValue * 0.8`.
    3.  Credit Team's FAAB budget.
    4.  Drop player from roster (optional: or keep as rights retained).

### 3. Clearer Scoring System
Define a point system that rewards "football actions" not just G/A.
-   **Defensive**: Tackle won (+1), Interception (+1), Clearance (+0.5), Clean Sheet (split by position tiers).
-   **Possession**: Key Pass (+2), Big Chance Created (+3), Successful Dribble (+1), Pass Completion % (tiered).
-   **Attacking**: Goal, Assist, Shot on Target.
*Constraint*: We must verify these specific stats are available in the API-Football Free Tier.

### 4. missing: Gameweek & Schedule Management
-   We need a system to lock lineups before the first kickoff of the Gameweek.
-   Need to fetch the PL Schedule and map matches to "Fantasy Gameweeks".
-   **Auto-Subs**: (Optional for MVP) If a starter doesn't play, auto-sub from bench based on priority.

## Verification Plan

### Automated Tests
-   **Unit Tests**: Scoring engine logic (input stats -> output points).
-   **Integration Tests**: Draft logic (ensure players are assigned correctly and removed from pool).

### Manual Verification
-   **Data Sync**: Verify that API fetches correctly map Granular Positions (e.g., verifying Trent Alexander-Arnold is listed as FB/CM if applicable, not just DEF).
-   **Draft Flow**: Simulate a mock draft with 3 users.
