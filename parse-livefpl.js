const https = require('https');

https.get('https://www.livefpl.net/rank', res => {
  let body = '';
  res.on('data', d => body += d);
  res.on('end', () => {
    const photos = body.match(/https:\/\/[^"'\s]+(png|jpg|webp)/gi) || [];
    console.log("LiveFPL images:", [...new Set(photos)].filter(p => p.includes('player') || p.includes('118748')).slice(0, 10));
  });
});
