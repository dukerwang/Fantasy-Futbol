const http = require('http');

async function testCron() {
  console.log('Sending request to /api/cron/start-scheduled-drafts on port 3000...');
  
  const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/api/cron/start-scheduled-drafts',
    method: 'POST',
    headers: {
      'x-cron-secret': 'irenie_beanie',
      'Content-Type': 'application/json'
    }
  };

  const req = http.request(options, (res) => {
    let data = '';
    console.log(`Response Status: ${res.statusCode}`);
    
    res.on('data', (chunk) => {
      data += chunk;
    });
    
    res.on('end', () => {
      console.log('Response Body:', data);
      try {
        const json = JSON.parse(data);
        console.log('Verification Success: Endpoint returned successfully.');
      } catch (e) {
        console.error('Failed to parse response JSON:', e.message);
      }
    });
  });

  req.on('error', (err) => {
    console.error('Request failed:', err.message);
  });

  req.end();
}

testCron();
