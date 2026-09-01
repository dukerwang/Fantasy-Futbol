import { describe, it, expect } from 'vitest';
import { fold } from '../fold';

/** Substring match, as the stats, players and listings filters do it. */
const finds = (query: string, name: string) => fold(name).includes(fold(query));

/** Word-start prefix, as the draft rooms do it. */
const findsByPrefix = (query: string, name: string) =>
  fold(name).split(/\s+/).some((word) => word.startsWith(fold(query)));

describe('fold', () => {
  it('finds a name typed without its diacritics', () => {
    // Every pair is a real current Premier League player.
    const cases: [string, string][] = [
      ['munoz', 'Víctor Muñoz'],
      ['rodriguez', 'Álvaro Rodríguez'],
      ['guimaraes', 'Bruno Guimarães'],
      ['diakite', 'Bafodé Diakité'],
      ['toure', 'Bazoumana Touré'],
      ['savio', 'Sávio'],
      ['omur', 'Abdülkadir Ömür'],
      ['kinsky', 'Antonín Kinský'],
      ['caoimhin', 'Caoimhín Kelleher'],
    ];
    for (const [q, name] of cases) {
      expect(finds(q, name), `${q} -> ${name}`).toBe(true);
      expect(findsByPrefix(q, name), `${q} -> ${name} (prefix)`).toBe(true);
    }
  });

  it('handles letters NFD cannot decompose', () => {
    // These fail on NFD alone — they are separate letters, not base + mark.
    const cases: [string, string][] = [
      ['odegaard', 'Martin Ødegaard'],
      ['norgaard', 'Christian Nørgaard'],
      ['jorgen', 'Jørgen Strand Larsen'],
      ['hjerto', 'Jens Hjertø-Dahl'],
      ['gross', 'Pascal Groß'],
      ['dorde', 'Đorđe Petrović'],
      ['kadioglu', 'Ferdi Kadıoğlu'],
    ];
    for (const [q, name] of cases) {
      expect(finds(q, name), `${q} -> ${name}`).toBe(true);
    }
  });

  it('still matches when the query carries the accent', () => {
    expect(finds('Muñoz', 'Víctor Muñoz')).toBe(true);
    expect(finds('Ødegaard', 'Martin Ødegaard')).toBe(true);
  });

  it('keeps the draft rooms word-start, so "es" does not match mid-word', () => {
    // Guarding the fix in DraftRoom.tsx: .includes() matched "es" against the
    // middle of Magalhães and Guimarães, which is not what typing "es" means.
    expect(findsByPrefix('es', 'Bruno Guimarães')).toBe(false);
    expect(findsByPrefix('es', 'Gabriel Magalhães')).toBe(false);
  });

  it('is empty for nullish input', () => {
    expect(fold(null)).toBe('');
    expect(fold(undefined)).toBe('');
    expect(fold('')).toBe('');
  });
});
