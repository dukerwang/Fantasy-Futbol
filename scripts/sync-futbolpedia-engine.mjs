#!/usr/bin/env node
/**
 * Copy @futbolpedia/engine from the Futbolpedia repo into Gaffa's vendored package.
 *
 * Usage:
 *   node scripts/sync-futbolpedia-engine.mjs
 *   node scripts/sync-futbolpedia-engine.mjs --source /path/to/Futbolpedia/packages/engine
 */
import { cpSync, rmSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const gaffaRoot = resolve(__dirname, '..');
const defaultSource = resolve(gaffaRoot, '../Futbolpedia/packages/engine');
const dest = resolve(gaffaRoot, 'packages/futbolpedia-engine');

const sourceArg = process.argv.indexOf('--source');
const source =
  sourceArg >= 0 ? resolve(process.argv[sourceArg + 1]) : defaultSource;

if (!existsSync(source)) {
  console.error(`Source engine not found: ${source}`);
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
cpSync(source, dest, { recursive: true });
console.log(`Synced ${source} -> ${dest}`);
