/**
 * Non-decomposable letters. NFD splits a composed character into a base letter
 * plus combining marks, which handles é, ñ, ö, ğ, ć and the rest. These seven
 * are different: they are separate letters in their own alphabets, not a base
 * plus a mark, so NFD leaves them untouched and a regex over the combining
 * block never sees them.
 *
 * Every entry is a current Premier League name, not a hypothetical: Ødegaard,
 * Nørgaard, Jørgen Strand Larsen and Hjertø-Dahl (ø), Groß (ß), Đorđe
 * Petrović (đ), Ferdi Kadıoğlu (the dotless ı — its ğ decomposes, its ı does
 * not). Without this map, typing "odegaard" finds nothing.
 */
const LETTERS: Record<string, string> = {
  ø: 'o', đ: 'd', ł: 'l', ı: 'i', ß: 'ss',
  æ: 'ae', œ: 'oe', ð: 'd', þ: 'th', ħ: 'h',
};

/**
 * Case- and diacritic-insensitive search key.
 *
 * Typing "munoz" has to find "Muñoz" and "odegaard" has to find "Ødegaard" — a
 * manager types what is on their keyboard, not what is in the feed. U+0300 to
 * U+036F is the combining-mark block, so stripping it after NFD leaves the
 * base letters behind; LETTERS covers what NFD cannot reach.
 *
 * Fold both sides of a comparison. Folding only the query still fails, because
 * the stored name is the accented one.
 */
export function fold(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[øđłıßæœðþħ]/g, (c) => LETTERS[c] ?? c)
    .trim();
}
