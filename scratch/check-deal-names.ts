// One-off: eyeball every branch of describeDeal in both voices.
import { describeDeal } from '../src/lib/transfers/describeDeal.ts';

const cases: [string, Parameters<typeof describeDeal>[0]][] = [
  ['cash → 1 player', { offered: [], requested: ['B. Saka'], offeredFaab: 40, requestedFaab: 0 }],
  ['cash → 2 players', { offered: [], requested: ['B. Saka', 'D. Rice'], offeredFaab: 60, requestedFaab: 0 }],
  ['players ⇄ players', { offered: ['J. Bowen'], requested: ['O. Watkins'], offeredFaab: 0, requestedFaab: 0 }],
  ['players + cash out', { offered: ['J. Bowen'], requested: ['O. Watkins'], offeredFaab: 30, requestedFaab: 0 }],
  ['players + cash in', { offered: ['D. Rice'], requested: ['N. Semenyo'], offeredFaab: 0, requestedFaab: 55 }],
  ['players → cash', { offered: ['D. Rice'], requested: [], offeredFaab: 0, requestedFaab: 55 }],
  ['cash both ways, players', { offered: ['J. Bowen'], requested: ['O. Watkins'], offeredFaab: 30, requestedFaab: 10 }],
  ['cash both ways, no players', { offered: [], requested: [], offeredFaab: 30, requestedFaab: 10 }],
  ['nothing', { offered: [], requested: [], offeredFaab: 0, requestedFaab: 0 }],
  ['three players', { offered: [], requested: ['Saka', 'Rice', 'Bowen'], offeredFaab: 90, requestedFaab: 0 }],
];

for (const [label, d] of cases) {
  const second = describeDeal(d);
  const third = describeDeal(d, { proposer: 'Northern Lights' });
  console.log(`\n${label}`);
  console.log(`  kind      ${second.kind}  (net ${second.netFaab}, sendable ${second.sendable})`);
  console.log(`  headline  ${second.headline}`);
  console.log(`  2nd       ${second.sentence}`);
  console.log(`  3rd       ${third.sentence}`);
}
