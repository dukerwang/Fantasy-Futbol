const fs = require('fs');

async function checkCityAndPhoto() {
  const fplRes = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/', {
    headers: { 'User-Agent': 'FantasyFutbol/1.0' }
  });
  const fplData = await fplRes.json();
  
  const p121160 = fplData.elements.filter(e => e.photo?.includes('121160'));
  console.log('Photo 121160 in FPL:', p121160);

  const cityTeam = fplData.teams.find(t => t.name.toLowerCase().includes('city') || t.name.toLowerCase().includes('manchester'));
  console.log('City team:', cityTeam);

  const cityPlayers = fplData.elements.filter(e => e.team === cityTeam?.id);
  console.log('City players in FPL:', cityPlayers.map(e => ({ id: e.id, name: `${e.first_name} ${e.second_name}`, web_name: e.web_name, type: e.element_type })));
}

checkCityAndPhoto();
