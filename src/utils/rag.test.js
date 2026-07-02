import { describe, it, expect } from 'vitest';
import {
  chunkSourceText,
  chunkLabel,
  BM25Index,
  cosineSimilarity,
  reciprocalRankFusion,
  hybridRetrieve,
  renumberCitations,
} from './rag.js';

describe('renumberCitations', () => {
  const cites = [
    { ref: 1, label: 'a' },
    { ref: 2, label: 'b' },
    { ref: 5, label: 'e' },
  ];

  it('renumbers to order of first appearance and drops uncited passages', () => {
    const { answer, citations } = renumberCitations('Claim X [2]. Claim Y [5]. More on X [2].', cites);
    expect(answer).toBe('Claim X [1]. Claim Y [2]. More on X [1].');
    expect(citations).toEqual([
      { ref: 1, label: 'b' },
      { ref: 2, label: 'e' },
    ]);
  });

  it('leaves citation-like numbers inside code spans untouched', () => {
    const { answer, citations } = renumberCitations('Use `arr[2]` and see [5].', cites);
    expect(answer).toBe('Use `arr[2]` and see [1].');
    expect(citations).toEqual([{ ref: 1, label: 'e' }]);
  });

  it('ignores hallucinated refs not present in the citation list', () => {
    const { answer, citations } = renumberCitations('Real [1]. Fake [9].', cites);
    expect(answer).toBe('Real [1]. Fake [9].');
    expect(citations).toEqual([{ ref: 1, label: 'a' }]);
  });

  it('keeps the answer and all passages when nothing valid is cited', () => {
    const { answer, citations } = renumberCitations('No citations here.', cites);
    expect(answer).toBe('No citations here.');
    expect(citations).toBe(cites);
  });
});

describe('chunkSourceText', () => {
  it('splits PDF pages with metadata labels', () => {
    const text = `[Page 1]
Introduction to machine learning basics.

[Page 2]
Neural networks use layers of neurons to learn representations from data.
Deep learning extends this with many hidden layers and large datasets.`;

    const chunks = chunkSourceText(text, { targetSize: 120, overlap: 30 });
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].page).toBe(1);
    expect(chunks.some((c) => c.page === 2)).toBe(true);
    expect(chunks[0].label).toBe('Page 1');
  });

  it('preserves video timestamps in chunk labels', () => {
    const text = `[0:15] Welcome to the lecture on retrieval augmented generation.
[1:30] We chunk documents, embed them, and retrieve relevant passages at query time.`;

    const chunks = chunkSourceText(text, { targetSize: 200, overlap: 40 });
    expect(chunks.some((c) => c.timestamp === '1:30')).toBe(true);
    expect(chunks.some((c) => c.label === '1:30')).toBe(true);
  });

  it('returns empty array for blank input', () => {
    expect(chunkSourceText('')).toEqual([]);
    expect(chunkSourceText('   ')).toEqual([]);
  });
});

describe('chunkLabel', () => {
  it('prefers page over timestamp', () => {
    expect(chunkLabel(5, '1:00', 1)).toBe('Page 5');
  });

  it('falls back to section index', () => {
    expect(chunkLabel(null, null, 3)).toBe('Section 3');
  });
});

describe('BM25Index', () => {
  it('ranks relevant documents higher', () => {
    const docs = [
      { text: 'cats and dogs are common pets' },
      { text: 'quantum computing uses qubits and superposition' },
      { text: 'pet care includes feeding and exercise for dogs' },
    ];
    const bm25 = new BM25Index(docs);
    const scores = bm25.score('dogs and pets');
    expect(scores[0]).toBeGreaterThan(scores[1]);
    expect(scores[2]).toBeGreaterThan(scores[1]);
  });
});

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });
});

describe('reciprocalRankFusion', () => {
  it('boosts documents ranked highly in both lists', () => {
    const fused = reciprocalRankFusion([
      [2, 0, 1],
      [0, 2, 1],
    ]);
    const topTwo = fused.slice(0, 2).map((f) => f.idx).sort();
    expect(topTwo).toEqual([0, 2]);
    const tail = fused.find((f) => f.idx === 1);
    expect(tail.score).toBeLessThan(fused[0].score);
  });
});

describe('hybridRetrieve', () => {
  it('returns top-k chunks with scores', () => {
    const chunks = [
      { id: 1, text: 'retrieval augmented generation pipeline', embedding: [1, 0, 0], label: 'Section 1' },
      { id: 2, text: 'unrelated cooking recipes for pasta', embedding: [0, 1, 0], label: 'Section 2' },
      { id: 3, text: 'vector search and bm25 hybrid fusion', embedding: [0.9, 0.1, 0], label: 'Section 3' },
    ];
    const index = { chunks, bm25: new BM25Index(chunks), sourceType: 'pdf', chunkCount: 3 };
    const queryEmbedding = [1, 0, 0];
    const hits = hybridRetrieve(index, 'retrieval generation', queryEmbedding, 2);

    expect(hits).toHaveLength(2);
    expect(hits[0].chunk.id).toBe(1);
    expect(hits[0].score).toBeGreaterThan(0);
  });
});
