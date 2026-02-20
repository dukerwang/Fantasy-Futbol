import type { GranularPosition } from '@/types';

/**
 * Position overrides for FPL player data.
 *
 * FPL uses 4 positions: GK / DEF / MID / FWD
 * We map them to 9 granular positions: GK CB FB DM CM AM LW RW ST
 *
 * Defaults applied in the sync route:
 *   GK  → GK
 *   DEF → CB   (override here for full-backs)
 *   MID → CM   (override here for DMs, AMs, LWs, RWs)
 *   FWD → ST   (override here for wingers listed as FWD)
 *
 * Keys: `${first_name} ${second_name}`.toLowerCase()
 * Fallback key: web_name.toLowerCase()
 *
 * Last reviewed: 2025-26 season squads (post-Jan 2026 transfer window).
 */
export const FPL_POSITION_OVERRIDES: Record<string, GranularPosition> = {

  // ─── FULL BACKS (FPL: DEF → override to FB) ──────────────────────────────

  // Arsenal
  'ben white': 'RB',
  'oleksandr zinchenko': 'LB',
  'jurrien timber': 'RB',
  'kieran tierney': 'LB',
  'jakub kiwior': 'LB',

  // Aston Villa
  'matty cash': 'RB',
  'lucas digne': 'LB',
  'alex moreno': 'LB',
  'ian maatsen': 'LB',          // now at Aston Villa; key resolves by name

  // Bournemouth
  'adam smith': 'RB',
  'milos kerkez': 'LB',

  // Brentford
  'rico henry': 'LB',
  'mads roerslev': 'RB',
  'aaron hickey': 'RB',

  // Brighton
  'joel veltman': 'RB',
  'pervis estupinan': 'LB',
  'tariq lamptey': 'RB',
  'igor julio': 'LB',

  // Chelsea
  'reece james': 'RB',
  'marc cucurella': 'LB',
  'malo gusto': 'RB',

  // Crystal Palace
  'joel ward': 'RB',
  'tyrick mitchell': 'LB',

  // Everton
  'seamus coleman': 'RB',
  'vitaliy mykolenko': 'LB',

  // Fulham
  'kenny tete': 'RB',
  'antonee robinson': 'LB',
  'josh wilson-esbrand': 'LB',

  // Ipswich (relegated 2024-25 — entries kept for players who may have joined PL clubs)
  'leif davis': 'LB',
  'harry clarke': 'RB',

  // Leicester (relegated 2024-25 — entries kept for players who may have joined PL clubs)
  'ricardo pereira': 'RB',
  'james justin': 'RB',
  'victor kristiansen': 'LB',

  // Liverpool
  'andrew robertson': 'LB',
  'conor bradley': 'RB',
  'joe gomez': 'RB',            // also plays CB
  'kostas tsimikas': 'LB',
  'tino livramento': 'RB',

  // Man City
  'kyle walker': 'RB',
  'josko gvardiol': 'LB',
  'rico lewis': 'RB',

  // Man United
  'diogo dalot': 'RB',
  'luke shaw': 'LB',
  'tyrell malacia': 'LB',

  // Newcastle
  'kieran trippier': 'RB',
  'dan burn': 'LB',

  // Nottm Forest
  'neco williams': 'RB',
  'ola aina': 'RB',

  // Southampton (relegated 2024-25 — entries kept for players who may have joined PL clubs)
  'kyle walker-peters': 'RB',
  'ryan manning': 'LB',

  // Spurs
  'pedro porro': 'RB',
  'destiny udogie': 'LB',
  'ben davies': 'LB',
  'emerson royal': 'RB',

  // West Ham
  'ben johnson': 'RB',
  'emerson palmieri': 'LB',
  'vladimir coufal': 'RB',

  // Wolves
  'nelson semedo': 'RB',
  'rayan ait-nouri': 'LB',
  'jonny otto': 'RB',

  // ─── DEFENSIVE MIDFIELDERS (FPL: MID → override to DM) ──────────────────

  'declan rice': 'DM',           // Arsenal
  'thomas partey': 'DM',        // Arsenal
  'boubacar kamara': 'DM',      // Aston Villa
  'amadou onana': 'DM',         // Aston Villa
  'lewis cook': 'DM',           // Bournemouth
  'frank onyeka': 'DM',         // Brentford
  'moises caicedo': 'DM',       // Chelsea
  'romeo lavia': 'DM',          // Chelsea
  'adam wharton': 'DM',         // Crystal Palace
  'will hughes': 'DM',          // Crystal Palace
  'idrissa gueye': 'DM',        // Everton
  'abdoulaye doucoure': 'DM',   // Everton — also listed CM, DM fits better
  'harrison reed': 'DM',        // Fulham
  'wilfred ndidi': 'DM',        // Leicester (relegated); keep if moved to PL club
  'nampalys mendy': 'DM',       // Leicester (relegated); keep if moved to PL club
  'wataru endo': 'DM',          // Liverpool
  'ryan gravenberch': 'DM',     // Liverpool (played as DM under Slot)
  'rodri': 'DM',                // Man City
  'mateo kovacic': 'DM',        // Man City
  'casemiro': 'DM',             // Man United
  'manuel ugarte': 'DM',        // Man United
  'bruno guimaraes': 'DM',      // Newcastle
  'joe willock': 'CM',          // Newcastle — more CM than DM
  'ibrahim sangare': 'DM',      // Nottm Forest
  'orel mangala': 'DM',         // Nottm Forest
  'danilo': 'DM',               // Nottm Forest
  'yves bissouma': 'DM',        // Spurs
  'pape matar sarr': 'DM',      // Spurs
  'tomas soucek': 'DM',         // West Ham
  'edson alvarez': 'DM',        // West Ham
  'joao gomes': 'DM',           // Wolves
  'mario lemina': 'DM',         // Wolves
  'tom cairney': 'DM',          // Fulham

  // ─── ATTACKING MIDFIELDERS (FPL: MID → override to AM) ──────────────────

  'martin odegaard': 'AM',      // Arsenal (see web_name fallback 'ødegaard' below)
  'kai havertz': 'AM',          // Arsenal (plays as #10 / false 9)
  'emiliano buendia': 'AM',     // Aston Villa
  'jacob ramsey': 'AM',         // Aston Villa
  'dango ouattara': 'AM',       // Bournemouth
  'justin kluivert': 'AM',      // Bournemouth
  'cole palmer': 'AM',          // Chelsea
  'christopher nkunku': 'AM',   // Chelsea
  'eberechi eze': 'AM',         // Crystal Palace
  'ismaila sarr': 'AM',         // Crystal Palace (can play LW too)
  'pascal gross': 'CM',         // Brighton — versatile CM, keep as CM
  'facundo buonanotte': 'AM',   // Brighton
  'mahmoud dahoud': 'CM',       // Brighton
  'billy gilmour': 'DM',        // Brighton — DM/CM
  'andreas pereira': 'AM',      // Fulham
  'willian': 'AM',              // Fulham
  'morgan gibbs-white': 'AM',   // Nottm Forest
  'elliot anderson': 'CM',      // Nottm Forest
  'james maddison': 'AM',       // Spurs
  'lucas paqueta': 'AM',        // West Ham
  'matheus cunha': 'AM',        // Wolves — AM/false 9
  'dominik szoboszlai': 'AM',   // Liverpool
  // harvey elliott handled in RW section below
  'bernardo silva': 'AM',       // Man City
  'bruno fernandes': 'AM',      // Man United
  'mason mount': 'AM',          // Man United
  'sandro tonali': 'CM',        // Newcastle
  'miguel almiron': 'RW',       // Newcastle
  'john mcginn': 'CM',          // Aston Villa — box-to-box CM
  'youri tielemans': 'CM',      // Aston Villa

  // ─── LEFT WINGERS (FPL: MID or FWD → LW) ────────────────────────────────

  'gabriel martinelli': 'LW',   // Arsenal
  'leandro trossard': 'LW',     // Arsenal
  'leon bailey': 'LW',          // Aston Villa
  'morgan rogers': 'LW',        // Aston Villa
  'kaoru mitoma': 'LW',         // Brighton
  'raheem sterling': 'LW',      // Chelsea
  'dwight mcneil': 'LW',        // Everton
  'jack harrison': 'LW',        // Everton
  'demarai gray': 'LW',         // Everton
  'manor solomon': 'LW',        // Fulham (loan from Spurs)
  'luis diaz': 'LW',            // Liverpool
  'cody gakpo': 'LW',           // Liverpool
  'jack grealish': 'LW',        // Man City
  'jeremy doku': 'LW',          // Man City (primarily left)
  'marcus rashford': 'LW',      // Man United
  'alejandro garnacho': 'LW',   // Man United
  'anthony gordon': 'LW',       // Newcastle
  'harvey barnes': 'LW',        // Newcastle
  'callum hudson-odoi': 'LW',   // Nottm Forest
  'son heung-min': 'LW',        // Spurs
  'michail antonio': 'ST',      // West Ham — FWD, keep ST
  'hwang hee-chan': 'LW',       // Wolves
  'kevin schade': 'LW',         // Brentford
  'fabio carvalho': 'LW',       // Brentford
  'pedro neto': 'LW',           // Chelsea (ex-Wolves)
  'diogo jota': 'LW',           // Liverpool — plays LW and ST
  'crysencio summerville': 'LW', // West Ham
  // jarrod bowen defined in RW section below

  // ─── RIGHT WINGERS (FPL: MID or FWD → RW) ───────────────────────────────

  'bukayo saka': 'RW',          // Arsenal
  'antoine semenyo': 'RW',      // Bournemouth
  'bryan mbeumo': 'RW',         // Man United (joined from Brentford 2025)
  'simon adingra': 'RW',        // Brighton
  'noni madueke': 'RW',         // Chelsea
  'adama traore': 'RW',         // Fulham / Wolves
  'jordan ayew': 'RW',          // Crystal Palace
  'jesper lindstrom': 'RW',     // Everton
  'harvey elliott': 'RW',       // Liverpool
  'phil foden': 'RW',           // Man City (plays right, AM too)
  'savinho': 'RW',              // Man City
  'antony': 'RW',               // Man United
  'dejan kulusevski': 'RW',     // Spurs
  'brennan johnson': 'RW',      // Spurs
  'bryan gil': 'RW',            // Spurs
  'jarrod bowen': 'RW',         // West Ham (plays on right)
  'mohammed kudus': 'RW',       // West Ham
  'jacob murphy': 'RW',         // Newcastle
  'anthony elanga': 'RW',       // Nottm Forest
  'michael olise': 'RW',        // Crystal Palace / Bayern (if still listed)
  'saul niguez': 'CM',          // Wolves (loan) — CM
  // riyad mahrez removed — at Al-Ahli, not in PL
  // adama traore defined above
  'harry wilson': 'RW',         // Fulham — winger

  // ─── WINGERS LISTED AS FWD in FPL ────────────────────────────────────────
  // FPL sometimes classifies wide attackers as FWD; we correct them here

  'darwin nunez': 'ST',         // Liverpool — FWD, keep ST
  'rasmus hojlund': 'ST',       // Man United
  'jhon duran': 'ST',           // Aston Villa
  'yoane wissa': 'ST',          // Brentford
  'evanilson': 'ST',            // Bournemouth
  'vangelis pavlidis': 'ST',    // Brighton
  'erling haaland': 'ST',       // Man City
  'alexander isak': 'ST',       // Newcastle
  'callum wilson': 'ST',        // Newcastle
  'taiwo awoniyi': 'ST',        // Nottm Forest
  'chris wood': 'ST',           // Nottm Forest
  'dominic solanke': 'ST',      // Spurs
  'richarlison': 'ST',          // Spurs
  'rodrigo muniz': 'ST',        // Fulham
  'raul jimenez': 'ST',         // Fulham
  'dominic calvert-lewin': 'ST', // Everton
  'beto': 'ST',                 // Everton
  'gabriel jesus': 'ST',        // Arsenal
  'eddie nketiah': 'ST',        // Arsenal
  'ollie watkins': 'ST',        // Aston Villa
  'nicolas jackson': 'ST',      // Chelsea
  'armando broja': 'ST',        // Chelsea
  'jean-philippe mateta': 'ST', // Crystal Palace
  'odsonne edouard': 'ST',      // Crystal Palace
  'joao pedro': 'ST',           // Brighton
  'danny welbeck': 'ST',        // Brighton
  'evan ferguson': 'ST',        // Brighton

  // ─── 2025-26 NEW ARRIVALS ─────────────────────────────────────────────────

  'mohamed salah': 'RW',        // Liverpool — was missing from overrides!
  'florian wirtz': 'AM',        // Liverpool (joined from Leverkusen 2025)
  'omar marmoush': 'LW',        // Man City (joined Jan 2025)
  'rayan cherki': 'AM',         // Man City
  'xavi simons': 'AM',          // Spurs
  'mathys tel': 'AM',           // Spurs (joined from Bayern)
  'amad diallo': 'RW',          // Man Utd
  'federico chiesa': 'RW',      // Liverpool
  'jamie bynoe-gittens': 'LW',  // Chelsea (joined from Dortmund)
  'alexis mac allister': 'DM',  // Liverpool — DM under Slot

  // Leeds (promoted 2025-26)
  'wilfried gnonto': 'LW',
  'daniel james': 'LW',
  'noah okafor': 'LW',
  'brenden aaronson': 'AM',
  'ethan ampadu': 'DM',
  'pascal struijk': 'LB',       // Leeds LB
  'joe rodon': 'CB',            // Leeds CB (already defaults, explicit for clarity)

  // Sunderland (promoted 2025-26)
  'granit xhaka': 'DM',
  'patrick roberts': 'RW',
  'habib diarra': 'AM',

  // Burnley (promoted 2025-26)
  'james ward-prowse': 'CM',    // Set-piece specialist / CM
  'lesley ugochukwu': 'DM',     // On loan; DM
  'jacob bruun larsen': 'RW',

  // ─── WEB_NAME FALLBACK KEYS ───────────────────────────────────────────────
  // FPL stores many names with accents or compound surnames.
  // The resolver tries fullKey first, then webKey (web_name.toLowerCase()).
  // These entries handle cases where the full-name key above doesn't match.

  'ødegaard': 'AM',             // Martin Ødegaard (FPL full: "Martin Ødegaard")
  'luis díaz': 'LW',            // Luis Díaz Marulanda (FPL full: "Luis Díaz Marulanda")
  'cunha': 'AM',                // Matheus Cunha (FPL full: "Matheus Santos Carneiro da Cunha")
  'neto': 'LW',                 // Pedro Neto (FPL full: "Pedro Lomba Neto")
  'b.fernandes': 'AM',          // Bruno Fernandes (FPL full: "Bruno Borges Fernandes")
  'doku': 'LW',                 // Jérémy Doku (FPL full: "Jérémy Doku")
  'martinelli': 'LW',           // Gabriel Martinelli (FPL full: "Gabriel Martinelli Silva")
  'mitoma': 'LW',               // Kaoru Mitoma (FPL uses surname-first: "Mitoma Kaoru")
  'rodrigo': 'DM',              // Rodri (FPL web: "Rodrigo") — distinct from R.Muniz
  'bruno g.': 'DM',             // Bruno Guimarães (FPL web: "Bruno G.")
  'mac allister': 'DM',         // Alexis Mac Allister (FPL web: "Mac Allister")
  'm.salah': 'RW',              // Mohamed Salah backup (FPL web: "M.Salah")
  'estêvão': 'RW',              // Estêvão (Chelsea; FPL full: "Estêvão Almeida de Oliveira Gonçalves")
  'traoré': 'RW',               // Bertrand Traoré — Sunderland (FPL web: "Traoré")
  'gündoğan': 'CM',             // İlkay Gündoğan (FPL web: "Gündoğan")
};

/**
 * Default positions when FPL element_type has no override.
 */
export const FPL_DEFAULT_POSITION: Record<number, GranularPosition> = {
  1: 'GK',
  2: 'CB',
  3: 'CM',
  4: 'ST',
};

/**
 * Resolve granular position for an FPL player element.
 * Tries full name first, then web_name as fallback.
 */
export function resolvePosition(
  firstName: string,
  secondName: string,
  webName: string,
  elementType: number
): GranularPosition {
  const fullKey = `${firstName} ${secondName}`.toLowerCase();
  const webKey = webName.toLowerCase();

  return (
    FPL_POSITION_OVERRIDES[fullKey] ??
    FPL_POSITION_OVERRIDES[webKey] ??
    FPL_DEFAULT_POSITION[elementType] ??
    'CM'
  );
}
