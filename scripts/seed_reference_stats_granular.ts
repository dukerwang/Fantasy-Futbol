/**
 * seed_reference_stats_granular.ts
 *
 * Downloads the vaastav/Fantasy-Premier-League merged_gw.csv (2024-25),
 * cross-references with our Supabase players table to get granular positions,
 * and computes per-GRANULAR-position medians and stddevs for each
 * rating component. Outputs SQL statements to populate rating_reference_stats.
 *
 * Usage:  npx tsx scripts/seed_reference_stats_granular.ts
 *
 * Requires SUPABASE_URL and SUPABASE_ANON_KEY in .env.local
 */

import { readFileSync } from "fs";
import { resolve } from "path";

// Load .env.local manually
const envPath = resolve(process.cwd(), ".env.local");
const envContent = readFileSync(envPath, "utf8");
for (const line of envContent.split("\n")) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
}

const CSV_URL =
    "https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/master/data/2024-25/gws/merged_gw.csv";

// ── Position types ──────────────────────────────────────────────────────

type GranularPosition = "GK" | "CB" | "LB" | "RB" | "DM" | "CM" | "LM" | "RM" | "AM" | "LW" | "RW" | "ST";

const ALL_POSITIONS: GranularPosition[] = ["GK", "CB", "LB", "RB", "DM", "CM", "LM", "RM", "AM", "LW", "RW", "ST"];

// Fallback: if a player isn't in our DB, use FPL position group → a default granular position
function fallbackPosition(fplPos: string): GranularPosition {
    switch (fplPos) {
        case "GK": return "GK";
        case "DEF": return "CB"; // conservative fallback
        case "MID": return "CM";
        case "FWD": return "ST";
        default: return "CM";
    }
}

// ── Component raw value calculations ────────────────────────────────────

interface CsvRow {
    name: string;
    position: string;
    minutes: number;
    bps: number;
    influence: number;
    creativity: number;
    threat: number;
    goals_scored: number;
    assists: number;
    clean_sheets: number;
    goals_conceded: number;
    saves: number;
    penalties_saved: number;
    expected_goals: number;
    expected_assists: number;
    expected_goals_conceded: number;
}

type RatingComponent =
    | "match_impact"
    | "influence"
    | "creativity"
    | "threat"
    | "defensive"
    | "goal_involvement"
    | "finishing"
    | "save_score";

function computeRawComponents(
    row: CsvRow,
    isGK: boolean,
): Record<RatingComponent, number | null> {
    const g = row.goals_scored;
    const a = row.assists;
    const gc = row.goals_conceded;
    const xgc = row.expected_goals_conceded;
    const cs = row.clean_sheets > 0 && row.minutes >= 60;

    return {
        match_impact: Math.max(0, row.bps - g * 12 - a * 9),
        influence: row.influence,
        creativity: row.creativity,
        threat: row.threat,
        defensive:
            (cs ? 4 : 0) +
            Math.max(0, xgc - gc) * 2 -
            Math.max(0, gc - xgc),
        goal_involvement: g * 6 + a * 4,
        finishing: g - row.expected_goals,
        save_score: isGK
            ? row.saves * 2 + row.penalties_saved * 5 - Math.max(0, gc - xgc) * 2
            : null,
    };
}

// ── Statistics helpers ──────────────────────────────────────────────────

function median(arr: number[]): number {
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
}

function stddev(arr: number[]): number {
    const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
    const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length;
    return Math.sqrt(variance);
}

// ── CSV parser ──────────────────────────────────────────────────────────

function parseCsvLine(line: string): string[] {
    const fields: string[] = [];
    let current = "";
    let inQuotes = false;
    for (const ch of line) {
        if (ch === '"') {
            inQuotes = !inQuotes;
        } else if (ch === "," && !inQuotes) {
            fields.push(current);
            current = "";
        } else {
            current += ch;
        }
    }
    fields.push(current);
    return fields;
}

// ── Name normalization for matching ─────────────────────────────────────

function normalizeName(name: string): string {
    return name
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // strip accents
        .replace(/[^a-z\s]/g, "") // strip non-alpha
        .trim();
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
        throw new Error("Missing SUPABASE_URL or SUPABASE_ANON_KEY in .env.local");
    }

    // ── Step 1: Fetch players from DB ───────────────────────────────────
    console.log("Fetching players from Supabase...");

    const allPlayers: { name: string; primary_position: string }[] = [];
    let offset = 0;
    const batchSize = 500;

    while (true) {
        const res = await fetch(
            `${supabaseUrl}/rest/v1/players?select=name,primary_position&primary_position=not.is.null&limit=${batchSize}&offset=${offset}`,
            {
                headers: {
                    apikey: supabaseKey,
                    Authorization: `Bearer ${supabaseKey}`,
                },
            }
        );
        if (!res.ok) throw new Error(`Supabase API error: ${res.status}`);
        const batch = await res.json();
        allPlayers.push(...batch);
        if (batch.length < batchSize) break;
        offset += batchSize;
    }

    console.log(`  Found ${allPlayers.length} players with positions`);

    // Build normalized name → granular position map
    const nameToPosition = new Map<string, GranularPosition>();
    for (const p of allPlayers) {
        const norm = normalizeName(p.name);
        nameToPosition.set(norm, p.primary_position as GranularPosition);
        // Also index by last word(s) for partial matching
        const parts = norm.split(/\s+/);
        if (parts.length >= 2) {
            nameToPosition.set(parts[parts.length - 1], p.primary_position as GranularPosition);
        }
    }

    // ── Step 2: Download and parse CSV ──────────────────────────────────
    console.log("Downloading merged_gw.csv...");
    const csvRes = await fetch(CSV_URL);
    if (!csvRes.ok) throw new Error(`HTTP ${csvRes.status}`);
    const text = await csvRes.text();

    const lines = text.split("\n").filter((l) => l.trim());
    const header = parseCsvLine(lines[0]);

    const col = (name: string) => {
        const idx = header.indexOf(name);
        if (idx === -1) throw new Error(`Column '${name}' not found`);
        return idx;
    };

    // ── Step 3: Process rows ────────────────────────────────────────────

    // Accumulators: granularPosition → component → number[]
    const data = new Map<GranularPosition, Map<RatingComponent, number[]>>();
    for (const pos of ALL_POSITIONS) {
        const m = new Map<RatingComponent, number[]>();
        for (const c of [
            "match_impact", "influence", "creativity", "threat",
            "defensive", "goal_involvement", "finishing", "save_score",
        ] as RatingComponent[]) {
            m.set(c, []);
        }
        data.set(pos, m);
    }

    let totalRows = 0;
    let matchedByName = 0;
    let fallbackUsed = 0;
    let skippedRows = 0;

    for (let i = 1; i < lines.length; i++) {
        const fields = parseCsvLine(lines[i]);
        if (fields.length < header.length) continue;

        const minutes = parseFloat(fields[col("minutes")]) || 0;
        if (minutes < 60) {
            skippedRows++;
            continue;
        }

        const csvName = fields[col("name")];
        const fplPos = fields[col("position")];

        // Try to find granular position from our DB
        const normName = normalizeName(csvName);
        let granularPos = nameToPosition.get(normName);

        if (!granularPos) {
            // Try last name only
            const parts = normName.split(/\s+/);
            for (let j = parts.length - 1; j >= 0; j--) {
                if (parts[j].length > 2) {
                    granularPos = nameToPosition.get(parts[j]);
                    if (granularPos) break;
                }
            }
        }

        if (granularPos) {
            matchedByName++;
        } else {
            granularPos = fallbackPosition(fplPos);
            fallbackUsed++;
        }

        const row: CsvRow = {
            name: csvName,
            position: fplPos,
            minutes,
            bps: parseFloat(fields[col("bps")]) || 0,
            influence: parseFloat(fields[col("influence")]) || 0,
            creativity: parseFloat(fields[col("creativity")]) || 0,
            threat: parseFloat(fields[col("threat")]) || 0,
            goals_scored: parseFloat(fields[col("goals_scored")]) || 0,
            assists: parseFloat(fields[col("assists")]) || 0,
            clean_sheets: parseFloat(fields[col("clean_sheets")]) || 0,
            goals_conceded: parseFloat(fields[col("goals_conceded")]) || 0,
            saves: parseFloat(fields[col("saves")]) || 0,
            penalties_saved: parseFloat(fields[col("penalties_saved")]) || 0,
            expected_goals: parseFloat(fields[col("expected_goals")]) || 0,
            expected_assists: parseFloat(fields[col("expected_assists")]) || 0,
            expected_goals_conceded: parseFloat(fields[col("expected_goals_conceded")]) || 0,
        };

        const raw = computeRawComponents(row, granularPos === "GK");

        for (const [comp, val] of Object.entries(raw)) {
            if (val === null) continue;
            data.get(granularPos)!.get(comp as RatingComponent)!.push(val);
        }

        totalRows++;
    }

    console.log(
        `\nProcessed ${totalRows} rows (matched: ${matchedByName}, fallback: ${fallbackUsed}, skipped: ${skippedRows})\n`
    );

    // ── Step 4: Output results ──────────────────────────────────────────

    console.log("═══════════════════════════════════════════════════════");
    console.log("  GRANULAR POSITION REFERENCE STATS (2024-25 data)");
    console.log("═══════════════════════════════════════════════════════\n");

    const season = "2025-26";
    const sqlStatements: string[] = [];

    // First, delete old position-group-level stats
    sqlStatements.push(`-- Clear old position-group-level stats`);
    sqlStatements.push(`DELETE FROM rating_reference_stats WHERE season = '${season}';`);
    sqlStatements.push('');

    for (const pos of ALL_POSITIONS) {
        const posMap = data.get(pos)!;
        console.log(`── ${pos} ────────────────────────────────────────`);

        for (const comp of [
            "match_impact", "influence", "creativity", "threat",
            "defensive", "goal_involvement", "finishing", "save_score",
        ] as RatingComponent[]) {
            const values = posMap.get(comp)!;
            if (values.length === 0) {
                console.log(`  ${comp.padEnd(20)} — no data`);
                continue;
            }

            const med = median(values);
            const sd = Math.max(0.1, stddev(values));
            const n = values.length;

            console.log(
                `  ${comp.padEnd(20)} median=${med.toFixed(2).padStart(8)}  stddev=${sd.toFixed(2).padStart(8)}  n=${n}`
            );

            sqlStatements.push(
                `INSERT INTO rating_reference_stats (position_group, component, median, stddev, sample_size, season) VALUES ('${pos}', '${comp}', ${med.toFixed(4)}, ${sd.toFixed(4)}, ${n}, '${season}') ON CONFLICT (position_group, component, season) DO UPDATE SET median = ${med.toFixed(4)}, stddev = ${sd.toFixed(4)}, sample_size = ${n};`
            );
        }
        console.log();
    }

    console.log("\n═══════════════════════════════════════════════════════");
    console.log("  SQL STATEMENTS (paste into Supabase SQL editor)");
    console.log("═══════════════════════════════════════════════════════\n");
    console.log(sqlStatements.join("\n"));
    console.log();
}

main().catch(console.error);
