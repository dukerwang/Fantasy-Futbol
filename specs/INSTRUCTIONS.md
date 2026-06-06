# Instructions for Building Gaffa

This folder contains the specifications and guidelines for the Gaffa application.

## 1. Project Overview
Build a granular, dynasty-style Fantasy Premier League app using **Next.js**, **Supabase**, and **Vanilla CSS**.

## 2. Data Source Stack
- **Player & Live Statistics**: FPL API (bootstrap-static and live gameweek events).
- **Granular Position Metadata**: SoFIFA API (EA FC data) synchronized to determine primary and secondary positions.
- **Market Values**: Transfermarkt scraped values matched fuzzy against players, with system-generated waivers/auctions for new arrivals.
- **Fixtures & PL Teams**: API-Football (Free Tier) as a helper for fixtures and team listings.

## 3. Current Implementation Status
- The core infrastructure, database schema, scoring engine, tournament generator, and economic transfer rules are fully implemented and deployed.
- Scheduled sync crons handle gameweek live statistics and lock lineups.

## 4. Design Guidelines
- Use **Vanilla CSS** with Modules (no utility frameworks like Tailwind CSS).
- Implement the dual-theme design system: **Cream Editorial** (primary warm off-white theme with serif typography) and **Premium Dark** (secondary dark theme).
- Pair **Newsreader** (serif display font) and **Hanken Grotesk** (clean body sans font).
- Focus on "Granular Positions" (GK, CB, LB, RB, LWB, RWB, DM, CM, AM, LW, RW, ST) in all UI components, lineups, and scoring profiles.
- For testing and integration verification, utilize the Vercel deployment URL: https://gaffa.live/
