import type { NextRequest } from 'next/server';

/**
 * Server-to-server auth for Futbolpedia club-context reads.
 * Dedicated secret — do not reuse CRON_SECRET for this surface long-term.
 */
export function authorizeFutbolpediaRead(req: NextRequest): boolean {
  const expected = process.env.FUTBOLPEDIA_READ_SECRET;
  if (!expected || !expected.trim()) return false;
  const got = req.headers.get('x-futbolpedia-secret');
  return !!got && got === expected;
}
