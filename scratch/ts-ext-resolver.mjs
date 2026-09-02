// Lets plain `node --experimental-strip-types` load the app's TS modules.
// Handles the two things raw Node ESM won't do that Next does:
//   • extensionless relative imports (`./matchRating`)
//   • the `@/` path alias from tsconfig
// Registered via scratch/register-ts.mjs.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SRC = path.resolve(process.cwd(), 'src');

async function tryResolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    if (err?.code !== 'ERR_MODULE_NOT_FOUND' && err?.code !== 'ERR_UNSUPPORTED_DIR_IMPORT') throw err;
    return null;
  }
}

export async function resolve(specifier, context, next) {
  if (specifier.startsWith('@/')) {
    const base = pathToFileURL(path.join(SRC, specifier.slice(2))).href;
    for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, base]) {
      const hit = await tryResolve(candidate, context, next);
      if (hit) return hit;
    }
  }

  const direct = await tryResolve(specifier, context, next);
  if (direct) return direct;

  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    for (const ext of ['.ts', '.tsx', '/index.ts']) {
      const hit = await tryResolve(`${specifier}${ext}`, context, next);
      if (hit) return hit;
    }
  }

  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url.endsWith('.json')) {
    return next(url, { ...context, importAttributes: { ...context.importAttributes, type: 'json' } });
  }
  return next(url, context);
}
