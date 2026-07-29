/**
 * POST /api/sync/players
 *
 * Syncs Premier League players from the free FPL bootstrap API.
 * No API key required. Safe to call daily (runs via cron at 02:00 UTC).
 *
 * Protected by CRON_SECRET header.
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncPlayersFromFpl } from "@/lib/players/syncPlayers";
import { seedHighValueAuctions } from "@/lib/auctions/seedHighValueAuctions";
import { resolveDepartureDecisions } from "@/lib/departures/resolve";

export const maxDuration = 60;

export async function GET(req: NextRequest) { return POST(req); }

export async function POST(req: NextRequest) {
  const secret =
    req.headers.get("x-cron-secret") ??
    req.headers.get("authorization")?.replace("Bearer ", "");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const result = await syncPlayersFromFpl(admin);

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  // Move departure decisions along before anything else looks at ownership:
  // opens reinstatement windows for retained players who are back in the PL,
  // expires windows nobody acted on, and auto-releases overdue in-season
  // decisions. Must run before the auction sweep so a player whose rights just
  // lapsed is available to it, and a player still held is not.
  let departures: Awaited<ReturnType<typeof resolveDepartureDecisions>> | null = null;
  try {
    departures = await resolveDepartureDecisions(admin);
  } catch (err) {
    console.error("[sync/players] Departure resolution failed:", err);
  }

  // Sweep every active league for newly high-value / promoted-club arrivals
  // and open a 48h system auction — closes the gap Kickoff (a one-time,
  // season-start-only scan) leaves for in-season transfers.
  let auctionSweep: Awaited<ReturnType<typeof seedHighValueAuctions>> = [];
  try {
    auctionSweep = await seedHighValueAuctions(admin);
  } catch (err) {
    console.error("[sync/players] Auction sweep failed:", err);
  }

  return NextResponse.json({ ok: true, ...result, departures, auctionSweep });
}
