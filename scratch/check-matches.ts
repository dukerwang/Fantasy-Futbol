import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import fs from 'fs';
import stringSimilarity from 'string-similarity';

dotenv.config({ path: '.env.local' });

// simple mocks of helper functions
function normalizeName(name: string) {
  return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z\s]/g, "").toLowerCase().trim();
}

function firstLast(name: string): string {
  const parts = name.split(/\s+/);
  if (parts.length <= 2) return name;
  return `${parts[0]} ${parts[parts.length - 1]}`;
}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

(async () => {
  const { data: dbPlayers } = await supabase.from('players').select('id, name, web_name').eq('is_active', true);
  if (!dbPlayers) return;

  const nameMap = new Map<string, any>();
  const nameList: string[] = [];

  function addToMap(key: string | null, player: any) {
    if (!key) return;
    if (!nameMap.has(key)) {
      nameMap.set(key, player);
      nameList.push(key);
    }
  }

  for (const p of dbPlayers) {
    const normFull = normalizeName(p.name);
    const normWeb = p.web_name ? normalizeName(p.web_name) : null;
    addToMap(normFull, p);
    addToMap(normWeb, p);
    addToMap(firstLast(normFull), p);
    if (normWeb) addToMap(firstLast(normWeb), p);
  }

  const scraped = JSON.parse(fs.readFileSync('scraped-sofifa.json', 'utf8'));
  let matched = 0;
  let total = 0;
  const unmatched: any[] = [];

  for (const t of scraped) {
    for (const sp of t.players || []) {
      total++;
      // MATCHING LOGIC (WITHOUT BUG FIX first, then WITH bug fix)
      const fullNameBuggy = [sp.firstName, sp.lastName].filter(Boolean).join(' ');
      const common = sp.commonName || '';
      const normFullBuggy = normalizeName(fullNameBuggy);
      const normCommon = normalizeName(common);

      const candidatesBuggy = Array.from(new Set([
        normFullBuggy, normCommon,
        firstLast(normFullBuggy), firstLast(normCommon),
      ])).filter(Boolean) as string[];

      let dbMatch = null;
      for (const c of candidatesBuggy) {
        dbMatch = nameMap.get(c) ?? null;
        if (dbMatch) break;
      }

      if (!dbMatch) {
        for (const candidate of candidatesBuggy) {
          if (nameList.length === 0) continue;
          const { bestMatch } = stringSimilarity.findBestMatch(candidate, nameList);
          if (bestMatch.rating > 0.82) {
            dbMatch = nameMap.get(bestMatch.target) ?? null;
            break;
          }
        }
      }

      if (dbMatch) {
        matched++;
      } else {
        unmatched.push({ commonName: sp.commonName, fullName: sp.fullName });
      }
    }
  }

  console.log(`Matched (Buggy): ${matched}/${total}`);
  console.log("Some unmatched examples under buggy name mapping:", unmatched.slice(0, 20));
})();
