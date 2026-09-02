/** One-off: regenerate the 20-player 0.3.2 sample that stresses the opening-angle fix. */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { runOutlookBatch } from '@/lib/outlook/batch';

function loadEnvLocal() {
  const p = resolve(process.cwd(), '.env.local');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    if (!process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

const SAMPLE_FULL = [
  '4396df3e-4925-46af-b437-f12d65eb2a94', // Truffert    LB   angle=1  offender
  '3ff9adc3-eccc-44a8-9f7c-5cbb65fcda93', // Gravenberch DM   angle=1
  '3218c8da-486e-40a9-95ba-d3937fe0d254', // Estêvão     RW   angle=1
  '3dbf4b85-db4c-4a2b-8f2c-b93e3b1b8882', // Gyökeres    ST   angle=5  true-positive control
  '1e0ea6bf-3b1e-4e6e-b19a-6b84ed7cdf85', // Saka        RW   angle=1
  'd83a1914-917b-4724-ba25-418ceaee6b92', // Cash        RB   angle=1  offender
  'bc1c56ac-c9dc-4d38-a444-74afc91f6356', // Wan-Bissaka RB   angle=1
  '8ac5e085-5cfc-4601-8ff4-648b24f720d2', // Kelleher    GK   angle=1  offender
  '857fe563-6772-4c5f-b962-47c85df3c9d0', // M.Sangaré   CM   angle=1  offender
  'c6b2dc4e-0fe9-4976-b49f-952446522b4c', // Isak        ST   angle=1
  'a5776d6d-c27d-43d8-b7e2-0575b0affdf3', // Kostoulas   ST   angle=1  true-positive control
  'a5a1513a-a62f-4cbc-9c6c-71501c19e6b4', // Donnarumma  GK   angle=1
  'f0ba2ad7-32ff-4a55-b442-177d919a106e', // Maatsen     LWB  angle=1  offender
  '54b33793-6911-4ad2-97b4-4f1e1396698a', // Canvot      CB   angle=0
  '37e90156-d93a-4e4b-8886-37990f5be35a', // Wilson      RW   angle=2
  '278ea88e-6a30-4476-b264-1e0ee2a024aa', // Bergvall    CM   angle=3
  '4bf2300f-315a-4fc8-b48c-25f567b422f5', // N.Williams  LB   angle=4
  '7228e4b5-0fb0-4321-aa02-7d71776fdc54', // Giles       LWB  angle=5
  '41e62aa8-47b4-4f28-8cfc-cce7145e78e9', // Dalot       RB   angle=0
  '5907035a-ee80-4139-9fb4-38d9e46b18c6', // Tchaouna    RW   angle=2
];

const SAMPLE = SAMPLE_FULL.filter((_, i) => [0,1,2,4,5,6,7,8,9,10,11,12].includes(i));

async function main() {
  loadEnvLocal();
  if (!process.env.API_KEY) { console.error('API_KEY missing'); process.exit(1); }
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const report = await runOutlookBatch(admin, { playerIds: SAMPLE, regulars: false, force: true });
  console.log(JSON.stringify(report, null, 2));
}
main();
