fetch('https://fantasy.premierleague.com/api/bootstrap-static/', {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  }
})
  .then(res => {
    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }
    return res.json();
  })
  .then(data => {
    console.log('--- FPL API STATUS ---');
    
    // 1. Events (Gameweeks) info
    console.log('\n--- Gameweeks/Events ---');
    if (data.events && data.events.length > 0) {
      console.log(`Total Gameweeks listed: ${data.events.length}`);
      const firstGW = data.events[0];
      const lastGW = data.events[data.events.length - 1];
      console.log(`GW1 Name: ${firstGW.name}`);
      console.log(`GW1 Deadline: ${firstGW.deadline_time}`);
      console.log(`GW1 Is Current/Next/Active: Current: ${firstGW.is_current}, Next: ${firstGW.is_next}, Active: ${firstGW.is_active}`);
      console.log(`Last GW Name: ${lastGW.name}`);
      console.log(`Last GW Deadline: ${lastGW.deadline_time}`);
    } else {
      console.log('No gameweeks/events found.');
    }

    // 2. Teams info
    console.log('\n--- Teams ---');
    if (data.teams && data.teams.length > 0) {
      console.log(`Total Teams listed: ${data.teams.length}`);
      console.log('Teams:', data.teams.map(t => `${t.name} (Code: ${t.code}, ID: ${t.id})`).join(', '));
    } else {
      console.log('No teams found.');
    }

    // 3. Elements (Players) info
    console.log('\n--- Players ---');
    if (data.elements && data.elements.length > 0) {
      console.log(`Total Players listed: ${data.elements.length}`);
      const samplePlayers = data.elements.slice(0, 5).map(e => `${e.first_name} ${e.second_name}`);
      console.log('Sample Players:', samplePlayers.join(', '));
    } else {
      console.log('No players found.');
    }
  })
  .catch(err => {
    console.error('Error fetching FPL API:', err);
  });
