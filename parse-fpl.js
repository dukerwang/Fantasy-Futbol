const https = require('https');

https.get('https://fantasy.premierleague.com/', res => {
  let body = '';
  res.on('data', d => body += d);
  res.on('end', () => {
    const jsFiles = [...body.matchAll(/src="(\/static\/js\/[^"]+)"/g)].map(m => m[1]);
    jsFiles.forEach(js => {
      https.get('https://fantasy.premierleague.com' + js, r => {
        let jsBody = '';
        r.on('data', d => jsBody += d);
        r.on('end', () => {
          const urls = [...jsBody.matchAll(/https:\/\/[^"']*(premierleague\.com|photos)[^"']*/gi)];
          if (urls.length > 0) {
            console.log('Found in', js, urls.map(m => m[0]));
          }
        });
      });
    });
  });
});
