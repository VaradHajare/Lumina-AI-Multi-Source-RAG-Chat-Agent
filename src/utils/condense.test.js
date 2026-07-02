import { describe, it, expect } from 'vitest';
import { needsCondensing, formatHistory } from './condense.js';

const history = [
  { role: 'user', content: 'What are the phases of the SDLC?' },
  { role: 'assistant', content: '1. Planning 2. Design 3. Implementation 4. Testing 5. Deployment' },
];

describe('needsCondensing', () => {
  it('never condenses without history', () => {
    expect(needsCondensing('explain the second one', [])).toBe(false);
    expect(needsCondensing('explain the second one', undefined)).toBe(false);
  });

  it('detects anaphoric follow-ups', () => {
    expect(needsCondensing('explain the second one in detail', history)).toBe(true);
    expect(needsCondensing('why is that phase important', history)).toBe(true);
    expect(needsCondensing('do they overlap in practice', history)).toBe(true);
  });

  it('detects elliptical follow-ups', () => {
    expect(needsCondensing('what about deployment?', history)).toBe(true);
    expect(needsCondensing('and the risks?', history)).toBe(true);
    expect(needsCondensing('why?', history)).toBe(true);
  });

  it('detects very short questions', () => {
    expect(needsCondensing('more examples please', history)).toBe(true);
  });

  it('passes standalone questions through', () => {
    expect(
      needsCondensing('What testing strategies does the document recommend for microservices?', history)
    ).toBe(false);
  });

  it('handles empty input', () => {
    expect(needsCondensing('', history)).toBe(false);
    expect(needsCondensing(null, history)).toBe(false);
  });
});

describe('formatHistory', () => {
  it('formats roles and keeps only the most recent turns', () => {
    const long = Array.from({ length: 10 }, (_, i) => ({
      role: i % 2 ? 'assistant' : 'user',
      content: `turn ${i}`,
    }));
    const out = formatHistory(long, 4);
    expect(out.split('\n')).toHaveLength(4);
    expect(out).toContain('User: turn 6');
    expect(out).toContain('Assistant: turn 9');
    expect(out).not.toContain('turn 5');
  });

  it('skips attachment-only and empty turns', () => {
    const out = formatHistory([
      { role: 'user', content: '' },
      { role: 'system', content: 'ignored' },
      { role: 'user', content: 'hello' },
    ]);
    expect(out).toBe('User: hello');
  });

  it('truncates very long turns', () => {
    const out = formatHistory([{ role: 'assistant', content: 'x'.repeat(2000) }]);
    expect(out.length).toBeLessThan(600);
  });
});
