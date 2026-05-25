const fs = require('fs');
const path = require('path');

// Load env
try {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    const envFile = fs.readFileSync(envPath, 'utf-8');
    for (const line of envFile.split('\n')) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        process.env[match[1]] = (match[2] || '').replace(/^"|"$/g, "");
      }
    }
  }
} catch (e) {}

const CRON_SECRET = process.env.CRON_SECRET;
if (!CRON_SECRET) {
  console.error("Missing CRON_SECRET in env");
  process.exit(1);
}

async function main() {
  console.log("Triggering /api/admin/backfill-scoring-v2 against local dev server...");
  const url = 'http://localhost:3000/api/admin/backfill-scoring-v2?stats=true&matchups=true';
  
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'x-cron-secret': CRON_SECRET,
      'Content-Type': 'application/json'
    }
  });

  if (!res.ok) {
    console.error(`Request failed with status ${res.status}:`, await res.text());
    process.exit(1);
  }

  const data = await res.json();
  console.log("Backfill completed successfully:", JSON.stringify(data, null, 2));
}

main().catch(console.error);
