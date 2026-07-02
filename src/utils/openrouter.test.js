import { describe, it, expect } from 'vitest';
import { parseSSEChunk } from './openrouter.js';

const frame = (content) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n`;

describe('parseSSEChunk', () => {
  it('extracts content deltas from complete frames', () => {
    const { deltas, rest } = parseSSEChunk(`${frame('Hello')}${frame(' world')}`);
    expect(deltas).toEqual(['Hello', ' world']);
    expect(rest).toBe('');
  });

  it('retains a trailing partial frame as rest', () => {
    const buffer = `${frame('done')}data: {"choices":[{"delta":{"cont`;
    const { deltas, rest } = parseSSEChunk(buffer);
    expect(deltas).toEqual(['done']);
    expect(rest).toContain('data: {"choices"');
  });

  it('ignores [DONE] and comment/blank lines', () => {
    const buffer = `: keep-alive\n\n${frame('hi')}data: [DONE]\n`;
    const { deltas } = parseSSEChunk(buffer);
    expect(deltas).toEqual(['hi']);
  });

  it('skips frames with empty delta content', () => {
    const { deltas } = parseSSEChunk(`${frame('')}${frame('x')}`);
    expect(deltas).toEqual(['x']);
  });
});
