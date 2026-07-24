process.loadEnvFile('.env.local');

async function checkNewAdditions() {
  const res = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/', { headers: { 'User-Agent': 'FantasyFutbol/1.0' } });
  const fplData = await res.json();
  const teams = new Map(fplData.teams.map(t => [t.id, t.name]));

  // Check Morgan Rogers details
  const rogers = fplData.elements.find(e => e.first_name === 'Morgan' && e.second_name === 'Rogers');
  console.log('--- Morgan Rogers FPL Record ---');
  console.log(rogers ? {
    name: rogers.first_name + ' ' + rogers.second_name,
    team: teams.get(rogers.team),
    news: rogers.news,
    status: rogers.status,
    cost: (rogers.now_cost / 10).toFixed(1)
  } : 'Not found');

  // Find players with news mentioning transfer / joined / signed / loan
  const newsPlayers = fplData.elements.filter(e => e.news && (
    e.news.toLowerCase().includes('transfer') ||
    e.news.toLowerCase().includes('joined') ||
    e.news.toLowerCase().includes('signed') ||
    e.news.toLowerCase().includes('loan')
  ));

  console.log('\n--- Players with Transfer/Loan/Signing News in FPL ---');
  newsPlayers.forEach(e => {
    console.log(`${e.first_name} ${e.second_name} (${e.web_name}) -> ${teams.get(e.team)} | News: ${e.news}`);
  });
}

checkNewAdditions();
