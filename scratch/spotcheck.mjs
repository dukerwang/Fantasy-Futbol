const boot = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/', { headers: { 'User-Agent': 'FantasyFutbol/1.0' } }).then(r => r.json());
const teams = new Map(boot.teams.map(t => [t.id, t.name]));
const probe = ['salah','konate','konaté','gordon','cucurella','zabarnyi','holding','onana','diaz','díaz','gundogan','gündogan','bowen','trossard','palhinha','bernardo','wan-bissaka'];
for (const q of probe) {
  const hits = boot.elements.filter(e => `${e.first_name} ${e.second_name} ${e.web_name}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').includes(q.normalize('NFD').replace(/[̀-ͯ]/g,'')));
  console.log(q.padEnd(14), hits.length ? hits.map(h => `${h.first_name} ${h.second_name} [${h.web_name}] ${teams.get(h.team)} status=${h.status}`).join(' | ') : '— NOT IN BOOTSTRAP');
}
