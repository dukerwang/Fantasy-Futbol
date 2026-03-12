const { readFileSync } = require('fs');
const { resolve } = require('path');

const envPath = resolve(__dirname, '..', '.env.local');
const envContent = readFileSync(envPath, 'utf8');
for (const line of envContent.split('\n')) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim();
}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function run() {
    console.log("Creating bot 1...");
    let res = await fetch(`${URL}/auth/v1/admin/users`, {
        method: 'POST',
        headers: { 'apikey': KEY, 'Authorization': `Bearer ${KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'bot_admin@fantasyfutbol.test', password: 'Password123!', email_confirm: true })
    });
    console.log(await res.json());
}
run();
