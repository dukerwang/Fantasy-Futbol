const fs = require('fs');

fetch('https://fantasy.premierleague.com/api/bootstrap-static/', {
  headers: { 'User-Agent': 'Mozilla/5.0' }
}).then(r => r.json()).then(d => {
  const teams = new Map(d.teams.map(t => [t.id, t.name]));

  // Find Rogers
  const rogers = d.elements.filter(e => 
    (e.web_name && e.web_name.toLowerCase().includes('rogers')) || 
    (e.second_name && e.second_name.toLowerCase().includes('rogers'))
  );
  console.log('--- FPL API: Rogers ---');
  console.log(rogers.map(e => ({ id: e.id, web_name: e.web_name, fullName: `${e.first_name} ${e.second_name}`, team: teams.get(e.team), cost: (e.now_cost/10).toFixed(1) })));

  // Find Tzolis
  const tzolis = d.elements.filter(e => 
    (e.web_name && e.web_name.toLowerCase().includes('tzolis')) || 
    (e.second_name && e.second_name.toLowerCase().includes('tzolis'))
  );
  console.log('--- FPL API: Tzolis ---');
  console.log(tzolis.map(e => ({ id: e.id, web_name: e.web_name, fullName: `${e.first_name} ${e.second_name}`, team: teams.get(e.team), cost: (e.now_cost/10).toFixed(1) })));

  // Find Ipswich Town players in FPL API
  const ipswichTeam = d.teams.find(t => t.name.toLowerCase().includes('ipswich'));
  console.log('--- FPL API: Ipswich Town ---');
  if (ipswichTeam) {
    const ipswichPlayers = d.elements.filter(e => e.team === ipswichTeam.id);
    console.log('Ipswich Players count:', ipswichPlayers.length);
    console.log(ipswichPlayers.map(e => ({ id: e.id, web_name: e.web_name, fullName: `${e.first_name} ${e.second_name}`, pos: e.element_type })));
  }

  // Check Chelsea roster
  const chelseaTeam = d.teams.find(t => t.name.toLowerCase().includes('chelsea'));
  if (chelseaTeam) {
    const chelseaPlayers = d.elements.filter(e => e.team === chelseaTeam.id);
    console.log('--- FPL API: Chelsea roster ---');
    console.log(chelseaPlayers.map(e => `${e.first_name} ${e.second_name} (${e.web_name})`));
  }

  // Check Arsenal roster
  const arsenalTeam = d.teams.find(t => t.name.toLowerCase().includes('arsenal'));
  if (arsenalTeam) {
    const arsenalPlayers = d.elements.filter(e => e.team === arsenalTeam.id);
    console.log('--- FPL API: Arsenal roster ---');
    console.log(arsenalPlayers.map(e => `${e.first_name} ${e.second_name} (${e.web_name})`));
  }
}).catch(console.error);
