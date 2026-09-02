import { describe, expect, it } from 'vitest';
import { decodeHtmlEntities } from '../pipeline/synthesize';

describe('decodeHtmlEntities', () => {
  it('decodes the entity that actually shipped', () => {
    expect(decodeHtmlEntities('while Hugo Ekitik&eacute; remains sidelined')).toBe(
      'while Hugo Ekitiké remains sidelined',
    );
  });

  it('handles the accents Premier League squads actually carry', () => {
    expect(decodeHtmlEntities('Guimar&atilde;es, Mu&ntilde;oz, Gro&szlig;, &Oslash;degaard'))
      .toBe('Guimarães, Muñoz, Groß, Ødegaard');
  });

  it('decodes numeric and hex references', () => {
    expect(decodeHtmlEntities('Kadi&#111;&#x11F;lu')).toBe('Kadioğlu');
  });

  it('leaves ordinary prose and unknown entities untouched', () => {
    expect(decodeHtmlEntities('He started 37 of 38 & scored twice.')).toBe(
      'He started 37 of 38 & scored twice.',
    );
    expect(decodeHtmlEntities('a &notarealentity; here')).toBe('a &notarealentity; here');
  });
});
