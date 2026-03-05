/**
 * seed_reference_stats.ts
 *
 * Downloads the vaastav/Fantasy-Premier-League merged_gw.csv (2024-25),
 * computes per-position-group medians and standard deviations for each
 * rating component, and outputs SQL UPDATE statements.
 *
 * Usage:  npx tsx scripts/seed_reference_stats.ts
 */

const CSV_URL =
    "https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/master/data/2024-25/gws/merged_gw.csv";

// ── Position mapping ────────────────────────────────────────────────────

type PositionGroup = "GK" | "DEF" | "MID" | "ATT";

function mapFplPosition(fplPos: string): PositionGroup {
    switch (fplPos) {
        case "GK":
            return "GK";
        case "DEF":
            return "DEF";
        case "MID":
            return "MID";
        case "FWD":
            return "ATT";
        default:
            return "MID";
    }
}

// ── Component raw value calculations ────────────────────────────────────
// These MUST match the formulas in matchRating.ts and sync-ratings/index.ts

interface CsvRow {
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
    row: CsvRow
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
        finishing: g - row.expected_goals, // raw xG outperformance
        save_score:
            mapFplPosition(row.position) === "GK"
                ? row.saves * 2 +
                row.penalties_saved * 5 -
                Math.max(0, gc - xgc) * 2
                : null, // only computed for GKs
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
    const variance =
        arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length;
    return Math.sqrt(variance);
}

// ── CSV parser (minimal, no dependencies) ───────────────────────────────

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

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
    console.log("Downloading merged_gw.csv …");
    const res = await fetch(CSV_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();

    const lines = text.split("\n").filter((l) => l.trim());
    const header = parseCsvLine(lines[0]);

    // Build column index map
    const col = (name: string) => {
        const idx = header.indexOf(name);
        if (idx === -1) throw new Error(`Column '${name}' not found`);
        return idx;
    };

    // Accumulators: posGroup → component → number[]
    const data = new Map<
        PositionGroup,
        Map<RatingComponent, number[]>
    >();
    for (const pg of ["GK", "DEF", "MID", "ATT"] as PositionGroup[]) {
        const m = new Map<RatingComponent, number[]>();
        for (const c of [
            "match_impact",
            "influence",
            "creativity",
            "threat",
            "defensive",
            "goal_involvement",
            "finishing",
            "save_score",
        ] as RatingComponent[]) {
            m.set(c, []);
        }
        data.set(pg, m);
    }

    let totalRows = 0;
    let skippedRows = 0;

    for (let i = 1; i < lines.length; i++) {
        const fields = parseCsvLine(lines[i]);
        if (fields.length < header.length) continue;

        const minutes = parseFloat(fields[col("minutes")]) || 0;
        if (minutes === 0) {
            skippedRows++;
            continue;
        }

        const row: CsvRow = {
            position: fields[col("position")],
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
            expected_goals_conceded:
                parseFloat(fields[col("expected_goals_conceded")]) || 0,
        };

        const pg = mapFplPosition(row.position);
        const raw = computeRawComponents(row);

        for (const [comp, val] of Object.entries(raw)) {
            if (val === null) continue;
            data.get(pg)!.get(comp as RatingComponent)!.push(val);
        }

        totalRows++;
    }

    console.log(
        `\nProcessed ${totalRows} player-match rows (skipped ${skippedRows} with 0 minutes)\n`
    );

    // ── Output results ──────────────────────────────────────────────────

    console.log("═══════════════════════════════════════════════════════");
    console.log("  COMPUTED REFERENCE STATS (2024-25 season)");
    console.log("═══════════════════════════════════════════════════════\n");

    const season = "2025-26";
    const sqlStatements: string[] = [];

    for (const pg of ["GK", "DEF", "MID", "ATT"] as PositionGroup[]) {
        console.log(`── ${pg} ────────────────────────────────────────`);
        const pgMap = data.get(pg)!;

        for (const comp of [
            "match_impact",
            "influence",
            "creativity",
            "threat",
            "defensive",
            "goal_involvement",
            "finishing",
            "save_score",
        ] as RatingComponent[]) {
            const values = pgMap.get(comp)!;
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
                `UPDATE rating_reference_stats SET median = ${med.toFixed(4)}, stddev = ${sd.toFixed(4)}, sample_size = ${n} WHERE position_group = '${pg}' AND component = '${comp}' AND season = '${season}';`
            );
        }
        console.log();
    }

    console.log("\n═══════════════════════════════════════════════════════");
    console.log("  SQL UPDATE STATEMENTS (paste into Supabase SQL editor)");
    console.log("═══════════════════════════════════════════════════════\n");
    console.log(sqlStatements.join("\n"));
    console.log();
}

main().catch(console.error);
