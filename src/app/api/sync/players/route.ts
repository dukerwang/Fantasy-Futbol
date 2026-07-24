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

  // Sweep every active league for newly high-value / promoted-club arrivals
  // and open a 48h system auction — closes the gap Kickoff (a one-time,
  // season-start-only scan) leaves for in-season transfers.
  let auctionSweep: Awaited<ReturnType<typeof seedHighValueAuctions>> = [];
  try {
    auctionSweep = await seedHighValueAuctions(admin);
  } catch (err) {
    console.error("[sync/players] Auction sweep failed:", err);
  }

  return NextResponse.json({ ok: true, ...result, auctionSweep });
}
