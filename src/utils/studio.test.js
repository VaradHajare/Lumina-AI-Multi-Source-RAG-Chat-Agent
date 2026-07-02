import { describe, it, expect } from 'vitest';
import { normalizeQuestions, normalizeStudyKit } from './studio.js';

describe('normalizeQuestions', () => {
  it('trims, drops empties, and caps at 4', () => {
    const out = normalizeQuestions({
      questions: [' What is X? ', '', 'Why Y?', 'How Z?', 'Q4', 'Q5'],
    });
    expect(out).toEqual(['What is X?', 'Why Y?', 'How Z?', 'Q4']);
  });

  it('returns [] for malformed input', () => {
    expect(normalizeQuestions(null)).toEqual([]);
    expect(normalizeQuestions({ questions: 'nope' })).toEqual([]);
  });
});

describe('normalizeStudyKit', () => {
  it('keeps valid flashcards and quiz items', () => {
    const { flashcards, quiz } = normalizeStudyKit({
      flashcards: [
        { front: 'Term', back: 'Def' },
        { front: '', back: 'no front' },
      ],
      quiz: [
        { question: 'Q?', options: ['a', 'b', 'c', 'd'], answerIndex: 2, explanation: 'because' },
      ],
    });
    expect(flashcards).toEqual([{ front: 'Term', back: 'Def' }]);
    expect(quiz).toHaveLength(1);
    expect(quiz[0].answerIndex).toBe(2);
  });

  it('drops quiz items that do not have exactly 4 options', () => {
    const { quiz } = normalizeStudyKit({
      quiz: [
        { question: 'Q1', options: ['a', 'b', 'c'], answerIndex: 0 },
        { question: 'Q2', options: ['a', 'b', 'c', 'd'], answerIndex: 1 },
      ],
    });
    expect(quiz).toHaveLength(1);
    expect(quiz[0].question).toBe('Q2');
  });

  it('drops quiz items with an out-of-range answerIndex', () => {
    const { quiz } = normalizeStudyKit({
      quiz: [{ question: 'Q', options: ['a', 'b', 'c', 'd'], answerIndex: 9 }],
    });
    expect(quiz).toHaveLength(0);
  });
});
