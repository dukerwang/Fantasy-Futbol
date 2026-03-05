fetch('https://fantasy.premierleague.com/api/bootstrap-static/')
  .then(res => res.json())
  .then(data => {
    const salah = data.elements.find(e => e.web_name === 'Salah');
    const haaland = data.elements.find(e => e.web_name === 'Haaland');
    console.log('Salah:', salah.photo);
    console.log('Haaland:', haaland.photo);
  });
