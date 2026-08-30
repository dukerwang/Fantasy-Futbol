#!/usr/bin/env node
/**
 * A/B synthesis temperature on one player — one search+extract, many synthesis passes.
 *
 * Usage:
 *   API_KEY=... npm run compare-outlook-temps -- --name "Bukayo Saka" --club Arsenal --position RW
 *   API_KEY=... npm run compare-outlook-temps -- --temps 0.65,0.8,0.95 --no-auto
 *
 * Loads API_KEY from Futbolpedia root .env.local when present.
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
  const args = {
    name: 'Bukayo Saka',
    club: 'Arsenal',
    position: 'RW',
    age: '24',
    temps: null,
    includeAuto: true,
    jitter: 0,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--name') args.name = argv[++i];
    else if (a === '--club') args.club = argv[++i];
    else if (a === '--position') args.position = argv[++i];
    else if (a === '--age') args.age = argv[++i];
    else if (a === '--temps') args.temps = argv[++i].split(',').map(Number);
    else if (a === '--no-auto') args.includeAuto = false;
    else if (a === '--jitter') args.jitter = Number(argv[++i]);
  }
  return args;
}

loadEnvLocal();
const args = parseArgs(process.argv);

const apiKey = process.env.API_KEY;
if (!apiKey) {
  console.error('Missing API_KEY (env or Futbolpedia .env.local)');
  process.exit(1);
}

const bag = {
  player_id: '00000000-0000-0000-0000-000000000099',
  name: args.name,
  display_name: args.name,
  age: Number(args.age),
  nationality: 'England',
  club: args.club,
  primary_position: args.position,
  secondary_positions: [],
  availability: 'available',
  injury_news: null,
  market_value_eur_m: 100,
  is_new_to_prem: false,
  academy_eligible: false,
  simulation_date: new Date().toISOString().slice(0, 10),
  current_season: '2026-27',
  is_dynasty_league: true,
};

const { compareSynthesisTemperatures } = await import('../src/index.ts');

console.log(`Comparing synthesis temperatures for ${args.name} (${args.club})…`);
console.log('(One search+extract pass, then multiple synthesis calls.)\n');

const result = await compareSynthesisTemperatures({
  apiKey,
  contextBag: bag,
  temperatures: args.temps ?? undefined,
  includeAuto: args.includeAuto,
  autoJitter: args.jitter,
});

console.log(`Grounding sources: ${result.groundingSourceCount}`);
console.log(`Verified facts: ${result.extraction.verified_facts.length}`);
console.log(`Data gaps: ${result.extraction.data_gaps.length || 'none'}\n`);

for (const row of result.rows) {
  const status = row.validation.ok ? 'PASS' : `FAIL (${row.validation.errors.join('; ')})`;
  console.log('='.repeat(72));
  console.log(`${row.label}  |  temp=${row.temperature}  |  ${row.wordCount} words  |  ${status}`);
  console.log(`tags: ${row.sidecar.evaluation_tags.join(', ')}`);
  console.log('-'.repeat(72));
  console.log(row.outlook);
  console.log('');
}
