const fs = require('fs');

async function checkManCity() {
  const fplRes = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/', {
    headers: { 'User-Agent': 'FantasyFutbol/1.0' }
  });
  const fplData = await fplRes.json();
  
  console.log('Teams:', fplData.teams.map(t => ({ id: t.id, name: t.name })));

  const mc = fplData.teams.find(t => t.name.includes('Man') || t.name.includes('Manchester'));
  const mcPlayers = fplData.elements.filter(e => e.team === 15 || e.team === 16);
  console.log('Team 15/16 players count:', mcPlayers.length);

  const ederson = fplData.elements.filter(e => e.first_name.toLowerCase().includes('ederson') || e.second_name.toLowerCase().includes('moraes') || e.web_name.toLowerCase().includes('ederson'));
  console.log('Ederson in FPL:', ederson);
}

checkManCity();
