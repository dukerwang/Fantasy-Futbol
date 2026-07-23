const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

if (fs.existsSync('.env.local')) {
  const envContent = fs.readFileSync('.env.local', 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const equalsIdx = trimmed.indexOf('=');
    if (equalsIdx > 0) {
      const key = trimmed.substring(0, equalsIdx).trim();
      const val = trimmed.substring(equalsIdx + 1).trim();
      process.env[key] = val;
    }
  });
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function nextSeason(current) {
  const match = current.match(/^(\d{4})-(\d{2})$/);
  if (!match) return current;
  const startYear = parseInt(match[1], 10) + 1;
  return `${startYear}-${String(startYear + 1).slice(2)}`;
}

function previousSeason(current) {
  const match = current.match(/^(\d{4})-(\d{2})$/);
  if (!match) return current;
  const startYear = parseInt(match[1], 10) - 1;
  return `${startYear}-${String(startYear + 1).slice(2)}`;
}

async function check() {
  const res = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/');
  const data = await res.json();
  const events = data.events || [];
  const gw1 = events.find(e => e.id === 1);
  const lastEvent = events[events.length - 1];

  const gw1Year = new Date(gw1.deadline_time).getFullYear();
  let fplSeason = `${gw1Year}-${String(gw1Year + 1).slice(2)}`;
  if (lastEvent?.finished) {
    fplSeason = nextSeason(fplSeason);
  }

  // Fixed isFplSeasonKickedOff:
  let kickedOff = true;
  if (lastEvent?.finished) {
    kickedOff = false;
  } else if (gw1?.deadline_time) {
    kickedOff = new Date() >= new Date(gw1.deadline_time);
  } else {
    kickedOff = false;
  }

  console.log('getCurrentFplSeason():', fplSeason);
  console.log('isFplSeasonKickedOff():', kickedOff);

  let targetSeason = fplSeason;
  if (!kickedOff) {
    targetSeason = previousSeason(targetSeason);
  }

  console.log('Resolved targetSeason for stats:', targetSeason);

  const { count } = await supabase.from('player_stats').select('*', { count: 'exact', head: true }).eq('season', targetSeason);
  console.log(`player_stats count for ${targetSeason}:`, count);
}

check();
