process.loadEnvFile('.env.local');
const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const SOFIFA_POS_MAP = {
  GK: 'GK', SW: 'CB', RWB: 'RWB', RB: 'RB', RCB: 'CB', CB: 'CB', LCB: 'CB', LB: 'LB', LWB: 'LWB',
  RDM: 'DM', CDM: 'DM', LDM: 'DM', RM: 'RW', RCM: 'CM', CM: 'CM', LCM: 'CM', LM: 'LW', RAM: 'AM',
  CAM: 'AM', LAM: 'AM', RF: 'RW', CF: 'ST', LF: 'LW', RW: 'RW', RS: 'ST', ST: 'ST', LS: 'ST', LW: 'LW',
  DM: 'DM', AM: 'AM'
};
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const context = await chromium.launchPersistentContext('./playwright-profile', {
    headless: false,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
  });
  const page = context.pages()[0] || await context.newPage();
  try {
    await page.goto('https://sofifa.com/players?keyword=David%20Akintola', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await delay(1500);
    const rows = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('table tbody tr')).map(row => {
        const a = row.querySelector('a[href^="/player/"]');
        const posEls = Array.from(row.querySelectorAll('span.pos'));
        return { name: a ? a.innerText.trim() : null, positions: posEls.map(el => el.innerText.trim()) };
      });
    });
    console.log('All rows for "David Akintola" search:', JSON.stringify(rows, null, 2));

    const good = rows.find(r => r.name && r.name.toLowerCase().includes('akintola') && (r.name.toLowerCase().startsWith('d') || r.name.toLowerCase().includes('david')));
    if (good) {
      const primaryPos = SOFIFA_POS_MAP[good.positions[0]];
      const secondaries = good.positions.slice(1).map(p => SOFIFA_POS_MAP[p]).filter(p => p && p !== primaryPos);
      console.log(`Verified match: ${good.name} -> ${primaryPos} ${JSON.stringify(secondaries)}`);
      const { error } = await supabase.from('players').update({ primary_position: primaryPos, secondary_positions: Array.from(new Set(secondaries)) }).eq('name', 'David Akintola').eq('is_active', true);
      if (error) console.log('update error', error.message);
      else console.log('Updated David Akintola.');
    } else {
      console.log('No verified match (no row starts with D/David) — reverting to safe FPL default CM.');
      const { error } = await supabase.from('players').update({ primary_position: 'CM', secondary_positions: [] }).eq('name', 'David Akintola').eq('is_active', true);
      if (error) console.log('revert error', error.message);
      else console.log('Reverted David Akintola to CM default.');
    }
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await context.close();
  }
})();
