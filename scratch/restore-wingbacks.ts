import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

try {
  const env = fs.readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf-8');
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (m) process.env[m[1]] = (m[2] || '').replace(/^"|"$/g, '');
  }
} catch (e) {}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

(async () => {
  const logPath = '/Users/dukewang/.gemini/antigravity/brain/5d60a1a2-8eee-4f4d-9a51-43677e9d9d44/.system_generated/tasks/task-2429.log';
  if (!fs.existsSync(logPath)) {
    console.error('Could not find log file at', logPath);
    process.exit(1);
  }

  const logContent = fs.readFileSync(logPath, 'utf-8');
  
  // Use regex to parse player JSON-like objects printed in console
  // Example pattern:
  //   {
  //     id: 'c828aa5b-d39b-49ef-8fb3-266eecf62196',
  //     name: 'Rayan Aït-Nouri',
  //     primary_position: 'LWB'
  //   }
  
  const regex = /\{\s*id:\s*'([^']+)',\s*name:\s*'([^']+)',\s*primary_position:\s*'([^']+)'\s*\}/g;
  
  let match;
  const playersToRestore: { id: string; name: string; originalPos: string }[] = [];
  
  while ((match = regex.exec(logContent)) !== null) {
    playersToRestore.push({
      id: match[1],
      name: match[2],
      originalPos: match[3]
    });
  }

  console.log(`Found ${playersToRestore.length} players to restore from log file.`);
  
  if (playersToRestore.length === 0) {
    console.error('No players matched the regex pattern in log file.');
    process.exit(1);
  }

  for (const p of playersToRestore) {
    console.log(`Restoring ${p.name} (${p.id}) back to ${p.originalPos}...`);
    const { error } = await sb
      .from('players')
      .update({ primary_position: p.originalPos })
      .eq('id', p.id);
      
    if (error) {
      console.error(`Failed to restore ${p.name}:`, error);
    }
  }

  console.log('Restoration completed.');
})();
