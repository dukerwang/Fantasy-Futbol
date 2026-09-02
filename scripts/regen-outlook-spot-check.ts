#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { runOutlookBatch } from '../src/lib/outlook/batch';

function loadEnvLocal() {
  const path = resolve(process.cwd(), '.env.local');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    const val = m[2].trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}

const SPOT_CHECK_IDS = [
  '8341cc41-6318-42b5-92e3-2d55de158e6f', // Cole Palmer
  '3218c8da-486e-40a9-95ba-d3937fe0d254', // Estêvão
  '00b2b501-9743-4473-9ba0-dce35927a988', // João Pedro
  '1f74b53b-6c9a-4806-9ae6-56cb8d088322', // Morgan Rogers
  '0fb16a00-b28f-468b-be86-4632544ece3c', // Tosin
  '0f396aa7-3ed6-427b-8b66-e8cbf111be8e', // Quenda
  '07cfc00c-1eaf-4941-80b9-71053e85b28d', // Palestra
  'c80f3912-04f9-4255-8d41-7999f8f9bd59', // Pedro Neto
  '1e0ea6bf-3b1e-4e6e-b19a-6b84ed7cdf85', // Saka
  '0a3c471a-ce3c-47a7-a2df-28d51a274f05', // Martinelli
];

async function main() {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !process.env.API_KEY) {
    console.error('Missing env vars');
    process.exit(1);
  }

  const admin = createClient(url, key);
  const report = await runOutlookBatch(admin, {
    playerIds: SPOT_CHECK_IDS,
    regulars: false,
    force: true,
  });
  console.log(JSON.stringify(report, null, 2));
  if (report.failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
