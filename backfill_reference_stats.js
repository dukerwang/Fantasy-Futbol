const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

// 1. Manually parse .env.local 
const envVars = fs.readFileSync('.env.local', 'utf-8').split('\n').filter(Boolean);
const env = {};
for (const line of envVars) {
    if (line.includes('=')) {
        const [k, ...v] = line.split('=');
        env[k.trim()] = v.join('=').trim().replace(/^"|"$/g, '');
    }
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase credentials in .env.local");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// 2. The newly calculated reference stats
const DEFAULT_REFERENCE_STATS = {
    GK: { match_impact: [14, 9.3], influence: [21.8, 14.28], creativity: [0, 3.17], threat: [0, 1.51], defensive: [0.2, 2.8], goal_involvement: [0, 0.48], finishing: [0, 1], save_score: [6, 4.03] },
    CB: { match_impact: [12, 8.72], influence: [18.2, 11.82], creativity: [1.8, 10.6], threat: [2, 9.81], defensive: [0.2, 2.8], goal_involvement: [0, 1.59], finishing: [0, 1], save_score: [0, 0.92] },
    LB: { match_impact: [10, 9.12], influence: [14.8, 11.2], creativity: [10.3, 14.04], threat: [4, 9.59], defensive: [0.2, 2.8], goal_involvement: [0, 1.7], finishing: [-0.01, 1], save_score: [0, 1] },
    RB: { match_impact: [12, 9.3], influence: [14.2, 11.53], creativity: [9.5, 12.92], threat: [2, 8.06], defensive: [0.2, 2.8], goal_involvement: [0, 1.82], finishing: [0, 1], save_score: [0, 1] },
    DM: { match_impact: [12, 6.54], influence: [13, 12.62], creativity: [10.1, 13.09], threat: [2, 10.22], defensive: [0.2, 2.8], goal_involvement: [0, 1.95], finishing: [-0.01, 1], save_score: [0, 1.36] },
    CM: { match_impact: [11, 6.69], influence: [12.2, 15.78], creativity: [14.2, 17.75], threat: [8, 14.92], defensive: [0.2, 2.8], goal_involvement: [0, 2.76], finishing: [-0.01, 0.11], save_score: [0, 1] },
    LM: { match_impact: [10, 7.07], influence: [10.2, 17.61], creativity: [16.3, 16.71], threat: [15, 17.83], defensive: [0.2, 2.8], goal_involvement: [0, 3.17], finishing: [-0.02, 0.13], save_score: [0, 1] },
    RM: { match_impact: [9, 7.01], influence: [11, 19.08], creativity: [15.1, 15.22], threat: [16, 20.49], defensive: [0.2, 2.8], goal_involvement: [0, 3.47], finishing: [-0.01, 0.13], save_score: [0, 1] },
    AM: { match_impact: [10, 7.47], influence: [12, 19.4], creativity: [15.9, 17.88], threat: [10, 16.43], defensive: [0.2, 2.8], goal_involvement: [0, 3.46], finishing: [-0.01, 0.13], save_score: [0, 1.04] },
    LW: { match_impact: [10, 7.46], influence: [10.6, 19.21], creativity: [15.95, 16.7], threat: [19.5, 18.5], defensive: [0.2, 2.8], goal_involvement: [0, 3.69], finishing: [-0.02, 0.15], save_score: [0, 1] },
    RW: { match_impact: [9, 7.45], influence: [11.8, 19.08], creativity: [16.3, 17.59], threat: [19, 18.11], defensive: [0.2, 2.8], goal_involvement: [0, 3.48], finishing: [-0.01, 0.14], save_score: [0, 1] },
    ST: { match_impact: [6, 9.22], influence: [8.2, 21.49], creativity: [10.8, 11.29], threat: [21, 22.13], defensive: [0.2, 2.8], goal_involvement: [0, 3.92], finishing: [-0.02, 0.15], save_score: [0, 1] },
};

async function main() {
    console.log("Starting DB backfill for rating_reference_stats...");

    // Remove old '2025-26' season refs entirely
    let { error: delError } = await supabase
        .from('rating_reference_stats')
        .delete()
        .eq('season', '2025-26');
        
    if (delError) {
        console.error("Error deleting old refs:", delError);
    } else {
        console.log("Successfully wiped previous estimates for 2025-26.");
    }

    // Build insert array
    const inserts = [];
    for (const [pos, comps] of Object.entries(DEFAULT_REFERENCE_STATS)) {
        for (const [comp, vals] of Object.entries(comps)) {
            inserts.push({
                season: '2025-26',
                position_group: pos,
                component: comp,
                median: vals[0],
                stddev: vals[1]
            });
        }
    }

    console.log(`Inserting ${inserts.length} exact components...`);
    let { error: insertError } = await supabase
        .from('rating_reference_stats')
        .insert(inserts);

    if (insertError) {
        console.error("Error inserting matching seed values:", insertError);
        process.exit(1);
    }

    console.log("Successfully updated rating_reference_stats with 3-season empirical data!");
}

main().catch(console.error);
