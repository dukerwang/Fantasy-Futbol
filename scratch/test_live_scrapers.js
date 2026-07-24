process.loadEnvFile('.env.local');

async function testLiveFetch() {
  console.log('Testing live fetch to api.sofifa.net...');
  try {
    const res = await fetch('https://api.sofifa.net/leagues', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://sofifa.com/',
      }
    });
    console.log('SoFIFA API status:', res.status);
    if (res.ok) {
      const data = await res.json();
      console.log('SoFIFA leagues data sample:', Array.isArray(data.data) ? data.data.slice(0, 3) : data);
    } else {
      const text = await res.text();
      console.log('SoFIFA response text:', text.slice(0, 200));
    }
  } catch (err) {
    console.error('SoFIFA fetch error:', err.message);
  }

  console.log('\nTesting live fetch to Transfermarkt API / search...');
  try {
    const tmRes = await fetch('https://transfermarkt-api.vercel.app/clubs/search?query=Arsenal', {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    console.log('Transfermarkt API status:', tmRes.status);
    if (tmRes.ok) {
      const tmData = await tmRes.json();
      console.log('Transfermarkt data sample:', tmData);
    }
  } catch (err) {
    console.error('Transfermarkt fetch error:', err.message);
  }
}

testLiveFetch();
