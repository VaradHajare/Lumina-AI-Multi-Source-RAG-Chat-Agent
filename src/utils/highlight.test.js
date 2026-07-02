import { describe, it, expect } from 'vitest';
import { locatePassage } from './highlight.js';

describe('locatePassage', () => {
  const source = '[Page 1]\nThe quick brown fox\njumps over the lazy dog.\n\nAnother paragraph here.';

  it('matches across collapsed whitespace / newlines and returns original slices', () => {
    const res = locatePassage(source, 'The quick brown fox jumps over the lazy dog.');
    expect(res).not.toBeNull();
    expect(res.mark).toContain('quick brown fox');
    expect(res.mark).toContain('lazy dog');
    expect(res.before + res.mark + res.after).toBe(source);
  });

  it('anchors on a prefix when the full passage is not present', () => {
    const res = locatePassage(source, 'The quick brown fox is a totally different ending that will not match');
    expect(res).not.toBeNull();
    expect(res.before + res.mark + res.after).toBe(source);
    expect(res.mark.startsWith('The quick brown fox')).toBe(true);
  });

  it('returns null when nothing matches', () => {
    expect(locatePassage(source, 'completely unrelated content xyz')).toBeNull();
  });

  it('returns null for empty/too-short input', () => {
    expect(locatePassage('', 'anything')).toBeNull();
    expect(locatePassage(source, 'short')).toBeNull();
  });
});
