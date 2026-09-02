import { NextRequest } from 'next/server';
import {
  Effect,
  FplService,
  FplServiceLive,
  UnauthorizedError,
  runApiEffect,
} from '@/lib/effect';

export const maxDuration = 30;

export async function GET(req: NextRequest) {
  return handleRequest(req);
}

export async function POST(req: NextRequest) {
  return handleRequest(req);
}

function handleRequest(req: NextRequest) {
  const program = Effect.gen(function* () {
    // 1. Authorization check
    const secret =
      req.headers.get('x-cron-secret') ??
      req.headers.get('authorization')?.replace('Bearer ', '');

    const expectedSecret = process.env.CRON_SECRET;
    if (expectedSecret && secret !== expectedSecret) {
      return yield* Effect.fail(new UnauthorizedError({ message: 'Invalid or missing cron secret' }));
    }

    // 2. Fetch Gameweek info via FplService
    const fpl = yield* FplService;
    const gwInfo = yield* fpl.getCurrentGameweek();

    // 3. Return structured status payload
    return {
      ok: true,
      runtime: 'Effect-TS 3.x',
      gameweek: gwInfo,
      timestamp: new Date().toISOString(),
    };
  }).pipe(Effect.provide(FplServiceLive));

  return runApiEffect(program);
}
