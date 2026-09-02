#!/usr/bin/env node
/**
 * Manual outlook smoke test.
 *
 * Usage:
 *   API_KEY=... node scripts/try-outlook.mjs --name "James Tarkowski" --club Everton --position CB
 *
 * Loads API_KEY from ../../.env.local if present.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '../..');

function loadEnvLocal() {
  const path = resolve(root, '.env.local');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    const val = m[2].trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}

function parseArgs(argv) {
  const args = { name: 'James Tarkowski', club: 'Everton', position: 'CB', age: '32' };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--name') args.name = argv[++i];
    else if (argv[i] === '--club') args.club = argv[++i];
    else if (argv[i] === '--position') args.position = argv[++i];
    else if (argv[i] === '--age') args.age = argv[++i];
    else if (argv[i] === '--dry-run') args.dryRun = true;
  }
  return args;
}

loadEnvLocal();
const args = parseArgs(process.argv);

const bag = {
  player_id: '00000000-0000-0000-0000-000000000001',
  name: args.name,
  display_name: args.name,
  age: Number(args.age),
  nationality: 'England',
  club: args.club,
  primary_position: args.position,
  secondary_positions: [],
  availability: 'available',
  injury_news: null,
  market_value_eur_m: 12,
  is_new_to_prem: false,
  academy_eligible: false,
  simulation_date: new Date().toISOString().slice(0, 10),
  current_season: '2026-27',
  is_dynasty_league: true,
};

if (args.dryRun) {
  const { buildLockedFactsBlock, buildOutlookSearchQueries } = await import('../src/index.ts');
  console.log(buildLockedFactsBlock(bag));
  console.log('\n--- QUERIES ---\n');
  console.log(buildOutlookSearchQueries(bag).join('\n'));
  process.exit(0);
}

const apiKey = process.env.API_KEY;
if (!apiKey) {
  console.error('Missing API_KEY (env or .env.local)');
  process.exit(1);
}

const { generateOutlook } = await import('../src/index.ts');

console.log(`Generating outlook for ${args.name} (${args.club})...\n`);

const result = await generateOutlook({ apiKey, contextBag: bag });

console.log(result.outlook);
console.log('\n--- SIDECAR ---');
console.log(JSON.stringify(result.sidecar, null, 2));
console.log('\n--- EXTRACTION ---');
console.log(JSON.stringify(result.extraction, null, 2));
console.log(`\nGrounding sources: ${result.groundingSourceCount}`);
