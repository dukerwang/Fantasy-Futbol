/**
 * POST /api/sync/matchups?gameweek=<n>&finished=<true/false>
 *
 * Calculates the current gameweek's matchups based on player_stats and starting XI.
 * Players earn points based on the specific slot they occupy in the lineup,
 * not their static DB primary_position.
 */
import { NextRequest, NextResponse } from 'next/server';
import { processMatchupsForGameweek } from '@/lib/scoring/matchupProcessor';

export const maxDuration = 60; // 1 minute max for Vercel Hobby tier

async function getCurrentGameweek(): Promise<number> {
    const res = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/', {
        next: { revalidate: 3600 }
    });
    const data = await res.json();
    const now = new Date();
    let gw = 0;
    for (const ev of data.events as any[]) {
        if (ev.deadline_time && new Date(ev.deadline_time) <= now) {
            gw = Math.max(gw, ev.id);
        }
    }
    return gw;
}

export async function GET(req: NextRequest) { return POST(req); }

export async function POST(req: NextRequest) {
    const secret = req.headers.get('x-cron-secret') ??
        req.headers.get('authorization')?.replace('Bearer ', '');
    if (!secret || !process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    let gameweek = parseInt(searchParams.get('gameweek') ?? '0', 10);
    if (!gameweek) {
        gameweek = await getCurrentGameweek();
    }
    const finished = searchParams.get('finished') === 'true';

    if (!gameweek || gameweek < 1) {
        return NextResponse.json({ error: 'gameweek required (positive integer)' }, { status: 400 });
    }

    try {
        const result = await processMatchupsForGameweek(gameweek, finished);
        return NextResponse.json(result);
    } catch (err: any) {
        return NextResponse.json({ error: 'Failed to process matchups', details: err.message }, { status: 500 });
    }
}
