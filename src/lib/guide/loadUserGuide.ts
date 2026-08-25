import { readFile } from 'fs/promises';
import path from 'path';

/**
 * Reads docs/USER_GUIDE.md from the repo. That file stays the single source
 * of truth — the /guide page does not keep a second copy of the rules.
 */
export async function loadUserGuide(): Promise<{ markdown: string } | { error: string }> {
  const filePath = path.join(process.cwd(), 'docs', 'USER_GUIDE.md');
  try {
    const markdown = await readFile(filePath, 'utf8');
    if (!markdown.trim()) return { error: 'The user guide is empty.' };
    return { markdown };
  } catch (err) {
    console.error('[loadUserGuide] failed:', err);
    return { error: 'Could not load the user guide.' };
  }
}
