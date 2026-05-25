(async () => {
  try {
    const res = await fetch('https://fantasy.premierleague.com/api/fixtures/?event=35');
    const fixtures = await res.json() as any[];
    console.log("Fixtures sample (first 3):");
    console.log(JSON.stringify(fixtures.slice(0, 3), null, 2));
  } catch (e) {
    console.error("Error fetching fixtures:", e);
  }
})();
