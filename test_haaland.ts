import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import { calculateMatchRating, DEFAULT_REFERENCE_STATS } from './src/lib/scoring/matchRating';

// Load env
const envVars = fs.readFileSync('.env.local', 'utf-8').split('\n').filter(Boolean);
const env: Record<string, string> = {};
for (const line of envVars) {
    if (line.includes('=')) {
        const [k, ...v] = line.split('=');
        env[k.trim()] = v.join('=').trim().replace(/^"|"$/g, '');
    }
}

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
    const { data: p } = await supabase.from('players').select('id').eq('name', 'Erling Haaland').single();
    const { data: stat } = await supabase.from('player_stats').select('stats').eq('player_id', p.id).eq('gameweek', 1).single();
    
    console.log("OLD RAW DB OUTPUT:", 8.7);
    
    // Test calculate manually using the exact mathRating logic 
    const result = calculateMatchRating(stat.stats, 'ST', DEFAULT_REFERENCE_STATS);
    
    console.log("NEW CALCULATED MATH OUTPUT:");
    console.log("Rating:", result.rating);
    console.log("Fantasy Pts:", result.fantasyPoints);
}
check();
