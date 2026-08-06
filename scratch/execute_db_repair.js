const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

if (fs.existsSync('.env.local')) {
  const envContent = fs.readFileSync('.env.local', 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const equalsIdx = trimmed.indexOf('=');
    if (equalsIdx > 0) {
      const key = trimmed.substring(0, equalsIdx).trim();
      const val = trimmed.substring(equalsIdx + 1).trim();
      process.env[key] = val;
    }
  });
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function repairDatabase() {
  console.log('--- REPAIRING CORRUPTED DB PLAYER RECORDS ---');

  const updates = [
    {
      id: '418a23ee-06ab-4067-9a11-efee1e2aa04e',
      name: 'Alisson',
      patch: {
        primary_position: 'GK',
        secondary_positions: [],
        nationality: 'Brazil',
        height_cm: 193,
        sofifa_common_name: 'Alisson'
      }
    },
    {
      id: '89b834d3-4564-40f3-aa5d-c68a51610f55',
      name: 'Daniel Muñoz',
      patch: {
        primary_position: 'RB',
        secondary_positions: ['RWB'],
        sofifa_common_name: 'D. Muñoz',
        full_name: 'Daniel Muñoz Mejía'
      }
    },
    {
      id: '0222027d-19f0-42b4-99da-d21c49e4d7cc',
      name: 'Ederson Santana de Moraes (Inactive)',
      patch: {
        web_name: 'Ederson',
        primary_position: 'GK',
        secondary_positions: []
      }
    },
    {
      id: '55a21522-6e0a-4417-bb73-c969ed02aa98',
      name: 'Harvey Cartwright',
      patch: {
        primary_position: 'GK',
        secondary_positions: []
      }
    },
    {
      id: 'bdac6680-592e-4cfc-a862-270cf341d3b7',
      name: 'Kjell Scherpen',
      patch: {
        primary_position: 'GK',
        secondary_positions: []
      }
    },
    {
      id: '74ee5733-c503-4cc9-bf0f-bc76c025a0a4',
      name: 'Ewen Jaouen',
      patch: {
        primary_position: 'GK',
        secondary_positions: []
      }
    },
    {
      id: '58841852-0cef-4a74-a204-f3b17abf6a06',
      name: 'Jannik Schuster',
      patch: {
        primary_position: 'CB',
        secondary_positions: ['LB']
      }
    },
    {
      id: 'f0e5257d-5cf1-43ac-b8a5-d51b6d837346',
      name: 'Tyler Dibling',
      patch: {
        primary_position: 'RW',
        secondary_positions: ['AM', 'RM']
      }
    },
    {
      id: '240b731c-b4c3-4e60-a55d-8746566c1a7d',
      name: 'Abdülkadir Ömür',
      patch: {
        primary_position: 'AM',
        secondary_positions: ['RW', 'CM']
      }
    },
    {
      id: 'd810a676-9a3d-41b4-8827-fdd6eab751c4',
      name: 'Jeremy Monga',
      patch: {
        primary_position: 'LW',
        secondary_positions: ['RW']
      }
    },
    {
      id: '38273526-7735-4641-9217-612af3f9130e',
      name: 'George Shepherd',
      patch: {
        primary_position: 'CM',
        secondary_positions: ['AM']
      }
    }
  ];

  for (const item of updates) {
    const { data: before } = await supabase.from('players').select('id, name, web_name, primary_position, secondary_positions').eq('id', item.id).single();
    console.log(`\nBefore repairing ${item.name} (${item.id}):`, before);

    const { error } = await supabase.from('players').update(item.patch).eq('id', item.id);
    if (error) {
      console.error(`Failed to update ${item.name}:`, error);
    } else {
      const { data: after } = await supabase.from('players').select('id, name, web_name, primary_position, secondary_positions').eq('id', item.id).single();
      console.log(`After repairing ${item.name}:`, after);
    }
  }

  console.log('\n--- VERIFYING RAYAN CHERKI IS UNTOUCHED ---');
  const { data: cherki } = await supabase.from('players').select('id, name, web_name, primary_position, pl_team, fpl_id').ilike('name', '%cherki%');
  console.log('Rayan Cherki row:', cherki);
}

repairDatabase();
