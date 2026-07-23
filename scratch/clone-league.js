const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

// Load environment variables
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

const SOURCE_LEAGUE_ID = '45b30999-1b85-4e44-aadf-268ca7f76063';

async function cloneLeague() {
  try {
    console.log(`Cloning league: ${SOURCE_LEAGUE_ID}`);
    
    // 1. Fetch Source League
    const { data: sourceLeague, error: lErr } = await supabase
      .from('leagues')
      .select('*')
      .eq('id', SOURCE_LEAGUE_ID)
      .single();
    if (lErr || !sourceLeague) throw new Error(`Source league not found: ${lErr?.message}`);

    const newName = `Copy of ${sourceLeague.name}`;
    console.log(`New league name: ${newName}`);

    // Create league payload (strip id, invite_code, and timestamps)
    const leaguePayload = { ...sourceLeague };
    delete leaguePayload.id;
    delete leaguePayload.invite_code;
    delete leaguePayload.created_at;
    delete leaguePayload.updated_at;
    leaguePayload.name = newName;

    // 2. Insert New League
    const { data: newLeague, error: newLErr } = await supabase
      .from('leagues')
      .insert(leaguePayload)
      .select()
      .single();
    if (newLErr || !newLeague) throw new Error(`Failed to create new league: ${newLErr?.message}`);
    console.log(`New League Created! ID: ${newLeague.id}`);

    // 3. Clone League Members
    const { data: members, error: mErr } = await supabase
      .from('league_members')
      .select('*')
      .eq('league_id', SOURCE_LEAGUE_ID);
    if (mErr) throw mErr;
    console.log(`Found ${members.length} members.`);

    if (members.length > 0) {
      const membersPayload = members.map(m => {
        const payload = { ...m };
        delete payload.id;
        delete payload.created_at;
        payload.league_id = newLeague.id;
        return payload;
      });
      const { error: insMemErr } = await supabase.from('league_members').insert(membersPayload);
      if (insMemErr) throw insMemErr;
      console.log('League members cloned successfully.');
    }

    // 4. Clone Teams
    const { data: teams, error: tErr } = await supabase
      .from('teams')
      .select('*')
      .eq('league_id', SOURCE_LEAGUE_ID);
    if (tErr) throw tErr;
    console.log(`Found ${teams.length} teams.`);

    const teamIdMap = {}; // old_team_id -> new_team_id
    for (const team of teams) {
      const teamPayload = { ...team };
      delete teamPayload.id;
      delete teamPayload.created_at;
      delete teamPayload.updated_at;
      teamPayload.league_id = newLeague.id;

      const { data: newTeam, error: insTeamErr } = await supabase
        .from('teams')
        .insert(teamPayload)
        .select()
        .single();
      if (insTeamErr || !newTeam) throw insTeamErr;
      teamIdMap[team.id] = newTeam.id;
    }
    console.log('Teams cloned successfully.');

    // 5. Clone Roster Entries
    const { data: rosters, error: rErr } = await supabase
      .from('roster_entries')
      .select('*')
      .in('team_id', Object.keys(teamIdMap));
    if (rErr) throw rErr;
    console.log(`Found ${rosters.length} roster entries.`);

    if (rosters.length > 0) {
      const rostersPayload = rosters.map(r => {
        const payload = { ...r };
        delete payload.id;
        delete payload.created_at;
        payload.team_id = teamIdMap[r.team_id];
        return payload;
      });
      const { error: insRosterErr } = await supabase.from('roster_entries').insert(rostersPayload);
      if (insRosterErr) throw insRosterErr;
      console.log('Roster entries cloned successfully.');
    }

    // 6. Clone Draft Picks
    const { data: picks, error: pErr } = await supabase
      .from('draft_picks')
      .select('*')
      .eq('league_id', SOURCE_LEAGUE_ID);
    if (pErr) throw pErr;
    console.log(`Found ${picks.length} draft picks.`);

    if (picks.length > 0) {
      const picksPayload = picks.map(p => {
        const payload = { ...p };
        delete payload.id;
        delete payload.created_at;
        payload.league_id = newLeague.id;
        payload.team_id = teamIdMap[p.team_id];
        return payload;
      });
      const { error: insPicksErr } = await supabase.from('draft_picks').insert(picksPayload);
      if (insPicksErr) throw insPicksErr;
      console.log('Draft picks cloned successfully.');
    }

    // 7. Clone Matchups
    const { data: matchups, error: matErr } = await supabase
      .from('matchups')
      .select('*')
      .eq('league_id', SOURCE_LEAGUE_ID);
    if (matErr) throw matErr;
    console.log(`Found ${matchups.length} matchups.`);

    if (matchups.length > 0) {
      const matchupsPayload = matchups.map(m => {
        const payload = { ...m };
        delete payload.id;
        delete payload.created_at;
        payload.league_id = newLeague.id;
        payload.team_a_id = teamIdMap[m.team_a_id];
        payload.team_b_id = teamIdMap[m.team_b_id];
        return payload;
      });
      const { error: insMatchupsErr } = await supabase.from('matchups').insert(matchupsPayload);
      if (insMatchupsErr) throw insMatchupsErr;
      console.log('Matchups cloned successfully.');
    }

    // 8. Clone Tournaments
    const { data: tournaments, error: tourErr } = await supabase
      .from('tournaments')
      .select('*')
      .eq('league_id', SOURCE_LEAGUE_ID);
    if (tourErr) throw tourErr;
    console.log(`Found ${tournaments.length} tournaments.`);

    for (const tour of tournaments) {
      const tourPayload = { ...tour };
      delete tourPayload.id;
      delete tourPayload.created_at;
      delete tourPayload.updated_at;
      tourPayload.league_id = newLeague.id;

      const { data: newTour, error: insTourErr } = await supabase
        .from('tournaments')
        .insert(tourPayload)
        .select()
        .single();
      if (insTourErr || !newTour) throw insTourErr;

      // Clone Rounds for this tournament
      const { data: rounds, error: roundErr } = await supabase
        .from('tournament_rounds')
        .select('*')
        .eq('tournament_id', tour.id);
      if (roundErr) throw roundErr;

      const roundIdMap = {};
      for (const round of rounds) {
        const roundPayload = { ...round };
        delete roundPayload.id;
        delete roundPayload.created_at;
        roundPayload.tournament_id = newTour.id;

        const { data: newRound, error: insRoundErr } = await supabase
          .from('tournament_rounds')
          .insert(roundPayload)
          .select()
          .single();
        if (insRoundErr || !newRound) throw insRoundErr;
        roundIdMap[round.id] = newRound.id;
      }

      // Clone Matchups for these rounds
      if (Object.keys(roundIdMap).length > 0) {
        const { data: tMatchups, error: tMatchErr } = await supabase
          .from('tournament_matchups')
          .select('*')
          .in('round_id', Object.keys(roundIdMap));
        if (tMatchErr) throw tMatchErr;

        const tMatchupIdMap = {};
        const tMatchupsToLink = [];

        for (const tm of tMatchups) {
          const tmPayload = { ...tm };
          delete tmPayload.id;
          delete tmPayload.created_at;
          tmPayload.round_id = roundIdMap[tm.round_id];
          tmPayload.team_a_id = tm.team_a_id ? teamIdMap[tm.team_a_id] : null;
          tmPayload.team_b_id = tm.team_b_id ? teamIdMap[tm.team_b_id] : null;
          tmPayload.winner_id = tm.winner_id ? teamIdMap[tm.winner_id] : null;
          // Set next_matchup_id to null initially
          tmPayload.next_matchup_id = null;

          const { data: newTm, error: insTmErr } = await supabase
            .from('tournament_matchups')
            .insert(tmPayload)
            .select()
            .single();
          if (insTmErr || !newTm) throw insTmErr;
          tMatchupIdMap[tm.id] = newTm.id;

          if (tm.next_matchup_id) {
            tMatchupsToLink.push({
              newId: newTm.id,
              oldNextId: tm.next_matchup_id
            });
          }
        }

        // Link next_matchup_ids
        for (const link of tMatchupsToLink) {
          const newNextId = tMatchupIdMap[link.oldNextId];
          if (newNextId) {
            const { error: updErr } = await supabase
              .from('tournament_matchups')
              .update({ next_matchup_id: newNextId })
              .eq('id', link.newId);
            if (updErr) throw updErr;
          }
        }
      }
    }
    console.log('Tournaments cloned successfully.');
    
    console.log(`\nSUCCESS! Cloned League ID: ${newLeague.id}`);
  } catch (err) {
    console.error('Cloning failed:', err);
  }
}

cloneLeague();
